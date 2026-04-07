/**
 * compressor-module.ts — Stereo compressor EOCModule
 *
 * Faust DSP: /faust/eoc-compressor.dsp
 * WASM:      /faust/eoc-compressor.wasm
 * JSON:      /faust/eoc-compressor.json
 * Worklet:   /faust/eoc-compressor-processor.js  (processorName: 'eoc-compressor-processor')
 *
 * 7 params (Faust JSON alphabetical order):
 *   0: attack    [0.1–200 ms, init 10]
 *   1: knee      [0–24 dB, init 6]
 *   2: makeup    [0–24 dB, init 0]
 *   3: mix       [0–1, init 1]  (dry/wet for parallel compression)
 *   4: ratio     [1–20, init 4]
 *   5: release   [10–2000 ms, init 100]
 *   6: threshold [-60–0 dBFS, init -24]
 */

import { EOCModule } from '../eoc-module.js';
import type { ParamMeta } from '../eoc-module.js';
import { loadFaustParamMeta } from '../../synth/faust-param-meta.js';

const COMP_PARAM_META: ParamMeta[] = [
  { id: 'attack',    name: 'Attack',    min: 0.1,  max: 200,  init: (10 - 0.1) / (200 - 0.1),    curve: 0.3, group: 'Compressor' },
  { id: 'knee',      name: 'Knee',      min: 0,    max: 24,   init: 6 / 24,                       curve: 0.5, group: 'Compressor' },
  { id: 'makeup',    name: 'Makeup',    min: 0,    max: 24,   init: 0,                            curve: 0.5, group: 'Compressor' },
  { id: 'mix',       name: 'Mix',       min: 0,    max: 1,    init: 1,                            curve: 0.5, group: 'Compressor' },
  { id: 'ratio',     name: 'Ratio',     min: 1,    max: 20,   init: (4 - 1) / (20 - 1),           curve: 0.4, group: 'Compressor' },
  { id: 'release',   name: 'Release',   min: 10,   max: 2000, init: (100 - 10) / (2000 - 10),     curve: 0.3, group: 'Compressor' },
  { id: 'threshold', name: 'Threshold', min: -60,  max: 0,    init: (-24 - (-60)) / (0 - (-60)),  curve: 0.5, group: 'Compressor' },
];

export class CompressorModule extends EOCModule {
  private _workletNode: AudioWorkletNode | null = null;
  private _effectGain: GainNode | null = null;
  private _paramMetaData: ParamMeta[] = COMP_PARAM_META;

  // ---------------------------------------------------------------------------
  // EOCModule identity
  // ---------------------------------------------------------------------------

  override get id(): string             { return 'compressor'; }
  override get displayName(): string    { return 'Compressor'; }
  override get paramMeta(): ParamMeta[] { return this._paramMetaData; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override async init(audioCtx: AudioContext): Promise<void> {
    await super.init(audioCtx);

    try {
      const fetched = await loadFaustParamMeta('/faust/eoc-compressor.json');
      if (fetched && fetched.length > 0) this._paramMetaData = fetched;
    } catch (err) {
      console.warn('[CompressorModule] Could not load eoc-compressor.json, using static paramMeta:', (err as Error).message);
    }

    try {
      await audioCtx.audioWorklet.addModule('/faust/faust-worklet-processor.js');
    } catch (_) { /* already registered */ }
    await audioCtx.audioWorklet.addModule('/faust/eoc-compressor-processor.js');

    this._workletNode = new AudioWorkletNode(audioCtx, 'eoc-compressor-processor', {
      numberOfInputs:     1,
      numberOfOutputs:    1,
      outputChannelCount: [2],
    });

    const wasmResp  = await fetch('/faust/eoc-compressor.wasm');
    if (!wasmResp.ok) throw new Error(`[CompressorModule] Failed to fetch eoc-compressor.wasm: ${wasmResp.status}`);
    const wasmBytes = await wasmResp.arrayBuffer();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CompressorModule worklet init timeout')), 10_000);
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
