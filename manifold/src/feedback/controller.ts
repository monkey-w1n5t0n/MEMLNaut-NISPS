/**
 * FeedbackController — framework-neutral learning-engine behaviour for the two
 * feedback modes plus solo/arm, prototyped in pure TS on the EXISTING engine
 * primitives (NO C++/WASM change).
 *
 * Authoritative design: docs/redesign/rl-feedback-design.md (Mode 2 default;
 * Mode 1 selectable; SOLO default MaskGradients). Engine primitives audited in
 * docs/redesign/findings-feedback-behaviour.md.
 *
 * This class holds NO React. ConsoleApp owns one instance and exposes its
 * actions + state into the console context; VerdictCluster + Manifold drive it.
 *
 * It talks ONLY to the small primitive surface of EngineApi:
 *   getWeights / setWeights      — snapshot + restore (byte round-trip)
 *   randomise()                  — draw_weights, re-roll the whole net
 *   setInput(x,y) / getOutputs() — synchronous forward inference (the spine)
 *   process()                    — re-run last input after a weight change
 *   addExample([x,y], outVec)    — append a training example
 *   train()                      — SGD over the dataset
 *   feedback.{setFocus,thumbsDown,thumbsUp}  — engine's RL primitives (Mode 1)
 *
 * Everything the design plans to push into the C++ core (geometric push-away,
 * the scratch-undo ring, the column-freeze gradient mask, the warm-start
 * interpolation loop) is implemented here in TS and CLEARLY COMMENTED as the
 * approximation it is, with a pointer to where the real core primitive lands.
 */

import { SeededRng } from './rng';

/** The two product feedback modes (rl-feedback-design §0). */
export type ProtoFeedbackMode = 'explore-and-place' | 'geometric-dislike';

/** Solo / arm gradient-mask variant (rl-feedback-design §3). */
export type ProtoSoloMode = 'mask-gradients' | 'zero-loss' | 'dont-care';

/**
 * A placed positive anchor: a chosen input location → the scratchpad output
 * vector heard there. The real model is warm-started to interpolate all of
 * these (rl-feedback-design §2.2 step 4).
 */
export interface Anchor {
  /** Chosen input location in [0,1]². */
  input: readonly [number, number];
  /** The 126-dim output vector heard at that location (copied, owned). */
  output: Float32Array;
  /**
   * Per-output arm mask captured at placement time (don't-care approximation —
   * §3.3). `null` ⇒ assert every output. Non-null ⇒ only assert masked dims.
   * In TS we can only approximate column-freeze at the EXAMPLE level (the true
   * gradient column-freeze is the C++ step).
   */
  mask: Uint8Array | null;
}

/** The minimal engine surface the controller needs (decoupled from EngineApi). */
export interface ControllerEngine {
  getWeights(): Float32Array;
  setWeights(w: Float32Array): void;
  randomise(spread?: number): void;
  setInput(x: number, y: number): void;
  getOutputs(): Float32Array;
  process(): void;
  addExample(features: ReadonlyArray<number>, labels: ReadonlyArray<number>): boolean;
  train(): number;
  readonly feedback: {
    thumbsUp(): number;
    thumbsDown(speed?: number, spread?: number, pinMask?: Uint8Array): number;
    setFocus(mask: Uint8Array | null): void;
  };
}

/** Snapshot of controller-observable state, mirrored into React on demand. */
export interface FeedbackControllerState {
  mode: ProtoFeedbackMode;
  soloMode: ProtoSoloMode;
  /** True while a Mode-2 scratchpad session is active. */
  exploring: boolean;
  /** True while a "place" gesture is pending a manifold location pick. */
  picking: boolean;
  /** Anchors placed in the CURRENT (not-yet-finalised) explore session. */
  anchorCount: number;
  /** Scratchpad undo-stack depth (nudges/rerolls that can be undone). */
  undoDepth: number;
  /** Count of currently-armed (soloed) outputs; 0 ⇒ none armed ⇒ train all. */
  armedCount: number;
}

export interface FeedbackControllerOptions {
  /** Seed for the deterministic nudge RNG (NOT Math.random — task constraint). */
  seed?: number;
  /** Master spread for randomise / nudge (mirrors the engine spread knob). */
  spread?: number;
  /** Nudge perturbation standard deviation (small bounded weight jitter). */
  nudgeStddev?: number;
  /**
   * Undo-stack depth. WASM D=4, firmware D=2 per rl-feedback-design §2.2; the
   * prototype defaults to the WASM depth.
   */
  undoDepth?: number;
}

