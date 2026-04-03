// master-module.js — EOC Master Bus module (meml-2zm part 2).
//
// Faust source: playground/faust/eoc-master.dsp
// Worklet processor: playground/faust/eoc-master-processor.js
// Processor name: 'eoc-master-processor'
//
// 4 parameters (in JSON / Faust alphabetical order):
//   0  dc_block         [0, 1]   init=1  (nentry: off/on)
//   1  gain             [0, 2]   init=1.0
//   2  limiter_thresh   [-12, 0] init=-1.0
//   3  width            [0, 2]   init=1.0

import { EOCModule } from '../eoc-module.js';

export class MasterModule extends EOCModule {
  constructor() {
    super();
    this._workletNode = null;
    this._effectGain  = null;
  }

  // ---------------------------------------------------------------------------
  // EOCModule identity
  // ---------------------------------------------------------------------------

  get id()          { return 'master'; }
  get displayName() { return 'Master Bus'; }

  get paramMeta() {
    return [
      { id: 'dc_block',        name: 'DC Block',        min: 0,   max: 1,  init: 1.0,                  curve: 0.5, group: 'Master' },
      { id: 'gain',            name: 'Gain',            min: 0,   max: 2,  init: 1.0 / 2.0,            curve: 0.5, group: 'Master' },
      { id: 'limiter_thresh',  name: 'Limiter (dB)',    min: -12, max: 0,  init: (-1.0 - (-12)) / 12,  curve: 0.5, group: 'Master' },
      { id: 'width',           name: 'Width',           min: 0,   max: 2,  init: 1.0 / 2.0,            curve: 0.5, group: 'Master' },
    ];
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init(audioCtx) {
    await super.init(audioCtx);

    const wasmResp = await fetch('faust/eoc-master.wasm');
    if (!wasmResp.ok) throw new Error(`[MasterModule] Failed to fetch eoc-master.wasm: ${wasmResp.status}`);
    const wasmBytes = await wasmResp.arrayBuffer();

    await audioCtx.audioWorklet.addModule('faust/faust-worklet-processor.js');
    await audioCtx.audioWorklet.addModule('faust/eoc-master-processor.js');

    this._workletNode = new AudioWorkletNode(audioCtx, 'eoc-master-processor', {
      numberOfInputs:  1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });

    this._workletNode.port.onmessage = (e) => {
      if (e.data?.type === 'error') {
        console.error('[MasterModule] Worklet error:', e.data.message);
      }
    };

    this._effectGain = audioCtx.createGain();
    this._effectGain.gain.value = 1;

    // Wire: bypassIn → worklet → effectGain → bypassOut
    this._bypassIn.connect(this._workletNode);
    this._workletNode.connect(this._effectGain);
    this._effectGain.connect(this._bypassOut);

    this._workletNode.port.postMessage(
      { type: 'init', wasmBytes, sampleRate: audioCtx.sampleRate },
      [wasmBytes]
    );

    this.paramMeta.forEach((_, i) => {
      this.setParam(i, this.getCurrentParamValue(i));
    });

    this._finishInit();
  }

  // ---------------------------------------------------------------------------
  // Real-time control
  // ---------------------------------------------------------------------------

  setParam(index, normalizedValue) {
    super.setParam(index, normalizedValue);
    if (!this._workletNode) return;
    const raw = this._denormalize(index, normalizedValue);
    this._workletNode.port.postMessage({ type: 'setParam', index, value: raw });
  }

  // ---------------------------------------------------------------------------
  // Bypass
  // ---------------------------------------------------------------------------

  _onBypassChange(enabled) {
    if (!this._effectGain) return;
    const t = this._audioCtx.currentTime;
    this._effectGain.gain.setTargetAtTime(enabled ? 1 : 0, t, 0.005);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose() {
    if (this._workletNode) {
      this._workletNode.disconnect();
      this._workletNode.port.onmessage = null;
      this._workletNode = null;
    }
    if (this._effectGain) {
      this._effectGain.disconnect();
      this._effectGain = null;
    }
    super.dispose();
  }
}
