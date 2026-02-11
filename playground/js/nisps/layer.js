// NISPS Layer - faithful port of nisps-core/include/nisps/layer.hpp
// Layer of neural network nodes with shared activation function

import { Node } from './node.js';

// Activation functions matching C++ utils.hpp exactly
const RELU_SLOPE = 0.01; // kReLUSlope

export const activations = {
  relu:         x => x > 0 ? x : RELU_SLOPE * x,
  derivRelu:    x => x > 0 ? 1 : RELU_SLOPE,
  sigmoid:      x => 1 / (1 + Math.exp(-x)),
  derivSigmoid: x => {
    const s = 1 / (1 + Math.exp(-x));
    return s * (1 - s);
  },
  linear:       x => x,
  derivLinear:  () => 1,
  tanh:         x => Math.tanh(x),
  derivTanh:    x => 1 - Math.pow(Math.tanh(x), 2),
};

// Map activation names to [fn, derivFn] pairs
const activationPairs = {
  relu:    [activations.relu,    activations.derivRelu],
  sigmoid: [activations.sigmoid, activations.derivSigmoid],
  linear:  [activations.linear,  activations.derivLinear],
  tanh:    [activations.tanh,    activations.derivTanh],
};

export class Layer {
  constructor(numInputsPerNode, numNodes, activationName, useConstantInit = true, constantInit = 0.5) {
    this.numInputsPerNode = numInputsPerNode;
    this.numNodes = numNodes;
    this.nodes = [];

    const pair = activationPairs[activationName];
    this.activationFn = pair[0];
    this.derivActivationFn = pair[1];

    for (let i = 0; i < numNodes; i++) {
      this.nodes.push(new Node(numInputsPerNode, useConstantInit, constantInit));
    }
  }

  getOutputAfterActivation(input) {
    const output = new Array(this.numNodes);
    for (let i = 0; i < this.numNodes; i++) {
      output[i] = this.nodes[i].getOutputAfterActivation(input, this.activationFn);
    }
    return output;
  }

  initializeGradientAccumulators() {
    for (const node of this.nodes) {
      node.initializeGradientAccumulator();
    }
  }

  clearGradientAccumulators() {
    for (const node of this.nodes) {
      node.clearGradientAccumulator();
    }
  }

  // Backprop with accumulation or direct update
  updateWeights(inputLayerActivation, derivError, learningRate, accumulate = false) {
    const deltas = new Array(this.numInputsPerNode).fill(0);

    if (accumulate) {
      // Accumulate gradients mode
      for (let i = 0; i < this.nodes.length; i++) {
        const dE_doj = derivError[i];
        const doj_dnetj = this.derivActivationFn(this.nodes[i].innerProd);
        const errorSignal = dE_doj * doj_dnetj;

        this.nodes[i].accumulateGradients(inputLayerActivation, errorSignal);

        for (let j = 0; j < this.numInputsPerNode; j++) {
          deltas[j] += errorSignal * this.nodes[i].weights[j];
        }
      }
    } else {
      // Direct update mode
      for (let i = 0; i < this.nodes.length; i++) {
        const dE_doj = derivError[i];
        const doj_dnetj = this.derivActivationFn(this.nodes[i].innerProd);

        for (let j = 0; j < this.numInputsPerNode; j++) {
          deltas[j] += dE_doj * doj_dnetj * this.nodes[i].weights[j];
          const dnetj_dwij = inputLayerActivation[j];
          this.nodes[i].updateWeight(j, -(dE_doj * doj_dnetj * dnetj_dwij), learningRate);
        }
      }
    }
    return deltas;
  }

  applyAccumulatedGradients(learningRate, batchSizeInv) {
    for (const node of this.nodes) {
      node.applyAccumulatedGradients(learningRate, batchSizeInv);
    }
  }

  getGradSumSquared(batchSizeInv) {
    let sumsq = 0;
    for (const node of this.nodes) {
      sumsq += node.getGradSumSquared(batchSizeInv);
    }
    return sumsq;
  }

  scaleAccumulatedGradients(clipCoef) {
    for (const node of this.nodes) {
      node.scaleAccumulatedGradients(clipCoef);
    }
  }

  resetOptimizerState() {
    for (const node of this.nodes) {
      node.resetOptimizerState();
    }
  }

  checkAndFixWeights() {
    let had = false;
    for (const node of this.nodes) {
      had |= node.checkAndFixWeights();
    }
    return had;
  }
}
