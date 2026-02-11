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

  get size() {
    return this.features.length;
  }

  isEmpty() {
    return this.features.length === 0;
  }
}