export class FeedbackController {
  private engine: ControllerEngine;
  private rng: SeededRng;
  private spread: number;
  private nudgeStddev: number;
  private maxUndo: number;

  private mode: ProtoFeedbackMode = 'explore-and-place';
  private soloMode: ProtoSoloMode = 'mask-gradients';

  // ---- Mode-2 scratchpad session state -------------------------------
  /** The set-aside REAL trained net, restored on finalise/cancel. */
  private snapshot: Float32Array | null = null;
  private exploringFlag = false;
  /** Undo stack of scratchpad weight snapshots (reroll + nudge are undoable). */
  private undoStack: Float32Array[] = [];
  /** Anchors placed this session (positives only — NEVER a dislike). */
  private anchors: Anchor[] = [];
  /** True between place() and the manifold location pick. */
  private pickingFlag = false;
  /**
   * The scratchpad output vector frozen at place() time, so the heard sound is
   * held while the user aims at a location (rl-feedback-design §2.2 step 3,
   * "place_begin freezes the current scratchpad output"). Copied/owned.
   */
  private placedOutput: Float32Array | null = null;

  // ---- Solo / arm ----------------------------------------------------
  /** Current arm mask (1=armed/soloed). null ⇒ none armed ⇒ train all. */
  private armMask: Uint8Array | null = null;

  // ---- Mode-1 dislike memory (TS approximation) ----------------------
  /**
   * Disliked (input → output) pairs. The TRUE firmware geometric push (upstream
   * 0a541cc, replay-backed) computes a k-NN positive centroid and pushes the
   * disliked action away from it, then trains toward that target. We cannot do
   * that on the existing primitives without the C++ replay store + train_targets
   * hook, so the TS prototype:
   *   (a) calls the engine's existing feedback.thumbsDown() (AVOID/move_weights)
   *       as the audible baseline, AND
   *   (b) records the disliked pair here so subsequent training can bias AWAY
   *       from it (a coarse example-level approximation — see applyDislikeBias).
   * Documented C++ gap: the directed geometric push-away lands in the core as
   * `geo_push.hpp` + `replay.hpp` + `mlp.train_targets` (rl-feedback-design §4).
   */
  private dislikes: { input: readonly [number, number]; output: Float32Array }[] = [];

  constructor(engine: ControllerEngine, opts: FeedbackControllerOptions = {}) {
    this.engine = engine;
    this.rng = new SeededRng(opts.seed ?? 0xfeedbacc);
    this.spread = opts.spread ?? 0.6;
    this.nudgeStddev = opts.nudgeStddev ?? 0.05;
    this.maxUndo = Math.max(1, opts.undoDepth ?? 4);
  }

  // ===================================================================
  // Config
  // ===================================================================

  setMode(mode: ProtoFeedbackMode): void {
    if (mode === this.mode) return;
    // Switching mode aborts any active scratchpad session (mirrors the C++
    // `set_mode` which aborts active exploration first — findings §2).
    if (this.exploringFlag) this.cancel();
    this.mode = mode;
  }

  getMode(): ProtoFeedbackMode {
    return this.mode;
  }

  setSoloMode(mode: ProtoSoloMode): void {
    this.soloMode = mode;
  }

  setSpread(spread: number): void {
    this.spread = spread;
  }

  /**
   * Set the arm/solo mask. The dock builds this from the per-output `armed`
   * flags (dock/output-state.ts buildArmMask). We RESPECT it at the example
   * level in both modes (§3.4 honest-limit copy). We also forward it to the
   * engine's `setFocus` so Mode-1's move_weights freezes unarmed final-layer
   * columns — the only directional gating the existing primitive offers.
   */
  setArmMask(mask: Uint8Array | null): void {
    this.armMask = mask && mask.length ? mask : null;
    this.engine.feedback.setFocus(this.armMask);
  }

  // ===================================================================
  // Mode 2 — "Explore & place" (DEFAULT, positive-only, NEVER a dislike)
  // ===================================================================

