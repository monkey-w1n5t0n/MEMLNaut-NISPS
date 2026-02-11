// NISPS Node - faithful port of nisps-core/include/nisps/node.hpp
// Single neural network node with weights, bias, and RMSProp optimizer

const RMSPROP_DECAY = 0.9;
const RMSPROP_DECAY_INV = 0.1;
const RMSPROP_EPSILON = 1e-6;
const MAX_SQUARED_GRAD_AVG = 1e6;
const MAX_ADJUSTED_LR = 1.0;
const GRADIENT_CLIP_VALUE = 10.0;

export class Node {
  constructor(numInputs, useConstantInit = true, constantInit = 0.5) {
    this.numInputs = numInputs;
    this.bias = 0.0;
    this.weights = new Float64Array(numInputs);
    this.squaredGradientAvg = new Float64Array(numInputs);
    this.biasSquaredGradientAvg = 0;
    this.gradientAccumulator = new Float64Array(numInputs);
    this.biasGradientAccumulator = 0;
    this.innerProd = 0;

    if (useConstantInit) {
      this.weights.fill(constantInit);
    } else {
      // gen_rand<T>(2.0) produces values in [-1, 1]
      for (let i = 0; i < numInputs; i++) {
        this.weights[i] = Math.random() * 2 - 1;
      }
    }
  }

  getInputInnerProdWithWeights(input) {
    let res = 0;
    for (let j = 0; j < input.length; j++) {
      res += input[j] * this.weights[j];
    }
    res += this.bias;
    this.innerProd = res;
    return this.innerProd;
  }

  getOutputAfterActivation(input, activationFn) {
    this.getInputInnerProdWithWeights(input);
    return activationFn(this.innerProd);
  }

  initializeGradientAccumulator() {
    this.gradientAccumulator = new Float64Array(this.weights.length);
    this.biasGradientAccumulator = 0;
  }

  clearGradientAccumulator() {
    this.gradientAccumulator.fill(0);
  }

  accumulateGradients(input, errorSignal) {
    for (let i = 0; i < this.weights.length; i++) {
      this.gradientAccumulator[i] += input[i] * errorSignal;
    }
    this.biasGradientAccumulator += errorSignal;
  }

  applyAccumulatedGradients(learningRate, batchSizeInv) {
    for (let i = 0; i < this.weights.length; i++) {
      let gradient = this.gradientAccumulator[i] * batchSizeInv;

      // Clamp gradient
      gradient = Math.max(Math.min(gradient, GRADIENT_CLIP_VALUE), -GRADIENT_CLIP_VALUE);

      this.squaredGradientAvg[i] =
        RMSPROP_DECAY * this.squaredGradientAvg[i] +
        RMSPROP_DECAY_INV * gradient * gradient;

      // Clamp squared gradient average
      this.squaredGradientAvg[i] = Math.min(this.squaredGradientAvg[i], MAX_SQUARED_GRAD_AVG);

      let adjustedLR = learningRate / (Math.sqrt(this.squaredGradientAvg[i]) + RMSPROP_EPSILON);

      // Clamp adjusted learning rate
      adjustedLR = Math.min(adjustedLR, MAX_ADJUSTED_LR);

      this.weights[i] -= adjustedLR * gradient;
      this.gradientAccumulator[i] = 0;
    }

    // Bias update
    let biasGradient = this.biasGradientAccumulator * batchSizeInv;
    biasGradient = Math.max(Math.min(biasGradient, GRADIENT_CLIP_VALUE), -GRADIENT_CLIP_VALUE);

    this.biasSquaredGradientAvg =
      RMSPROP_DECAY * this.biasSquaredGradientAvg +
      RMSPROP_DECAY_INV * biasGradient * biasGradient;

    this.biasSquaredGradientAvg = Math.min(this.biasSquaredGradientAvg, MAX_SQUARED_GRAD_AVG);

    let biasAdjustedLR = learningRate / (Math.sqrt(this.biasSquaredGradientAvg) + RMSPROP_EPSILON);
    biasAdjustedLR = Math.min(biasAdjustedLR, MAX_ADJUSTED_LR);

    this.bias -= biasAdjustedLR * biasGradient;
    this.biasGradientAccumulator = 0;
  }

  getGradSumSquared(batchSizeInv) {
    let sumsq = 0;
    for (let i = 0; i < this.gradientAccumulator.length; i++) {
      const scaled = this.gradientAccumulator[i] * batchSizeInv;
      sumsq += scaled * scaled;
    }
    return sumsq;
  }

  scaleAccumulatedGradients(clipCoef) {
    for (let i = 0; i < this.gradientAccumulator.length; i++) {
      this.gradientAccumulator[i] *= clipCoef;
    }
  }

  updateWeight(weightId, increment, learningRate) {
    this.weights[weightId] += learningRate * increment;
  }

  resetOptimizerState() {
    this.squaredGradientAvg.fill(0);
    this.biasSquaredGradientAvg = 0;
  }

  checkAndFixWeights() {
    let hadCorruption = false;
    for (let i = 0; i < this.weights.length; i++) {
      if (!isFinite(this.weights[i])) {
        this.weights[i] = 0;
        this.squaredGradientAvg[i] = 0;
        hadCorruption = true;
      }
    }
    if (!isFinite(this.bias)) {
      this.bias = 0;
      this.biasSquaredGradientAvg = 0;
      hadCorruption = true;
    }
    return hadCorruption;
  }

  getWeightsCopy() {
    return Array.from(this.weights);
  }

  setWeights(weights) {
    for (let i = 0; i < this.weights.length; i++) {
      this.weights[i] = weights[i];
    }
  }
}
