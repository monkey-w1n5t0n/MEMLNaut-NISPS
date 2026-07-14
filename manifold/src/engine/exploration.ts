/**
 * exploration.ts — ExplorationController: wires the two exploration gestures onto
 * manifold's EngineApi, driving the SHARED C++/WASM core.
 *
 *   • Jolt   — hold to continuously morph the network's weights live, release to
 *              freeze (nisps/ml/jolt.hpp; firmware TogB1).
 *   • Explore — an Ornstein-Uhlenbeck random walk on the output that makes the
 *              sound slowly roam so likes/dislikes can steer it (nisps/ml/
 *              ou_noise.hpp; firmware RVX1 = exploration amount).
 *
 * This is a plain framework-neutral class (no Solid stores, no React) that the
 * Console owns one of, once the engine resolves. The Learning drawer's Jolt
 * button + Explore slider call these methods.
 *
 * ─── one-core-engine P3 (SWAP DONE) ────────────────────────────────────────────
 * The maths now lives in the C++/WASM core; this controller is a thin driver that
 * owns only the control-rate timers (the spine is push-driven — manifold has no
 * always-on control loop to hook). Each gesture owns a scoped interval that
 * exists ONLY while it is engaged and is torn down on release / at intensity 0:
 *
 *     joltPress()            → engine.explore.joltPress   (nisps_ml_jolt_press)
 *     held ~200 Hz driver    → engine.explore.joltStep + engine.process
 *     joltRelease()          → engine.explore.joltRelease (nisps_ml_jolt_release)
 *     setExploreIntensity(l) → engine.explore.setExploreIntensity (…_explore_intensity)
 *     spine setOutputMorph   → engine.explore.exploreApply (…_explore_apply)
 *
 * The interim TS ports (`jolt.ts` / `ou-explore.ts`) were deleted with this swap;
 * the UI keeps calling the same joltPress/joltRelease/joltActive/
 * setExploreIntensity/exploreIntensity surface — no drawer changes.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import type { EngineApi } from './engine-api';

// Control-rate cadences. Manifold has no always-on control-rate loop to hook (the
// spine is push-driven; the input-layer rAF only runs while a poll-based source is
// active), so each gesture owns a scoped interval that exists ONLY while it is
// engaged. Not a global timer.
/** ~200Hz — matches the upstream firmware control rate the Jolt constants assume. */
const JOLT_TICK_MS = 5;
/** ~33Hz — keeps the OU walk roaming when the input is static. */
const EXPLORE_TICK_MS = 30;

export class ExplorationController {
  private readonly engine: EngineApi;

  private joltTimer: ReturnType<typeof setInterval> | null = null;
  private exploreTimer: ReturnType<typeof setInterval> | null = null;

  constructor(engine: EngineApi) {
    this.engine = engine;
    // Register the OU walk as the spine's post-output morph. It is inert while
    // intensity is 0 (the core apply() early-returns), so the spine stays
    // parity-safe until Explore is turned up. Applied on EVERY spine tick (user
    // input or the EXPLORE_TICK_MS driver): copy the routed vector into the WASM
    // heap, advance + add the OU offset in the core, copy back.
    engine.spine.setOutputMorph((routed) => this.engine.explore.exploreApply(routed));
  }

  // ---- Jolt (held-button continuous weight morph) --------------------------

  joltActive(): boolean {
    return this.engine.explore.joltActive();
  }

  /** Press-and-hold on: begin morphing a scatter of weights toward random targets. */
  joltPress(): void {
    if (!this.engine.getState().ready) return;
    this.engine.explore.joltPress();
    if (this.joltTimer === null) {
      this.joltTimer = setInterval(() => this.tickJolt_(), JOLT_TICK_MS);
    }
  }

  /** Release: freeze the weights where they landed (permanent) and stop ticking. */
  joltRelease(): void {
    this.engine.explore.joltRelease();
    if (this.joltTimer !== null) {
      clearInterval(this.joltTimer);
      this.joltTimer = null;
    }
  }

  private tickJolt_(): void {
    if (!this.engine.explore.joltActive()) return;
    // The core does the get→glide→set of weights in one step; re-run inference so
    // audio + visuals reflect the morphed weights without the user having to move
    // the controller.
    this.engine.explore.joltStep();
    this.engine.process();
  }

  // ---- Explore (OU exploration noise on the output) ------------------------

  exploreIntensity(): number {
    return this.engine.explore.exploreIntensity();
  }

  /**
   * Set the exploration amount in [0,1]. >0 starts the roaming driver so the
   * sound keeps wandering even when the input is static; 0 stops it and flushes a
   * clean output so the passthrough is parity-safe again.
   */
  setExploreIntensity(level: number): void {
    this.engine.explore.setExploreIntensity(level);
    const enabled = this.engine.explore.exploreIntensity() > 0;
    if (enabled && this.exploreTimer === null) {
      this.exploreTimer = setInterval(() => {
        if (!this.engine.getState().ready) return;
        // Re-tick the last input through the spine; the registered output morph
        // advances the OU state (in the core) and reships the routed vector.
        this.engine.process();
      }, EXPLORE_TICK_MS);
    } else if (!enabled && this.exploreTimer !== null) {
      clearInterval(this.exploreTimer);
      this.exploreTimer = null;
      // Flush the now-clean output (intensity 0 → morph is inert) to audio + visuals.
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
    this.engine.explore.setExploreIntensity(0);
    this.engine.spine.setOutputMorph(null);
  }
}
