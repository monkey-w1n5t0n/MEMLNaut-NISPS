/**
 * eoc-delay-processor.js — AudioWorklet processor for the EOC Stereo Delay.
 *
 * Extends FaustWorkletProcessor (faust-worklet-processor.js).
 * Loads eoc-delay.wasm compiled from eoc-delay.dsp.
 *
 * Parameter index order (alphabetical within group, matching eoc-delay.json):
 *   0  feedback     [0, 0.95]
 *   1  lp_cutoff    [500, 20000]
 *   2  mix          [0, 1]
 *   3  ping_pong    [0, 1]
 *   4  spread       [0, 1]
 *   5  sync         [0, 3]  (nentry)
 *   6  time         [1, 2000]
 */

// Must be loaded in AudioWorkletGlobalScope after faust-worklet-processor.js.

class EOCDelayProcessor extends FaustWorkletProcessor {
  constructor(options) {
    super(options);
    this._dsp = null;
    this._paramAddresses = [];
    this._blockSize = 128;
    this._sampleRate = 48000;
  }

  // ---------------------------------------------------------------------------
  // FaustWorkletProcessor overrides
  // ---------------------------------------------------------------------------

  async _initWasm(wasmBytes, sr) {
    this._sampleRate = sr;

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

    this._exports = exports;
    this._heap = new Float32Array(memory.buffer);
    this._heapi32 = new Int32Array(memory.buffer);
    this._mem = memory;

    // Create DSP instance
    if (exports.createDSPInstance) {
      this._dsp = exports.createDSPInstance();
    } else if (exports.eoc_delay) {
      this._dsp = exports.eoc_delay();
    } else {
      console.warn('[EOCDelayProcessor] No DSP factory found; exports:', Object.keys(exports));
      return;
    }

    exports.init(this._dsp, sr);
    this._buildParamIndex(exports, memory);
  }

  _buildParamIndex(exports, memory) {
    if (!exports.getJSON) return;
    const ptr = exports.getJSON(this._dsp);
    const buf = new Uint8Array(memory.buffer);
    let str = '';
    let i = ptr;
    while (buf[i] !== 0) { str += String.fromCharCode(buf[i++]); }

    let desc;
    try { desc = JSON.parse(str); } catch { return; }

    const addresses = [];

    function walk(items, path) {
      for (const item of items) {
        const label = item.label ?? '';
        const type = item.type ?? '';
        const addr = item.address ?? (path + '/' + label);
        if (['hslider', 'vslider', 'nentry', 'button', 'checkbox'].includes(type)) {
          addresses.push(addr);
        } else if (item.items) {
          walk(item.items, path + '/' + label);
        }
      }
    }

    walk(desc.ui ?? [], '');
    this._paramAddresses = addresses;
  }

  _onSetParam(index, value) {
    if (!this._exports || !this._dsp) return;
    const addr = this._paramAddresses[index];
    if (addr && this._exports.setParamValue) {
      this._exports.setParamValue(this._dsp, addr, value);
    }
  }

  _renderBlock(outL, outR, blockSize) {
    if (!this._exports || !this._dsp) return;
    const exports = this._exports;
    const mem = this._mem;
    const heap = this._heap;

    const heapBytes = mem.buffer.byteLength;
    const inLOff  = (heapBytes >> 2) - blockSize * 4 - 128;
    const inROff  = inLOff + blockSize;
    const outLOff = inROff + blockSize;
    const outROff = outLOff + blockSize;

    // Zero input buffers (delay is an effect — pass through audio)
    // Input pointers
    const i32 = this._heapi32;
    const inPtrsOff  = outROff + blockSize;
    const outPtrsOff = inPtrsOff + 2;
    i32[inPtrsOff]      = inLOff  * 4;
    i32[inPtrsOff + 1]  = inROff  * 4;
    i32[outPtrsOff]     = outLOff * 4;
    i32[outPtrsOff + 1] = outROff * 4;

    exports.compute(this._dsp, blockSize, inPtrsOff * 4, outPtrsOff * 4);

    for (let i = 0; i < blockSize; i++) {
      outL[i] = heap[outLOff + i];
      outR[i] = heap[outROff + i];
    }
  }
}

registerProcessor('eoc-delay-processor', EOCDelayProcessor);
