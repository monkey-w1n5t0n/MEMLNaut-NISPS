// ShapeSeq — Sequence NISPS Instance
//
// Factory for creating a second WasmIML instance dedicated to sequence control.
// The MLP has a fixed 16-element output which a downstream param mapping layer
// (not in this module) fans out to however many primitive params the current
// chain requires.
//
// Input routing is configurable and wired externally (default: hand tracking
// features 0+1). This module only creates the IML instance — it does not
// subscribe to any input source. The integration layer (see meml-9tf) is
// responsible for calling setInputs() with routed values each frame.
//
// Usage:
//   import { createSequenceIML } from './shapeseq/seq-iml.js';
//   const seqIML = await createSequenceIML();
//   // Per frame:
//   seqIML.setInputs([x, y]);
//   seqIML.process();
//   const params16 = seqIML.getOutputs();

import { WasmIML } from '../nisps/nisps-wasm.js';

// Fixed architecture for the sequence MLP.
// 2 inputs (routed externally), 16 outputs (fixed — param mapping fans out).
// Smaller network than the synth MLP ([3,32,48,64,126]):
// three hidden layers of 16 neurons keeps inference cheap while providing
// enough capacity for 16 continuous outputs.
const SEQ_N_INPUTS = 2;
const SEQ_N_OUTPUTS = 16;
const SEQ_HIDDEN_LAYERS = [16, 16, 16];

// Training hyperparameters — same defaults as the synth IML
const SEQ_MAX_ITERATIONS = 1000;
const SEQ_LEARNING_RATE = 1.0;
const SEQ_CONVERGENCE_THRESHOLD = 0.00001;

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
 * @returns {Promise<WasmIML>} — the sequence IML instance (augmented with
 *   .SEQ_N_INPUTS, .SEQ_N_OUTPUTS, .SEQ_HIDDEN_LAYERS)
 */
export async function createSequenceIML() {
  const seqIML = await WasmIML.create(
    SEQ_N_INPUTS,
    SEQ_N_OUTPUTS,
    SEQ_HIDDEN_LAYERS,
    SEQ_MAX_ITERATIONS,
    SEQ_LEARNING_RATE,
    SEQ_CONVERGENCE_THRESHOLD
  );

  seqIML.setLogger(msg => console.log('[NISPS:seq]', msg));

  // Attach architecture metadata for introspection
  seqIML.SEQ_N_INPUTS = SEQ_N_INPUTS;
  seqIML.SEQ_N_OUTPUTS = SEQ_N_OUTPUTS;
  seqIML.SEQ_HIDDEN_LAYERS = SEQ_HIDDEN_LAYERS;

  return seqIML;
}

// Re-export constants for use by other modules (e.g., param mapping layer)
export { SEQ_N_INPUTS, SEQ_N_OUTPUTS, SEQ_HIDDEN_LAYERS };
