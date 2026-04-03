/**
 * fm-matrix-processor.js — AudioWorklet processor for the FM Matrix synth engine
 *
 * Extends FaustWorkletProcessor (faust-worklet-processor.js).
 * Loads fm-matrix.wasm compiled from fm-matrix.dsp.
 *
 * Parameter addresses are built from the Faust JSON descriptor at init time.
 * Index→address mapping follows the order returned by faustJsonToParamMeta()
 * (alphabetical within groups, groups in declaration order).
 *
 * Hidden params (not in NISPS 55-param list):
 *   /fm-matrix/Master/freq  — set by noteOn
 *   /fm-matrix/Master/gate  — set by noteOn/noteOff
 *   /fm-matrix/Master/_vel  — set by noteOn
 */

// Must be imported in AudioWorkletGlobalScope — include faust-worklet-processor.js
// via audioCtx.audioWorklet.addModule() before this file.

class FMMatrixProcessor extends FaustWorkletProcessor {
  constructor(options) {
    super(options);
    this._dsp = null;
    this._paramAddresses = [];  // ordered by NISPS index (from JSON)
    this._hiddenAddresses = {}; // freq, gate, _vel
    this._blockSize = 128;
    this._sampleRate = 48000;
  }

  // ---------------------------------------------------------------------------
  // FaustWorkletProcessor overrides
  // ---------------------------------------------------------------------------

  async _initWasm(wasmBytes, sr) {
    this._sampleRate = sr;

    // The Faust -lang wasm output exports a single factory function
    // named by the -cn flag (fm_matrix).
    const module = await WebAssembly.compile(wasmBytes);
    const memory = new WebAssembly.Memory({ initial: 32, maximum: 256 });

    const imports = {
      env: {
        memory,
        memoryBase: 0,
        tableBase: 0,
        _abs: Math.abs,
        _acosf: Math.acos,
        _asinf: Math.asin,
        _atanf: Math.atan,
        _atan2f: Math.atan2,
        _ceilf: Math.ceil,
        _cosf: Math.cos,
        _expf: Math.exp,
        _floorf: Math.floor,
        _fmodf: (x, y) => x % y,
        _logf: Math.log,
        _log10f: Math.log10,
        _max_f: Math.max,
        _min_f: Math.min,
        _remainderf: (x, y) => x - Math.round(x / y) * y,
        _powf: Math.pow,
        _roundf: Math.round,
        _sinf: Math.sin,
        _sqrtf: Math.sqrt,
        _tanf: Math.tan,
        _fabs: Math.abs,
        table: new WebAssembly.Table({ initial: 0, element: 'anyfunc' }),
      },
    };

    const instance = await WebAssembly.instantiate(module, imports);
    const exports = instance.exports;

    // Faust -lang wasm exports: getNumInputs, getNumOutputs, init,
    // instanceInit, getSampleRate, compute, setParamValue, getParamValue,
    // getJSON (pointer to null-terminated JSON string in memory)
    this._exports = exports;
    this._heap = new Float32Array(memory.buffer);
    this._heapi32 = new Int32Array(memory.buffer);
    this._mem = memory;

    // Allocate DSP instance (Faust C++ new equivalent)
    if (exports.createDSPInstance) {
      this._dsp = exports.createDSPInstance();
    } else if (exports.fm_matrix) {
      this._dsp = exports.fm_matrix();
    } else {
      // fallback: look for any exported constructor-like function
      const keys = Object.keys(exports).filter(k => typeof exports[k] === 'function');
      console.warn('[FMMatrixProcessor] No createDSPInstance found; exports:', keys);
      return;
    }

    // Initialise at sample rate
    exports.init(this._dsp, sr);

    // Parse embedded JSON to build param address list
    this._buildParamIndex(exports, memory);
  }

  _buildParamIndex(exports, memory) {
    // getJSON() returns a pointer to a JSON string in WASM memory
    if (!exports.getJSON) return;
    const ptr = exports.getJSON(this._dsp);
    const buf = new Uint8Array(memory.buffer);
    let str = '';
    let i = ptr;
    while (buf[i] !== 0) { str += String.fromCharCode(buf[i++]); }

    let desc;
    try { desc = JSON.parse(str); } catch { return; }

    const HIDDEN = new Set(['freq', 'gate', '_vel']);
    const addresses = [];

    function walk(items, path) {
      for (const item of items) {
        const label = item.label ?? '';
        const type = item.type ?? '';
        const addr = item.address ?? (path + '/' + label);
        if (['hslider', 'vslider', 'nentry', 'button', 'checkbox'].includes(type)) {
          if (HIDDEN.has(label)) {
            // store hidden separately
            addresses._hidden = addresses._hidden || {};
            addresses._hidden[label] = addr;
          } else {
            addresses.push(addr);
          }
        } else if (item.items) {
          walk(item.items, path + '/' + label);
        }
      }
    }

    walk(desc.ui ?? [], '');
    this._paramAddresses = addresses;
    this._hiddenAddresses = addresses._hidden ?? {};
  }

  _onSetParam(index, value) {
    if (!this._exports || !this._dsp) return;
    const addr = this._paramAddresses[index];
    if (addr && this._exports.setParamValue) {
      this._exports.setParamValue(this._dsp, addr, value);
    }
  }

  _onNoteOn(freq, vel) {
    if (!this._exports || !this._dsp) return;
    const set = (label, v) => {
      const addr = this._hiddenAddresses[label];
      if (addr) this._exports.setParamValue?.(this._dsp, addr, v);
    };
    set('freq', freq);
    set('_vel', vel);
    set('gate', 1);
  }

  _onNoteOff(_freq) {
    if (!this._exports || !this._dsp) return;
    const addr = this._hiddenAddresses['gate'];
    if (addr) this._exports.setParamValue?.(this._dsp, addr, 0);
  }

  _renderBlock(outL, outR, blockSize) {
    if (!this._exports || !this._dsp) return;
    const exports = this._exports;
    const heap = this._heap;
    const mem = this._mem;

    // Allocate output buffers in WASM heap (crude bump allocator using high addresses)
    const heapBytes = mem.buffer.byteLength;
    const outLOff = (heapBytes >> 2) - blockSize * 2 - 64;
    const outROff = outLOff + blockSize;

    // Allocate pointer arrays for outputs
    const ptrSize = 4; // 32-bit pointers in wasm32
    const outPtrsOff = outROff + blockSize;
    const i32 = this._heapi32;
    i32[outPtrsOff]     = outLOff * 4;  // byte offset in memory
    i32[outPtrsOff + 1] = outROff * 4;

    exports.compute(this._dsp, blockSize, 0 /* no inputs */, outPtrsOff * 4);

    for (let i = 0; i < blockSize; i++) {
      outL[i] = heap[outLOff + i];
      outR[i] = heap[outROff + i];
    }
  }
}

registerProcessor('fm-matrix-processor', FMMatrixProcessor);