  /**
   * ENTER explore (rl-feedback-design §2.2 step 1): snapshot the REAL weights,
   * set them aside, then randomise() into a scratchpad net. Mark exploring.
   * Idempotent re-entry while already exploring = a re-roll (step 2).
   */
  enterExplore(): void {
    if (this.exploringFlag) {
      // Re-press while exploring re-rolls ("meh, randomise…" — §2.2 step 2).
      this.reroll();
      return;
    }
    // Snapshot the real trained net (byte round-trip via get/set weights). This
    // is the SET-ASIDE net restored on finalise/cancel — it is NOT part of the
    // scratchpad undo ring (undo stays inside the scratchpad; you leave the
    // session via cancel/finalise, never by undoing back into the real net).
    this.snapshot = this.engine.getWeights();
    this.undoStack = [];
    this.anchors = [];
    this.placedOutput = null;
    this.pickingFlag = false;
    this.exploringFlag = true;
    // Randomise into the first scratchpad candidate, then record it as the undo
    // baseline (the history holds the LIVE candidate AFTER each op).
    this.engine.randomise(this.spread);
    this.recordCandidate();
  }

  /**
   * SCRATCHPAD OP: re-roll the whole net (§2.2 step 2). Undoable. The scratchpad
   * is NEVER trained — this only generates a fresh candidate sound to audition.
   */
  reroll(): void {
    if (!this.exploringFlag) return;
    this.engine.randomise(this.spread);
    this.recordCandidate();
  }

  /**
   * SCRATCHPAD OP: nudge — a small bounded gaussian weight perturbation (§2.2
   * step 2). Undoable. Deterministic via the seeded RNG (NO Math.random).
   *
   * --- C++ GAP -----------------------------------------------------------
   * The firmware does this with `move_weights(speed, spread)` on its own
   * `nisps::Rng`. Here we read the weights, add a small seeded gaussian, and
   * write them back — the TS-achievable equivalent. Becomes
   * `nisps_ml_feedback_nudge` driving the engine's Rng (rl-feedback-design §4).
   * ----------------------------------------------------------------------
   */
  nudge(): void {
    if (!this.exploringFlag) return;
    const w = this.engine.getWeights();
    // Bounded gaussian perturbation. No per-call allocation beyond the weights
    // buffer the engine already returns (we mutate it in place then write back).
    for (let i = 0; i < w.length; i++) {
      w[i] += this.rng.nextGaussian(this.nudgeStddev);
    }
    this.engine.setWeights(w);
    this.engine.process();
    this.recordCandidate();
  }

  /**
   * UNDO the last scratchpad op (reroll or nudge). Both are undoable (§2.2). The
   * undo ring holds the live scratchpad candidate after each op; undo discards
   * the current candidate and restores the previous one. The baseline (first
   * candidate after enter) is kept so undo never leaves the scratchpad.
   */
  undo(): void {
    if (!this.exploringFlag) return;
    if (this.undoStack.length <= 1) return; // already at the baseline candidate
    this.undoStack.pop(); // discard current candidate
    const prev = this.undoStack[this.undoStack.length - 1];
    this.engine.setWeights(prev);
    this.engine.process();
  }

  /** Record the CURRENT live scratchpad weights as a new undo-ring entry. */
  private recordCandidate(): void {
    this.undoStack.push(this.engine.getWeights());
    // Bound the ring to maxUndo+1 (the +1 is the kept baseline at index 0).
    if (this.undoStack.length > this.maxUndo + 1) {
      this.undoStack.splice(1, 1);
    }
  }

  /**
   * PLACE begin (§2.2 step 3): the user likes the current candidate. Freeze the
   * scratchpad output so the heard sound is held while they aim, and enter the
   * PICK-LOCATION state — the next manifold pointer-down chooses the location.
   */
  place(): void {
    if (!this.exploringFlag) return;
    this.placedOutput = new Float32Array(this.engine.getOutputs());
    this.pickingFlag = true;
  }

  /** True while a place() is awaiting a manifold location pick. */
  isPicking(): boolean {
    return this.pickingFlag;
  }

  /** The frozen scratchpad output held during aiming (read-only; may be null). */
  getPlacedOutput(): Float32Array | null {
    return this.placedOutput;
  }

