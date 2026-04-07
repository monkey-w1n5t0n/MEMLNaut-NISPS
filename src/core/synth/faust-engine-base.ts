/**
 * faust-engine-base.ts — Base class for Faust WASM synth engines
 *
 * Handles the common lifecycle for engines compiled from Faust .dsp files:
 *   1. Fetch the .json descriptor → build paramMeta via loadFaustParamMeta()
 *   2. Fetch the .wasm binary and transfer it to an AudioWorkletNode
 *   3. Wire setParam / noteOn / noteOff through worklet messages
 *
 * Usage:
 *   class AdditiveEngine extends FaustEngineBase {
 *     constructor() {
 *       super({
 *         id:            'additive',
 *         displayName:   'Additive',
 *         wasmUrl:       '/faust/additive.wasm',
 *         jsonUrl:       '/faust/additive.json',
 *         workletUrl:    '/faust/additive-processor.js',
 *         processorName: 'additive-processor',
 *       });
 *     }
 *   }
 *
 *   const engine = new AdditiveEngine();
 *   await engine.init(audioCtx);
 *   engine.noteOn(69, 0.8);    // A4, velocity 0.8
 *   engine.setParam(0, 0.5);   // first param at 50%
 */

import { SynthEngine, type ParamMeta } from './engine-interface.js';
import { loadFaustParamMeta } from './faust-param-meta.js';

// ---------------------------------------------------------------------------
// Worklet message shapes
// ---------------------------------------------------------------------------

type WorkletInitMsg = {
  type: 'init';
  wasmBytes: ArrayBuffer;
  sampleRate: number;
};

type WorkletSetParamMsg = {
  type: 'setParam';
  index: number;
  value: number;
};

type WorkletNoteOnMsg = {
  type: 'noteOn';
  freq: number;
  vel: number;
};

type WorkletNoteOffMsg = {
  type: 'noteOff';
  freq: number;
};

type WorkletInboundMsg =
  | { type: 'ready' }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

export interface FaustEngineBaseOptions {
  /** Short unique id (e.g. 'additive') */
  id: string;
  /** Human-readable name shown in UI */
  displayName: string;
  /** URL to the .wasm binary produced by faust -lang wasm */
  wasmUrl: string;
  /** URL to the Faust .json descriptor */
  jsonUrl: string;
  /** URL to the AudioWorklet processor JS file */
  workletUrl: string;
  /** Name passed to registerProcessor() inside workletUrl */
  processorName: string;
}

// ---------------------------------------------------------------------------
// FaustEngineBase
// ---------------------------------------------------------------------------

export class FaustEngineBase extends SynthEngine {
  private readonly _id: string;
  private readonly _displayName: string;
  private readonly _wasmUrl: string;
  private readonly _jsonUrl: string;
  private readonly _workletUrl: string;
  private readonly _processorName: string;

  private _paramMeta: ParamMeta[] = [];
  private _audioCtx: AudioContext | null = null;
  private _workletNode: AudioWorkletNode | null = null;
  private _masterGain: GainNode | null = null;
  private _outputNode: AudioNode | null = null;
  private _onReady: (() => void) | null = null;

  constructor(opts: FaustEngineBaseOptions) {
    super();
    this._id            = opts.id;
    this._displayName   = opts.displayName;
    this._wasmUrl       = opts.wasmUrl;
    this._jsonUrl       = opts.jsonUrl;
    this._workletUrl    = opts.workletUrl;
    this._processorName = opts.processorName;
  }

  // ---------------------------------------------------------------------------
  // SynthEngine identity
  // ---------------------------------------------------------------------------

