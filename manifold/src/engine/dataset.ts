/**
 * Dataset — JS-side training-example store.
 *
 * Why duplicate the C++ ring buffer? Two reasons:
 *   1. Sample-weight computation (recency / spatial / combined) lives in JS so
 *      that adjusting weighting modes doesn't burn a WASM round-trip.
 *   2. The dataset is part of session state we serialize to localStorage —
 *      the WASM heap is wiped on reload.
 *
 * On train() we ship features + labels into WASM via `addExample` calls. The
 * order of insertion is preserved; FIFO eviction matches the C++ MLP's
 * `dataset_head_` pointer so weighting stays consistent.
 *
 * The implementation is a faithful TypeScript port of the legacy
 * `playground/_archive/js/nisps/dataset.js` with:
 *   - Float32Array backing instead of `Array<Array<number>>`
 *   - Stricter types
 *   - No `withBias` flag (the WASM bindings don't take a bias term)
 */

export type WeightMode = 'global' | 'local' | 'combined' | 'uniform';

export interface ComputeWeightsParams {
  /** [0,1] — how strongly to bias toward newest examples (global/combined). */
  recencyBias?: number;
  /** Current input position, used for local/combined spatial weighting. */
  queryInput?: ReadonlyArray<number>;
  /** Spatial radius in input space (local/combined). */
  radius?: number;
}

export class Dataset {
  /** Maximum number of examples retained. FIFO eviction beyond this. */
  readonly maxSize: number;
  /** Length of feature vectors. Set on first add(); locked thereafter. */
  private inputSize_ = 0;
  /** Length of label vectors. Set on first add(); locked thereafter. */
  private outputSize_ = 0;

  /** Flat arrays — entries `[i*inputSize, (i+1)*inputSize)` belong to example i. */
  private features_: Float32Array = new Float32Array(0);
  private labels_: Float32Array = new Float32Array(0);
  private size_ = 0;

  /**
   * `maxSize` has NO default on purpose: this store mirrors the C++ MLP's
   * example ring buffer 1:1 (FIFO eviction order, sample-weight indexing),
   * so its cap must always come from the C++ side's actual `max_examples()`
   * (via `nisps_ml_describe`) rather than a value picked independently here.
   * A default invited exactly that divergence — see S35
   * (docs/specs/recon/simplification-audit-2026-07.md): the JS mirror
   * defaulted to 100 while the C++ ring defaulted to 128, so train() and
   * trainAsync() silently trained on different data past 100 examples, and
   * sample-weight buffers sized to the JS side's count read out of bounds
   * on the C++ side once its count exceeded that.
   */
  constructor(maxSize: number) {
    if (maxSize <= 0) throw new Error('Dataset.maxSize must be > 0');
    this.maxSize = maxSize;
  }

  /** Number of examples currently stored. */
  get size(): number {
    return this.size_;
  }

  isEmpty(): boolean {
    return this.size_ === 0;
  }

  /**
   * Add a feature/label pair. Returns true on success, false if the
   * dimensions don't match a previously-added example.
   *
   * Eviction: when at capacity, the oldest example is removed (shift),
   * then the new one is appended. This matches the legacy JS behaviour
   * (and is conceptually equivalent to the C++ side's ring buffer with
   * `head_` advancement).
   */
  add(features: ReadonlyArray<number>, labels: ReadonlyArray<number>): boolean {
    if (this.size_ === 0) {
      this.inputSize_ = features.length;
      this.outputSize_ = labels.length;
      // Allocate full-capacity buffers up front to avoid growth thrash.
      this.features_ = new Float32Array(this.maxSize * this.inputSize_);
      this.labels_ = new Float32Array(this.maxSize * this.outputSize_);
    }

    if (features.length !== this.inputSize_ || labels.length !== this.outputSize_) {
      return false;
    }

    if (this.size_ >= this.maxSize) {
      // FIFO: shift left in place. This is O(n*dim) and could be replaced
      // with a head pointer; for maxSize ≤ a few hundred it's fine.
      this.features_.copyWithin(0, this.inputSize_);
      this.labels_.copyWithin(0, this.outputSize_);
      this.size_ = this.maxSize - 1;
    }

    const fOff = this.size_ * this.inputSize_;
    const lOff = this.size_ * this.outputSize_;
    for (let i = 0; i < this.inputSize_; ++i) this.features_[fOff + i] = features[i];
    for (let i = 0; i < this.outputSize_; ++i) this.labels_[lOff + i] = labels[i];
    this.size_++;
    return true;
  }