  /**
   * PLACE commit (§2.2 step 3): the user picked a location on the manifold. We
   * move the scratchpad input there, run inference, capture the output the
   * scratchpad produces AT THAT LOCATION, and store it as a positive anchor.
   *
   * Per the spec the captured output is "the output the scratchpad produces at
   * the chosen location" (getOutputs() after setting the input there) — NOT the
   * frozen audition vector. The frozen vector only kept the *audio* steady while
   * aiming. Returns the new anchor count.
   */
  placeCommit(x: number, y: number): number {
    if (!this.exploringFlag || !this.pickingFlag) return this.anchors.length;
    this.engine.setInput(x, y);
    this.engine.process();
    const out = new Float32Array(this.engine.getOutputs());
    // Solo/arm respected at the EXAMPLE level: capture the arm mask so warm-start
    // only asserts armed outputs ("don't-care on others" — §3.3 approximation).
    const mask = this.armMask ? new Uint8Array(this.armMask) : null;
    this.anchors.push({ input: [x, y], output: out, mask });
    this.pickingFlag = false;
    this.placedOutput = null;
    return this.anchors.length;
  }

  /** Cancel a pending place() without storing an anchor (back to auditioning). */
  cancelPlace(): void {
    this.pickingFlag = false;
    this.placedOutput = null;
  }

  /**
   * RESOLVE / warm-start (§2.2 step 4): restore the set-aside REAL net, then
   * warm-start it to interpolate ALL placed anchors by re-adding each as an
   * example and training. ADDITIVE — anchors are added to the existing dataset
   * (the user's prior thumbs-up likes are NOT clobbered). Exits exploring.
   *
   * --- C++ GAP -----------------------------------------------------------
   * The firmware warm-start trains anchors only on soloed dims via a gradient
   * column-freeze (`train_masked`). Here we approximate that at the example
   * level: when an anchor carries an arm mask we still add the FULL output
   * vector (the engine's addExample takes a full label row), but we forward the
   * mask to the engine's setFocus so move_weights/training freezes unarmed
   * final-layer columns. True per-example gradient masking (`train_masked`
   * consuming `Anchor.mask`) is the C++ step (rl-feedback-design §3.3).
   * ----------------------------------------------------------------------
   */
  finalise(): number {
    if (!this.exploringFlag) return 0;
    if (this.snapshot) {
      this.engine.setWeights(this.snapshot); // restore the real net (warm start)
    }
    const placed = this.anchors.length;
    // Re-assert the arm focus so training honours any soloed columns.
    this.engine.feedback.setFocus(this.armMask);
    for (const a of this.anchors) {
      this.engine.addExample([a.input[0], a.input[1]], Array.from(a.output));
    }
    if (placed > 0) {
      this.engine.train();
    }
    this.engine.process();
    this.endSession();
    return placed;
  }

  /**
   * CANCEL / undo whole session (§2.2 step 5): discard scratchpad + anchors,
   * restore the set-aside real net. No anchor stored.
   */
  cancel(): void {
    if (!this.exploringFlag) return;
    if (this.snapshot) {
      this.engine.setWeights(this.snapshot);
      this.engine.process();
    }
    this.endSession();
  }

  private endSession(): void {
    this.exploringFlag = false;
    this.pickingFlag = false;
    this.placedOutput = null;
    this.snapshot = null;
    this.undoStack = [];
    this.anchors = [];
  }

  // ===================================================================
  // Mode 1 — "Geometric dislike" (selectable)
  // ===================================================================

