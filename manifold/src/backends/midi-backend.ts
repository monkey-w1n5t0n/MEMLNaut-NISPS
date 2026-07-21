/**
 * WebMidiBackend — real Web MIDI CC output (backends-spec §2.3).
 *
 * Per non-silent output: map (0..1) → baseline (min/max/curve) → round(×127) →
 * send `[0xB0|(ch-1), cc, value]` on the configured CC#/channel. Throttled to
 * ~50ms (≈20 Hz) with a per-CC dead-zone (Δ ≥ 1) so we never flood the port.
 *
 * The per-output MIDI spec (cc/channel/name/range) lives on the shared MFParam
 * store (output-state.ts MidiCcSpec) and arrives via BackendContext.mappings +
 * a parallel `midiSpecs` array set through {@link setMidiConfig}. The port is
 * picked in the Outputs panel and applied via {@link selectOutput}.
 *
 * No per-frame allocation: the 3-byte message array is reused; the inherited
 * `lastSent` buffer tracks per-CC values for the dead-zone (7-bit integers —
 * exact in float32). Status/throttle/lastSent plumbing lives in BaseBackend.
 */
import type { BackendContext } from './backend';
import { BaseBackend } from './base-backend';
import { isSilent, mapOutput } from './mapping';
import type { MidiCcSpec } from '../dock/output-state';

const SEND_INTERVAL_MS = 50;
const DEAD_ZONE = 1;

export interface MidiBackendConfig {
  /** Selected output port id (null = none). */
  outputId: string | null;
  /** How many of the outputs are mapped to CCs (subset of outputCount). */
  ccCount: number;
}

export class WebMidiBackend extends BaseBackend {
  readonly id = 'midi' as const;

  private access: MIDIAccess | null = null;
  private output: MIDIOutput | null = null;
  private outputId: string | null = null;
  private ccCount = 0;

  /** Per-output MIDI specs, index-aligned with ctx.mappings. */
  private specs: MidiCcSpec[] = [];

  private msg: number[] = [0, 0, 0]; // reused 3-byte buffer

  constructor() {
    super({ state: 'idle', message: 'MIDI idle' });
  }

  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  async start(ctx: BackendContext): Promise<void> {
    this.ctx = ctx;
    this.resetLastSent(ctx.outputCount);
    if (!this.isAvailable()) {
      this.setStatus({ state: 'unavailable', message: 'Web MIDI not supported in this browser' });
      return;
    }
    this.setStatus({ state: 'connecting', message: 'Requesting MIDI access…' });
    try {
      this.access = await navigator.requestMIDIAccess!({ sysex: false });
      this.access.onstatechange = () => this.refreshPort();
      this.refreshPort();
      if (this.output) {
        this.setStatus({ state: 'ready', message: `MIDI → ${this.output.name ?? 'output'}` });
      } else {
        this.setStatus({ state: 'ready', message: 'MIDI ready — pick an output port' });
      }
    } catch (err) {
      this.setStatus({ state: 'error', message: `MIDI access denied: ${(err as Error).message}` });
    }
  }

  /** Update the per-output MIDI specs + how many CCs are mapped + the port. */
  setMidiConfig(specs: MidiCcSpec[], cfg: MidiBackendConfig): void {
    this.specs = specs;
    this.ccCount = cfg.ccCount;
    if (cfg.outputId !== this.outputId) {
      this.outputId = cfg.outputId;
      this.refreshPort();
    }
    this.lastSent.fill(-1); // CC map changed → re-send next frame
  }

  /** Enumerate the available MIDI output ports. */
  listOutputs(): { id: string; name: string }[] {
    if (!this.access) return [];
    const out: { id: string; name: string }[] = [];
    this.access.outputs.forEach((o, id) => out.push({ id, name: o.name ?? `MIDI Output ${id}` }));
    return out;
  }

  selectOutput(outputId: string | null): void {
    this.outputId = outputId;
    this.lastSent.fill(-1);
    this.refreshPort();
  }

  private refreshPort(): void {
    if (!this.access) {
      this.output = null;
      return;
    }
    if (this.outputId) {
      this.output = this.access.outputs.get(this.outputId) ?? null;
    } else {
      this.output = null;
    }
    if (this.output) {
      this.setStatus({ state: 'ready', message: `MIDI → ${this.output.name ?? 'output'}` });
    }
  }

  send(routed: Float32Array): void {
    const out = this.output;
    const ctx = this.ctx;
    if (!out || !ctx) return;

    if (this.throttled(SEND_INTERVAL_MS)) return;

    const n = Math.min(this.ccCount, routed.length, ctx.mappings.length, this.specs.length);
    for (let i = 0; i < n; i++) {
      const m = ctx.mappings[i];
      if (isSilent(m)) continue;
      const spec = this.specs[i];
      if (!spec) continue;
      // Baseline maps into [min,max] (already 0..1 here), then scale to 7-bit.
      const mapped = mapOutput(routed[i], m);
      const val = Math.max(0, Math.min(127, Math.round(mapped * 127)));
      const prev = this.lastSent[i];
      if (prev >= 0 && Math.abs(val - prev) < DEAD_ZONE) continue;
      this.lastSent[i] = val;
      const ch = Math.max(0, Math.min(15, (spec.channel - 1) | 0));
      const cc = Math.max(0, Math.min(127, spec.cc | 0));
      this.msg[0] = 0xb0 | ch;
      this.msg[1] = cc;
      this.msg[2] = val;
      try {
        out.send(this.msg);
      } catch {
        /* port unplugged mid-send — refresh on next statechange */
      }
    }
  }

  async teardown(): Promise<void> {
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.output = null;
    this.setStatus({ state: 'idle', message: 'MIDI idle' });
  }
}
