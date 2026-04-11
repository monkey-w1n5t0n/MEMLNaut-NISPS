/**
 * faust-worklet-processor.js — Base AudioWorklet processor for Faust WASM engines
 *
 * This file must be loaded via audioContext.audioWorklet.addModule() before
 * creating a FaustWorkletNode.  It runs in AudioWorkletGlobalScope.
 *
 * Each Faust engine subclasses FaustWorkletProcessor and overrides:
 *   - static get processorName() — returns the unique processor name string
 *   - _initWasm(wasmBytes, sampleRate) — initialises the Faust WASM instance
 *   - _renderBlock(outputL, outputR, blockSize) — fills output buffers per block
 *
 * Message protocol (port.postMessage from main thread):
 *   { type: 'init',     wasmBytes: ArrayBuffer, sampleRate: number }
 *   { type: 'setParam', index: number, value: number }
 *   { type: 'noteOn',   freq: number, vel: number }
 *   { type: 'noteOff',  freq: number }
 *
 * Replies from worklet to main thread:
 *   { type: 'ready' }
 *   { type: 'error', message: string }
 */

class FaustWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this._ready = false;
    this._paramValues = {};  // index → current value (raw Faust units)

    // Messages that arrive before init() finishes are buffered here and
    // drained by _drainPendingMessages() in order once the subclass sets
    // _ready = true. Subclasses with extended _handleMessage() should call
    // _queueIfNotReady(msg) as their first line to participate.
    this._pendingMessages = [];

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  // ---------------------------------------------------------------------------
  // Pre-ready message buffering
  // ---------------------------------------------------------------------------

  /**
   * Returns true if the message was queued (processor not ready yet).
   * Subclasses should call this at the top of their _handleMessage override
   * after the 'init' special case, before touching _dspInst.
   */
  _queueIfNotReady(msg) {
    if (this._ready) return false;
    if (!msg || msg.type === 'init') return false;
    this._pendingMessages.push(msg);
    return true;
  }

  /** Drain all buffered pre-ready messages, in arrival order. */
  _drainPendingMessages() {
    if (this._pendingMessages.length === 0) return;
    const pending = this._pendingMessages;
    this._pendingMessages = [];
    for (const msg of pending) {
      try { this._handleMessage(msg); }
      catch (err) {
        this.port.postMessage({
          type: 'error',
          message: 'drain failed: ' + String(err),
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Message handler (runs in worklet thread)
  // ---------------------------------------------------------------------------

  _handleMessage(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'init') {
      this._initWasm(msg.wasmBytes, msg.sampleRate || sampleRate)
        .then(() => {
          this._ready = true;
          this.port.postMessage({ type: 'ready' });
          this._drainPendingMessages();
        })
        .catch((err) => {
          this.port.postMessage({ type: 'error', message: String(err) });
        });
      return;
    }

    if (this._queueIfNotReady(msg)) return;

    switch (msg.type) {
      case 'setParam':
        this._paramValues[msg.index] = msg.value;
        this._onSetParam(msg.index, msg.value);
        break;

      case 'noteOn':
        this._onNoteOn(msg.freq, msg.vel);
        break;

      case 'noteOff':
        this._onNoteOff(msg.freq);
        break;

      default:
        console.warn('[FaustWorkletProcessor] Unknown message type:', msg.type);
    }
  }

  // ---------------------------------------------------------------------------
  // AudioWorkletProcessor interface
  // ---------------------------------------------------------------------------

  process(_inputs, outputs, _params) {
    if (!this._ready) return true;

    const out = outputs[0];
    const blockSize = out[0]?.length ?? 128;
    const outL = out[0] ?? new Float32Array(blockSize);
    const outR = out[1] ?? new Float32Array(blockSize);

    this._renderBlock(outL, outR, blockSize);

    return true; // keep processor alive
  }

  // ---------------------------------------------------------------------------
  // Subclass API — override these in concrete engine processors
  // ---------------------------------------------------------------------------

  /**
   * Initialise the WASM module.  Called once with the raw bytes and sample rate.
   * Must return a Promise that resolves when the engine is ready to render.
   *
   * @param {ArrayBuffer} wasmBytes
   * @param {number}      sampleRate
   * @returns {Promise<void>}
   */
  async _initWasm(_wasmBytes, _sampleRate) {
    // Default no-op: subclasses that don't use WASM can override _renderBlock only.
  }

  /**
   * Called when a parameter value changes.  Override to forward to DSP.
   * @param {number} index  Param index (matches paramMeta order)
   * @param {number} value  Raw value in Faust units
   */
  _onSetParam(_index, _value) {}

  /**
   * Called on note-on.
   * @param {number} freq  Hz
   * @param {number} vel   0–1
   */
  _onNoteOn(_freq, _vel) {}

  /**
   * Called on note-off.
   * @param {number} freq  Hz
   */
  _onNoteOff(_freq) {}

  /**
   * Fill a single audio block.  Called from process() every 128 samples.
   * Both arrays are pre-allocated Float32Arrays of length blockSize.
   *
   * @param {Float32Array} outL  Left channel output buffer (write to this)
   * @param {Float32Array} outR  Right channel output buffer (write to this)
   * @param {number}       blockSize
   */
  _renderBlock(_outL, _outR, _blockSize) {
    // Default: silence — override in subclass
  }
}

// Explicitly attach to globalThis so subsequent addModule() scripts can see
// it. Class declarations at the top of a classic script are lexically scoped
// to that script's evaluation context and do NOT propagate across separate
// addModule() calls; an explicit property assignment is required for the
// cross-script reference to resolve.
globalThis.FaustWorkletProcessor = FaustWorkletProcessor;

// Note: registerProcessor() is called by each concrete engine file, not here,
// because each engine has its own processor name.
// Subclass files should end with:
//   registerProcessor('my-engine-processor', MyEngineProcessor);
