/**
 * VcvBackend — drives + trains the VCV Rack NISPS module over the OSC↔WS bridge
 * (backends-spec §2.6; docs/specs/vcv-module.md OSC verbs). In "bridged" mode the BROWSER is
 * authoritative: it streams the current input vector to the module and forwards
 * the verdict loop (thumbs up/down, explore-and-place) so the module's embedded
 * net trains in lock-step with the browser session.
 *
 * Transport (reuses {@link NispsOscClient} → the Deno bridge in
 * manifold/osc-bridge, default ws://localhost:8765, default module UDP 7001):
 *
 *   browser → module
 *     /nisps/input    <f…f>     the current 2-D input vector (drives the module)
 *     /nisps/output   <f…f>     per-output values (CV) — sent as params batch so
 *                               the bridge maps each to /nisps/<name>; the module
 *                               also derives its own outputs, but the browser
 *                               value is authoritative in bridged mode
 *     /nisps/feedback {op,…}    verdict op (up | down | rand | clear) as a JSON
 *                               string — { op, spread, input[], output[] }
 *
 *   module → browser
 *     /nisps/output   <f…f>     module's live outputs (proves the module is alive)
 *     /nisps/input    <f…f>     module's live inputs (echo — same alive proof)
 *
 * The bridge process AND the VCV module must both be running — until the WS
 * connects we surface "bridge not running"; until the module replies we stay
 * "connected, waiting for module".
 *
 * British spelling in product copy; the synth is the "Built-in Synth", never
 * "C15".
 */
import type { BackendContext, BackendStatus, OutputBackend } from './backend';
import { isSilent, mapOutput } from './mapping';
import { NispsOscClient } from './osc-client';
import type { VcvSpec } from '../dock/output-state';

const SEND_INTERVAL_MS = 50;
const DEAD_ZONE = 0.002; // on the normalised value, pre physical-scale

/** A verdict op forwarded to the module's embedded learner. */
export interface VcvFeedbackOp {
  op: 'up' | 'down' | 'rand' | 'clear';
  /** Master spread (0..1) — mirrors the engine spread knob. */
  spread: number;
  /** The control input the verdict was given at (2-D). */
  input: number[];
  /** The heard output vector at that input (≤126 dims). */
  output: number[];
}

export interface VcvBackendConfig {
  /** Bridge WebSocket URL (the bridge then relays to the module over UDP). */
  url: string;
  /** Send raw normalised 0..1 instead of the per-output bipolar/unipolar range. */
  sendRaw: boolean;
}

export class VcvBackend implements OutputBackend {
  readonly id = 'vcv' as const;

  private client = new NispsOscClient();
  private ctx: BackendContext | null = null;
  private specs: VcvSpec[] = [];
  private sendRaw = false;

  /** Latest input vector the browser is driving the module with (2-D). */
  private inputVec: number[] = [0.5, 0.5];

  private lastSent: Float32Array = new Float32Array(0); // last normalised output
  private batch: Array<[string, number]> = []; // reused outer; entries reused
  private lastSendMs = 0;
  private lastInputSent: [number, number] = [-1, -1];

  private gotModuleReply = false;

  private statusState: BackendStatus = { state: 'idle', message: 'VCV idle' };
  private statusListeners = new Set<(s: BackendStatus) => void>();
  private offConn: (() => void) | null = null;
  private offInfo: (() => void) | null = null;
  private offOutputs: (() => void) | null = null;
  private offInputs: (() => void) | null = null;

  isAvailable(): boolean {
    return typeof WebSocket !== 'undefined';
  }

  async start(ctx: BackendContext): Promise<void> {
    this.ctx = ctx;
    this.lastSent = new Float32Array(ctx.outputCount).fill(-1);
    if (!this.isAvailable()) {
      this.setStatus({ state: 'unavailable', message: 'WebSocket not available' });
      return;
    }
    this.offConn = this.client.onConnectionChange((connected) => {
      if (!connected) {
        this.gotModuleReply = false;
        this.setStatus({ state: 'error', message: `VCV bridge not running — start it (${this.client.url})` });
        return;
      }
      this.setStatus({
        state: this.gotModuleReply ? 'ready' : 'connecting',
        message: this.gotModuleReply
          ? `VCV module connected (${this.client.url})`
          : `Bridge connected (${this.client.url}) — waiting for module…`,
      });
    });
    this.offInfo = this.client.onInfo((m) => {
      if (this.client.connected && !this.gotModuleReply) {
        this.setStatus({ state: 'connecting', message: m });
      }
    });
    // Module → browser: a reply on either channel proves the module is alive.
    this.offOutputs = this.client.onOutputsReceived(() => this.onModuleReply());
    this.offInputs = this.client.onInputsReceived(() => this.onModuleReply());

    this.setStatus({ state: 'connecting', message: `Connecting to VCV bridge (${this.client.url})…` });
    this.client.connect({ reconnect: true }).catch(() => {
      this.setStatus({ state: 'error', message: `VCV bridge not running — start it (${this.client.url})` });
    });
  }

