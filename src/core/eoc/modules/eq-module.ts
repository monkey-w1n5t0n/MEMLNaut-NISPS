/**
 * eq-module.ts — 4-band parametric EQ EOCModule
 *
 * Faust DSP: /faust/eoc-eq.dsp
 * WASM:      /faust/eoc-eq.wasm
 * JSON:      /faust/eoc-eq.json
 * Worklet:   /faust/eoc-eq-processor.js   (processorName: 'eoc-eq-processor')
 *
 * 10 params (shelf bands have no Q in Faust fi.low_shelf / fi.high_shelf):
 *   Band 1 (Low Shelf):  freq1 [20–500 Hz, init 80], gain1 [-12–+12 dB, init 0]
 *   Band 2 (Low-Mid):    freq2 [100–2000 Hz, init 400], gain2 [-12–+12 dB, init 0], q2 [0.1–10, init 1]
 *   Band 3 (High-Mid):   freq3 [500–8000 Hz, init 2500], gain3 [-12–+12 dB, init 0], q3 [0.1–10, init 1]
 *   Band 4 (High Shelf): freq4 [2000–20000 Hz, init 8000], gain4 [-12–+12 dB, init 0]
 *
 * Param order (Faust JSON alphabetical-within-group, groups in declaration order):
 *   0 freq1, 1 gain1, 2 freq2, 3 gain2, 4 q2, 5 freq3, 6 gain3, 7 q3, 8 freq4, 9 gain4
 */

import { EOCModule } from '../eoc-module.js';
import type { ParamMeta } from '../eoc-module.js';
import { loadFaustParamMeta } from '../../synth/faust-param-meta.js';

// Static paramMeta — mirrors eoc-eq.json, used before/without JSON fetch.
const EQ_PARAM_META: ParamMeta[] = [
  // Band 1 (Low Shelf)
  { id: 'band_1__low_shelf__freq1',  name: 'Freq 1',  min: 20,   max: 500,   init: (80 - 20) / (500 - 20),      curve: 0.3, group: 'Band 1 (Low Shelf)' },
  { id: 'band_1__low_shelf__gain1',  name: 'Gain 1',  min: -12,  max: 12,    init: (0 - (-12)) / (12 - (-12)),   curve: 0.5, group: 'Band 1 (Low Shelf)' },
  // Band 2 (Low-Mid bell)
  { id: 'band_2__low-mid__freq2',    name: 'Freq 2',  min: 100,  max: 2000,  init: (400 - 100) / (2000 - 100),   curve: 0.3, group: 'Band 2 (Low-Mid)' },
  { id: 'band_2__low-mid__gain2',    name: 'Gain 2',  min: -12,  max: 12,    init: (0 - (-12)) / (12 - (-12)),   curve: 0.5, group: 'Band 2 (Low-Mid)' },
  { id: 'band_2__low-mid__q2',       name: 'Q 2',     min: 0.1,  max: 10,    init: (1 - 0.1) / (10 - 0.1),      curve: 0.3, group: 'Band 2 (Low-Mid)' },
  // Band 3 (High-Mid bell)
  { id: 'band_3__high-mid__freq3',   name: 'Freq 3',  min: 500,  max: 8000,  init: (2500 - 500) / (8000 - 500),  curve: 0.3, group: 'Band 3 (High-Mid)' },
  { id: 'band_3__high-mid__gain3',   name: 'Gain 3',  min: -12,  max: 12,    init: (0 - (-12)) / (12 - (-12)),   curve: 0.5, group: 'Band 3 (High-Mid)' },
  { id: 'band_3__high-mid__q3',      name: 'Q 3',     min: 0.1,  max: 10,    init: (1 - 0.1) / (10 - 0.1),      curve: 0.3, group: 'Band 3 (High-Mid)' },
  // Band 4 (High Shelf)
  { id: 'band_4__high_shelf__freq4', name: 'Freq 4',  min: 2000, max: 20000, init: (8000 - 2000) / (20000 - 2000), curve: 0.3, group: 'Band 4 (High Shelf)' },
  { id: 'band_4__high_shelf__gain4', name: 'Gain 4',  min: -12,  max: 12,    init: (0 - (-12)) / (12 - (-12)),   curve: 0.5, group: 'Band 4 (High Shelf)' },
];

export class EQModule extends EOCModule {
  private _workletNode: AudioWorkletNode | null = null;
  private _effectGain: GainNode | null = null;
  private _paramMetaData: ParamMeta[] = EQ_PARAM_META;

  // ---------------------------------------------------------------------------
  // EOCModule identity
  // ---------------------------------------------------------------------------

  override get id(): string          { return 'eq'; }
  override get displayName(): string { return 'Parametric EQ'; }
  override get paramMeta(): ParamMeta[] { return this._paramMetaData; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override async init(audioCtx: AudioContext): Promise<void> {
    await super.init(audioCtx);

    // Attempt to load richer paramMeta from JSON (non-fatal if fetch fails)
    try {
      const fetched = await loadFaustParamMeta('/faust/eoc-eq.json');
      if (fetched && fetched.length > 0) this._paramMetaData = fetched;
    } catch (err) {
      console.warn('[EQModule] Could not load eoc-eq.json, using static paramMeta:', (err as Error).message);
    }

    // Register worklet modules (browser deduplicates across calls)
    try {
      await audioCtx.audioWorklet.addModule('/faust/faust-worklet-processor.js');
    } catch (_) { /* already registered */ }
    await audioCtx.audioWorklet.addModule('/faust/eoc-eq-processor.js');

    // Create AudioWorkletNode
    this._workletNode = new AudioWorkletNode(audioCtx, 'eoc-eq-processor', {
      numberOfInputs:     1,
      numberOfOutputs:    1,
      outputChannelCount: [2],
    });

    // Fetch WASM and transfer to worklet
    const wasmResp  = await fetch('/faust/eoc-eq.wasm');
    if (!wasmResp.ok) throw new Error(`[EQModule] Failed to fetch eoc-eq.wasm: ${wasmResp.status}`);
    const wasmBytes = await wasmResp.arrayBuffer();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('EQModule worklet init timeout')), 10_000);
      this._workletNode!.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'ready') { clearTimeout(timeout); resolve(); }
        if (e.data?.type === 'error') { clearTimeout(timeout); reject(new Error(e.data.message)); }
      };
      this._workletNode!.port.postMessage(
        { type: 'init', wasmBytes, sampleRate: audioCtx.sampleRate },
        [wasmBytes],
      );
    });

    // Gain node so bypass can mute the effect path
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
