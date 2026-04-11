/**
 * modular-additive-processor.js — AudioWorklet processor for the
 * "Modular" mode additive voice (modular-additive.dsp).
 *
 * Extends FaustWorkletProcessor (faust-worklet-processor.js).
 * Loads modular-subtractive.wasm compiled by `faust -lang wasm`.
 *
 * Param-index strategy:
 *   modular-additive.dsp has ~700 parameters (25 engine + 80 ADSR + 96 LFO
 *   + 480 matrix + 3 hidden). Hand-maintained zone tables (additive-processor
 *   style) do not scale. Instead we use the wasm-native JSON descriptor
 *   produced by `faust -lang wasm`, which has a numeric `index` field on each
 *   leaf item. That index is the direct memory offset that setParamValue
 *   expects as its zone argument — no sentinel scanning, no address strings.
 *
 *   The main thread fetches modular-additive.json, parses it, and passes
 *   the UI tree to the worklet via the init message.
 *
 * Calling convention (faust -lang wasm, single-instance):
 *   init(dsp, sampleRate)           dsp is always 0
 *   compute(dsp, n, inputs, outputs)
 *   setParamValue(dsp, zone, value) zone = numeric memory address from JSON
 *   getParamValue(dsp, zone) -> float
 *
 * Hidden params (not in the engine's ML-controllable list):
 *   0_Hidden/freq  — set by noteOn
 *   0_Hidden/gate  — set by noteOn/noteOff (button, value 0/1)
 *   0_Hidden/_vel  — set by noteOn
 */

// Must be imported in AudioWorkletGlobalScope — include faust-worklet-processor.js
// via audioCtx.audioWorklet.addModule() before this file.

const DSP = 0;
const BLOCK_SIZE = 128;

class ModularAdditiveProcessor extends FaustWorkletProcessor {
  constructor(options) {
    super(options);
    this._dspInst     = null;
    this._dspMemory   = null;  // live Float32Array view
    this._sampleRate  = 48000;

    // Zone tables, populated once the init message has been processed.
    this._paramZones         = [];    // NISPS index (order from JSON walk) -> zone
    this._paramZonesByLabel  = {};    // label -> zone (for smoke test)
    this._hiddenZones        = {};    // {freq, gate, _vel} -> zone

    // Audio output buffer pointers
    this._outPtrsAddr = 0;
    this._outLAddr    = 0;
    this._outRAddr    = 0;
  }

  // ---------------------------------------------------------------------------
  // _initWasm — called by FaustWorkletProcessor.handleMessage on 'init'.
  //
  // Extra fields on the init message:
  //   uiJson — parsed Faust UI descriptor (the .json file contents) for
  //            zone discovery. Faust's -lang wasm embeds numeric `index`
  //            fields that we use directly as zone memory addresses.
  // ---------------------------------------------------------------------------

  async _initWasm(wasmBytes, sampleRate, uiJson) {
    this._sampleRate = sampleRate;

    const importObj = {
      env: {
        _sinf:       Math.sin,
        _cosf:       Math.cos,
        _tanf:       Math.tan,
        _expf:       Math.exp,
        _logf:       Math.log,
        _log10f:     Math.log10,
        _powf:       Math.pow,
        _tanhf:      Math.tanh,
        _sqrtf:      Math.sqrt,
        _fabsf:      Math.abs,
        _floorf:     Math.floor,
        _ceilf:      Math.ceil,
        _remainderf: (a, b) => a - Math.round(a / b) * b,
        _fmodf:      (a, b) => a % b,
        _roundf:     Math.round,
        _truncf:     Math.trunc,
        _acosf:      Math.acos,
        _asinf:      Math.asin,
        _atanf:      Math.atan,
        _atan2f:     Math.atan2,
      },
    };

    const result = await WebAssembly.instantiate(wasmBytes, importObj);
    this._dspInst = result.instance;
    const ex = this._dspInst.exports;

    // Grow memory by 2 pages (128 KB) so the output buffer region sits past
    // Faust's allocated parameter zones. After growth we have at least
    // 3 * BLOCK_SIZE * 4 bytes of scratch at the high end of memory.
    ex.memory.grow(2);

    this._dspMemory = new Float32Array(ex.memory.buffer);

    // Initialise the DSP instance (single-instance convention: dsp = 0)
    ex.init(DSP, sampleRate);

    // Allocate output buffers at the top of WASM memory.
    const memBytes = ex.memory.buffer.byteLength;
    this._outLAddr    = memBytes - BLOCK_SIZE * 4 * 3;
    this._outRAddr    = this._outLAddr + BLOCK_SIZE * 4;
    this._outPtrsAddr = this._outRAddr + BLOCK_SIZE * 4;

    const u32 = new Uint32Array(ex.memory.buffer);
    u32[this._outPtrsAddr / 4]     = this._outLAddr;
    u32[this._outPtrsAddr / 4 + 1] = this._outRAddr;

    // Refresh the float view after any potential reallocation
    this._dspMemory = new Float32Array(ex.memory.buffer);

    // Build the zone index from the JSON we were passed.
    if (uiJson) {
      this._buildZoneIndexFromJson(uiJson);
    } else {
      console.warn('[ModularAdditiveProcessor] no uiJson in init message — ' +
                   'setParam will silently no-op.');
    }
  }

