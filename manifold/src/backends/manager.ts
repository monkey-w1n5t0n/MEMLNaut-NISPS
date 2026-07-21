/**
 * BackendManager — the single consumer of the engine spine that forwards each
 * routed output vector to the ACTIVE output backend (backends-spec §0–§1).
 *
 * It is a CONSUMER of the engine, exactly like the stage / dock: it
 * `engine.subscribe()`s and reads `engine.routedOutput()` on each bump, then
 * calls `activeBackend.send(routed)`. It NEVER modifies the engine.
 *
 * Audio gating: the Built-in Synth plays inside the engine (EngineHost pushes
 * params to the worklet on every spine tick — see engine-api.ts `send`). So
 * selecting MIDI / OSC / Particle would ALSO blast the synth. The manager gates
 * this with `engine.audio.setMuted(true)` on every non-synth mode and
 * `setMuted(false)` on the synth mode. (Cleanly gating the worklet push without
 * an engine change isn't possible — muting is the documented approach,
 * backends-spec §1 / task constraint.)
 *
 * Framework-neutral: no React. A thin hook (useBackendManager.ts) exposes status.
 */
import type { BackendContext, BackendStatus, OutputBackend } from './backend';
import type { BackendId } from '../dock/output-state';
import { WebMidiBackend } from './midi-backend';
import { OscBridgeBackend } from './osc-backend';
import { PassthroughBackend } from './passthrough-backend';
import { ParticleBackend } from './particle-backend';
import { VcvBackend, type VcvFeedbackOp } from './vcv-backend';
import { UseqCvBackend } from './cv-backend';

/** The slice of EngineApi the manager depends on (keeps it decoupled/testable). */
export interface ManagerEngine {
  subscribe(cb: () => void): () => void;
  routedOutput(): Float32Array | null;
  audio: { setMuted(muted: boolean): void };
  /**
   * Current FULL-width control input vector (one entry per active input axis
   * — NOT fixed at 2-D). Optional — when present the VCV backend streams it
   * to the module so the browser drives the module's inputs in bridged mode.
   * May be a live reused buffer (ArrayLike) — the manager copies it straight
   * through to `VcvBackend.setInputVector`, which itself copies.
   */
  inputVector?(): ArrayLike<number>;
}

export class BackendManager {
  private engine: ManagerEngine;
  private backends: Map<BackendId, OutputBackend>;
  private active: OutputBackend | null = null;
  private activeId: BackendId | null = null;
  private ctx: BackendContext | null = null;
  private unsub: (() => void) | null = null;
  private switching = false;
  /** Latest id requested while a switch was already in flight (simplification
   *  audit L19) — re-run once the in-flight switch settles, so a rapid double
   *  click no longer silently drops the second request. Cleared before the
   *  re-run so it can only ever chain one hop at a time (no unbounded loop). */
  private pendingId: BackendId | null = null;

  private statusListeners = new Set<(id: BackendId, s: BackendStatus) => void>();
  private offBackendStatus: (() => void) | null = null;

  constructor(engine: ManagerEngine, backends?: Partial<Record<BackendId, OutputBackend>>) {
    this.engine = engine;
    this.backends = new Map<BackendId, OutputBackend>([
      ['midi', backends?.midi ?? new WebMidiBackend()],
      ['osc', backends?.osc ?? new OscBridgeBackend()],
      ['synth', backends?.synth ?? new PassthroughBackend('synth', 'Built-in Synth — audio plays in the engine')],
      ['particles', backends?.particles ?? new ParticleBackend()],
      ['cvgate', backends?.cvgate ?? new UseqCvBackend()],
      ['vcv', backends?.vcv ?? new VcvBackend()],
    ]);

    // Single subscription to the spine: forward routed → active backend. For the
    // VCV backend we also stream the current input vector each tick so the
    // browser drives the module's inputs in bridged mode.
    this.unsub = this.engine.subscribe(() => {
      if (!this.active) return;
      if (this.active instanceof VcvBackend && this.engine.inputVector) {
        this.active.setInputVector(this.engine.inputVector());
      }
      const routed = this.engine.routedOutput();
      if (routed) this.active.send(routed);
    });
  }

