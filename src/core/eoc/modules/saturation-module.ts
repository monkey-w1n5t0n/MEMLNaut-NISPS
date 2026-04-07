/**
 * saturation-module.ts — Saturation/waveshaper EOCModule
 *
 * Faust DSP: /faust/eoc-saturation.dsp
 * WASM:      /faust/eoc-saturation.wasm
 * Worklet:   /faust/eoc-saturation-processor.js  (processorName: 'eoc-saturation-processor')
 *
 * 4 params (Faust JSON alphabetical order):
 *   0: character  [0–1, init 0.0]
 *   1: drive      [0–1, init 0.0]
 *   2: mix        [0–1, init 1.0]
 *   3: tone       [0–1, init 0.5]
 */

import { EOCModule } from '../eoc-module.js';
import type { ParamMeta } from '../eoc-module.js';

export class SaturationModule extends EOCModule {
  private _workletNode: AudioWorkletNode | null = null;
  private _effectGain: GainNode | null = null;

  // ---------------------------------------------------------------------------
  // EOCModule identity
  // ---------------------------------------------------------------------------

  override get id(): string          { return 'saturation'; }
  override get displayName(): string { return 'Saturation'; }

  override get paramMeta(): ParamMeta[] {
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

  override async init(audioCtx: AudioContext): Promise<void> {
    await super.init(audioCtx);

    const wasmResp = await fetch('/faust/eoc-saturation.wasm');
    if (!wasmResp.ok) throw new Error(`[SaturationModule] Failed to fetch eoc-saturation.wasm: ${wasmResp.status}`);
    const wasmBytes = await wasmResp.arrayBuffer();

    await audioCtx.audioWorklet.addModule('/faust/faust-worklet-processor.js');
    await audioCtx.audioWorklet.addModule('/faust/eoc-saturation-processor.js');

    this._workletNode = new AudioWorkletNode(audioCtx, 'eoc-saturation-processor', {
      numberOfInputs:     1,
      numberOfOutputs:    1,
      outputChannelCount: [2],
      channelCount:       2,
      channelCountMode:   'explicit',
    });

    this._workletNode.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'error') {
        console.error('[SaturationModule] Worklet error:', e.data.message);
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
