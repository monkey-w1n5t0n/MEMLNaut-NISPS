/**
 * PowerfulSynthBackend — drives the Powerful Synth Engine from the routed MLP
 * output vector.
 *
 * `setPreset(presetId)` fixes the output-index → synth-parameter identity (the
 * preset's ML-controlled params, in output order) and the values the other
 * params are held at. Per-output range/curve/state come from the shared
 * BackendContext mappings (seeded from `presetParamSpecs` by the rig), so
 * `send()` shapes each value with `mapOutput` exactly like the other backends
 * and writes the resulting normalised hardware value straight to the synth.
 * The preset's overrides are NOT re-applied here.
 *
 * Throttled to 50 ms with a 0.002 per-parameter dead-zone (as the old app).
 * `send()` does not allocate.
 */
import type { BackendContext } from './backend';
import { BaseBackend } from './base-backend';
import { clamp01, isSilent, mapOutput } from './mapping';
import type { BackendId } from '../dock/output-state';
import type { PowerfulSynth } from '../synth/psynth';
import { presetHeldValues, presetParamSpecs } from '../synth/preset-model';

const SEND_INTERVAL_MS = 50;
const DEAD_ZONE = 0.002;

/** The slice of PowerfulSynth the backend needs (lets tests use a fake). */
export type SynthSink = Pick<PowerfulSynth, 'isRunning' | 'setParamByHardwareId'>;

export class PowerfulSynthBackend extends BaseBackend {
  readonly id: BackendId = 'psynth';

  private presetId: string | null = null;
  /** Hardware id per output index for the current preset. */
  private ids = new Int32Array(0);

  constructor(private readonly synth: SynthSink) {
    super({ state: 'idle', message: 'Synth idle' });
  }

  isAvailable(): boolean {
    return (
      typeof SharedArrayBuffer !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined'
    );
  }

  /** Choose the preset: output i drives its i-th ML-controlled param. Re-writes held values. */
  setPreset(presetId: string): void {
    const specs = presetParamSpecs(presetId);
    this.presetId = presetId;
    this.ids = new Int32Array(specs.length);
    for (let i = 0; i < specs.length; i++) this.ids[i] = specs[i].id;
    this.resetLastSent(this.ids.length);
    this.writeHeld();
  }

  get currentPreset(): string | null {
    return this.presetId;
  }

  /** Write the held (non-ML-controlled) values once. */
  private writeHeld(): void {
    if (this.presetId === null || !this.synth.isRunning) return;
    for (const h of presetHeldValues(this.presetId)) this.synth.setParamByHardwareId(h.id, h.value);
  }

  async start(ctx: BackendContext): Promise<void> {
    this.ctx = ctx;
    this.resetLastSent(this.ids.length);
    if (!this.isAvailable()) {
      this.setStatus({ state: 'unavailable', message: 'Synth needs Web Audio with cross-origin isolation' });
      return;
    }
    // The rig owns the synth's audio lifecycle (it also plays the sequencer),
    // so switching output modes never starts or stops it.
    if (!this.synth.isRunning) {
      this.setStatus({ state: 'connecting', message: 'Press play to start the synth' });
      return;
    }
    this.writeHeld();
    this.setStatus({ state: 'ready', message: 'Synth running' });
  }

  send(routed: Float32Array): void {
    const ctx = this.ctx;
    if (!ctx || !this.synth.isRunning) return;
    if (this.throttled(SEND_INTERVAL_MS)) return;

    const n = Math.min(routed.length, this.ids.length, ctx.mappings.length);
    for (let i = 0; i < n; i++) {
      const m = ctx.mappings[i];
      if (isSilent(m)) continue;
      const v = clamp01(mapOutput(routed[i], m));
      const prev = this.lastSent[i];
      if (prev >= 0 && Math.abs(v - prev) <= DEAD_ZONE) continue;
      this.lastSent[i] = v;
      this.synth.setParamByHardwareId(this.ids[i], v);
    }
  }

  async teardown(): Promise<void> {
    this.setStatus({ state: 'idle', message: 'Synth idle' });
  }
}
