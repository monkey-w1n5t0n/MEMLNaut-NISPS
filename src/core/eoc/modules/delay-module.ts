/**
 * delay-module.ts — Stereo Delay EOCModule
 *
 * Faust DSP: /faust/eoc-delay.dsp
 * WASM:      /faust/eoc-delay.wasm
 * Worklet:   /faust/eoc-delay-processor.js  (processorName: 'eoc-delay-processor')
 *
 * 7 params (Faust JSON alphabetical order):
 *   0: feedback   [0–0.95, init 0.3]
 *   1: lp_cutoff  [500–20000 Hz, init 8000]
 *   2: mix        [0–1, init 0.3]
 *   3: ping_pong  [0–1, init 0.0]
 *   4: spread     [0–1, init 0.5]
 *   5: sync       [0–3, init 0]  (nentry)
 *   6: time       [1–2000 ms, init 250]
 */

import { EOCModule } from '../eoc-module.js';
import type { ParamMeta } from '../eoc-module.js';

export class DelayModule extends EOCModule {
  private _workletNode: AudioWorkletNode | null = null;
  private _effectGain: GainNode | null = null;

  // ---------------------------------------------------------------------------
  // EOCModule identity
  // ---------------------------------------------------------------------------

  override get id(): string          { return 'delay'; }
  override get displayName(): string { return 'Delay'; }

  override get paramMeta(): ParamMeta[] {
    return [
      { id: 'feedback',  name: 'Feedback',  min: 0,   max: 0.95,  init: 0.3 / 0.95,           curve: 0.5,  group: 'Delay' },
      { id: 'lp_cutoff', name: 'LP Cutoff', min: 500, max: 20000, init: (8000 - 500) / 19500,  curve: 0.35, group: 'Delay' },
      { id: 'mix',       name: 'Mix',       min: 0,   max: 1,     init: 0.3,                   curve: 0.5,  group: 'Delay' },
      { id: 'ping_pong', name: 'Ping-Pong', min: 0,   max: 1,     init: 0.0,                   curve: 0.5,  group: 'Delay' },
      { id: 'spread',    name: 'Spread',    min: 0,   max: 1,     init: 0.5,                   curve: 0.5,  group: 'Delay' },
      { id: 'sync',      name: 'Sync',      min: 0,   max: 3,     init: 0.0,                   curve: 0.5,  group: 'Delay' },
      { id: 'time',      name: 'Time (ms)', min: 1,   max: 2000,  init: (250 - 1) / 1999,      curve: 0.35, group: 'Delay' },
    ];
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override async init(audioCtx: AudioContext): Promise<void> {
    await super.init(audioCtx);

    // Fetch WASM bytes
    const wasmResp = await fetch('/faust/eoc-delay.wasm');
    if (!wasmResp.ok) throw new Error(`[DelayModule] Failed to fetch eoc-delay.wasm: ${wasmResp.status}`);
    const wasmBytes = await wasmResp.arrayBuffer();

    // Register worklet (browser deduplicates)
    await audioCtx.audioWorklet.addModule('/faust/faust-worklet-processor.js');
    await audioCtx.audioWorklet.addModule('/faust/eoc-delay-processor.js');

    // Create worklet node: stereo effect
    this._workletNode = new AudioWorkletNode(audioCtx, 'eoc-delay-processor', {
      numberOfInputs:     1,
      numberOfOutputs:    1,
      outputChannelCount: [2],
      channelCount:       2,
      channelCountMode:   'explicit',
    });

    this._workletNode.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'error') {
        console.error('[DelayModule] Worklet error:', e.data.message);
      }
    };

    // Effect gain node — muted when bypassed
    this._effectGain = audioCtx.createGain();
    this._effectGain.gain.value = 1;

    // Wire: bypassIn → worklet → effectGain → bypassOut
    this._bypassIn!.connect(this._workletNode);
    this._workletNode.connect(this._effectGain);
    this._effectGain.connect(this._bypassOut!);

    // Send init message to worklet
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
