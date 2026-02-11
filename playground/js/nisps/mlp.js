// NISPS MLP - faithful port of nisps-core/include/nisps/mlp.hpp + mlp_impl.hpp
// Multi-layer perceptron with Train, TrainBatch, GetOutput, weight management

import { Layer } from './layer.js';

// MSE loss function - port of loss.hpp
function mseLoss(expected, actual, lossDeriv, sampleSizeReciprocal) {
  let accumLoss = 0;
  const oneOverN = 1 / actual.length;

  for (let j = 0; j < actual.length; j++) {
    const diff = expected[j] - actual[j];
    accumLoss += (diff * diff) * oneOverN;
    lossDeriv[j] = -2 * oneOverN * diff * sampleSizeReciprocal;
  }
  accumLoss *= sampleSizeReciprocal;
  return accumLoss;
}

// Fisher-Yates shuffle
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export class MLP {
  /**
   * @param {number[]} layersNodes - e.g. [3, 10, 10, 14, 8]
   * @param {string[]} layersActivations - e.g. ['relu', 'relu', 'relu', 'sigmoid']
   */
  constructor(layersNodes, layersActivations) {
    this.layersNodes = layersNodes;
    this.numInputs = layersNodes[0];
    this.numOutputs = layersNodes[layersNodes.length - 1];
    this.numHiddenLayers = layersNodes.length - 2;
    this.layers = [];
    this.progressCallback = null;

    for (let i = 0; i < layersNodes.length - 1; i++) {
      this.layers.push(
        new Layer(layersNodes[i], layersNodes[i + 1], layersActivations[i], false)
      );
    }
  }

  getOutput(input, forInference = true) {
    if (input.length !== this.numInputs) return null;

    let tempIn = [...input];
    let tempOut;
    const allActivations = [];

    for (let i = 0; i < this.layers.length; i++) {
      if (i > 0) {
        allActivations.push(tempIn);
        tempIn = tempOut;
      }
      tempOut = this.layers[i].getOutputAfterActivation(tempIn);
    }

    // Push last layer's input activation
    allActivations.push(tempIn);

    return { output: tempOut, activations: allActivations };
  }

  // Per-sample SGD training (Train method from C++)
  train(features, labels, learningRate, maxIterations = 1000, minError = 0.00001) {
    const sampleSizeRecip = 1 / features.length;
    let loss = 0;

    for (let iter = 0; iter < maxIterations; iter++) {
      loss = 0;

      for (let s = 0; s < features.length; s++) {
        const { output, activations } = this.getOutput(features[s], false);
        const derivError = new Array(output.length);

        loss += mseLoss(labels[s], output, derivError, sampleSizeRecip);

        // Backprop with direct weight update
        let tempDerivError = derivError;
        for (let i = this.numHiddenLayers; i >= 0; i--) {
          const deltas = this.layers[i].updateWeights(activations[i], tempDerivError, learningRate, false);
          if (i > 0) tempDerivError = deltas;
        }
      }

      loss *= sampleSizeRecip;

      if (this.progressCallback && (iter & 0x1F) === 0) {
        this.progressCallback(iter, loss);
      }

      if (loss < minError) break;
    }

    return loss;
  }

  // Batch training with RMSProp (TrainBatch from C++)
  trainBatch(features, labels, learningRate, maxIterations = 1000, batchSize = 8, minError = 0.00001) {
    const nSamples = features.length;
    const nBatches = Math.ceil(nSamples / batchSize);
    let epochLoss = 0;

    for (let iter = 0; iter < maxIterations; iter++) {
      epochLoss = 0;

      // Shuffle indices
      const indices = Array.from({ length: nSamples }, (_, i) => i);
      shuffleArray(indices);

      let sampleIdx = 0;

      for (let batch = 0; batch < nBatches; batch++) {
        const currentBatchSize = Math.min(batchSize, nSamples - sampleIdx);
        const batchSizeRecip = 1 / currentBatchSize;

        // Initialize gradient accumulators
        for (const layer of this.layers) {
          layer.initializeGradientAccumulators();
        }

        let batchLoss = 0;

        for (let i = 0; i < currentBatchSize; i++) {
          const idx = indices[sampleIdx++];
          const { output, activations } = this.getOutput(features[idx], false);
          const derivError = new Array(output.length);

          batchLoss += mseLoss(labels[idx], output, derivError, 1.0);

          // Backprop with accumulation
          let tempDerivError = derivError;
          for (let li = this.numHiddenLayers; li >= 0; li--) {
            const deltas = this.layers[li].updateWeights(activations[li], tempDerivError, 0, true);
            if (li > 0) tempDerivError = deltas;
          }
        }

        // Gradient clipping (norm > 5.0)
        let gradSumSq = 0;
        for (const layer of this.layers) {
          gradSumSq += layer.getGradSumSquared(batchSizeRecip);
        }
        const gradNorm = Math.sqrt(gradSumSq);

        if (gradNorm > 5.0) {
          const clipCoef = 5.0 / gradNorm;
          for (const layer of this.layers) {
            layer.scaleAccumulatedGradients(clipCoef);
          }
        }

        // Apply accumulated gradients
        for (const layer of this.layers) {
          layer.applyAccumulatedGradients(learningRate, batchSizeRecip);
        }

        epochLoss += batchLoss / currentBatchSize;
      }

      epochLoss /= nBatches;

      if (this.progressCallback) {
        this.progressCallback(iter, epochLoss);
      }

      if (epochLoss < minError) break;
    }

    return epochLoss;
  }

  getWeights() {
    return this.layers.map(layer =>
      layer.nodes.map(node => ({
        weights: node.getWeightsCopy(),
        bias: node.bias,
      }))
    );
  }

  setWeights(weights) {
    for (let l = 0; l < this.layers.length; l++) {
      for (let n = 0; n < this.layers[l].nodes.length; n++) {
        this.layers[l].nodes[n].setWeights(weights[l][n].weights);
        this.layers[l].nodes[n].bias = weights[l][n].bias;
      }
    }
  }

  // DrawWeights - randomize all weights uniformly in [-1, 1]
  drawWeights(scale = 1) {
    for (const layer of this.layers) {
      for (const node of layer.nodes) {
        for (let j = 0; j < node.weights.length; j++) {
          node.weights[j] = (Math.random() * 2 - 1) * scale;
        }
      }
    }
  }

  // MoveWeights - add Gaussian noise (port of gen_randn)
  moveWeights(speed) {
    for (const layer of this.layers) {
      for (const node of layer.nodes) {
        for (let j = 0; j < node.weights.length; j++) {
          // gen_randn: sum of 3 uniform randoms * kN_times * stddev + mean
          let accum = 0;
          for (let n = 0; n < 3; n++) {
            accum += Math.random() * 2 - 1; // gen_rand with range 2.0
          }
          node.weights[j] = 3 * accum * speed + node.weights[j];
        }
      }
    }
  }

  resetOptimizerState() {
    for (const layer of this.layers) {
      layer.resetOptimizerState();
    }
  }
}
