/**
 * exploration.ts — ExplorationController: wires the two playground exploration
 * gestures onto manifold's EngineApi.
 *
 *   • Jolt   — hold to continuously morph the network's weights live, release to
 *              freeze (nisps/ml/jolt.hpp; firmware TogB1).
 *   • Explore — an Ornstein-Uhlenbeck random walk on the output that makes the
 *              sound slowly roam so likes/dislikes can steer it (nisps/ml/
 *              ou_noise.hpp; firmware RVX1 = exploration amount).
 *
 * The gestures the playground drove from `mode-runtime.ts` are re-homed here as a
 * plain framework-neutral class (no Solid stores, no React) that the Console owns
 * one of, once the engine resolves. The Learning drawer's Jolt button + Explore
 * slider call these methods.
 *
 * ─── P3 SWAP POINT ────────────────────────────────────────────────────────────
 * The maths currently runs in TS (`jolt.ts` / `ou-explore.ts`, ported from the
 * retired playground). In §P3 of docs/specs/plans/one-core-engine-refactor.md it
 * moves into the C++/WASM core:
 *
 *     joltPress(count)       → nisps_ml_jolt_press
 *     joltRelease()          → nisps_ml_jolt_release
 *     setExploreIntensity(l) → nisps_ml_explore_intensity
 *
 * When that lands, ONLY THIS MODULE changes: `jolt.ts` + `ou-explore.ts` are
 * deleted, the per-tick stepping below (getWeights → step → setWeights → process,
 * and the OU output-morph) is removed because the core owns the control-rate
 * morph + OU advance, and the calls above target the bindings. The UI keeps
 * calling the same `joltPress/joltRelease/joltActive/setExploreIntensity/
 * exploreIntensity` surface — no drawer changes.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import type { EngineApi } from './engine-api';
import { Jolt } from './jolt';
import { OUExplore } from './ou-explore';

// Control-rate cadences, reproduced from the playground's mode-runtime.ts.
// Manifold has no always-on control-rate loop to hook (the spine is push-driven;
// the input-layer rAF only runs while a poll-based source is active), so — like
// the playground — each gesture owns a scoped interval that exists ONLY while it
// is engaged and is torn down on release / at intensity 0. Not a global timer.
/** ~200Hz — matches the upstream firmware control rate the Jolt constants assume. */
const JOLT_TICK_MS = 5;
/** ~33Hz — keeps the OU walk roaming when the input is static. */
const EXPLORE_TICK_MS = 30;

export class ExplorationController {
  private readonly engine: EngineApi;
  private readonly jolt = new Jolt();
  private readonly ou = new OUExplore();

  private joltTimer: ReturnType<typeof setInterval> | null = null;
  private exploreTimer: ReturnType<typeof setInterval> | null = null;

  constructor(engine: EngineApi) {
    this.engine = engine;
    // Register the OU walk as the spine's post-output morph. It is inert while
    // intensity is 0 (apply() early-returns), so the spine stays parity-safe
    // until Explore is turned up. Applied on EVERY spine tick (user input or the
    // EXPLORE_TICK_MS driver), exactly as the playground applied it in
    // recomputeOutputs. In P3 this becomes a core-side step, not a JS morph.
    engine.spine.setOutputMorph((routed) => this.ou.apply(routed));
  }

  // ---- Jolt (held-button continuous weight morph) --------------------------

  joltActive(): boolean {
    return this.jolt.active();
  }

  /** Press-and-hold on: begin morphing a scatter of weights toward random targets. */
  joltPress(): void {
    if (!this.engine.getState().ready) return;
    const weightCount = this.engine.getWeights().length;
    this.jolt.press(weightCount);
    if (this.joltTimer === null) {
      this.joltTimer = setInterval(() => this.tickJolt_(), JOLT_TICK_MS);
    }
  }

  /** Release: freeze the weights where they landed (permanent) and stop ticking. */
  joltRelease(): void {
    this.jolt.release();
    if (this.joltTimer !== null) {
      clearInterval(this.joltTimer);
      this.joltTimer = null;
    }
  }

  private tickJolt_(): void {
    if (!this.jolt.active()) return;
    const w = this.engine.getWeights();
    if (w.length === 0) return;
    this.jolt.step(w);
    this.engine.setWeights(w);
    // Re-run inference so audio + visuals reflect the morphed weights without
    // the user having to move the controller.
    this.engine.process();
  }

  // ---- Explore (OU exploration noise on the output) ------------------------

  exploreIntensity(): number {
    return this.ou.intensity();
  }

  /**
   * Set the exploration amount in [0,1]. >0 starts the roaming driver so the
   * sound keeps wandering even when the input is static; 0 stops it and resets
   * the walk so the output passes through cleanly again.
   */
  setExploreIntensity(level: number): void {
    this.ou.setIntensity(level);
    if (this.ou.enabled() && this.exploreTimer === null) {
      this.exploreTimer = setInterval(() => {
        if (!this.engine.getState().ready) return;
        // Re-tick the last input through the spine; the registered output morph
        // advances the OU state and reships the routed vector.
        this.engine.process();
      }, EXPLORE_TICK_MS);
    } else if (!this.ou.enabled() && this.exploreTimer !== null) {
      clearInterval(this.exploreTimer);
      this.exploreTimer = null;
      this.ou.reset();
      // Flush the now-clean output (no residual drift) to audio + visuals.
      this.engine.process();
    }
  }

  // ---- Lifecycle -----------------------------------------------------------

  dispose(): void {
    this.joltRelease();
    if (this.exploreTimer !== null) {
      clearInterval(this.exploreTimer);
      this.exploreTimer = null;
    }
    this.ou.setIntensity(0);
    this.ou.reset();
    this.engine.spine.setOutputMorph(null);
  }
}
