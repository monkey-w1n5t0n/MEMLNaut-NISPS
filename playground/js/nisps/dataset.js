// NISPS Dataset - faithful port of nisps-core/include/nisps/dataset.hpp
// Manages feature-label pairs for training

export class Dataset {
  constructor(maxExamples = 100) {
    this.features = [];
    this.labels = [];
    this.maxExamples = maxExamples;
  }

  add(feature, label) {
    if (this.features.length > 0) {
      if (feature.length !== this.features[0].length || label.length !== this.labels[0].length) {
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

  clear() {
    this.features = [];
    this.labels = [];
  }

  getFeatures(withBias = true) {
    return this.features.map(f => withBias ? [...f, 1.0] : [...f]);
  }

  getLabels() {
    return this.labels;
  }

  /**
   * Compute per-sample training weights. Returns Float32Array normalized to sum to 1.
   * @param {'global'|'local'|'combined'} mode
   * @param {object} params
   * @param {number} params.recencyBias - 0 = uniform, 1 = strong recency (global/combined)
   * @param {number[]} [params.queryInput] - current input position (local/combined)
   * @param {number} [params.radius] - spatial radius in input space (local/combined), default 0.15
   * @returns {Float32Array} weights summing to 1
   */
  computeWeights(mode = 'global', params = {}) {
    const n = this.features.length;
    if (n === 0) return new Float32Array(0);
    if (n === 1) return new Float32Array([1.0]);

    const weights = new Float32Array(n).fill(1.0);

    // Global recency: exponential decay — newest = 1, each older *= decay
    if (mode === 'global' || mode === 'combined') {
      const bias = params.recencyBias ?? 0.6;
      if (bias > 0) {
        // decay per step: at bias=1, decay=0.7 (newest ~10x oldest for 10 examples)
        // at bias=0.5, decay=0.85 (gentler)
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
        // Distance from this example to the query point
        let distSq = 0;
        for (let d = 0; d < feat.length; d++) {
          const diff = feat[d] - (query[d] ?? 0);
          distSq += diff * diff;
        }

        if (distSq < radiusSq) {
          // Count newer examples also within the radius
          const proximity = 1 - Math.sqrt(distSq) / radius; // 1 = on top, 0 = at edge
          let newerNearby = 0;
          for (let j = i + 1; j < n; j++) {
            let djSq = 0;
            for (let d = 0; d < feat.length; d++) {
              const diff = feat[d] - this.features[j][d];
              djSq += diff * diff;
            }
            if (djSq < radiusSq) newerNearby++;
          }
          // Suppress: more newer neighbors + closer to query = more suppression
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

  get size() {
    return this.features.length;
  }

  isEmpty() {
    return this.features.length === 0;
  }
}
