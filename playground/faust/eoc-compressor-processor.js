/**
 * eoc-compressor-processor.js — AudioWorklet processor for the stereo compressor
 *
 * Extends FaustWorkletProcessor (faust-worklet-processor.js).
 * Loads eoc-compressor.wasm compiled from eoc-compressor.dsp.
 *
 * 7 params (alphabetical order as emitted by Faust JSON):
 *   0: attack (ms)
 *   1: knee (dB)
 *   2: makeup (dB)
 *   3: mix (0–1)
 *   4: ratio
 *   5: release (ms)
 *   6: threshold (dB)
 */

// Runs in AudioWorkletGlobalScope — faust-worklet-processor.js must be loaded first.

class EOCCompressorProcessor extends FaustWorkletProcessor {
  constructor(options) {
    super(options);
    this._dsp     = null;
    this._exports = null;
    this._heap    = null;
    this._heapi32 = null;
    this._mem     = null;
    this._paramAddresses = [];
    this._inputL  = null;
    this._inputR  = null;
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
        _abs:        Math.abs,
        _acosf:      Math.acos,
        _asinf:      Math.asin,
        _atanf:      Math.atan,
        _atan2f:     Math.atan2,
        _ceilf:      Math.ceil,
        _cosf:       Math.cos,
        _expf:       Math.exp,
        _floorf:     Math.floor,
        _fmodf:      (x, y) => x % y,
        _logf:       Math.log,
        _log10f:     Math.log10,
        _max_f:      Math.max,
        _min_f:      Math.min,
        _remainderf: (x, y) => x - Math.round(x / y) * y,
        _powf:       Math.pow,
        _roundf:     Math.round,
        _sinf:       Math.sin,
        _sqrtf:      Math.sqrt,
        _tanf:       Math.tan,
        _fabs:       Math.abs,
        table: new WebAssembly.Table({ initial: 0, element: 'anyfunc' }),
      },
    };

    const instance = await WebAssembly.instantiate(module, imports);
    this._exports = instance.exports;
    this._mem     = memory;
    this._heap    = new Float32Array(memory.buffer);
    this._heapi32 = new Int32Array(memory.buffer);

    const exps = this._exports;

    if (exps.createDSPInstance) {
      this._dsp = exps.createDSPInstance();
    } else if (exps.eoc_compressor) {
      this._dsp = exps.eoc_compressor();
    } else {
      const fnKeys = Object.keys(exps).filter(k => typeof exps[k] === 'function');
      console.warn('[EOCCompressorProcessor] No DSP constructor found; exports:', fnKeys);
      return;
    }

    exps.init(this._dsp, sr);
    this._buildParamIndex(exps, memory);
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

    function walk(items) {
      for (const item of items) {
        const type = item.type ?? '';
        if (['hslider', 'vslider', 'nentry'].includes(type)) {
          addresses.push(item.address ?? '');
        } else if (item.items) {
          walk(item.items);
        }
      }
    }

    walk(desc.ui ?? []);
    this._paramAddresses = addresses;
  }

  _onSetParam(index, value) {
    if (!this._exports || !this._dsp) return;
    const addr = this._paramAddresses[index];
    if (addr !== undefined && this._exports.setParamValue) {
      this._exports.setParamValue(this._dsp, addr, value);
    }
  }

  _renderBlock(outL, outR, blockSize) {
    if (!this._exports || !this._dsp) return;

    const exps  = this._exports;
    const mem   = this._mem;
    const heap  = this._heap;
    const i32   = this._heapi32;

    const heapWords  = mem.buffer.byteLength >> 2;
    const inLOff     = heapWords - blockSize * 6 - 32;
    const inROff     = inLOff  + blockSize;
    const outLOff    = inROff  + blockSize;
    const outROff    = outLOff + blockSize;
    const inPtrsOff  = outROff + blockSize;
    const outPtrsOff = inPtrsOff + 2;

    i32[inPtrsOff]      = inLOff  * 4;
    i32[inPtrsOff + 1]  = inROff  * 4;
    i32[outPtrsOff]     = outLOff * 4;
    i32[outPtrsOff + 1] = outROff * 4;

    const srcL = this._inputL;
    const srcR = this._inputR;
    if (srcL) for (let i = 0; i < blockSize; i++) heap[inLOff + i] = srcL[i];
    if (srcR) for (let i = 0; i < blockSize; i++) heap[inROff + i] = srcR[i];

    exps.compute(this._dsp, blockSize, inPtrsOff * 4, outPtrsOff * 4);

    for (let i = 0; i < blockSize; i++) {
      outL[i] = heap[outLOff + i];
      outR[i] = heap[outROff + i];
    }
  }

  process(inputs, outputs, params) {
    const inp = inputs[0];
    this._inputL = inp?.[0] ?? null;
    this._inputR = inp?.[1] ?? inp?.[0] ?? null;
    return super.process(inputs, outputs, params);
  }
}

registerProcessor('eoc-compressor-processor', EOCCompressorProcessor);
