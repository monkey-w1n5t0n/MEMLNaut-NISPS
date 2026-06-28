/**
 * jolt.ts — "Jolt": held-button continuous weight morph.
 *
 * Faithful TS port of `nisps/ml/jolt.hpp` (which itself ports upstream
 * memllib InterfaceRL "jolts"). While a button/pedal is held, pick a
 * handful of random weights scattered across the whole network and
 * EMA-glide each toward a bounded random target; on arrival, re-roll the
 * target so the motion never stops. Releasing freezes the weights where
 * they landed (the change is permanent).
 *
 * This operates on the MLP's FLAT weight buffer (the same buffer reached
 * via `mlStore.getWeights()` / `setWeights()` / weight_count), so it is
 * architecture-agnostic.
 *
 * RNG note: the C++ owns a per-instance deterministic xoshiro256+ for
 * firmware↔browser parity. This is a browser-only exploration aid that
 * never round-trips through WASM, so we use `Math.random()` — the exact
 * sequence does not need to match firmware. Constants are reproduced
 * verbatim from JoltParams.
 *
 * DEFAULT STATE IS INERT: a freshly constructed Jolt is inactive and
 * `step()` is a no-op until `press()` is called.
 */

/** Upstream JoltParams defaults (kJolt* constants). */
export interface JoltParams {
  /** kJoltNumWeights — number of weights morphed at once. */
  numWeights: number;
  /** kJoltMorphRate — EMA glide per tick (~1s @200Hz). */
  morphRate: number;
  /** kJoltWeightMin — lower bound of a random target. */
  targetMin: number;
  /** kJoltWeightMax — upper bound of a random target. */
  targetMax: number;
  /** kJoltTargetEpsilon — re-roll target once within this distance. */
  targetEpsilon: number;
}

export const DEFAULT_JOLT_PARAMS: JoltParams = {
  numWeights: 40,
  morphRate: 0.017,
  targetMin: -1.2,
  targetMax: 0.9,
  targetEpsilon: 0.05,
};

export class Jolt {
  private params_: JoltParams = { ...DEFAULT_JOLT_PARAMS };
  private active_ = false;
  private n_ = 0;
  private idx_: Int32Array = new Int32Array(0);
  private target_: Float32Array = new Float32Array(0);

  constructor(params?: Partial<JoltParams>) {
    if (params) this.params_ = { ...this.params_, ...params };
  }

  setParams(p: Partial<JoltParams>): void {
    this.params_ = { ...this.params_, ...p };
  }

  get params(): Readonly<JoltParams> {
    return this.params_;
  }

  active(): boolean {
    return this.active_;
  }

  /**
   * Begin a jolt over a flat weight buffer of `weightCount` entries: pick
   * `numWeights` random global indices and a bounded random target each.
   */
  press(weightCount: number): void {
    this.active_ = true;
    this.n_ = this.params_.numWeights;
    if (weightCount <= 0) {
      this.n_ = 0;
      return;
    }
    if (this.idx_.length < this.n_) this.idx_ = new Int32Array(this.n_);
    if (this.target_.length < this.n_) this.target_ = new Float32Array(this.n_);
    for (let i = 0; i < this.n_; ++i) {
      this.idx_[i] = Math.floor(Math.random() * weightCount) % weightCount;
      this.target_[i] = this.rollTarget_();
    }
  }

  /**
   * Per control tick while held: EMA-glide each selected weight toward its
   * target, re-rolling targets that have been reached. No-op when inactive.
   * Mutates `weights` in place.
   */
  step(weights: Float32Array): void {
    if (!this.active_) return;
    const wc = weights.length;
    const rate = this.params_.morphRate;
    const eps = this.params_.targetEpsilon;
    for (let i = 0; i < this.n_; ++i) {
      const k = this.idx_[i]!;
      if (k < 0 || k >= wc) continue;
      let w = weights[k]!;
      w += rate * (this.target_[i]! - w);
      weights[k] = w;
      if (Math.abs(this.target_[i]! - w) < eps) {
        this.target_[i] = this.rollTarget_();
      }
    }
  }

  /** Release: freeze weights where they are (permanent). */
  release(): void {
    this.active_ = false;
  }

  private rollTarget_(): number {
    return (
      this.params_.targetMin +
      Math.random() * (this.params_.targetMax - this.params_.targetMin)
    );
  }
}
