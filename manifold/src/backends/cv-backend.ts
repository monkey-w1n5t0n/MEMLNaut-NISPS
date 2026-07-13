/**
 * UseqCvBackend — real CV/gate output over USB Web Serial to a uSEQ module
 * (+ CV expander). The restored, modernised descendant of the April-2026
 * "uSEQ-Celium" output mode (provenance: docs/specs/useq-cv-protocol.md).
 *
 * Per non-silent output: map (0..1) → baseline (min/max/curve) → assign to the
 * output's configured uSEQ channel — a CV jack (12-bit value) or a gate
 * (threshold the mapped value). The 11 CV + 3 gate channels are packed into one
 * 26-byte OUTPUT frame and streamed at ~100 Hz (useq-protocol.ts), throttled
 * with a per-channel dead-zone so we never flood the port.
 *
 * Web Serial needs a user gesture to pick a port, so unlike MIDI this backend
 * exposes connect()/identify()/disconnect() for the Outputs-config buttons;
 * start() only tries to silently re-open a previously-granted port.
 *
 * The per-output CV spec (channel + gate threshold) lives on the shared MFParam
 * store (output-state.ts CvSpec) and arrives via {@link setCvConfig}, parallel
 * to ctx.mappings — exactly like the MIDI backend.
 */
import type { BackendContext, BackendStatus, OutputBackend } from './backend';
import { isSilent, mapOutput } from './mapping';
import type { CvChannelId, CvSpec } from '../dock/output-state';
import {
  CV_MAX,
  FRAME_OUTPUT_LEN,
  NUM_CV,
  STREAM_HZ,
  UseqRxParser,
  cvToWire,
  encodeIdentify,
  encodeOutput,
  FRAME_IDENTIFY_LEN,
} from './useq-protocol';

const SEND_INTERVAL_MS = 1000 / STREAM_HZ; // ~10 ms
const CV_DEAD_ZONE = 8; // on the 12-bit value (~0.2%)
const IDENTIFY_TIMEOUT_MS = 5000;

/** Resolve a channel id into a fast {kind, index} target (or null for 'none'). */
type Target = { kind: 'cv'; idx: number } | { kind: 'gate'; idx: number } | null;
function resolveTarget(id: CvChannelId): Target {
  if (id === 'none') return null;
  if (id.startsWith('cv')) return { kind: 'cv', idx: parseInt(id.slice(2), 10) - 1 };
  return { kind: 'gate', idx: parseInt(id.slice(4), 10) - 1 };
}

export class UseqCvBackend implements OutputBackend {
  readonly id = 'cvgate' as const;

  private ctx: BackendContext | null = null;
  /** Per-output CV specs, index-aligned with ctx.mappings. */
  private specs: CvSpec[] = [];
  /** Pre-resolved channel targets, index-aligned with specs. */
  private targets: Target[] = [];

  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private parser = new UseqRxParser(
    () => {},
    (ok) => this.onAck(ok),
  );

  private cvVals = new Uint16Array(NUM_CV); // last computed 12-bit CV per channel
  private gateBits = 0;
  private lastCv = new Int32Array(NUM_CV).fill(-1);
  private lastGateBits = -1;
  private lastSendMs = 0;
  private writing = false; // in-flight write guard (avoid serial backpressure)

  private pendingIdentify: (() => void) | null = null;

  private statusState: BackendStatus = { state: 'idle', message: 'CV idle' };
  private statusListeners = new Set<(s: BackendStatus) => void>();

  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  async start(ctx: BackendContext): Promise<void> {
    this.ctx = ctx;
    if (!this.isAvailable()) {
      this.setStatus({ state: 'unavailable', message: 'Web Serial not supported in this browser' });
      return;
    }
    if (this.port) {
      this.setStatus({ state: 'ready', message: 'uSEQ connected' });
      return;
    }
    // Try to silently re-open a previously-granted port (no user gesture needed).
    try {
      const ports = await navigator.serial.getPorts();
      if (ports.length > 0) {
        await this.open(ports[0]);
        return;
      }
    } catch {
      /* ignore — fall through to the idle "connect" prompt */
    }
    this.setStatus({ state: 'ready', message: 'uSEQ ready — click Connect device' });
  }

  setContext(ctx: BackendContext): void {
    this.ctx = ctx;
  }

  /** Update the per-output CV specs (channel + gate threshold). */
  setCvConfig(specs: CvSpec[]): void {
    this.specs = specs;
    this.targets = specs.map((s) => resolveTarget(s.channel));
    this.lastCv.fill(-1);
    this.lastGateBits = -1;
  }

  /** User-gesture path: pick + open a serial port. Throws if the user cancels. */
  async connect(): Promise<void> {
    if (!this.isAvailable()) {
      this.setStatus({ state: 'unavailable', message: 'Web Serial not supported in this browser' });
      return;
    }
    this.setStatus({ state: 'connecting', message: 'Select the uSEQ serial port…' });
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch {
      this.setStatus({ state: 'ready', message: 'uSEQ ready — click Connect device' });
      return; // user dismissed the picker
    }
    await this.open(port);
  }