  /** Typed handle to a concrete backend (for the dock's per-backend config). */
  midi(): WebMidiBackend | null {
    const b = this.backends.get('midi');
    return b instanceof WebMidiBackend ? b : null;
  }

  osc(): OscBridgeBackend | null {
    const b = this.backends.get('osc');
    return b instanceof OscBridgeBackend ? b : null;
  }

  vcv(): VcvBackend | null {
    const b = this.backends.get('vcv');
    return b instanceof VcvBackend ? b : null;
  }

  cv(): UseqCvBackend | null {
    const b = this.backends.get('cvgate');
    return b instanceof UseqCvBackend ? b : null;
  }

  /**
   * Forward a verdict op to the VCV module's embedded learner over the bridge.
   * No-op unless the VCV backend is the ACTIVE one — the verdict loop only
   * trains the module when Mode = VCV (otherwise the browser engine is the
   * learner). Returns true if it was forwarded.
   */
  forwardFeedback(op: VcvFeedbackOp): boolean {
    if (this.activeId !== 'vcv') return false;
    const vcv = this.vcv();
    if (!vcv) return false;
    vcv.sendFeedback(op);
    return true;
  }

  get(id: BackendId): OutputBackend | undefined {
    return this.backends.get(id);
  }

  getActiveId(): BackendId | null {
    return this.activeId;
  }

  /** Provide / refresh the BackendContext (mappings + names) for the active set. */
  setContext(ctx: BackendContext): void {
    this.ctx = ctx;
    this.active?.setContext?.(ctx);
  }

  /**
   * Switch the active backend. Tears down the old, starts the new, and applies
   * the synth audio gate. Idempotent for the same id.
   *
   * If a switch is already in flight, the request is NOT dropped: it is
   * remembered as `pendingId` (the latest caller wins) and re-run once the
   * in-flight switch's `finally` settles — see below.
   */
  async setActive(id: BackendId): Promise<void> {
    if (this.activeId === id) return;
    if (this.switching) {
      this.pendingId = id;
      return;
    }
    this.switching = true;
    try {
      // Gate audio: only the synth mode drives sound.
      this.engine.audio.setMuted(id !== 'synth');

      const next = this.backends.get(id);
      if (!next) return;
      if (this.active) {
        this.offBackendStatus?.();
        this.offBackendStatus = null;
        await this.active.teardown();
      }
      this.active = next;
      this.activeId = id;
      this.offBackendStatus = next.onStatusChange?.((s) => this.emitStatus(id, s)) ?? null;
      if (this.ctx) {
        next.setContext?.(this.ctx);
        await next.start(this.ctx);
      }
      this.emitStatus(id, next.status());
    } finally {
      this.switching = false;
      // A newer request arrived mid-switch — chase it. Clearing `pendingId`
      // BEFORE the recursive call (rather than in it) bounds this to one hop
      // per settled switch: the only way to chain further is another NEW
      // request arriving during that hop, which is the intended behaviour,
      // not an infinite loop.
      const pending = this.pendingId;
      this.pendingId = null;
      if (pending !== null && pending !== this.activeId) {
        void this.setActive(pending);
      }
    }
  }

  status(id?: BackendId): BackendStatus {
    const b = id ? this.backends.get(id) : this.active;
    return b?.status() ?? { state: 'idle', message: 'idle' };
  }

  onStatusChange(cb: (id: BackendId, s: BackendStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = null;
    this.offBackendStatus?.();
    if (this.active) void this.active.teardown();
    this.active = null;
    this.activeId = null;
  }

  private emitStatus(id: BackendId, s: BackendStatus): void {
    for (const cb of this.statusListeners) cb(id, s);
  }
}
