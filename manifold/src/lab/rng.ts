/**
 * Seeded PRNG for the lab (mulberry32). Every random choice a simulated
 * session makes — goals, perception noise, wander paths — comes from one of
 * these, so a (config, seed) pair replays bit-identically.
 */
export class Rng {
  private a: number;
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.a = this.seed || 0x9e3779b9;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Standard normal (Box–Muller). */
  normal(): number {
    const u = Math.max(1e-12, this.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }

  /** An independent stream for one purpose, derived from the SEED (not the
   *  current state), so adding draws to one stream never shifts another. */
  fork(salt: number): Rng {
    let h = Math.imul(this.seed ^ Math.imul(salt, 0x85ebca6b), 0xc2b2ae35);
    h ^= h >>> 16;
    return new Rng(h >>> 0);
  }
}
