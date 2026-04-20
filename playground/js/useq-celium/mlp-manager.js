// MLPManager — thin, role-labelled lifecycle wrapper around WasmIML.
//
// Exposes the small subset of WasmIML behaviour the Celium dual-MLP flow
// actually needs, normalised for predictability (always Float32Array outputs,
// local example count, single `rebuild()` entry point, idempotent dispose).
//
// Role is purely a label for logging + event detail ('rhythm' or 'cv').
//
// `_wasmImlFactory` is an injection seam for tests. In production the default
// factory calls `WasmIML.create(...)` from nisps-wasm.js. Tests can pass a
// fake factory producing a lightweight JS stand-in.
//
// NOTE on WasmIML surface: WasmIML exposes `destroy()` (not `dispose`),
// `clearDataset()` (not `clearExamples`), and private `_getFlatWeights`/
// `_setFlatWeights` for flat weight I/O. This wrapper shields callers from
// those naming differences.

/**
 * Default factory: dynamically import WasmIML and call its async .create().
 * Kept behind a function so tests that never hit it don't trigger the import
 * (nisps-wasm.js is non-loadable under Node — needs fetch + WASM).
 */
async function defaultWasmImlFactory(nInputs, nOutputs, hiddenLayers) {
  const { WasmIML } = await import('../nisps/nisps-wasm.js');
  // maxIter / lr / convergenceThresh use WasmIML defaults matching a-app.js.
  return WasmIML.create(nInputs, nOutputs, hiddenLayers, 1000, 1.0, 0.00001);
}

