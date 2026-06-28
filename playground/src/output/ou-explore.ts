/**
 * ou-explore.ts — Ornstein-Uhlenbeck exploration noise on the output.
 *
 * Faithful TS port of `nisps/ml/ou_noise.hpp`. Adds a per-output-channel
 * Ornstein-Uhlenbeck random walk to the network's action (output) vector
 * before it reaches audio. Unlike i.i.d. per-frame noise, an OU process is
 * temporally correlated: each output drifts in long, smooth sweeps and is
 * gently pulled back toward the mapping output (mean reversion). Because
 * learning stays active while the noise roams, "likes" registered during
 * the wander steer the network toward sounds the player wants.
 *
 * Discrete Euler-Maruyama update, per output channel x (mu = 0):
 *     x += theta * (-x) * dt + noiseScale * N(0,1)
 *     out = clamp(out + x, 0, 1)
 * where, to make the stationary std equal a requested `std`:
 *     noiseScale = std * sqrt(2 * theta * dt)
 * and the exploration knob [0,1] maps std = level * kMaxAmplitude (0.65).
 *
 * RNG note: the C++ owns a per-instance deterministic xoshiro256+ for
 * firmware↔browser parity. This is a browser-only exploration aid that
 * never round-trips through WASM, so `Math.random()` is fine. The gaussian
 * is reproduced as the same sum-of-three-uniforms shape the C++ `Rng` uses
 * (`next_float_gaussian`).
 *
 * DEFAULT STATE IS INERT: intensity defaults to 0, `enabled()` is false, and
 * `apply()` neither advances the RNG nor touches the output — so the output
 * passes through bit-identically when intensity is 0 (parity-safe).
 */

/** Upstream kMaxAmplitude: the exploration knob's full-scale stationary std. */
export const OU_MAX_AMPLITUDE = 0.65;

/** Sum-of-three-uniforms gaussian (matches nisps::Rng::next_float_gaussian). */
function gaussian(stddev = 1): number {
  // Three uniforms in [-1, 1): variance 1/3 each ⇒ sum has variance 1.
  const a = Math.random() * 2 - 1;
  const b = Math.random() * 2 - 1;
  const c = Math.random() * 2 - 1;
  return (a + b + c) * stddev;
}

export class OUExplore {
  private theta_ = 0.02;
  private dt_ = 0.001;
  private stationaryStd_ = 0;
  private noiseScale_ = 0;
  private state_: Float32Array = new Float32Array(0);

  constructor() {
    this.recomputeScale_();
  }

  /**
   * Exploration amount in [0,1]; 0 disables (inert). Maps to the OU
   * stationary std = level * kMaxAmplitude.
   */
  setIntensity(level: number): void {
    let l = level;
    if (l < 0) l = 0;
    else if (l > 1) l = 1;
    this.stationaryStd_ = l * OU_MAX_AMPLITUDE;
    this.recomputeScale_();
  }

  intensity(): number {
    return this.stationaryStd_ / OU_MAX_AMPLITUDE;
  }

  enabled(): boolean {
    return this.stationaryStd_ > 0;
  }

  setTheta(theta: number): void {
    this.theta_ = theta;
    this.recomputeScale_();
  }

  setDt(dt: number): void {
    this.dt_ = dt;
    this.recomputeScale_();
  }

  /**
   * Advance the per-channel OU state and add it (clamped) to `out`, mutating
   * `out` in place. No-op (no state advance, no output change) when disabled.
   * `out` is the post-inference parameter vector.
   */
  apply(out: Float32Array): void {
    if (!this.enabled()) return;
    const n = out.length;
    if (this.state_.length < n) {
      // Grow the per-channel state, preserving existing drift.
      const next = new Float32Array(n);
      next.set(this.state_);
      this.state_ = next;
    }
    const theta = this.theta_;
    const dt = this.dt_;
    const scale = this.noiseScale_;
    for (let i = 0; i < n; ++i) {
      // mu = 0: the walk is an offset that mean-reverts to zero, so the
      // network's own mapping output stays the anchor.
      let s = this.state_[i]!;
      s += theta * -s * dt + scale * gaussian(1);
      this.state_[i] = s;
      let v = out[i]! + s;
      if (v < 0) v = 0;
      else if (v > 1) v = 1;
      out[i] = v;
    }
  }

  reset(): void {
    this.state_.fill(0);
  }

  private recomputeScale_(): void {
    let k = 2 * this.theta_ * this.dt_;
    if (k < 0) k = 0;
    this.noiseScale_ = this.stationaryStd_ * Math.sqrt(k);
  }
}
