// delay-module.js — EOC Stereo Delay module (meml-2sl).
//
// Faust source: playground/faust/eoc-delay.dsp
// Worklet processor: playground/faust/eoc-delay-processor.js
// Processor name: 'eoc-delay-processor'
//
// 7 parameters (in JSON / Faust alphabetical order):
//   0  feedback     [0, 0.95]   init=0.3
//   1  lp_cutoff    [500, 20000] init=8000
//   2  mix          [0, 1]      init=0.3
//   3  ping_pong    [0, 1]      init=0.0
//   4  spread       [0, 1]      init=0.5
//   5  sync         [0, 3]      init=0  (nentry)
//   6  time         [1, 2000]   init=250

import { EOCModule }          from '../eoc-module.js';
import { loadFaustParamMeta } from '../../synth/faust-param-meta.js';

export class DelayModule extends EOCModule {
  constructor() {
    super();
    this._workletNode = null;
    this._effectGain  = null;  // GainNode: muted when bypassed
  }

  // ---------------------------------------------------------------------------
  // EOCModule identity
  // ---------------------------------------------------------------------------

  get id()          { return 'delay'; }
  get displayName() { return 'Delay'; }

  get paramMeta() {
    // Normalized init values derived from Faust defaults
    return [
      { id: 'feedback',  name: 'Feedback',  min: 0,   max: 0.95,  init: 0.3 / 0.95,              curve: 0.5, group: 'Delay' },
      { id: 'lp_cutoff', name: 'LP Cutoff', min: 500, max: 20000, init: (8000 - 500) / 19500,     curve: 0.35, group: 'Delay' },
      { id: 'mix',       name: 'Mix',       min: 0,   max: 1,     init: 0.3,                      curve: 0.5, group: 'Delay' },
      { id: 'ping_pong', name: 'Ping-Pong', min: 0,   max: 1,     init: 0.0,                      curve: 0.5, group: 'Delay' },
      { id: 'spread',    name: 'Spread',    min: 0,   max: 1,     init: 0.5,                      curve: 0.5, group: 'Delay' },
      { id: 'sync',      name: 'Sync',      min: 0,   max: 3,     init: 0.0,                      curve: 0.5, group: 'Delay' },
      { id: 'time',      name: 'Time (ms)', min: 1,   max: 2000,  init: (250 - 1) / 1999,         curve: 0.35, group: 'Delay' },
    ];
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init(audioCtx) {
    await super.init(audioCtx);

    // Fetch WASM bytes
    const wasmResp = await fetch('faust/eoc-delay.wasm');
    if (!wasmResp.ok) throw new Error(`[DelayModule] Failed to fetch eoc-delay.wasm: ${wasmResp.status}`);
    const wasmBytes = await wasmResp.arrayBuffer();

    // Register worklet (browser deduplicates)
    await audioCtx.audioWorklet.addModule('faust/faust-worklet-processor.js');
    await audioCtx.audioWorklet.addModule('faust/eoc-delay-processor.js');

    // Create worklet node: 2-in / 2-out stereo effect
    this._workletNode = new AudioWorkletNode(audioCtx, 'eoc-delay-processor', {
      numberOfInputs:  1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });

    // Listen for ready / error messages
    this._workletNode.port.onmessage = (e) => {
      if (e.data?.type === 'error') {
        console.error('[DelayModule] Worklet error:', e.data.message);
      }
    };

    // Effect gain node — muted when bypassed
    this._effectGain = audioCtx.createGain();
    this._effectGain.gain.value = 1;

    // Wire: bypassIn → worklet → effectGain → bypassOut
    this._bypassIn.connect(this._workletNode);
    this._workletNode.connect(this._effectGain);
    this._effectGain.connect(this._bypassOut);

    // Send init message to worklet
    this._workletNode.port.postMessage(
      { type: 'init', wasmBytes, sampleRate: audioCtx.sampleRate },
      [wasmBytes]
    );

    // Apply initial default param values
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
