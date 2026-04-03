/**
 * faust-engine-base.js — Base class for Faust WASM synth engines
 *
 * Handles the common lifecycle for engines compiled from Faust .dsp files:
 *   1. Fetch the .json descriptor → build paramMeta via faustJsonToParamMeta()
 *   2. Load the .wasm binary as an AudioWorkletNode
 *   3. Wire setParam / noteOn / noteOff through worklet messages
 *
 * Usage:
 *   class AdditiveEngine extends FaustEngineBase {
 *     constructor() {
 *       super({
 *         id:            'additive',
 *         displayName:   'Additive',
 *         wasmUrl:       'faust/additive.wasm',
 *         jsonUrl:       'faust/additive.json',
 *         workletUrl:    'faust/additive-processor.js',
 *         processorName: 'additive-processor',
 *       });
 *     }
 *   }
 *
 *   const engine = new AdditiveEngine();
 *   await engine.init(audioCtx);
 *   engine.noteOn(220, 0.8);
 *   engine.setParam(0, 0.5);
 */

import { SynthEngine } from './engine-interface.js';
import { loadFaustParamMeta } from './faust-param-meta.js';

export class FaustEngineBase extends SynthEngine {
  /**
   * @param {object} opts
   * @param {string} opts.id             Short unique id (e.g. 'additive')
   * @param {string} opts.displayName    Human-readable name
   * @param {string} opts.wasmUrl        URL to the .wasm binary (faust -lang wasm output)
   * @param {string} opts.jsonUrl        URL to the Faust .json descriptor
   * @param {string} opts.workletUrl     URL to the AudioWorklet processor JS file
   * @param {string} opts.processorName  Name passed to registerProcessor() in workletUrl
   */
  constructor({ id, displayName, wasmUrl, jsonUrl, workletUrl, processorName } = {}) {
    super();
    this._id            = id            ?? 'faust-engine';
    this._displayName   = displayName   ?? 'Faust Engine';
    this._wasmUrl       = wasmUrl       ?? null;
    this._jsonUrl       = jsonUrl       ?? null;
    this._workletUrl    = workletUrl    ?? null;
    this._processorName = processorName ?? null;

    this._paramMeta   = [];   // populated in init()
    this._audioCtx    = null;
    this._workletNode = null;
    this._masterGain  = null;
    this._running     = false;
    this._onReady     = null; // internal ready-wait callback
    this._outputNode  = null;
  }

  // ---------------------------------------------------------------------------
  // SynthEngine identity
  // ---------------------------------------------------------------------------

  get id()          { return this._id; }
  get displayName() { return this._displayName; }
  get paramMeta()   { return this._paramMeta; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialise the engine: fetch JSON → build paramMeta → load WASM worklet.
   *
   * @param {AudioContext} audioCtx  A running (or suspended) AudioContext.
   * @returns {Promise<void>}
   */
  async init(audioCtx) {
    if (this._running) return;
    this._audioCtx = audioCtx;

    // Step 1: fetch and parse the Faust JSON descriptor → paramMeta
    this._paramMeta = await loadFaustParamMeta(this._jsonUrl);

    // Step 2: fetch the WASM binary
    const wasmResp = await fetch(this._wasmUrl);
    if (!wasmResp.ok) {
      throw new Error(`[FaustEngineBase:${this._id}] Failed to fetch WASM: ${wasmResp.status}`);
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
    this._workletNode.port.onmessage = (e) => this._handleWorkletMsg(e.data);

    // Step 6: connect to audio graph through a master gain node
    this._masterGain = audioCtx.createGain();
    this._masterGain.gain.value = 0.7;
    this._workletNode.connect(this._masterGain);
    this._masterGain.connect(audioCtx.destination);
    this._outputNode = this._masterGain;

    // Step 7: send init message — transfer ownership of wasmBytes to avoid copy
    this._workletNode.port.postMessage(
      { type: 'init', wasmBytes, sampleRate: audioCtx.sampleRate },
      [wasmBytes]
    );

    // Wait for worklet to confirm readiness (10 s timeout)
    await this._waitForReady(10_000);
  }

  /** Return the output AudioNode (for downstream routing). */
  getOutputNode() {
    return this._outputNode;
  }

  /** Release all resources. */
  dispose() {
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
   * @param {number} index            Index into paramMeta
   * @param {number} normalizedValue  0–1
   */
  setParam(index, normalizedValue) {
    if (!this._workletNode) return;
    const meta = this._paramMeta[index];
    if (!meta) return;
    const raw = meta.min + normalizedValue * (meta.max - meta.min);
    this._workletNode.port.postMessage({ type: 'setParam', index, value: raw });
  }

  /**
   * Trigger a note.
   * @param {number} note  MIDI note number 0–127 (converts to Hz internally)
   * @param {number} vel   Velocity 0–1 (default 0.7)
   */
  noteOn(note, vel = 0.7) {
    if (!this._workletNode) return;
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    this._workletNode.port.postMessage({ type: 'noteOn', freq, vel });
  }

  /**
   * Release a note.
   * @param {number} note  MIDI note number 0–127
   */
  noteOff(note) {
    if (!this._workletNode) return;
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    this._workletNode.port.postMessage({ type: 'noteOff', freq });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _handleWorkletMsg(data) {
    if (!data) return;
    if (data.type === 'ready') {
      this._running = true;
      this._onReady?.();
    } else if (data.type === 'error') {
      console.error(`[FaustEngineBase:${this._id}] Worklet error:`, data.message);
    }
  }

  _waitForReady(timeoutMs) {
    if (this._running) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._onReady = null;
        reject(new Error(`[FaustEngineBase:${this._id}] Timed out waiting for worklet ready`));
      }, timeoutMs);

      this._onReady = () => {
        clearTimeout(timer);
        this._onReady = null;
        resolve();
      };
    });
  }
}
