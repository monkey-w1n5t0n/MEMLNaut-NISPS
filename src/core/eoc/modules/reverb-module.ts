/**
 * reverb-module.ts — Zita reverb EOCModule
 *
 * Faust DSP: /faust/eoc-reverb.dsp
 * WASM:      /faust/eoc-reverb.wasm
 * JSON:      /faust/eoc-reverb.json
 * Worklet:   /faust/eoc-reverb-processor.js  (processorName: 'eoc-reverb-processor')
 *
 * 9 params total (8 from Faust JSON + 1 mod_rate placeholder):
 *   0: decay     [0.1–20 s, init 3]
 *   1: diffusion [0–1, init 0.7]
 *   2: hi_damp   [0–1, init 0.5]
 *   3: lo_damp   [0–1, init 0]
 *   4: mix       [0–1, init 0.2]
 *   5: predelay  [0–100 ms, init 0]
 *   6: size      [0–1, init 0.5]
 *   7: width     [0–1, init 0.8]
 *   8: mod_rate  [0–5 Hz, init 0.5] — placeholder, not yet connected to zita internals
 *
 * Note: mod_rate is listed in paramMeta as a placeholder (fixed at 0.5 Hz)
 * to preserve the 9-param count. It has no effect on audio until zita
 * modulation is plumbed through.
 */

import { EOCModule } from '../eoc-module.js';
import type { ParamMeta } from '../eoc-module.js';
import { loadFaustParamMeta } from '../../synth/faust-param-meta.js';

const REVERB_PARAM_META: ParamMeta[] = [
  { id: 'decay',     name: 'Decay',     min: 0.1, max: 20,  init: (3 - 0.1) / (20 - 0.1), curve: 0.3, group: 'Reverb' },
  { id: 'diffusion', name: 'Diffusion', min: 0,   max: 1,   init: 0.7,                     curve: 0.5, group: 'Reverb' },
  { id: 'hi_damp',   name: 'Hi Damp',   min: 0,   max: 1,   init: 0.5,                     curve: 0.5, group: 'Reverb' },
  { id: 'lo_damp',   name: 'Lo Damp',   min: 0,   max: 1,   init: 0,                       curve: 0.5, group: 'Reverb' },
  { id: 'mix',       name: 'Mix',       min: 0,   max: 1,   init: 0.2,                     curve: 0.5, group: 'Reverb' },
  { id: 'predelay',  name: 'Predelay',  min: 0,   max: 100, init: 0,                       curve: 0.4, group: 'Reverb' },
  { id: 'size',      name: 'Size',      min: 0,   max: 1,   init: 0.5,                     curve: 0.5, group: 'Reverb' },
  { id: 'width',     name: 'Width',     min: 0,   max: 1,   init: 0.8,                     curve: 0.5, group: 'Reverb' },
  // Placeholder: mod_rate is not yet connected to zita internals
  { id: 'mod_rate',  name: 'Mod Rate',  min: 0,   max: 5,   init: 0.5 / 5,                 curve: 0.5, group: 'Reverb' },
];

export class ReverbModule extends EOCModule {
  private _workletNode: AudioWorkletNode | null = null;
  private _effectGain: GainNode | null = null;
  private _paramMetaData: ParamMeta[] = REVERB_PARAM_META;

  // ---------------------------------------------------------------------------
  // EOCModule identity
  // ---------------------------------------------------------------------------

  override get id(): string             { return 'reverb'; }
  override get displayName(): string    { return 'Reverb'; }
  override get paramMeta(): ParamMeta[] { return this._paramMetaData; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override async init(audioCtx: AudioContext): Promise<void> {
    await super.init(audioCtx);

    // After loading JSON, merge — but keep mod_rate placeholder (index 8)
    try {
      const fetched = await loadFaustParamMeta('/faust/eoc-reverb.json');
      if (fetched && fetched.length > 0) {
        // Append mod_rate placeholder so total stays 9
        this._paramMetaData = [
          ...fetched,
          { id: 'mod_rate', name: 'Mod Rate', min: 0, max: 5, init: 0.5 / 5, curve: 0.5, group: 'Reverb' },
        ];
      }
    } catch (err) {
      console.warn('[ReverbModule] Could not load eoc-reverb.json, using static paramMeta:', (err as Error).message);
    }

    try {
      await audioCtx.audioWorklet.addModule('/faust/faust-worklet-processor.js');
    } catch (_) { /* already registered */ }
    await audioCtx.audioWorklet.addModule('/faust/eoc-reverb-processor.js');

    this._workletNode = new AudioWorkletNode(audioCtx, 'eoc-reverb-processor', {
      numberOfInputs:     1,
      numberOfOutputs:    1,
      outputChannelCount: [2],
    });

    const wasmResp  = await fetch('/faust/eoc-reverb.wasm');
    if (!wasmResp.ok) throw new Error(`[ReverbModule] Failed to fetch eoc-reverb.wasm: ${wasmResp.status}`);
    const wasmBytes = await wasmResp.arrayBuffer();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('ReverbModule worklet init timeout')), 10_000);
      this._workletNode!.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'ready') { clearTimeout(timeout); resolve(); }
        if (e.data?.type === 'error') { clearTimeout(timeout); reject(new Error(e.data.message)); }
      };
      this._workletNode!.port.postMessage(
        { type: 'init', wasmBytes, sampleRate: audioCtx.sampleRate },
        [wasmBytes],
      );
    });

    this._effectGain = audioCtx.createGain();
    this._effectGain.gain.value = 1;

    // Wire: bypassIn → worklet → effectGain → bypassOut
    this._bypassIn!.connect(this._workletNode);
    this._workletNode.connect(this._effectGain);
    this._effectGain.connect(this._bypassOut!);

    this._finishInit();
  }

  // ---------------------------------------------------------------------------
  // Real-time control
  // ---------------------------------------------------------------------------

  override setParam(index: number, normalizedValue: number): void {
    super.setParam(index, normalizedValue);
    if (!this._workletNode) return;
    const meta = this._paramMetaData[index];
    if (!meta) return;
    // mod_rate (index 8) is a placeholder — skip sending to worklet
    if (meta.id === 'mod_rate') return;
    const raw = meta.min + normalizedValue * (meta.max - meta.min);
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
    this._workletNode?.disconnect();
    this._effectGain?.disconnect();
    this._workletNode = null;
    this._effectGain  = null;
    super.dispose();
  }
}
