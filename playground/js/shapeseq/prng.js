/**
 * ShapeSeq PRNG — seedable pseudo-random number generator (mulberry32)
 *
 * Port-ready: explicit state as plain objects, no closures in hot path,
 * all state is serializable. Pure-functional next/nextInt/fork — no mutation.
 *
 * @module shapeseq/prng
 */

// --- Mulberry32 core ---

/**
 * Single step of the mulberry32 PRNG.
 * Pure function: takes a 32-bit state, returns { value, nextState }.
 *
 * @param {number} state - unsigned 32-bit integer
 * @returns {{ value: number, nextState: number }}
 *   value: float in [0, 1)
 *   nextState: next 32-bit state
 */
function mulberry32Step(state) {
  let t = (state + 0x6D2B79F5) | 0;
  const nextState = t >>> 0; // the incremented state IS the new state
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const raw = ((t ^ (t >>> 14)) >>> 0);
  return { value: raw / 0x100000000, nextState };
}

// --- Public API ---

/**
 * Create a PRNG instance from a seed.
 *
 * @param {number} seed - any 32-bit integer (will be coerced to unsigned)
 * @returns {{ state: number }} serializable PRNG state object
 */
export function createPRNG(seed) {
  return { state: (seed >>> 0) };
}

/**
 * Produce the next random float in [0, 1). Pure — does not mutate input.
 *
 * @param {{ state: number }} prng
 * @returns {{ value: number, nextState: { state: number } }}
 */
export function next(prng) {
  const { value, nextState } = mulberry32Step(prng.state);
  return { value, nextState: { state: nextState } };
}

/**
 * Produce a random integer in [min, max] (inclusive). Pure — does not mutate input.
 *
 * @param {{ state: number }} prng
 * @param {number} min - inclusive lower bound (integer)
 * @param {number} max - inclusive upper bound (integer)
 * @returns {{ value: number, nextState: { state: number } }}
 */
export function nextInt(prng, min, max) {
  const { value, nextState } = next(prng);
  const range = max - min + 1;
  const intVal = min + Math.floor(value * range);
  return { value: intVal, nextState };
}

/**
 * Derive an independent PRNG stream from the current state + an id.
 * Used to give each primitive in a chain its own deterministic stream.
 *
 * The child seed is produced by hashing the current state with the id
 * using a simple but effective mixing function (splitmix-style).
 *
 * @param {{ state: number }} prng
 * @param {number|string} id - primitive position index or string identifier
 * @returns {{ state: number }} a new, independent PRNG state
 */
export function fork(prng, id) {
  // Convert string ids to a numeric hash
  let idNum;
  if (typeof id === 'string') {
    idNum = 0;
    for (let i = 0; i < id.length; i++) {
      idNum = ((idNum << 5) - idNum + id.charCodeAt(i)) | 0;
    }
    idNum = idNum >>> 0;
  } else {
    idNum = id >>> 0;
  }

  // Mix state + id using splitmix-style finalizer
  let h = (prng.state ^ idNum) >>> 0;
  h = (h + 0x9E3779B9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;

  return { state: h };
}

/**
 * Get serializable state from a PRNG instance (for freeze/restore).
 *
 * @param {{ state: number }} prng
 * @returns {{ state: number }}
 */
export function getState(prng) {
  return { state: prng.state };
}

/**
 * Restore a PRNG instance from previously saved state.
 *
 * @param {{ state: number }} _prng - ignored (stateless restore)
 * @param {{ state: number }} savedState
 * @returns {{ state: number }}
 */
export function setState(_prng, savedState) {
  return { state: savedState.state >>> 0 };
}

/**
 * Generate a cryptographically random seed for initial seeding.
 * Uses crypto.getRandomValues when available, falls back to Date.now().
 *
 * @returns {number} unsigned 32-bit integer
 */
export function randomSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  }
  // Fallback: not cryptographic, but sufficient for musical randomness
  return (Date.now() * 2654435761) >>> 0;
}
