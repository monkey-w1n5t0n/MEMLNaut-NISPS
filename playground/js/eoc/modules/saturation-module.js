// saturation-module.js — EOC Saturation module (meml-2zm part 1).
//
// Faust source: playground/faust/eoc-saturation.dsp
// Worklet processor: playground/faust/eoc-saturation-processor.js
// Processor name: 'eoc-saturation-processor'
//
// 4 parameters (in JSON / Faust alphabetical order):
//   0  character    [0, 1]   init=0.0
//   1  drive        [0, 1]   init=0.0
//   2  mix          [0, 1]   init=1.0
//   3  tone         [0, 1]   init=0.5

import { EOCModule } from '../eoc-module.js';

export class SaturationModule extends EOCModule {
  constructor() {
    super();
    this._workletNode = null;
    this._effectGain  = null;
  }

  // ---------------------------------------------------------------------------
  // EOCModule identity
  // ---------------------------------------------------------------------------

  get id()          { return 'saturation'; }
  get displayName() { return 'Saturation'; }

  get paramMeta() {
    return [
      { id: 'character', name: 'Character', min: 0, max: 1, init: 0.0, curve: 0.5, group: 'Saturation' },
      { id: 'drive',     name: 'Drive',     min: 0, max: 1, init: 0.0, curve: 0.6, group: 'Saturation' },
      { id: 'mix',       name: 'Mix',       min: 0, max: 1, init: 1.0, curve: 0.5, group: 'Saturation' },
      { id: 'tone',      name: 'Tone',      min: 0, max: 1, init: 0.5, curve: 0.5, group: 'Saturation' },
    ];
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init(audioCtx) {
    await super.init(audioCtx);

    const wasmResp = await fetch('faust/eoc-saturation.wasm');
    if (!wasmResp.ok) throw new Error(`[SaturationModule] Failed to fetch eoc-saturation.wasm: ${wasmResp.status}`);
    const wasmBytes = await wasmResp.arrayBuffer();

    await audioCtx.audioWorklet.addModule('faust/faust-worklet-processor.js');
    await audioCtx.audioWorklet.addModule('faust/eoc-saturation-processor.js');

    this._workletNode = new AudioWorkletNode(audioCtx, 'eoc-saturation-processor', {
      numberOfInputs:  1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });

    this._workletNode.port.onmessage = (e) => {
      if (e.data?.type === 'error') {
        console.error('[SaturationModule] Worklet error:', e.data.message);
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
