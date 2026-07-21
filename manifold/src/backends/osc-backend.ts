/**
 * OscBridgeBackend — OSC output over the Deno WebSocket↔UDP bridge
 * (backends-spec §2.4). Browsers can't send UDP, so we connect to the bridge
 * (default ws://localhost:8765) and post `{ type:'params', payload:[[path,
 * value], ...] }`; the bridge encodes OSC and forwards to the target.
 *
 * Per output: a configurable OSC address path + a physical range. The 0..1
 * model output is baseline-mapped (min/max/curve) then linearly scaled into the
 * per-output physical [rangeMin,rangeMax] (unless "send raw 0..1" is toggled).
 *
 * The bridge process must be running locally; the client auto-reconnects and we
 * surface "bridge not running" until the WS connects. Throttled to ~50ms with a
 * per-output dead-zone (matching the deployed osc-output.js).
 */
import type { BackendContext } from './backend';
import { BaseBackend } from './base-backend';
import { isSilent, mapOutput } from './mapping';
import { NispsOscClient } from './osc-client';
import type { OscSpec } from '../dock/output-state';

const SEND_INTERVAL_MS = 50;
const DEAD_ZONE = 0.002; // on the normalised value, pre physical-scale

export interface OscBackendConfig {
  /** Bridge WebSocket URL. */
  url: string;
  /** Send raw normalised 0..1 instead of the physical range. */
  sendRaw: boolean;
}

export class OscBridgeBackend extends BaseBackend {
  readonly id = 'osc' as const;

  private client = new NispsOscClient();
  private specs: OscSpec[] = [];
  private sendRaw = false;

  private batch: Array<[string, number]> = []; // reused outer; entries reused

  private offConn: (() => void) | null = null;
  private offInfo: (() => void) | null = null;

  constructor() {
    super({ state: 'idle', message: 'OSC idle' });
  }

  isAvailable(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  async start(ctx: BackendContext): Promise<void> {
    this.ctx = ctx;
    this.resetLastSent(ctx.outputCount);
    if (!this.isAvailable()) {
      this.setStatus({ state: 'unavailable', message: 'WebSocket not available' });
      return;
    }
    this.offConn = this.client.onConnectionChange((connected) => {
      this.setStatus(
        connected
          ? { state: 'ready', message: `OSC bridge connected (${this.client.url})` }
          : { state: 'error', message: `OSC bridge not running — start it (${this.client.url})` },
      );
    });
    this.offInfo = this.client.onInfo((m) => {
      if (this.client.connected) this.setStatus({ state: 'ready', message: m });
    });
    this.setStatus({ state: 'connecting', message: `Connecting to OSC bridge (${this.client.url})…` });
    // Reject is non-fatal — the client keeps reconnecting in the background.
    this.client.connect({ reconnect: true }).catch(() => {
      this.setStatus({ state: 'error', message: `OSC bridge not running — start it (${this.client.url})` });
    });
  }

  /** Update per-output OSC specs + bridge URL/raw toggle. */
  setOscConfig(specs: OscSpec[], cfg: OscBackendConfig): void {
    this.specs = specs;
    this.sendRaw = cfg.sendRaw;
    if (cfg.url !== this.client.url) {
      this.client.setUrl(cfg.url);
      if (this.isAvailable()) {
        this.setStatus({ state: 'connecting', message: `Connecting to OSC bridge (${cfg.url})…` });
        this.client.connect({ reconnect: true }).catch(() => {
          this.setStatus({ state: 'error', message: `OSC bridge not running — start it (${cfg.url})` });
        });
      }
    }
    this.lastSent.fill(-1);
  }

  send(routed: Float32Array): void {
    const ctx = this.ctx;
    if (!ctx || !this.client.connected) return;

    if (this.throttled(SEND_INTERVAL_MS)) return;

    const n = Math.min(routed.length, ctx.mappings.length, this.specs.length);
    this.batch.length = 0;
    for (let i = 0; i < n; i++) {
      const m = ctx.mappings[i];
      if (isSilent(m)) continue;
      const spec = this.specs[i];
      if (!spec || !spec.path) continue;
      const mapped = mapOutput(routed[i], m); // 0..1 in [min,max]
      const prev = this.lastSent[i];
      if (prev >= 0 && Math.abs(mapped - prev) < DEAD_ZONE) continue;
      this.lastSent[i] = mapped;
      const value = this.sendRaw
        ? mapped
        : spec.rangeMin + mapped * (spec.rangeMax - spec.rangeMin);
      this.batch.push([spec.path, value]);
    }
    if (this.batch.length) this.client.sendParams(this.batch);
  }

  async teardown(): Promise<void> {
    this.offConn?.();
    this.offInfo?.();
    this.offConn = null;
    this.offInfo = null;
    this.client.disconnect();
    this.setStatus({ state: 'idle', message: 'OSC idle' });
  }
}