  setContext(ctx: BackendContext): void {
    this.ctx = ctx;
    if (this.lastSent.length !== ctx.outputCount) {
      this.lastSent = new Float32Array(ctx.outputCount).fill(-1);
    }
  }

  /** Update per-output VCV specs (polarity) + bridge URL/raw toggle. */
  setVcvConfig(specs: VcvSpec[], cfg: VcvBackendConfig): void {
    this.specs = specs;
    this.sendRaw = cfg.sendRaw;
    if (cfg.url !== this.client.url) {
      this.client.setUrl(cfg.url);
      this.gotModuleReply = false;
      if (this.isAvailable()) {
        this.setStatus({ state: 'connecting', message: `Connecting to VCV bridge (${cfg.url})…` });
        this.client.connect({ reconnect: true }).catch(() => {
          this.setStatus({ state: 'error', message: `VCV bridge not running — start it (${cfg.url})` });
        });
      }
    }
    this.lastSent.fill(-1);
  }

  /**
   * Set the input vector the browser drives the module with (bridged mode). The
   * next `send()` streams it to /nisps/input. Copied — caller may mutate.
   */
  setInputVector(vec: ReadonlyArray<number>): void {
    if (this.inputVec.length !== vec.length) this.inputVec = new Array(vec.length);
    for (let i = 0; i < vec.length; i++) this.inputVec[i] = vec[i];
  }

  /**
   * Forward a verdict op to the module's embedded learner over /nisps/feedback.
   * Hooked from the BackendManager when the verdict loop fires in VCV mode, so
   * thumbs-up/down + explore-and-place train the module across the bridge.
   */
  sendFeedback(op: VcvFeedbackOp): void {
    if (!this.client.connected) return;
    // → bridge `feedback` verb → OSC string to /nisps/feedback.
    this.client.sendFeedback(op);
  }

  send(routed: Float32Array): void {
    const ctx = this.ctx;
    if (!ctx || !this.client.connected) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastSendMs < SEND_INTERVAL_MS) return;
    this.lastSendMs = now;

    // 1) Stream the current input vector so the browser drives the module.
    const ix = this.inputVec[0] ?? 0.5;
    const iy = this.inputVec[1] ?? 0.5;
    if (Math.abs(ix - this.lastInputSent[0]) >= DEAD_ZONE || Math.abs(iy - this.lastInputSent[1]) >= DEAD_ZONE) {
      this.lastInputSent[0] = ix;
      this.lastInputSent[1] = iy;
      // → bridge `input` verb → ONE multi-float message to /nisps/input.
      this.client.sendInput(this.inputVec);
    }

    // 2) Stream the routed per-output values (authoritative CV in bridged mode).
    const n = Math.min(routed.length, ctx.mappings.length);
    this.batch.length = 0;
    for (let i = 0; i < n; i++) {
      const m = ctx.mappings[i];
      if (isSilent(m)) continue;
      const mapped = mapOutput(routed[i], m); // 0..1 in [min,max]
      const prev = this.lastSent[i];
      if (prev >= 0 && Math.abs(mapped - prev) < DEAD_ZONE) continue;
      this.lastSent[i] = mapped;
      const spec = this.specs[i];
      const value = this.sendRaw ? mapped : this.toVoltage(mapped, spec);
      const name = ctx.names[i] ? sanitise(ctx.names[i]) : `out${i}`;
      this.batch.push([name, value]);
    }
    if (this.batch.length) this.client.sendParams(this.batch);
  }

  /** Map a 0..1 value into the per-output VCV voltage range (uni/bipolar). */
  private toVoltage(v: number, spec: VcvSpec | undefined): number {
    // Unipolar 0..10 V; bipolar ±5 V (dock-spec §4.3 polarity).
    return spec?.bipolar ? v * 10 - 5 : v * 10;
  }

  private onModuleReply(): void {
    if (!this.gotModuleReply) {
      this.gotModuleReply = true;
      this.setStatus({ state: 'ready', message: `VCV module connected (${this.client.url})` });
    }
  }

  async teardown(): Promise<void> {
    this.offConn?.();
    this.offInfo?.();
    this.offOutputs?.();
    this.offInputs?.();
    this.offConn = null;
    this.offInfo = null;
    this.offOutputs = null;
    this.offInputs = null;
    this.client.disconnect();
    this.gotModuleReply = false;
    this.setStatus({ state: 'idle', message: 'VCV idle' });
  }

  status(): BackendStatus {
    return this.statusState;
  }

  onStatusChange(cb: (s: BackendStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private setStatus(s: BackendStatus): void {
    this.statusState = s;
    for (const cb of this.statusListeners) cb(s);
  }
}

/** Sanitise an output name into an OSC-path-safe token (the bridge prefixes it). */
function sanitise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'out';
}
