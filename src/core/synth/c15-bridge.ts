// C15 WASM synth engine bridge
// Handles WASM loading, AudioWorklet setup, ring buffer communication.
//
// NOTE: C15Bridge creates its OWN AudioContext internally. It does NOT accept
// an external AudioContext. The ring buffer uses SharedArrayBuffer for
// lock-free communication with the AudioWorklet (requires COOP/COEP headers).

const CONFIG = {
  WASM_PATH: '/c15/c15_engine.wasm',
  WORKLET_PATH: '/c15/worklet-processor.js',
  PARAMS_PATH: '/c15/parameters.json',
  SAMPLE_RATE: 48000,
  POLYPHONY: 24,
} as const;

const MESSAGE_TYPE = { PARAMETER: 0, NOTE_ON: 1, NOTE_OFF: 2 } as const;

const HEADER_SIZE = 3;
const MESSAGE_SIZE = 4;
const RING_CAPACITY = 512;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface C15RawParam {
  id: number;
  valid: boolean;
  defaultValue: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// RingBufferWriter
// ---------------------------------------------------------------------------

/**
 * Multi-producer-safe ring buffer writer using CAS (compare-and-swap).
 * Safe for concurrent writes from main thread + arpeggiator Worker.
 *
 * Layout (Float32Array view of the SharedArrayBuffer):
 *   [0]  writeIdx (also used as Int32 for Atomics)
 *   [1]  readIdx  (also used as Int32 for Atomics)
 *   [2]  pendingCount (atomic Int32 — incremented after each write)
 *   [HEADER_SIZE + slotIndex * MESSAGE_SIZE + 0]  type
 *   [HEADER_SIZE + slotIndex * MESSAGE_SIZE + 1]  id
 *   [HEADER_SIZE + slotIndex * MESSAGE_SIZE + 2]  value
 *   [HEADER_SIZE + slotIndex * MESSAGE_SIZE + 3]  (reserved)
 */
class RingBufferWriter {
  private readonly _sab: SharedArrayBuffer;
  private readonly _buffer: Float32Array;
  private readonly _int32: Int32Array;

  constructor(sharedBuffer: SharedArrayBuffer) {
    this._sab = sharedBuffer;
    this._buffer = new Float32Array(sharedBuffer);
    this._int32 = new Int32Array(sharedBuffer);
  }

  write(type: number, id: number, value: number): boolean {
    // CAS loop: claim a slot atomically
    for (let attempt = 0; attempt < 4; attempt++) {
      const writeIdx = Atomics.load(this._int32, 0);
      const readIdx = Atomics.load(this._int32, 1);
      const next = (writeIdx + 1) % RING_CAPACITY;
      if (next === readIdx) return false; // full

      // Try to claim this slot
      if (Atomics.compareExchange(this._int32, 0, writeIdx, next) === writeIdx) {
        // Won the slot — write data
        const off = HEADER_SIZE + writeIdx * MESSAGE_SIZE;
        this._buffer[off] = type;
        this._buffer[off + 1] = id;
        this._buffer[off + 2] = value;
        this._buffer[off + 3] = 0;
        Atomics.add(this._int32, 2, 1);
        return true;
      }
      // Another writer took it — retry
    }
    return false; // contention too high
  }

  writeParameter(paramId: number, value: number): boolean {
    return this.write(MESSAGE_TYPE.PARAMETER, paramId, value);
  }

  writeNoteOn(note: number, velocity: number): boolean {
    return this.write(MESSAGE_TYPE.NOTE_ON, note, velocity);
  }

  writeNoteOff(note: number, velocity: number): boolean {
    return this.write(MESSAGE_TYPE.NOTE_OFF, note, velocity);
  }

  /** The SharedArrayBuffer — expose so it can be passed to Workers. */
  get sharedBuffer(): SharedArrayBuffer {
    return this._sab;
  }
}

// ---------------------------------------------------------------------------
// C15Bridge
// ---------------------------------------------------------------------------

export class C15Bridge {
  audioContext: AudioContext | null = null;
  workletNode: AudioWorkletNode | null = null;
  masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private ringWriter: RingBufferWriter | null = null;
  running = false;
  ready = false;
  allParams: C15RawParam[] | null = null;
  private activeNotes: Set<number> = new Set();
  private _sab: SharedArrayBuffer | null = null;
  private _onStatusChange: ((msg: string) => void) | null = null;

  set onStatusChange(fn: (msg: string) => void) {
    this._onStatusChange = fn;
  }

  /** SharedArrayBuffer for the ring buffer — available after start(). */
  get sharedBuffer(): SharedArrayBuffer | null {
    return this._sab;
  }

  /**
   * The limiter node — the last AudioNode before destination.
   * Use this as the input to any post-processing chain (e.g. EOCChain).
   * Only available after start().
   */
  get limiterNode(): DynamicsCompressorNode | null {
    return this.limiter ?? null;
  }

  private _status(msg: string): void {
    console.log('[C15]', msg);
    this._onStatusChange?.(msg);
  }

  async loadParams(): Promise<C15RawParam[]> {
    if (this.allParams) return this.allParams;
    try {
      const res = await fetch(CONFIG.PARAMS_PATH);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as { parameters: C15RawParam[] };
      this.allParams = data.parameters;
    } catch (err) {
      console.warn('[C15] Failed to load parameters.json:', (err as Error).message);
      this.allParams = [];
    }
    return this.allParams!;
  }

  async start(): Promise<void> {
    if (this.running) return;

    try {
      if (typeof SharedArrayBuffer === 'undefined') {
        throw new Error(
          'SharedArrayBuffer not available — serve with COOP/COEP headers',
        );
      }

      this._status('Compiling WASM...');
      const resp = await fetch(CONFIG.WASM_PATH);
      if (!resp.ok) throw new Error(`Failed to fetch WASM: ${resp.status}`);
      const wasmBytes = await resp.arrayBuffer();
      const wasmModule = await WebAssembly.compile(wasmBytes);

      // C15Bridge owns its AudioContext — it does NOT accept an external one.
      this.audioContext = new AudioContext({
        sampleRate: CONFIG.SAMPLE_RATE,
        latencyHint: 'interactive',
      });

      // Ring buffer (passed via processorOptions — worklet reads it immediately)
      const sabSize = (HEADER_SIZE + RING_CAPACITY * MESSAGE_SIZE) * 4;
      const sab = new SharedArrayBuffer(sabSize);
      new Float32Array(sab).fill(0);
      this._sab = sab;
      this.ringWriter = new RingBufferWriter(sab);

      // Load worklet
      this._status('Loading AudioWorklet...');
      await this.audioContext.audioWorklet.addModule(CONFIG.WORKLET_PATH);

      this.workletNode = new AudioWorkletNode(this.audioContext, 'c15-processor', {
        processorOptions: {
          sampleRate: CONFIG.SAMPLE_RATE,
          polyphony: CONFIG.POLYPHONY,
          wasmModule,
          ringBuffer: sab,
        },
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      this.workletNode.port.onmessage = (e: MessageEvent) =>
        this._handleWorkletMsg(e.data as Record<string, unknown>);

      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.5;

      // Limiter: always-on compressor configured as a brick-wall limiter
      this.limiter = this.audioContext.createDynamicsCompressor();
      this.limiter.threshold.value = -6;   // dB — start limiting at -6dB
      this.limiter.knee.value = 3;         // dB — soft knee for less pumping
      this.limiter.ratio.value = 20;       // near-infinite ratio = limiter
      this.limiter.attack.value = 0.002;   // 2ms — fast attack catches transients
      this.limiter.release.value = 0.05;   // 50ms — quick release, less pumping

      this.workletNode.connect(this.masterGain);
      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.audioContext.destination);

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.running = true;
      this._status('Running');
    } catch (err) {
      this._status(`Error: ${(err as Error).message}`);
      console.error('[C15] Start failed:', err);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.panic();
    if (this.audioContext) {
      await this.audioContext.suspend();
    }
    this.running = false;
    this.ready = false;
    this._status('Stopped');
  }

  private _handleWorkletMsg(data: Record<string, unknown>): void {
    if (data['type'] === 'status' && data['status'] === 'ready') {
      this.ready = true;
      this._status('WASM ready');
      this._sendAllDefaults();
    }
  }

  private _sendAllDefaults(): void {
    if (!this.allParams || !this.ringWriter) return;
    for (const p of this.allParams) {
      if (!p.valid) continue;
      this.ringWriter.writeParameter(p.id, Math.max(0, Math.min(1, p.defaultValue)));
    }
    // Set some initial sound: Osc A output level up, envelope sustain
    this.ringWriter.writeParameter(169, 0.75); // Out_Mix_A_Lvl
    this.ringWriter.writeParameter(8,   0.4);  // Env_A_Sus
    this.ringWriter.writeParameter(0,   0.1);  // Env_A_Att (quick)
    this.ringWriter.writeParameter(10,  0.5);  // Env_A_Rel
    this.ringWriter.writeParameter(241, 0.15); // Reverb_Mix
    this.ringWriter.writeParameter(233, 0.08); // Echo_Mix
  }

  setParameter(paramId: number, value: number): void {
    if (!this.ringWriter || !this.running) return;
    this.ringWriter.writeParameter(paramId, Math.max(0, Math.min(1, value)));
  }

  noteOn(note: number, velocity = 0.7): void {
    if (!this.ringWriter || !this.running) return;
    this.ringWriter.writeNoteOn(note, velocity);
    this.activeNotes.add(note);
  }

  noteOff(note: number): void {
    if (!this.ringWriter || !this.running) return;
    this.ringWriter.writeNoteOff(note, 0);
    this.activeNotes.delete(note);
  }

  panic(): void {
    for (const note of this.activeNotes) {
      this.ringWriter?.writeNoteOff(note, 0);
    }
    this.activeNotes.clear();
  }

  setMasterVolume(value: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = value;
    }
  }
}