  clear(): void {
    this.size_ = 0;
  }

  /** Read-only view of the i-th feature vector. */
  feature(i: number): Float32Array {
    if (i < 0 || i >= this.size_) throw new RangeError(`feature index ${i} out of bounds`);
    return this.features_.subarray(i * this.inputSize_, (i + 1) * this.inputSize_);
  }

  /** Read-only view of the i-th label vector. */
  label(i: number): Float32Array {
    if (i < 0 || i >= this.size_) throw new RangeError(`label index ${i} out of bounds`);
    return this.labels_.subarray(i * this.outputSize_, (i + 1) * this.outputSize_);
  }

  /** Flat view of all features (size * inputSize). */
  featuresFlat(): Float32Array {
    return this.features_.subarray(0, this.size_ * this.inputSize_);
  }

  /** Flat view of all labels (size * outputSize). */
  labelsFlat(): Float32Array {
    return this.labels_.subarray(0, this.size_ * this.outputSize_);
  }

  get inputSize(): number {
    return this.inputSize_;
  }
  get outputSize(): number {
    return this.outputSize_;
  }

  /**
   * Compute per-sample training weights. Returns Float32Array (size=this.size)
   * normalized to sum to 1. For an empty dataset returns a 0-length array;
   * for a singleton, [1.0].
   *
   * Modes:
   *  - `uniform`  — every weight = 1/n.
   *  - `global`   — exponential recency decay over insertion order.
   *  - `local`    — within `radius` of `queryInput`, suppress older neighbours.
   *  - `combined` — global × local.
   */
  computeWeights(mode: WeightMode = 'uniform', params: ComputeWeightsParams = {}): Float32Array {
    const n = this.size_;
    if (n === 0) return new Float32Array(0);
    if (n === 1) return new Float32Array([1.0]);

    const weights = new Float32Array(n).fill(1.0);

    if (mode === 'global' || mode === 'combined') {
      const bias = params.recencyBias ?? 0.6;
      if (bias > 0) {
        const decay = 1 - 0.3 * bias;
        for (let i = n - 2; i >= 0; --i) weights[i] = weights[i + 1] * decay;
      }
    }

    if ((mode === 'local' || mode === 'combined') && params.queryInput) {
      const query = params.queryInput;
      const radius = params.radius ?? 0.15;
      const radiusSq = radius * radius;
      const dim = this.inputSize_;

      for (let i = 0; i < n; ++i) {
        const fOffI = i * dim;
        let distSq = 0;
        for (let d = 0; d < dim; ++d) {
          const diff = this.features_[fOffI + d] - (query[d] ?? 0);
          distSq += diff * diff;
        }
        if (distSq < radiusSq) {
          const proximity = 1 - Math.sqrt(distSq) / radius;
          let newerNearby = 0;
          for (let j = i + 1; j < n; ++j) {
            const fOffJ = j * dim;
            let djSq = 0;
            for (let d = 0; d < dim; ++d) {
              const diff = this.features_[fOffI + d] - this.features_[fOffJ + d];
              djSq += diff * diff;
            }
            if (djSq < radiusSq) ++newerNearby;
          }
          if (newerNearby > 0) {
            weights[i] *= Math.pow(1 - proximity, newerNearby);
          }
        }
      }
    }

    let sum = 0;
    for (let i = 0; i < n; ++i) sum += weights[i];
    if (sum > 0) for (let i = 0; i < n; ++i) weights[i] /= sum;
    return weights;
  }
}
