/**
 * PowerfulSynth — the browser host for the Powerful Synth Engine (a WASM synth
 * running inside an AudioWorklet). Port of the old playground bridge.
 *
 * One instance owns its own 48 kHz AudioContext, the worklet node, a master
 * gain and an always-on limiter. Parameters and notes reach the worklet through
 * a shared ring buffer (`ring`, see ./ring.ts) that other threads (e.g. the
 * sequencer worker) can also write into.
 *
 * `start()` must be called from a user gesture. The worklet keeps its WASM
 * state in module globals, so only ONE synth may be running per page; a second
 * `start()` while another instance is live fails with an error status.
 */
import { RingBufferWriter, createRingBuffer } from './ring';
import { SYNTH_PARAM_MAP, findSynthParam } from './psynth-params';

const SAMPLE_RATE = 48000;
const POLYPHONY = 24;
const PROCESSOR_NAME = 'psynth-processor';
const READY_TIMEOUT_MS = 8000;

/** The instance currently holding the page-wide single-instance slot. */
let liveInstance: PowerfulSynth | null = null;

function assetUrl(file: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return new URL(base + 'psynth/' + file, document.baseURI).toString();
}

interface ParametersFile {
  parameters: { id: number; valid: boolean; name: string; defaultValue: number }[];
}

