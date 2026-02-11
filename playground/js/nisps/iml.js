// NISPS IML - faithful port of nisps-core/include/nisps/iml.hpp + iml_impl.hpp
// Interactive Machine Learning interface

import { MLP } from './mlp.js';
import { Dataset } from './dataset.js';

export class IML {
  /**
   * @param {number} nInputs
   * @param {number} nOutputs
   * @param {number[]} hiddenLayers
   * @param {number} maxIterations
   * @param {number} learningRate
   * @param {number} convergenceThreshold
   */
  constructor(
    nInputs,
    nOutputs,
    hiddenLayers = [10, 10, 14],
    maxIterations = 1000,
    learningRate = 1.0,
    convergenceThreshold = 0.00001
  ) {
    this.nInputs = nInputs;
    this.nOutputs = nOutputs;
    this.maxIterations = maxIterations;
    this.learningRate = learningRate;
    this.convergenceThreshold = convergenceThreshold;

    // Build layer sizes: input+bias, hidden..., output
    const BIAS = 1;
    const layerSizes = [nInputs + BIAS, ...hiddenLayers, nOutputs];

    // Activation functions: RELU for hidden, SIGMOID for output
    const activationNames = [
      ...hiddenLayers.map(() => 'relu'),
      'sigmoid',
    ];

    this.dataset = new Dataset(100);
    this.mlp = new MLP(layerSizes, activationNames);

    this.inputState = new Array(nInputs).fill(0.5);
    this.outputState = new Array(nOutputs).fill(0);
    this.mode = 'inference';
    this.performInference = true;
    this.inputUpdated = true;
    this.storedWeights = null;
    this.weightsRandomised = false;
    this.lastLoss = null;
    this.logFn = null;
  }

  setLogger(fn) {
    this.logFn = fn;
  }

  log(msg) {
    if (this.logFn) this.logFn(msg);
  }

  setInput(index, value) {
    if (index >= this.nInputs) return;
    this.inputState[index] = Math.max(0, Math.min(1, value));
    this.inputUpdated = true;
  }

  setInputs(values) {
    for (let i = 0; i < values.length && i < this.nInputs; i++) {
      this.inputState[i] = Math.max(0, Math.min(1, values[i]));
    }
    this.inputUpdated = true;
  }

  getOutputs() {
    return this.outputState;
  }

  setOutput(index, value) {
    if (index >= this.nOutputs) return;
    this.outputState[index] = Math.max(0, Math.min(1, value));
  }

  setOutputs(values) {
    for (let i = 0; i < values.length && i < this.nOutputs; i++) {
      this.outputState[i] = Math.max(0, Math.min(1, values[i]));
    }
  }

  process() {
    if (!this.performInference || !this.inputUpdated) return;

    // Add bias term
    const inputWithBias = [...this.inputState, 1.0];
    const { output } = this.mlp.getOutput(inputWithBias);
    this.outputState = output;
    this.inputUpdated = false;
  }

  getMode() {
    return this.mode;
  }

  setMode(mode) {
    if (mode === 'inference' && this.mode === 'training') {
      this.train();
    }
    this.mode = mode;
  }

  // Two-step save example (hardware workflow)
  saveExample() {
    if (this.performInference) {
      this.performInference = false;
      this.log('Move to desired output position...');
      return;
    }

    this.dataset.add(this.inputState, this.outputState);
    this.performInference = true;

    // Run inference
    const inputWithBias = [...this.inputState, 1.0];
    const { output } = this.mlp.getOutput(inputWithBias);
    this.outputState = output;

    this.log('Example saved.');
  }

  // Direct programmatic example addition
  addExample(inputs, outputs) {
    const inVec = inputs.slice(0, this.nInputs);
    while (inVec.length < this.nInputs) inVec.push(0);
    const outVec = outputs.slice(0, this.nOutputs);
    while (outVec.length < this.nOutputs) outVec.push(0);
    this.dataset.add(inVec, outVec);
  }

  clearDataset() {
    this.dataset.clear();
    this.log('Dataset cleared.');
  }

  randomiseWeights() {
    this.storedWeights = this.mlp.getWeights();
    this.mlp.drawWeights();
    this.weightsRandomised = true;

    // Run inference to show effect
    const inputWithBias = [...this.inputState, 1.0];
    const { output } = this.mlp.getOutput(inputWithBias);
    this.outputState = output;

    this.log('Weights randomised.');
  }

  // Add Gaussian noise to weights (for RL exploration)
  moveWeights(speed) {
    this.mlp.moveWeights(speed);
    // Run inference to show effect
    this.inputUpdated = true;
    this.process();
  }

  train() {
    // Restore weights if randomised
    if (this.weightsRandomised && this.storedWeights) {
      this.mlp.setWeights(this.storedWeights);
      this.weightsRandomised = false;
    }

    const features = this.dataset.getFeatures(true); // with bias
    const labels = this.dataset.getLabels();

    if (features.length === 0 || labels.length === 0) {
      this.log('Empty dataset, skipping training.');
      return null;
    }

    this.log('Training...');
    this.lastLoss = this.mlp.train(
      features,
      labels,
      this.learningRate,
      this.maxIterations,
      this.convergenceThreshold
    );

    // Run inference after training
    const inputWithBias = [...this.inputState, 1.0];
    const { output } = this.mlp.getOutput(inputWithBias);
    this.outputState = output;

    this.log(`Training complete. Loss: ${this.lastLoss.toFixed(6)}`);
    return this.lastLoss;
  }

  get exampleCount() {
    return this.dataset.size;
  }
}
