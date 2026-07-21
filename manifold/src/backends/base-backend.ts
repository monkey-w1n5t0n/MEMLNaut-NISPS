/**
 * BaseBackend — shared status + throttle + lastSent plumbing for the real
 * output backends (MIDI / OSC / uSEQ CV / VCV), mirroring the inputs layer's
 * BaseSource (inputs/base-source.ts). Subclasses implement
 * isAvailable/start/send/teardown.
 *
 * What lives here:
 *   - Status plumbing: `statusState` + listeners + `status()` /
 *     `onStatusChange()` / `setStatus()` — byte-for-byte what each backend
 *     previously carried.
 *   - Throttle gate: `throttled(intervalMs)` around the shared `lastSendMs`
 *     stamp. Call it first thing in `send()` (after the connected/ctx guards);
 *     it stamps on pass, so a frame dropped AFTER the gate (e.g. serial
 *     backpressure in the CV backend) still consumed its slot — exactly the
 *     previous inline semantics. Tests poke `lastSendMs` directly to bypass
 *     the gate (tests/input-vector-truncation.test.ts) — keep the field name.
 *   - lastSent: the per-output dead-zone sentinel buffer (-1 = unsent),
 *     unconditionally reset by `resetLastSent()` (start / config change) and
 *     resized-if-needed by `setContext()`. The uSEQ CV backend tracks
 *     CHANNEL-level state instead (lastCv/lastGateBits — its dead-zone is
 *     frame-level over the 14 uSEQ channels) and simply never reads this
 *     buffer; it still shares the status/throttle/ctx plumbing.
 */
import type { BackendId } from '../dock/output-state';
import type { BackendContext, BackendStatus, OutputBackend } from './backend';

export abstract class BaseBackend implements OutputBackend {
  abstract readonly id: BackendId;

  protected ctx: BackendContext | null = null;
  protected statusState: BackendStatus;
  private statusListeners = new Set<(s: BackendStatus) => void>();

  /**
   * Per-output dead-zone sentinels (-1 = unsent). Float32 holds the MIDI
   * backend's 7-bit integers (0..127) exactly, so one buffer type serves the
   * float (OSC/VCV) and integer (MIDI) dead-zones alike.
   */
  protected lastSent = new Float32Array(0);

  /** Throttle-gate timestamp. Tests poke this directly — do not rename. */
  private lastSendMs = 0;

  constructor(initial: BackendStatus) {
    this.statusState = initial;
  }

  abstract isAvailable(): boolean;
  abstract start(ctx: BackendContext): Promise<void>;
  abstract send(routed: Float32Array): void;
  abstract teardown(): Promise<void>;

  status(): BackendStatus {
    return this.statusState;
  }

  onStatusChange(cb: (s: BackendStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  /** Apply a fresh context; resize the dead-zone buffer only when the output
   *  count changed (an unchanged-width remap keeps its sentinels — matching
   *  the previous per-backend behaviour). */
  setContext(ctx: BackendContext): void {
    this.ctx = ctx;
    if (this.lastSent.length !== ctx.outputCount) this.resetLastSent(ctx.outputCount);
  }

  protected setStatus(s: BackendStatus): void {
    this.statusState = s;
    for (const cb of this.statusListeners) cb(s);
  }

  /**
   * Send-interval gate. Returns true when this call falls inside the interval
   * (caller should drop the frame); otherwise stamps `lastSendMs` and returns
   * false.
   */
  protected throttled(intervalMs: number): boolean {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastSendMs < intervalMs) return true;
    this.lastSendMs = now;
    return false;
  }

  /** (Re)allocate the per-output dead-zone buffer, every sentinel -1. */
  protected resetLastSent(count: number): void {
    this.lastSent = new Float32Array(count).fill(-1);
  }
}
