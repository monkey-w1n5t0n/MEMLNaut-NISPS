// ShapeSeq — Sequence NISPS Instance
//
// Factory for creating a second WasmIML instance dedicated to sequence control.
// The MLP output count is configurable (default 16). A downstream param mapping
// layer (not in this module) fans out to however many primitive params the
// current chain requires.
//
// Input routing is configurable and wired externally (default: hand tracking
// features 0+1). This module only creates the IML instance — it does not
// subscribe to any input source. The integration layer (see meml-9tf) is
// responsible for calling setInputs() with routed values each frame.
//
// Usage:
//   import { createSequenceIML } from './shapeseq/seq-iml.js';
//   const seqIML = await createSequenceIML();                  // 16 outputs
//   const seqIML = await createSequenceIML({ outputCount: 32 }); // 32 outputs
//   // Per frame:
//   seqIML.setInputs([x, y]);
//   seqIML.process();
//   const params = seqIML.getOutputs();

import { WasmIML } from '../nisps/nisps-wasm.js';

// Default architecture for the sequence MLP.
// 2 inputs (routed externally), configurable outputs (param mapping fans out).
const SEQ_N_INPUTS = 2;
const SEQ_DEFAULT_OUTPUT_COUNT = 16;

// Training hyperparameters — same defaults as the synth IML
const SEQ_MAX_ITERATIONS = 1000;
const SEQ_LEARNING_RATE = 1.0;
const SEQ_CONVERGENCE_THRESHOLD = 0.00001;

/**
 * Compute a hidden-layer architecture scaled to the requested output count.
 *
 * The strategy keeps three hidden layers with enough capacity for the output
 * count while staying cheap for inference:
 *   - outputCount <=  8  → [8, 8, 8]
 *   - outputCount <= 16  → [16, 16, 16]
 *   - outputCount <= 32  → [24, 24, 32]
 *   - outputCount >  32  → [outputCount, outputCount, outputCount]
 *
 * @param {number} outputCount
 * @returns {number[]}
 */
export function computeHiddenLayers(outputCount) {
  if (outputCount <= 8)  return [8, 8, 8];
  if (outputCount <= 16) return [16, 16, 16];
  if (outputCount <= 32) return [24, 24, 32];
  return [outputCount, outputCount, outputCount];
}

/**
 * Validate and normalise an output count value.
 * Must be a positive integer >= 1.
 *
 * @param {number} outputCount
 * @returns {number} the validated count
 * @throws {RangeError} if invalid
 */
export function validateOutputCount(outputCount) {
  const n = Math.round(outputCount);
  if (!Number.isFinite(n) || n < 1) {
    throw new RangeError(`outputCount must be a positive integer, got ${outputCount}`);
  }
  return n;
}

/**
 * Create a WasmIML instance configured for sequence control.
 *
 * Follows the same creation pattern as imlJoy / imlHand in a-app.js:
 *   const iml = await WasmIML.create(nInputs, nOutputs, hiddenLayers, ...);
 *
 * The returned object is a standard WasmIML instance with the full interface:
 *   setInput / setInputs, getOutputs, process,
 *   addExample, clearDataset, train, trainAsync,
 *   randomiseWeights (drawWeights), moveWeights,
 *   exampleCount, destroy, etc.
 *
 * Additionally exposes SEQ_N_INPUTS, SEQ_N_OUTPUTS, SEQ_HIDDEN_LAYERS as
 * properties on the returned object for introspection by downstream code.
 *
 * @param {{ outputCount?: number }} [opts]
 * @returns {Promise<WasmIML>} — the sequence IML instance (augmented with
 *   .SEQ_N_INPUTS, .SEQ_N_OUTPUTS, .SEQ_HIDDEN_LAYERS)
 */
export async function createSequenceIML({ outputCount = SEQ_DEFAULT_OUTPUT_COUNT } = {}) {
  const nOutputs = validateOutputCount(outputCount);
  const hiddenLayers = computeHiddenLayers(nOutputs);

  const seqIML = await WasmIML.create(
    SEQ_N_INPUTS,
    nOutputs,
    hiddenLayers,
    SEQ_MAX_ITERATIONS,
    SEQ_LEARNING_RATE,
    SEQ_CONVERGENCE_THRESHOLD
  );

  seqIML.setLogger(msg => console.log('[NISPS:seq]', msg));

  // Attach architecture metadata for introspection
  seqIML.SEQ_N_INPUTS = SEQ_N_INPUTS;
  seqIML.SEQ_N_OUTPUTS = nOutputs;
  seqIML.SEQ_HIDDEN_LAYERS = hiddenLayers;

  return seqIML;
}

// Re-export constants for use by other modules (e.g., param mapping layer)
export { SEQ_N_INPUTS, SEQ_DEFAULT_OUTPUT_COUNT };