  /**
   * DISLIKE (thumbs-down in Mode 1). Push the current mapping away from the
   * disliked sound.
   *
   * PROTOTYPE: we use the engine's existing feedback.thumbsDown() (AVOID /
   * move_weights — undirected Gaussian diffusion, the baseline) as the audible
   * effect, AND record the disliked (input → output) so a subsequent like+train
   * can bias away from it (applyDislikeBias).
   *
   * --- C++ GAP (the real firmware behaviour) -----------------------------
   * The true geometric push-away (upstream 0a541cc, replay-backed,
   * InterfaceRL.cpp:602-738) is:
   *   1. store the negative (input, action) in a ReplayStore (dedup within 0.05)
   *   2. compute the k-NN(k=4) centroid of POSITIVE memories near the input
   *   3. target[j] = clamp(neg[j] + dir/||dir|| * pushStep/(1+||dir||), 0, 1)
   *      where dir[j] = neg[j] - meanPositive[j]  (away from the liked centroid)
   *   4. train the net toward that computed `target` at lr*negLRRatio
   *   5. cold-start fallback when there are no positives yet.
   * This needs `replay.hpp`, `geo_push.hpp`, and `mlp.train_targets` (train
   * toward arbitrary COMPUTED targets, which the existing train()/addExample()
   * cannot do — they only train toward STORED labels). It lands in the C++ core
   * in rl-feedback-design Phase 1 (§5). Until then this TS prototype keeps the
   * baseline move_weights effect plus example-level bias.
   * ----------------------------------------------------------------------
   *
   * @param input   the control input the disliked sound was heard at
   * @param output  the heard 126-dim output vector (a_neg)
   * @param speed   move_weights speed (noise cap)
   * @param spread  move_weights spread
   */
  dislike(
    input: readonly [number, number],
    output: Float32Array,
    speed: number,
    spread: number,
  ): void {
    // Record the disliked pair (the firmware ReplayStore negative). Dedup within
    // a coarse radius so repeated dislikes near each other don't pile up — a
    // cheap stand-in for the firmware `deepen_or_store_negative(radius=0.05)`.
    const RADIUS = 0.05;
    const near = this.dislikes.find(
      (d) =>
        Math.hypot(d.input[0] - input[0], d.input[1] - input[1]) <= RADIUS,
    );
    if (near) {
      near.output = new Float32Array(output);
    } else {
      this.dislikes.push({ input: [input[0], input[1]], output: new Float32Array(output) });
    }
    // Audible baseline: the engine's existing AVOID move_weights, focus-gated by
    // the arm mask (the only directional gating the primitive offers today).
    this.engine.feedback.thumbsDown(speed, spread, this.armMask ?? undefined);
    this.engine.process();
  }

  /**
   * LIKE + train (thumbs-up in Mode 1). Store the current (input → output) as a
   * positive example and train. In firmware this also feeds the positive
   * centroid (replay.store(+1,…)); here it is a normal addExample + train, with
   * an optional bias away from recorded dislikes.
   */
  like(input: readonly [number, number], output: Float32Array): void {
    this.engine.feedback.setFocus(this.armMask);
    this.engine.addExample([input[0], input[1]], Array.from(output));
    this.applyDislikeBias();
    this.engine.train();
    this.engine.process();
  }

  /**
   * Coarse example-level bias AWAY from disliked sounds (the TS approximation of
   * the geometric push). For each recorded dislike we add a "repelled" example:
   * an example at the disliked input whose output is nudged away from the
   * disliked vector toward the dataset mean. This is a WEAK stand-in — it biases
   * the trainer rather than computing a true centroid-relative push.
   *
   * --- C++ GAP -----------------------------------------------------------
   * Replaced by `geo_push.compute_push_targets` + `train_targets` in the C++
   * core (rl-feedback-design §4). Intentionally conservative here so it never
   * destabilises the net before any positives exist (the `posMemCount==0`
   * cold-start fallback the design ports faithfully).
   * ----------------------------------------------------------------------
   */
  private applyDislikeBias(): void {
    // No-op when there are no dislikes; conservative cold-start (do nothing
    // destabilising) when there is nothing to push away from yet.
    if (this.dislikes.length === 0) return;
    for (const d of this.dislikes) {
      const out = new Float32Array(d.output.length);
      // Push each dim of the disliked output toward its complement (0.5 pivot) —
      // a direction-free repulsion stand-in. Respect the arm mask: only move
      // armed dims; leave others at the disliked value (don't-care).
      for (let j = 0; j < out.length; j++) {
        const armed = !this.armMask || this.armMask[j] === 1;
        if (armed) {
          const v = d.output[j];
          out[j] = Math.max(0, Math.min(1, v + (0.5 - v) * 0.6));
        } else {
          out[j] = d.output[j];
        }
      }
      this.engine.addExample([d.input[0], d.input[1]], Array.from(out));
    }
  }

  // ===================================================================
  // State snapshot
  // ===================================================================

  getState(): FeedbackControllerState {
    let armed = 0;
    if (this.armMask) for (const m of this.armMask) if (m) armed++;
    return {
      mode: this.mode,
      soloMode: this.soloMode,
      exploring: this.exploringFlag,
      picking: this.pickingFlag,
      anchorCount: this.anchors.length,
      // -1 for the entry-state baseline kept at index 0.
      undoDepth: Math.max(0, this.undoStack.length - 1),
      armedCount: armed,
    };
  }

  /** Read-only view of placed anchors (current session). */
  getAnchors(): readonly Anchor[] {
    return this.anchors;
  }
}