export class MLPManager extends EventTarget {
  /**
   * @param {Object} opts
   * @param {'rhythm'|'cv'|string} opts.role - label
   * @param {number} [opts.nInputs=2]
   * @param {number} opts.nOutputs
   * @param {number[]} opts.hiddenLayers
   * @param {Function} [opts._wasmImlFactory] - test seam; defaults to WasmIML.create wrapper
   */
  constructor({ role, nInputs = 2, nOutputs, hiddenLayers, _wasmImlFactory } = {}) {
    super();
    if (!role) throw new Error('MLPManager: role is required');
    if (!Number.isInteger(nOutputs) || nOutputs < 1) {
      throw new Error(`MLPManager[${role}]: nOutputs must be a positive integer`);
    }
    if (!Array.isArray(hiddenLayers) || hiddenLayers.length === 0 ||
        !hiddenLayers.every(n => Number.isInteger(n) && n > 0)) {
      throw new Error(`MLPManager[${role}]: hiddenLayers must be a non-empty array of positive ints`);
    }

    this.role = role;
    this.nInputs = nInputs;
    this.nOutputs = nOutputs;
    this.hiddenLayers = [...hiddenLayers];

    this._factory = _wasmImlFactory || defaultWasmImlFactory;
    this._iml = null;
    this._ready = false;
    this._disposed = false;
    this._lastOutputs = null;   // Float32Array cache
    this._exampleCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Create the underlying WasmIML. Dispatches 'ready' when done. */
  async init() {
    if (this._disposed) throw new Error(`MLPManager[${this.role}]: cannot init a disposed manager`);
    if (this._ready) return;
    this._iml = await this._factory(this.nInputs, this.nOutputs, this.hiddenLayers);
    this._ready = true;
    this.dispatchEvent(new CustomEvent('ready', { detail: { role: this.role } }));
  }

  /**
   * Rebuild the underlying net with a new shape. Disposes the old one,
   * creates a new instance. Example set is lost by design (training data
   * was tied to the old shape). Dispatches 'rebuild'.
   */
  async rebuild({ nOutputs, hiddenLayers }) {
    this._assertReady('rebuild');
    if (!Number.isInteger(nOutputs) || nOutputs < 1) {
      throw new Error(`MLPManager[${this.role}]: rebuild nOutputs must be a positive integer`);
    }
    if (!Array.isArray(hiddenLayers) || hiddenLayers.length === 0 ||
        !hiddenLayers.every(n => Number.isInteger(n) && n > 0)) {
      throw new Error(`MLPManager[${this.role}]: rebuild hiddenLayers must be a non-empty array of positive ints`);
    }

    const oldIml = this._iml;
    this._ready = false;
    this._iml = null;
    this._lastOutputs = null;
    this._exampleCount = 0;
    this.nOutputs = nOutputs;
    this.hiddenLayers = [...hiddenLayers];

    // Build new one first; only then dispose the old (so a build failure
    // leaves us with a sensible prior state? — actually, on failure we
    // restore to disposed; caller has to retry). Dispose old regardless to
    // free WASM memory deterministically.
    try {
      this._iml = await this._factory(this.nInputs, this.nOutputs, this.hiddenLayers);
      this._ready = true;
    } finally {
      this._disposeIml(oldIml);
    }

    this.dispatchEvent(new CustomEvent('rebuild', {
      detail: { role: this.role, nOutputs, hiddenLayers: [...hiddenLayers] },
    }));
  }

  /** Dispose. Frees the underlying WasmIML. Idempotent. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._ready = false;
    const iml = this._iml;
    this._iml = null;
    this._disposeIml(iml);
  }

  _disposeIml(iml) {
    if (!iml) return;
    // Prefer destroy (WasmIML). Tolerate dispose() too for the test fake.
    if (typeof iml.destroy === 'function') iml.destroy();
    else if (typeof iml.dispose === 'function') iml.dispose();
  }

  // ---------------------------------------------------------------------------
  // Inference
  // ---------------------------------------------------------------------------

  /**
   * Run a forward pass. Caches the result; returns Float32Array of length nOutputs.
   * @param {number[]|Float32Array} inputs
   */
  async infer(inputs) {
    this._assertReady('infer');
    if (!inputs || inputs.length < this.nInputs) {
      throw new Error(`MLPManager[${this.role}]: infer needs ${this.nInputs} inputs`);
    }
    this._iml.setInputs(inputs);
    this._iml.process();
    const raw = this._iml.getOutputs();
    // WasmIML returns Array; normalise to Float32Array for downstream perf.
    const out = new Float32Array(this.nOutputs);
    for (let i = 0; i < this.nOutputs; i++) out[i] = raw[i] ?? 0;
    this._lastOutputs = out;
    return out;
  }

  /** Latest cached outputs, or null if no infer has run since init/rebuild. */
  getLastOutputs() {
    return this._lastOutputs;
  }

  // ---------------------------------------------------------------------------
  // Dataset
  // ---------------------------------------------------------------------------

  addExample(inputs, outputs) {
    this._assertReady('addExample');
    this._iml.addExample(Array.from(inputs), Array.from(outputs));
    this._exampleCount++;
  }

  exampleCount() {
    return this._exampleCount;
  }

  /**
   * Clear the dataset. WasmIML exposes `clearDataset()`; mirror that.
   * Falls back to a noisy warning + full rebuild if the method disappears
   * (defensive; shouldn't happen with current nisps-wasm.js).
   */
  clearExamples() {
    this._assertReady('clearExamples');
    if (typeof this._iml.clearDataset === 'function') {
      this._iml.clearDataset();
      this._exampleCount = 0;
      return;
    }
    // Degraded path: unknown how to clear; surface + reset local counter.
    console.warn(`MLPManager[${this.role}]: underlying instance has no clearDataset(); counter reset only.`);
    this._exampleCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Training
  // ---------------------------------------------------------------------------

  /**
   * Train off the main thread (WasmIML's trainAsync uses a Worker). Resolves
   * with `{ loss }`. If WasmIML can't start training (empty dataset, already
   * training), resolves with { loss: null }.
   */
  async train() {
    this._assertReady('train');
    return new Promise((resolve) => {
      let settled = false;
      const settle = (loss) => {
        if (settled) return;
        settled = true;
        resolve({ loss });
      };
      const prom = this._iml.trainAsync(({ loss } = {}) => {
        settle(typeof loss === 'number' ? loss : null);
      });
      // trainAsync returns a Promise too; if it resolves with null (empty dataset
      // etc.) the callback never fires, so await it as a fallback.
      if (prom && typeof prom.then === 'function') {
        prom.then((loss) => {
          if (loss === null || loss === undefined) settle(null);
          else settle(typeof loss === 'number' ? loss : null);
        }, () => settle(null));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Weight ops
  // ---------------------------------------------------------------------------

  randomiseWeights(spread = 0.6) {
    this._assertReady('randomiseWeights');
    this._iml.randomiseWeights(spread);
  }

  moveWeights(speed, spread, pinMask) {
    this._assertReady('moveWeights');
    this._iml.moveWeights(speed, spread, pinMask || null);
  }

  // ---------------------------------------------------------------------------
  // State import/export
  // ---------------------------------------------------------------------------

  /**
   * Returns a plain serialisable snapshot: { arch, weights }.
   * `arch = { nInputs, nOutputs, hiddenLayers }`
   * `weights` is a Float32Array of all flat weights.
   */
  exportState() {
    this._assertReady('exportState');
    const weights = this._readFlatWeights();
    return {
      arch: {
        nInputs: this.nInputs,
        nOutputs: this.nOutputs,
        hiddenLayers: [...this.hiddenLayers],
      },
      weights: new Float32Array(weights),
    };
  }

  /**
   * Import a previously-exported snapshot. If the arch differs from the current
   * network, rebuild before installing weights.
   */
  async importState({ arch, weights }) {
    this._assertReady('importState');
    if (!arch || !weights) throw new Error(`MLPManager[${this.role}]: importState needs { arch, weights }`);
    const archChanged =
      arch.nInputs !== this.nInputs ||
      arch.nOutputs !== this.nOutputs ||
      arch.hiddenLayers.length !== this.hiddenLayers.length ||
      arch.hiddenLayers.some((n, i) => n !== this.hiddenLayers[i]);

    if (archChanged) {
      // nInputs change isn't something we advertise; still respect it.
      if (arch.nInputs !== this.nInputs) this.nInputs = arch.nInputs;
      await this.rebuild({ nOutputs: arch.nOutputs, hiddenLayers: arch.hiddenLayers });
    }

    this._writeFlatWeights(Array.from(weights));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  _readFlatWeights() {
    const iml = this._iml;
    if (typeof iml._getFlatWeights === 'function') return iml._getFlatWeights();
    if (typeof iml.getFlatWeights === 'function') return iml.getFlatWeights();
    if (typeof iml.extractWeights === 'function') return iml.extractWeights().weights;
    throw new Error(`MLPManager[${this.role}]: underlying instance exposes no weight getter`);
  }

  _writeFlatWeights(flat) {
    const iml = this._iml;
    if (typeof iml._setFlatWeights === 'function') return iml._setFlatWeights(flat);
    if (typeof iml.setFlatWeights === 'function') return iml.setFlatWeights(flat);
    throw new Error(`MLPManager[${this.role}]: underlying instance exposes no weight setter`);
  }

  _assertReady(op) {
    if (this._disposed) throw new Error(`MLPManager[${this.role}]: ${op}() after dispose()`);
    if (!this._ready || !this._iml) {
      throw new Error(`MLPManager[${this.role}]: ${op}() before init() resolved`);
    }
  }
}
