/**
 * ShapeSeq DeltaController — MLP delta application with boundary enforcement
 *
 * Applies MLP output deltas to frozen param values for live (unfrozen) params.
 * Frozen params pass through unchanged. Live params get:
 *   frozenValue + (mlpValue - 0.5) * 2 * deltaScale
 * with per-param boundary enforcement (clamp, wrap, scaled).
 *
 * @module shapeseq/delta
 */

import { applyBoundary } from './primitive.js';

export class DeltaController {
  /**
   * Compute effective params by applying MLP-derived deltas to frozen values.
   *
   * For frozen params: returns the frozen value unchanged.
   * For live params: frozenValue + delta, with boundary enforcement.
   *
   * The delta is derived from the MLP output: delta = (mlpValue - 0.5) * 2 * deltaScale
   * This maps MLP [0,1] output to a [-deltaScale, +deltaScale] range centered on the frozen value.
   *
   * @param {Float32Array} frozenParams - captured param values from FreezeManager
   * @param {Uint8Array} liveFlags - 1=live, 0=frozen from FreezeManager
   * @param {Float32Array} mlpParams - current MLP-mapped param values [0,1]
   * @param {Array<{schema: {boundary: string, scaledRange?: number}}>} paramSchemas - from chain.getParamSchemas()
   * @param {number} deltaScale - global delta sensitivity (default 0.3)
   * @returns {Float32Array} effective params ready for chain.evaluate()
   */
  static computeEffective(frozenParams, liveFlags, mlpParams, paramSchemas, deltaScale = 0.3) {
    const count = frozenParams.length;
    const result = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      if (!liveFlags[i]) {
        // Frozen: passthrough
        result[i] = frozenParams[i];
      } else {
        // Live: apply delta with boundary enforcement
        const delta = (mlpParams[i] - 0.5) * 2 * deltaScale;
        const raw = frozenParams[i] + delta;
        const schema = paramSchemas[i]?.schema || { boundary: 'clamp' };
        result[i] = applyBoundary(raw, schema, frozenParams[i]);
      }
    }

    return result;
  }
}
