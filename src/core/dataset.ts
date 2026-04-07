/**
 * NISPS Dataset — TypeScript port of playground/js/nisps/dataset.js
 * Manages feature-label pairs for training with FIFO ring buffer
 * and configurable sample weighting.
 */
export class Dataset {
  features: number[][] = [];
  labels: number[][] = [];
  maxExamples: number;

  constructor(maxExamples = 100) {
    this.maxExamples = maxExamples;
  }

  add(feature: number[], label: number[]): boolean {
    if (this.features.length > 0) {
      if (
        feature.length !== this.features[0].length ||
        label.length !== this.labels[0].length
      ) {
        return false;
      }
    }
    if (this.features.length >= this.maxExamples) {
      // FIFO: remove oldest
      this.features.shift();
      this.labels.shift();
    }
    this.features.push([...feature]);
    this.labels.push([...label]);
    return true;
  }

  clear(): void {
    this.features = [];
    this.labels = [];
  }

  getFeatures(withBias = true): number[][] {
    return this.features.map((f) => (withBias ? [...f, 1.0] : [...f]));
  }

  getLabels(): number[][] {
    return this.labels;
  }

  /**
   * Compute per-sample training weights. Returns Float32Array normalized to sum to 1.
   */
  computeWeights(
    mode: 'global' | 'local' | 'combined' = 'global',
    params: {
      recencyBias?: number;
      queryInput?: number[];
      radius?: number;
    } = {}
  ): Float32Array {
    const n = this.features.length;
    if (n === 0) return new Float32Array(0);
    if (n === 1) return new Float32Array([1.0]);

    const weights = new Float32Array(n).fill(1.0);

    // Global recency: exponential decay
    if (mode === 'global' || mode === 'combined') {
      const bias = params.recencyBias ?? 0.6;
      if (bias > 0) {
        const decay = 1 - 0.3 * bias;
        for (let i = n - 2; i >= 0; i--) {
          weights[i] = weights[i + 1] * decay;
        }
      }
    }

    // Local recency: newer examples near the query suppress older nearby ones
    if ((mode === 'local' || mode === 'combined') && params.queryInput) {
      const query = params.queryInput;
      const radius = params.radius ?? 0.15;
      const radiusSq = radius * radius;

      for (let i = 0; i < n; i++) {
        const feat = this.features[i];
        let distSq = 0;
        for (let d = 0; d < feat.length; d++) {
          const diff = feat[d] - (query[d] ?? 0);
          distSq += diff * diff;
        }

        if (distSq < radiusSq) {
          const proximity = 1 - Math.sqrt(distSq) / radius;
          let newerNearby = 0;
          for (let j = i + 1; j < n; j++) {
            let djSq = 0;
            for (let d = 0; d < feat.length; d++) {
              const diff = feat[d] - this.features[j][d];
              djSq += diff * diff;
            }
            if (djSq < radiusSq) newerNearby++;
          }
          if (newerNearby > 0) {
            weights[i] *= Math.pow(1 - proximity, newerNearby);
          }
        }
      }
    }

    // Normalize to sum to 1
    let sum = 0;
    for (let i = 0; i < n; i++) sum += weights[i];
    if (sum > 0) {
      for (let i = 0; i < n; i++) weights[i] /= sum;
    }

    return weights;
  }

  get size(): number {
    return this.features.length;
  }

  isEmpty(): boolean {
    return this.features.length === 0;
  }
}
