/**
 * InputLayer — composes the active InputSource adapters into ONE N-dim input
 * vector at the head of the reactive spine, and drives engine.setInputs.
 *
 * Sits ABOVE the engine: it owns a single rAF loop that, each frame,
 *  1. polls poll-based sources (gamepad buttons → actions),
 *  2. pulls every active source's axes into the shared `vector` (pull-based),
 *  3. blends/maps the N-dim vector down to the engine's input arity, and
 *  4. fires engine.setInputs(...) exactly once.
 *
 * The XY pad remains push-driven via the existing onMove handler — when it's the
 * only active source the loop is effectively a no-op for it (it already latched
 * its value), but routing everything through one compose path keeps sources
 * composable and the channel layout coherent.
 *
 * ── Dedicated dimensions (no blending) ──────────────────────────────────────
 * The WASM net is over-provisioned to a 32-input head (= MAX_AXES; see
 * nisps/wasm/bindings.cpp). Each active axis drives its OWN engine input slot
 * 1:1 — a double-stick gamepad is 4 genuine dims, a learned MIDI surface is N
 * genuine dims. `compose()` simply forwards the active axes; the engine
 * zero-pads the remaining slots and a zero input is inert (0 × weight = 0), so
 * unused dimensions never perturb the net. We do NOT mean-blend (the previous
 * behaviour) — that diluted every source and biased the net toward idle
 * sources' resting values.
 *
 * Changing the ACTIVE axis count offers a reshape (ConsoleApp → ReshapeModal):
 * a new net at the new arity, warm-started from the overlapping weights, with
 * examples + feedback state reset. Declining keeps this over-provisioned head.
 */
import type { InputAction, InputSource } from './types';

/** Minimal engine surface the layer needs (keeps this framework/engine-neutral). */
export interface InputEngineSink {
  setInputs(arr: ReadonlyArray<number>): void;
  readonly architecture: { inputSize: number };
}

const MAX_AXES = 32;

export class InputLayer {
  private sources: InputSource[] = [];
  private engine: InputEngineSink | null = null;
  private vector = new Float32Array(MAX_AXES);
  private running = false;
  private rafId: number | null = null;
  private actionListeners = new Set<(a: InputAction) => void>();
  private layoutListeners = new Set<() => void>();
  private reducedListeners = new Set<(x: number, y: number) => void>();
  private unsubActions = new Map<InputSource, () => void>();

  attach(engine: InputEngineSink): void {
    this.engine = engine;
  }

  /** Replace the active source set. Sources already started stay started. */
  setSources(sources: InputSource[]): void {
    // Unsubscribe actions from sources being dropped.
    for (const [src, unsub] of this.unsubActions) {
      if (!sources.includes(src)) {
        unsub();
        this.unsubActions.delete(src);
      }
    }
    // Subscribe new sources' actions through to our fan-out.
    for (const src of sources) {
      if (!this.unsubActions.has(src)) {
        this.unsubActions.set(src, src.onAction((a) => this.fanAction(a)));
      }
    }
    this.sources = sources;
    this.notifyLayout();
  }

  getSources(): ReadonlyArray<InputSource> {
    return this.sources;
  }

  /** Total composed axis count across active sources. */
  axisCount(): number {
    let n = 0;
    for (const s of this.sources) n += s.axisCount();
    return Math.min(n, MAX_AXES);
  }

  /** Per-axis labels in composed order ("XY:X", "Gamepad:L-X", …). */
  channelLayout(): { source: string; label: string }[] {
    const out: { source: string; label: string }[] = [];
    for (const s of this.sources) {
      const labels = s.axisLabels();
      for (const l of labels) {
        if (out.length >= MAX_AXES) break;
        out.push({ source: s.label, label: l });
      }
    }
    return out;
  }

  // ---- loop ----------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.frame();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** One composition tick (also callable directly from a push handler/tests). */
  frame(): void {
    const engine = this.engine;
    if (!engine || this.sources.length === 0) return;

    // 1. poll poll-based sources (gamepad button edges → actions).
    for (const s of this.sources) {
      const maybePoll = s as { poll?: () => void };
      if (typeof maybePoll.poll === 'function') maybePoll.poll();
    }

    // 2. pull each source's axes into the shared vector.
    let n = 0;
    for (const s of this.sources) {
      if (n >= MAX_AXES) break;
      n += s.sample(this.vector, n);
    }
    if (n === 0) return;

    // 3. reduce to the engine's input arity (see file header — blend, not fake).
    const reduced = this.compose(n, engine.architecture.inputSize);

    // 4. one engine write.
    engine.setInputs(reduced);

    // 5. report the reduced 2D position so the on-screen manifold can track a
    //    gamepad/MIDI-driven input (the XY pad pushes its own position).
    if (this.reducedListeners.size) {
      const x = reduced[0] ?? 0.5;
      const y = reduced[1] ?? reduced[0] ?? 0.5;
      for (const cb of this.reducedListeners) cb(x, y);
    }
  }

  /**
   * Map the composed N active axes to the engine's input vector — DEDICATED
   * DIMENSIONS, no blending. Each active axis i drives engine input slot i 1:1;
   * the engine zero-pads the slots beyond `count` and a zero input is inert
   * (0 × weight = 0), so unused dimensions never perturb the net.
   *
   * The net's input arity is over-provisioned (32, = MAX_AXES), so `inputSize`
   * is effectively always ≥ n; the `min` only guards a transient where more
   * axes are active than the net can take. We deliberately do NOT mean-blend
   * (the old behaviour) — that diluted every source and biased the net toward
   * idle sources' resting values.
   */
  private compose(n: number, inputSize: number): number[] {
    const count = Math.min(n, inputSize);
    const out = new Array<number>(count);
    for (let i = 0; i < count; i++) out[i] = this.vector[i];
    return out;
  }

  // ---- actions + layout fan-out -------------------------------------------

  onAction(cb: (a: InputAction) => void): () => void {
    this.actionListeners.add(cb);
    return () => {
      this.actionListeners.delete(cb);
    };
  }

  onLayoutChange(cb: () => void): () => void {
    this.layoutListeners.add(cb);
    return () => {
      this.layoutListeners.delete(cb);
    };
  }

  /** Subscribe to the reduced 2D input each frame (composed → engine arity). */
  onReducedInput(cb: (x: number, y: number) => void): () => void {
    this.reducedListeners.add(cb);
    return () => {
      this.reducedListeners.delete(cb);
    };
  }

  private fanAction(a: InputAction): void {
    for (const cb of this.actionListeners) cb(a);
  }

  private notifyLayout(): void {
    for (const cb of this.layoutListeners) cb();
  }

  dispose(): void {
    this.stop();
    for (const unsub of this.unsubActions.values()) unsub();
    this.unsubActions.clear();
    this.actionListeners.clear();
    this.layoutListeners.clear();
    this.reducedListeners.clear();
  }
}
