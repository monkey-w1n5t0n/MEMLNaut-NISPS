/**
 * Deterministic seeded RNG for the feedback controller's hot path.
 *
 * The rl-feedback-design (§6) mandates: "every new operation is deterministic
 * f32 arithmetic on the per-instance `nisps::Rng` (no libc `rand()` anywhere)".
 * In the C++ core the controller owns a `nisps::Rng` seeded from
 * `kSeed ^ kFeedbackSalt`. This TS prototype mirrors that discipline so that the
 * `nudge` perturbation is reproducible run-to-run (no `Math.random` in the
 * core path — see the task CONSTRAINTS).
 *
 * Implementation: a small splitmix64-style integer generator reduced to f32.
 * This is NOT bit-identical to the C++ `nisps::Rng` — when the geometric push /
 * nudge becomes a C++ core primitive (rl-feedback-design §4), the seeded stream
 * must come from `nisps::Rng` so native==WASM parity holds. Here it only needs
 * to be deterministic *within* the prototype.
 *
 * --- C++ GAP -------------------------------------------------------------
 * The true firmware nudge perturbs weights with `move_weights(speed, spread)`
 * driven by the controller's `nisps::Rng`. This TS RNG is a stand-in so the
 * prototype is reproducible; it will be REPLACED by the engine's own Rng stream
 * once `nisps_ml_feedback_nudge` exists (rl-feedback-design §4 "TS").
 * ------------------------------------------------------------------------
 */

export class SeededRng {
  // 64-bit state held as two 32-bit halves (BigInt would be cleaner but we keep
  // to plain number maths to avoid any per-call BigInt allocation in the hot
  // nudge loop).
  private state: number;

  constructor(seed: number) {
    // Fold the seed into a non-zero 32-bit state.
    this.state = (seed ^ 0x9e3779b9) >>> 0;
    if (this.state === 0) this.state = 0x1234567;
  }

  /** Next uniform float in [0, 1). xorshift32 — deterministic, allocation-free. */
  nextFloat(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    // Map to [0,1) using the top 24 bits for a clean float mantissa.
    return (x >>> 8) / 0x01000000;
  }

  /** Next uniform float in [-1, 1). */
  nextFloatSigned(): number {
    return this.nextFloat() * 2 - 1;
  }

  /**
   * Approximate gaussian via the sum-of-three-uniforms method the nisps core
   * uses (`gen_randn` in MEMORY.md: sum of 3 uniforms). Mean 0, the given
   * standard deviation. Allocation-free.
   */
  nextGaussian(stddev: number): number {
    const u = this.nextFloatSigned() + this.nextFloatSigned() + this.nextFloatSigned();
    return u * stddev;
  }
}
