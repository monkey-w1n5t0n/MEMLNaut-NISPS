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
 * ── Arity mismatch (the WASM reshape TODO) ──────────────────────────────────
 * The browser WASM is fixed at MLP<2, …, 126> — a TWO-input head. When the
 * composed vector has > 2 axes (double-stick gamepad = 4, MIDI learn-map = many)
 * we must reduce to 2 to feed today's engine. We do NOT fake a wider net.
 *
 *   chosen reduction (this pass): pairwise BLEND.
 *     inX = mean(axis[0], axis[2], axis[4], …)   // even axes
 *     inY = mean(axis[1], axis[3], axis[5], …)   // odd axes
 *   so a single stick passes straight through (axis0→X, axis1→Y), a double
 *   stick averages L/R into one XY, and MIDI axes fold into X/Y by parity.
 *
 * TODO(workstream F, docs/redesign/inputs-spec.md — "multiple WASM modules +
 * warm-start"): the real fix is to (re)load a WASM module whose MLP input arity
 * matches the composed axis count and warm-start its weights from the prior net,
 * so every axis gets its own genuine input dimension instead of being blended.
 * That is a larger build (multiple .wasm artefacts or a runtime-variadic head)
 * and is deliberately deferred — this layer is wired so that swapping the
 * reduction for a true reshape is a localised change in `compose()`.
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
  }

  /**
   * Reduce the composed N-axis vector to the engine's input arity.
   *
   * For the fixed 2-input WASM, fold by parity (even→X, odd→Y) via mean. If a
   * future multi-module engine reports inputSize >= n, this passes axes through
   * 1:1 (truncated/padded) — the seam where the real reshape lands.
   */
  private compose(n: number, inputSize: number): number[] {
    if (inputSize >= n) {
      // True passthrough path (future multi-module head). Pad with 0.5.
      const out = new Array<number>(inputSize);
      for (let i = 0; i < inputSize; i++) out[i] = i < n ? this.vector[i] : 0.5;
      return out;
    }
    if (inputSize === 2) {
      let sx = 0;
      let sy = 0;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < n; i++) {
        if ((i & 1) === 0) {
          sx += this.vector[i];
          cx++;
        } else {
          sy += this.vector[i];
          cy++;
        }
      }
      return [cx ? sx / cx : 0.5, cy ? sy / cy : 0.5];
    }
    // Generic fallback for any other fixed arity: chunked mean.
    const out = new Array<number>(inputSize).fill(0.5);
    const per = Math.ceil(n / inputSize);
    for (let k = 0; k < inputSize; k++) {
      let s = 0;
      let c = 0;
      for (let i = k * per; i < Math.min((k + 1) * per, n); i++) {
        s += this.vector[i];
        c++;
      }
      if (c) out[k] = s / c;
    }
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
  }
}