export type SynthStatusListener = (message: string) => void;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class PowerfulSynth {
  /** Shared ring buffer; available after `start()`. Sequencer workers write notes here. */
  ring: SharedArrayBuffer | null = null;

  /** Optional status callback (progress and errors, British spelling). */
  onStatusChange: SynthStatusListener | null = null;

  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private writer: RingBufferWriter | null = null;
  private running = false;
  private starting: Promise<void> | null = null;
  private masterValue = 0.5;
  private defaults: { id: number; value: number }[] | null = null;
  private readonly activeNotes = new Set<number>();
  private readyResolve: (() => void) | null = null;

  get isRunning(): boolean {
    return this.running;
  }

  /** Last AudioNode before the destination (for post-processing), or null before start. */
  get outputNode(): AudioNode | null {
    return this.limiter ?? this.master;
  }

  private status(msg: string): void {
    console.log('[psynth]', msg);
    this.onStatusChange?.(msg);
  }

  /** Start (or resume) audio. Call from a user gesture. Never throws; failures set the status. */
  start(): Promise<void> {
    if (this.running) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    if (liveInstance && liveInstance !== this) {
      this.status('Error: another Powerful Synth Engine is already running on this page');
      return;
    }
    liveInstance = this;
    try {
      if (this.ctx && this.node) {
        // Restart after stop(): the graph exists, just resume it.
        await this.ctx.resume();
        this.running = true;
        this.status('Running');
        return;
      }
      if (typeof SharedArrayBuffer === 'undefined') {
        throw new Error('SharedArrayBuffer unavailable (cross-origin isolation required)');
      }
      this.status('Compiling synth…');
      const [wasmResp, paramsResp] = await Promise.all([
        fetch(assetUrl('engine.wasm')),
        fetch(assetUrl('parameters.json')),
      ]);
      if (!wasmResp.ok) throw new Error(`Failed to fetch engine.wasm: ${wasmResp.status}`);
      const wasmModule = await WebAssembly.compile(await wasmResp.arrayBuffer());
      this.defaults = paramsResp.ok ? this.parseDefaults(await paramsResp.json()) : [];

      const AC: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
      this.ctx = ctx;

      const ring = this.ring ?? createRingBuffer();
      this.ring = ring;
      this.writer = new RingBufferWriter(ring);

      this.status('Loading audio worklet…');
      await ctx.audioWorklet.addModule(assetUrl('worklet-processor.js'));

      const ready = new Promise<void>((resolve, reject) => {
        this.readyResolve = resolve;
        setTimeout(() => reject(new Error('Synth engine did not become ready')), READY_TIMEOUT_MS);
      });
      const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
        processorOptions: { sampleRate: SAMPLE_RATE, polyphony: POLYPHONY, wasmModule, ringBuffer: ring },
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.node = node;
      node.port.onmessage = (e: MessageEvent) => {
        const d = e.data as { type?: string; status?: string } | undefined;
        if (d?.type === 'status' && d.status === 'ready') this.readyResolve?.();
      };

      const master = ctx.createGain();
      master.gain.value = this.masterValue;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 3;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.05;
      node.connect(master);
      master.connect(limiter);
      limiter.connect(ctx.destination);
      this.master = master;
      this.limiter = limiter;

      if (ctx.state === 'suspended') await ctx.resume();
      await ready;
      this.running = true;
      this.writeDefaults();
      this.status('Running');
    } catch (err) {
      this.status(`Error: ${(err as Error).message}`);
      console.error('[psynth] start failed:', err);
      this.teardownGraph();
      if (liveInstance === this) liveInstance = null;
    }
  }

  private parseDefaults(data: ParametersFile): { id: number; value: number }[] {
    return data.parameters.filter((p) => p.valid).map((p) => ({ id: p.id, value: clamp01(p.defaultValue) }));
  }

  /** Engine defaults plus a small "audible" starting sound (as the old bridge did). */
  private writeDefaults(): void {
    const w = this.writer;
    if (!w || !this.defaults) return;
    for (const d of this.defaults) w.writeParameter(d.id, d.value);
    w.writeParameter(169, 0.75); // Out_Mix_A_Lvl
    w.writeParameter(8, 0.4); // Env_A_Sus
    w.writeParameter(0, 0.1); // Env_A_Att
    w.writeParameter(10, 0.5); // Env_A_Rel
    w.writeParameter(241, 0.15); // Reverb_Mix
    w.writeParameter(233, 0.08); // Echo_Mix
  }

  /** Silence and suspend audio. The graph is kept, so `start()` resumes it. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.panic();
    this.running = false;
    await this.ctx?.suspend();
    this.status('Stopped');
  }

  /** Release the audio graph and the single-instance slot. The instance is unusable afterwards. */
  dispose(): void {
    this.panic();
    this.running = false;
    this.teardownGraph();
    if (liveInstance === this) liveInstance = null;
  }

  private teardownGraph(): void {
    try {
      this.node?.disconnect();
      this.master?.disconnect();
      this.limiter?.disconnect();
      void this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.node = null;
    this.master = null;
    this.limiter = null;
    this.ctx = null;
    this.writer = null;
    this.ring = null;
    this.running = false;
  }

  /** Write a normalised (0..1) value for a named parameter. Unknown names are ignored. */
  setParamByName(name: string, v01: number): void {
    const p = findSynthParam(name);
    if (p) this.setParamByHardwareId(p.id, v01);
  }

  /** Write a normalised (0..1) value for a hardware parameter id. Allocation-free. */
  setParamByHardwareId(id: number, v01: number): void {
    if (!this.writer || !this.running) return;
    this.writer.writeParameter(id, clamp01(v01));
  }

  noteOn(note: number, velocity = 0.7): void {
    if (!this.writer || !this.running) return;
    this.writer.noteOn(note, velocity);
    this.activeNotes.add(note);
  }

  noteOff(note: number): void {
    if (!this.writer || !this.running) return;
    this.writer.noteOff(note, 0);
    this.activeNotes.delete(note);
  }

  /** Release every note started through this instance. */
  panic(): void {
    for (const n of this.activeNotes) this.writer?.noteOff(n, 0);
    this.activeNotes.clear();
  }

  setMasterGain(value: number): void {
    this.masterValue = value;
    if (this.master) this.master.gain.value = value;
  }
}

/** Number of curated parameters the synth exposes to a model. */
export const SYNTH_PARAM_COUNT = SYNTH_PARAM_MAP.length;