  override get id(): string          { return this._id; }
  override get displayName(): string { return this._displayName; }
  override get paramMeta(): ParamMeta[] { return this._paramMeta; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Eagerly load ONLY the JSON descriptor (no WASM, no AudioContext needed).
   * Safe to call multiple times — no-ops if paramMeta is already populated.
   * This ensures paramCount is available before init() for MLP sizing.
   */
  async loadParamMeta(): Promise<void> {
    if (this._paramMeta.length > 0) return;
    this._paramMeta = await loadFaustParamMeta(this._jsonUrl);
  }

  /**
   * Initialise the engine: fetch JSON → build paramMeta → load WASM worklet.
   *
   * @param audioCtx  A running (or suspended) AudioContext.
   */
  override async init(audioCtx: AudioContext): Promise<void> {
    if (this._running) return;

    this._audioCtx = audioCtx;

    // Step 1: fetch and parse the Faust JSON descriptor → paramMeta
    // (skip if already loaded eagerly via loadParamMeta())
    if (this._paramMeta.length === 0) {
      this._paramMeta = await loadFaustParamMeta(this._jsonUrl);
    }

    // Step 2: fetch the WASM binary
    const wasmResp = await fetch(this._wasmUrl);
    if (!wasmResp.ok) {
      throw new Error(
        `[FaustEngineBase:${this._id}] Failed to fetch WASM: ${wasmResp.status}`,
      );
    }
    const wasmBytes = await wasmResp.arrayBuffer();

    // Step 3: register the AudioWorklet module (browser deduplicates)
    await audioCtx.audioWorklet.addModule(this._workletUrl);

    // Step 4: create the AudioWorkletNode
    this._workletNode = new AudioWorkletNode(audioCtx, this._processorName, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // Step 5: listen for worklet → main thread messages
    this._workletNode.port.onmessage = (e: MessageEvent<WorkletInboundMsg>) =>
      this._handleWorkletMsg(e.data);

    // Step 6: connect to audio graph through a master gain node
    this._masterGain = audioCtx.createGain();
    this._masterGain.gain.value = 0.7;
    this._workletNode.connect(this._masterGain);
    this._masterGain.connect(audioCtx.destination);
    this._outputNode = this._masterGain;

    // Step 7: send init message — transfer ownership of wasmBytes to avoid copy
    const initMsg: WorkletInitMsg = {
      type: 'init',
      wasmBytes,
      sampleRate: audioCtx.sampleRate,
    };
    this._workletNode.port.postMessage(initMsg, [wasmBytes]);

    // Wait for worklet to confirm readiness (10 s timeout)
    await this._waitForReady(10_000);
  }

  /** Return the output AudioNode (for downstream routing). */
  override getOutputNode(): AudioNode {
    if (!this._outputNode) {
      throw new Error(`[FaustEngineBase:${this._id}] Engine not initialised — call init() first`);
    }
    return this._outputNode;
  }

  /** Stop audio output (mute, but keep worklet alive for quick restart). */
  async stop(): Promise<void> {
    if (this._masterGain && this._audioCtx) {
      this._masterGain.gain.setTargetAtTime(0, this._audioCtx.currentTime, 0.01);
    }
    this._running = false;
  }

  /** Restart audio output after stop(). */
  async start(): Promise<void> {
    if (this._masterGain && this._audioCtx) {
      this._masterGain.gain.setTargetAtTime(0.7, this._audioCtx.currentTime, 0.01);
    }
    this._running = true;
  }

  /** Release all resources. */
  override dispose(): void {
    if (this._masterGain) {
      this._masterGain.disconnect();
      this._masterGain = null;
    }
    if (this._workletNode) {
      this._workletNode.disconnect();
      this._workletNode.port.onmessage = null;
      this._workletNode = null;
    }
    this._outputNode = null;
    this._running = false;
  }

  // ---------------------------------------------------------------------------
  // Real-time control
  // ---------------------------------------------------------------------------

  /**
   * Set a parameter by index.
   * normalizedValue is [0, 1] and is mapped to the param's [min, max] range.
   *
   * @param index            Index into paramMeta
   * @param normalizedValue  0–1
   */
  override setParam(index: number, normalizedValue: number): void {
    if (!this._workletNode) return;
    const meta = this._paramMeta[index];
    if (!meta) return;
    const raw = meta.min + normalizedValue * (meta.max - meta.min);
    const msg: WorkletSetParamMsg = { type: 'setParam', index, value: raw };
    this._workletNode.port.postMessage(msg);
  }

  /**
   * Trigger a note.
   *
   * @param note  MIDI note number 0–127 (converted to Hz internally)
   * @param vel   Velocity 0–1 (default 0.7)
   */
  override noteOn(note: number, vel = 0.7): void {
    if (!this._workletNode) return;
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    const msg: WorkletNoteOnMsg = { type: 'noteOn', freq, vel };
    this._workletNode.port.postMessage(msg);
  }

  /**
   * Release a note.
   *
   * @param note  MIDI note number 0–127
   */
  override noteOff(note: number): void {
    if (!this._workletNode) return;
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    const msg: WorkletNoteOffMsg = { type: 'noteOff', freq };
    this._workletNode.port.postMessage(msg);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private _handleWorkletMsg(data: WorkletInboundMsg): void {
    if (!data) return;
    if (data.type === 'ready') {
      this._running = true;
      this._onReady?.();
    } else if (data.type === 'error') {
      console.error(`[FaustEngineBase:${this._id}] Worklet error:`, data.message);
    }
  }

  private _waitForReady(timeoutMs: number): Promise<void> {
    if (this._running) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._onReady = null;
        reject(
          new Error(`[FaustEngineBase:${this._id}] Timed out waiting for worklet ready`),
        );
      }, timeoutMs);

      this._onReady = () => {
        clearTimeout(timer);
        this._onReady = null;
        resolve();
      };
    });
  }

}
