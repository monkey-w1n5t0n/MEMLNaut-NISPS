/**
 * Small seeded RNG (mulberry32) shared by the generators. Deterministic and
 * allocation-free per draw; there is no Math.random anywhere in the sequencer.
 */

export class Rng {
  private s = 1;

  constructor(seed: number) {
    this.reseed(seed);
  }

  reseed(seed: number): void {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
