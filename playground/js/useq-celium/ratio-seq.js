// Pure JS port of ratioSeq() and friends, from modes/AudioApps/RatioSeq.hpp.
//
// ratioSeq divides a [0,1) phasor into N variable-width beats weighted by
// `ratios`, then reports whether we're within the `pulseWidth` fraction of
// the current beat. No state — all callers own their own phasor.
//
// See also RatioSeqEngine.hpp for the C++ source of truth on parameter decode;
// that decode lives in voice-engine.js here.

/**
 * Sum a ratio array. Cheap helper so callers can precompute once per param
 * update rather than every tick.
 *
 * @param {number[]|Float32Array} ratios
 * @returns {number}
 */
export function sumRatios(ratios) {
  let s = 0;
  for (let i = 0; i < ratios.length; i++) s += ratios[i];
  return s;
}

/**
 * Given a bar phasor, return whether the current "beat" within the
 * ratio-weighted subdivision is currently gate-on (i.e. phase within the beat
 * is below `pulseWidth`).
 *
 * Faithful port of the C++ template in RatioSeq.hpp:
 *   template<size_t seqLength>
 *   bool ratioSeq(float phasor, float phaseOffset, float ratioSum,
 *                 const std::array<float, seqLength>& ratios, float pulseWidth);
 *
 * @param {number} phasor      bar phase in [0, 1)
 * @param {number} phaseOffset beat-offset in [0, 1), added to phasor (mod 1)
 * @param {number} ratioSum    precomputed sum of `ratios` (use sumRatios())
 * @param {number[]|Float32Array} ratios  >= 1 positive numbers
 * @param {number} pulseWidth  gate width in [0, 1); width of on-portion per beat
 * @returns {boolean}          true if currently gate-on
 */
export function ratioSeq(phasor, phaseOffset, ratioSum, ratios, pulseWidth) {
  let offsetPhase = phaseOffset + phasor;
  if (offsetPhase >= 1) offsetPhase -= 1;
  const phaseAdj = ratioSum * offsetPhase;

  let accumulatedSum = 0;
  let lastAccumulatedSum = 0;
  for (let i = 0; i < ratios.length; i++) {
    accumulatedSum += ratios[i];
    if (phaseAdj <= accumulatedSum) {
      const span = accumulatedSum - lastAccumulatedSum;
      // Guard against zero-length span if a caller passes ratio=0 (shouldn't
      // happen given decode, but be safe: zero-width beat is never on).
      if (span <= 0) return false;
      const beatPhase = (phaseAdj - lastAccumulatedSum) / span;
      return beatPhase <= pulseWidth;
    }
    lastAccumulatedSum = accumulatedSum;
  }
  // Should be unreachable when phasor ∈ [0,1) and ratioSum = Σ ratios, but
  // defensive: fall through as off.
  return false;
}