  // -------------------------------------------------------------------------
  // _buildZoneIndexFromJson — walk the Faust UI tree and collect numeric
  // zone indexes, separating hidden params from the main NISPS-controllable
  // list. Preserves the UI tree's traversal order, which matches the order
  // the playground's faustJsonToParamMeta() parser will produce.
  // -------------------------------------------------------------------------

  _buildZoneIndexFromJson(faustJson) {
    const HIDDEN_TAIL = new Set(['freq', 'gate', '_vel']);
    const zones = [];
    const byLabel = {};
    const hidden = {};

    const walk = (items) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        const type = item?.type;
        if (type === 'hslider' || type === 'vslider' ||
            type === 'nentry'  || type === 'button' ||
            type === 'checkbox') {
          const label = item.label ?? '';
          const idx = item.index;
          if (typeof idx !== 'number') continue;

          const hasHiddenMeta = Array.isArray(item.meta) &&
            item.meta.some(m => m.hidden === '1' || m.hidden === 1);
          const tail = label.includes('/') ? label.split('/').pop() : label;

          if (hasHiddenMeta || HIDDEN_TAIL.has(tail)) {
            hidden[tail] = idx;
          } else {
            zones.push(idx);
            byLabel[label] = idx;
          }
        } else if (item?.items) {
          walk(item.items);
        }
      }
    };

    walk(faustJson.ui ?? []);

    this._paramZones        = zones;
    this._paramZonesByLabel = byLabel;
    this._hiddenZones       = hidden;
  }

  // -------------------------------------------------------------------------
  // _onSetParam — look up the zone by NISPS index and poke the DSP
  // -------------------------------------------------------------------------

  _onSetParam(index, value) {
    if (!this._dspInst) return;
    const zone = this._paramZones[index];
    if (zone === undefined) return;
    this._dspInst.exports.setParamValue(DSP, zone, value);
  }

  _onNoteOn(freq, vel) {
    if (!this._dspInst) return;
    const ex = this._dspInst.exports;
    const z = this._hiddenZones;
    if (z.freq !== undefined) ex.setParamValue(DSP, z.freq, freq);
    if (z._vel !== undefined) ex.setParamValue(DSP, z._vel, vel ?? 0.7);
    if (z.gate !== undefined) ex.setParamValue(DSP, z.gate, 1.0);
  }

  _onNoteOff(_freq) {
    if (!this._dspInst) return;
    const z = this._hiddenZones;
    if (z.gate !== undefined) {
      this._dspInst.exports.setParamValue(DSP, z.gate, 0.0);
    }
  }

  // -------------------------------------------------------------------------
  // Extended message handling — override for setByLabel + init-with-json
  // -------------------------------------------------------------------------

  _handleMessage(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'init') {
      // Override the base class's init path so we can thread `uiJson` through.
      this._initWasm(msg.wasmBytes, msg.sampleRate || sampleRate, msg.uiJson)
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

    // Buffer anything that arrives before init() finishes. See
    // faust-worklet-processor.js._queueIfNotReady.
    if (this._queueIfNotReady(msg)) return;

    if (msg.type === 'setByLabel') {
      const zone = this._paramZonesByLabel[msg.label];
      if (zone !== undefined) {
        this._dspInst.exports.setParamValue(DSP, zone, msg.value);
      }
      return;
    }

    // Delegate everything else (setParam, noteOn, noteOff) to the base class.
    super._handleMessage(msg);
  }

  // -------------------------------------------------------------------------
  // _renderBlock — call Faust compute, copy output buffers
  // -------------------------------------------------------------------------

  _renderBlock(outL, outR, blockSize) {
    if (!this._dspInst || !this._dspMemory) return;

    const ex = this._dspInst.exports;
    ex.compute(DSP, blockSize, 0, this._outPtrsAddr);

    const wL = new Float32Array(ex.memory.buffer, this._outLAddr, blockSize);
    const wR = new Float32Array(ex.memory.buffer, this._outRAddr, blockSize);
    outL.set(wL);
    outR.set(wR);
  }
}

registerProcessor('modular-additive-processor', ModularAdditiveProcessor);