  private async open(port: SerialPort): Promise<void> {
    try {
      await port.open({ baudRate: 115200 });
    } catch (err) {
      this.setStatus({ state: 'error', message: `Could not open port: ${(err as Error).message}` });
      return;
    }
    this.port = port;
    this.writer = port.writable?.getWriter() ?? null;
    this.lastCv.fill(-1);
    this.lastGateBits = -1;
    if (typeof port.addEventListener === 'function') {
      port.addEventListener('disconnect', () => this.handleDisconnect());
    }
    this.startReadLoop();
    this.setStatus({ state: 'ready', message: 'uSEQ connected' });
  }

  private async startReadLoop(): Promise<void> {
    const readable = this.port?.readable;
    if (!readable) return;
    this.reader = readable.getReader();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.parser.push(value);
      }
    } catch {
      /* stream errored (unplug) — handled by disconnect / teardown */
    } finally {
      try {
        this.reader?.releaseLock();
      } catch {
        /* already released */
      }
      this.reader = null;
    }
  }

  /** Send an IDENTIFY frame; both boards flash their LEDs. Resolves on ack/timeout. */
  identify(): void {
    const w = this.writer;
    if (!w) return;
    const frame = new Uint8Array(FRAME_IDENTIFY_LEN);
    encodeIdentify(frame);
    this.setStatus({ state: 'connecting', message: 'Identify… (watch the LEDs)' });
    let settled = false;
    const done = (msg: string) => {
      if (settled) return;
      settled = true;
      this.pendingIdentify = null;
      if (this.port) this.setStatus({ state: 'ready', message: msg });
    };
    this.pendingIdentify = () => done('uSEQ connected — identify ack');
    w.write(frame).catch(() => done('uSEQ connected'));
    setTimeout(() => done('uSEQ connected'), IDENTIFY_TIMEOUT_MS);
  }

  private onAck(ok: boolean): void {
    if (this.pendingIdentify) this.pendingIdentify();
    else if (ok && this.port) this.setStatus({ state: 'ready', message: 'uSEQ connected' });
  }

  send(routed: Float32Array): void {
    const ctx = this.ctx;
    const w = this.writer;
    if (!ctx || !w) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastSendMs < SEND_INTERVAL_MS) return;
    this.lastSendMs = now;
    if (this.writing) return; // previous frame still draining — drop this one

    // Rebuild the 14-channel snapshot from the routed outputs.
    this.cvVals.fill(0);
    let gates = 0;
    const n = Math.min(routed.length, ctx.mappings.length, this.targets.length);
    for (let i = 0; i < n; i++) {
      const t = this.targets[i];
      if (!t) continue;
      const m = ctx.mappings[i];
      if (isSilent(m)) continue;
      const mapped = mapOutput(routed[i], m); // 0..1 in [min,max]
      if (t.kind === 'cv') {
        if (t.idx >= 0 && t.idx < NUM_CV) this.cvVals[t.idx] = cvToWire(mapped);
      } else if (t.idx >= 0 && t.idx < 3) {
        if (mapped >= (this.specs[i]?.gateThreshold ?? 0.5)) gates |= 1 << t.idx;
      }
    }

    // Dead-zone: skip the frame entirely if nothing moved enough.
    let changed = gates !== this.lastGateBits;
    for (let i = 0; i < NUM_CV; i++) {
      if (this.lastCv[i] < 0 || Math.abs(this.cvVals[i] - this.lastCv[i]) >= CV_DEAD_ZONE) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    for (let i = 0; i < NUM_CV; i++) this.lastCv[i] = this.cvVals[i];
    this.lastGateBits = gates;

    // Fresh buffer per frame (the async writer may still hold the previous one).
    const frame = new Uint8Array(FRAME_OUTPUT_LEN);
    encodeOutput(frame, this.cvVals, gates);
    this.writing = true;
    w.write(frame)
      .catch(() => this.handleDisconnect())
      .finally(() => {
        this.writing = false;
      });
  }

  private handleDisconnect(): void {
    if (!this.port) return;
    this.port = null;
    this.writer = null;
    this.setStatus({ state: 'error', message: 'uSEQ disconnected — click Connect device' });
  }

  async disconnect(): Promise<void> {
    await this.closePort();
    this.setStatus({ state: 'ready', message: 'uSEQ ready — click Connect device' });
  }

  private async closePort(): Promise<void> {
    try {
      this.reader?.cancel().catch(() => {});
      this.writer?.releaseLock();
    } catch {
      /* ignore */
    }
    this.writer = null;
    this.reader = null;
    const port = this.port;
    this.port = null;
    if (port) {
      try {
        await port.close();
      } catch {
        /* already closed */
      }
    }
  }

  async teardown(): Promise<void> {
    await this.closePort();
    this.setStatus({ state: 'idle', message: 'CV idle' });
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
