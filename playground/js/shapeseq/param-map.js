// ShapeSeq param mapping layer
// Maps fixed-size MLP outputs (16 values [0,1]) to variable-count primitive params
//
// The sequence MLP always outputs a fixed number of values (default 16).
// The primitive chain has a variable number of params depending on which
// primitives are active. This module bridges the two via automatic distribution:
//   - N <= mlpOutputCount: each param gets one dedicated output
//   - N > mlpOutputCount: outputs distributed via linear interpolation
//
// Port-ready: Float32Array, no closures, pure functions.

/**
 * Create a param mapper instance for a given MLP output count.
 * @param {number} mlpOutputCount - number of MLP outputs (e.g. 16)
 * @returns {{ map: Function, mapWithSchema: Function, mlpOutputCount: number }}
 */
export function createParamMap(mlpOutputCount) {
  if (!Number.isInteger(mlpOutputCount) || mlpOutputCount < 1) {
    throw new Error('mlpOutputCount must be a positive integer');
  }

  return {
    mlpOutputCount,
    map,
    mapWithSchema,
  };
}

/**
 * Map MLP outputs to N primitive params via automatic distribution.
 *
 * If paramCount <= mlpOutputCount, each param gets one dedicated output
 * (first paramCount outputs used, rest ignored).
 *
 * If paramCount > mlpOutputCount, outputs are distributed via linear
 * interpolation so that the first param maps to the first output and the
 * last param maps to the last output, with intermediate params interpolated.
 *
 * @param {Float32Array|number[]} mlpOutputs - MLP output values [0,1]
 * @param {number} paramCount - number of primitive params to produce
 * @returns {Float32Array} mapped values [0,1], length = paramCount
 */
export function map(mlpOutputs, paramCount) {
  const mlpCount = mlpOutputs.length;
  const result = new Float32Array(paramCount);

  if (paramCount === 0) return result;

  if (paramCount <= mlpCount) {
    // Direct mapping: each param gets one dedicated output
    for (let i = 0; i < paramCount; i++) {
      result[i] = mlpOutputs[i];
    }
  } else {
    // Interpolated mapping: spread mlpCount outputs across paramCount params
    // param[i] maps to a fractional position in the output array
    // param[0] -> output[0], param[paramCount-1] -> output[mlpCount-1]
    const scale = paramCount > 1 ? (mlpCount - 1) / (paramCount - 1) : 0;

    for (let i = 0; i < paramCount; i++) {
      const pos = i * scale;
      const lo = pos | 0; // floor
      const hi = lo + 1 < mlpCount ? lo + 1 : lo;
      const frac = pos - lo;
      result[i] = mlpOutputs[lo] + (mlpOutputs[hi] - mlpOutputs[lo]) * frac;
    }
  }

  return result;
}

/**
 * Map MLP outputs to primitive params and apply per-param min/max scaling.
 *
 * Each param schema defines { min, max } (both [0,1]). The mapped [0,1]
 * value is scaled into [min, max] for each param.
 *
 * @param {Float32Array|number[]} mlpOutputs - MLP output values [0,1]
 * @param {Array<{ min: number, max: number }>} paramSchemas - per-param range definitions
 * @returns {Float32Array} scaled values, length = paramSchemas.length
 */
export function mapWithSchema(mlpOutputs, paramSchemas) {
  const paramCount = paramSchemas.length;
  const mapped = map(mlpOutputs, paramCount);

  for (let i = 0; i < paramCount; i++) {
    const schema = paramSchemas[i];
    const min = schema.min !== undefined ? schema.min : 0;
    const max = schema.max !== undefined ? schema.max : 1;
    mapped[i] = min + mapped[i] * (max - min);
  }

  return mapped;
}
