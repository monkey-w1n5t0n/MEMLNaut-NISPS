/**
 * master-module.ts — Master volume/limiter EOCModule
 *
 * Faust DSP: /faust/eoc-master.dsp
 * WASM:      /faust/eoc-master.wasm
 * Worklet:   /faust/eoc-master-processor.js  (processorName: 'eoc-master-processor')
 *
 * 4 params (Faust JSON alphabetical order):
 *   0: dc_block        [0–1, init 1]  (nentry: off/on)
 *   1: gain            [0–2, init 1.0]
 *   2: limiter_thresh  [-12–0 dBFS, init -1.0]
 *   3: width           [0–2, init 1.0]
 */

import { EOCModule } from '../eoc-module.js';
import type { ParamMeta } from '../eoc-module.js';

export class MasterModule extends EOCModule {
  private _workletNode: AudioWorkletNode | null = null;
  private _effectGain: GainNode | null = null;

  // ---------------------------------------------------------------------------
  // EOCModule identity
  // ---------------------------------------------------------------------------

  override get id(): string          { return 'master'; }
  override get displayName(): string { return 'Master Bus'; }

  override get paramMeta(): ParamMeta[] {
    return [
      { id: 'dc_block',       name: 'DC Block',     min: 0,   max: 1,  init: 1.0,                       curve: 0.5, group: 'Master' },
      { id: 'gain',           name: 'Gain',         min: 0,   max: 2,  init: 1.0 / 2.0,                 curve: 0.5, group: 'Master' },
      { id: 'limiter_thresh', name: 'Limiter (dB)', min: -12, max: 0,  init: (-1.0 - (-12)) / 12,       curve: 0.5, group: 'Master' },
      { id: 'width',          name: 'Width',        min: 0,   max: 2,  init: 1.0 / 2.0,                 curve: 0.5, group: 'Master' },
    ];
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override async init(audioCtx: AudioContext): Promise<void> {
    await super.init(audioCtx);

    const wasmResp = await fetch('/faust/eoc-master.wasm');
    if (!wasmResp.ok) throw new Error(`[MasterModule] Failed to fetch eoc-master.wasm: ${wasmResp.status}`);
    const wasmBytes = await wasmResp.arrayBuffer();

    await audioCtx.audioWorklet.addModule('/faust/faust-worklet-processor.js');
    await audioCtx.audioWorklet.addModule('/faust/eoc-master-processor.js');

    this._workletNode = new AudioWorkletNode(audioCtx, 'eoc-master-processor', {
      numberOfInputs:     1,
      numberOfOutputs:    1,
      outputChannelCount: [2],
      channelCount:       2,
      channelCountMode:   'explicit',
    });

    this._workletNode.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'error') {
        console.error('[MasterModule] Worklet error:', e.data.message);
      }
    };

    this._effectGain = audioCtx.createGain();
    this._effectGain.gain.value = 1;

    // Wire: bypassIn → worklet → effectGain → bypassOut
    this._bypassIn!.connect(this._workletNode);
    this._workletNode.connect(this._effectGain);
    this._effectGain.connect(this._bypassOut!);

    this._workletNode.port.postMessage(
      { type: 'init', wasmBytes, sampleRate: audioCtx.sampleRate },
      [wasmBytes],
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

  override setParam(index: number, normalizedValue: number): void {
    super.setParam(index, normalizedValue);
    if (!this._workletNode) return;
    const raw = this._denormalize(index, normalizedValue);
    this._workletNode.port.postMessage({ type: 'setParam', index, value: raw });
  }

  // ---------------------------------------------------------------------------
  // Bypass
  // ---------------------------------------------------------------------------

  protected override _onBypassChange(enabled: boolean): void {
    if (!this._effectGain || !this._audioCtx) return;
    const t = this._audioCtx.currentTime;
    this._effectGain.gain.setTargetAtTime(enabled ? 1 : 0, t, 0.005);
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  override dispose(): void {
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
