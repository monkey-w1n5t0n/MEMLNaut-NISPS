// DualMLPManager — coordinates two independent MLPManagers (rhythm + CV)
// driven by the left and right gamepad sticks respectively.
//
// Stick inputs are always 2D; each MLP has its own output count + hidden
// architecture. Unified "thumbs up" trains both; "thumbs down" jitters both
// weight sets. Stick positions are cached even across rebuilds so downstream
// consumers always have a recent (x,y) to work with.

import { MLPManager } from './mlp-manager.js';

export class DualMLPManager extends EventTarget {
  /**
   * @param {Object} opts
   * @param {{nOutputs:number, hiddenLayers:number[]}} opts.rhythmArch
   * @param {{nOutputs:number, hiddenLayers:number[]}} opts.cvArch
   * @param {Function} [opts._wasmImlFactory] - test seam, forwarded to each MLPManager
   */
  constructor({ rhythmArch, cvArch, _wasmImlFactory } = {}) {
    super();
    if (!rhythmArch) throw new Error('DualMLPManager: rhythmArch required');
    if (!cvArch) throw new Error('DualMLPManager: cvArch required');

    this._wasmImlFactory = _wasmImlFactory;

    this.rhythm = new MLPManager({
      role: 'rhythm',
      nInputs: 2,
      nOutputs: rhythmArch.nOutputs,
      hiddenLayers: rhythmArch.hiddenLayers,
      _wasmImlFactory,
    });
    this.cv = new MLPManager({
      role: 'cv',
      nInputs: 2,
      nOutputs: cvArch.nOutputs,
      hiddenLayers: cvArch.hiddenLayers,
      _wasmImlFactory,
    });

    // Cached stick positions — survive rebuilds.
    this._leftXY = { x: 0.5, y: 0.5 };
    this._rightXY = { x: 0.5, y: 0.5 };

    this._ready = false;
    this._disposed = false;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init() {
    if (this._disposed) throw new Error('DualMLPManager: cannot init after dispose');
    if (this._ready) return;
    await Promise.all([this.rhythm.init(), this.cv.init()]);
    this._ready = true;
    this.dispatchEvent(new CustomEvent('ready'));
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._ready = false;
    this.rhythm.dispose();
    this.cv.dispose();
  }

  // ---------------------------------------------------------------------------
  // Stick input
  // ---------------------------------------------------------------------------

  /**
   * Update left-stick axes + run rhythm inference. Caches outputs.
   * If rhythm is mid-rebuild, caches the axes and silently skips inference —
   * the next setGamepadLeftAxes post-rebuild will catch up.
   */
  async setGamepadLeftAxes(x, y) {
    this._leftXY = { x, y };
    if (!this.rhythm._ready) return;
    const outputs = await this.rhythm.infer([x, y]);
    this.dispatchEvent(new CustomEvent('rhythmoutputs', {
      detail: { outputs, inputs: { x, y } },
    }));
  }

  async setGamepadRightAxes(x, y) {
    this._rightXY = { x, y };
    if (!this.cv._ready) return;
    const outputs = await this.cv.infer([x, y]);
    this.dispatchEvent(new CustomEvent('cvoutputs', {
      detail: { outputs, inputs: { x, y } },
    }));
  }

  getRhythmOutputs() { return this.rhythm.getLastOutputs(); }
  getCVOutputs() { return this.cv.getLastOutputs(); }

  /** Latest known stick positions, regardless of whether inference ran. */
  getCurrentInputs() {
    return {
      rhythm: { ...this._leftXY },
      cv: { ...this._rightXY },
    };
  }

  // ---------------------------------------------------------------------------
  // Training
  // ---------------------------------------------------------------------------

  /**
   * Capture an example on both MLPs using their current inputs + last outputs,
   * then train both (in parallel via Worker).
   *
   * If either side has no prior output cached (never inferred since init/rebuild),
   * runs a fresh inference first so addExample has something to capture.
   *
   * Dispatches 'trainingdone' with { rhythmLoss, cvLoss }.
   */
  async thumbsUp() {
    this._assertReady('thumbsUp');

    // Ensure both sides have cached outputs before capturing.
    if (!this.rhythm.getLastOutputs()) {
      await this.rhythm.infer([this._leftXY.x, this._leftXY.y]);
    }
    if (!this.cv.getLastOutputs()) {
      await this.cv.infer([this._rightXY.x, this._rightXY.y]);
    }

    const rOut = this.rhythm.getLastOutputs();
    const cOut = this.cv.getLastOutputs();

    this.rhythm.addExample([this._leftXY.x, this._leftXY.y], Array.from(rOut));
    this.cv.addExample([this._rightXY.x, this._rightXY.y], Array.from(cOut));

    const [r, c] = await Promise.all([this.rhythm.train(), this.cv.train()]);
    const detail = { rhythmLoss: r?.loss ?? null, cvLoss: c?.loss ?? null };
    this.dispatchEvent(new CustomEvent('trainingdone', { detail }));
    return detail;
  }

  /**
   * Jitter weights on both MLPs. Dispatches 'weightsmoved'.
   * @param {number} noise - magnitude, passed as `speed` to moveWeights
   */
  async thumbsDown(noise = 0.3) {
    this._assertReady('thumbsDown');
    this.rhythm.moveWeights(noise, noise);
    this.cv.moveWeights(noise, noise);
    this.dispatchEvent(new CustomEvent('weightsmoved', { detail: { noise } }));
  }

  clearExamples() {
    this._assertReady('clearExamples');
    this.rhythm.clearExamples();
    this.cv.clearExamples();
  }

  // ---------------------------------------------------------------------------
  // Architecture changes
  // ---------------------------------------------------------------------------

  async rebuildRhythm({ nOutputs, hiddenLayers }) {
    this._assertReady('rebuildRhythm');
    await this.rhythm.rebuild({ nOutputs, hiddenLayers });
  }

  async rebuildCV({ nOutputs, hiddenLayers }) {
    this._assertReady('rebuildCV');
    await this.cv.rebuild({ nOutputs, hiddenLayers });
  }

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------

  exportSession() {
    this._assertReady('exportSession');
    return {
      version: 1,
      rhythm: this.rhythm.exportState(),
      cv: this.cv.exportState(),
    };
  }

  async importSession(state) {
    this._assertReady('importSession');
    if (!state || state.version !== 1) {
      throw new Error('DualMLPManager.importSession: invalid or unsupported version');
    }
    await this.rhythm.importState(state.rhythm);
    await this.cv.importState(state.cv);
  }

  // ---------------------------------------------------------------------------
  _assertReady(op) {
    if (this._disposed) throw new Error(`DualMLPManager: ${op}() after dispose`);
    if (!this._ready) throw new Error(`DualMLPManager: ${op}() before init()`);
  }
}
