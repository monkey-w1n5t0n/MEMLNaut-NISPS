// UseqCeliumComposer — orchestration layer for uSEQ-Celium browser mode.
//
// Binds together:
//   - adapter (UseqCeliumAdapter) — owns the serial bridge + StateProducer
//   - dualMlp (DualMLPManager)   — rhythm + CV MLPs driven by gamepad sticks
//   - voiceEngine (VoiceEngine)  — bar-phasor + ratioSeq rhythm generator
//   - router (ChannelRouter)     — per-channel routing from voices/CVs → wire
//   - gamepad (GamepadInput?)    — optional; if absent we poll navigator.getGamepads
//
// Responsibilities:
//   1. Route gamepad-stick input into the dual-MLP.
//   2. Re-shape the rhythm MLP whenever voiceCount changes.
//   3. On every 'rhythmoutputs' event, feed the rhythm MLP output back into
//      voiceEngine.updateParams() so the next tick uses fresh params.
//   4. Register a snapshot-source fn with the adapter that, per producer tick,
//      advances the voice engine, reads cached CV outputs, runs routing, and
//      returns {gates, cvMain, cvExp} for the wire.
//   5. Forward events (archchange, routingchange, trainingdone, weightsmoved,
//      bpmchange) outward so the UI can react.
//
// Does NOT:
//   - own any DOM. The adapter assembles the UI; this module is pure logic.
//   - know anything about the wire protocol — that's the adapter's territory.

const DEFAULT_RHYTHM_HIDDEN = [16, 24];
const MIN_BPM = 30;
const MAX_BPM = 300;

export class UseqCeliumComposer extends EventTarget {
  /**
   * @param {object} deps
   * @param {object} deps.adapter      UseqCeliumAdapter instance
   * @param {object} deps.dualMlp      DualMLPManager (already init()-ed)
   * @param {object} deps.voiceEngine  VoiceEngine
   * @param {object} deps.router       ChannelRouter
   * @param {object} [deps.gamepad]    Optional GamepadInput; if omitted we poll
   */
  constructor({ adapter, dualMlp, voiceEngine, router, gamepad } = {}) {
    super();
    if (!adapter) throw new Error('UseqCeliumComposer: adapter required');
    if (!dualMlp) throw new Error('UseqCeliumComposer: dualMlp required');
    if (!voiceEngine) throw new Error('UseqCeliumComposer: voiceEngine required');
    if (!router) throw new Error('UseqCeliumComposer: router required');

    this._adapter = adapter;
    this._dualMlp = dualMlp;
    this._voiceEngine = voiceEngine;
    this._router = router;
    this._gamepad = gamepad || null;

    this._currentRhythmHidden = [...DEFAULT_RHYTHM_HIDDEN];
    this._currentCvHidden = null; // filled lazily from dualMlp config at start()
    this._lastTickTime = null;
    this._running = false;

    // Internal gamepad polling fallback (only used when no gamepad passed in).
    this._rafHandle = null;
    this._leftPrev = { x: -1, y: -1 };
    this._rightPrev = { x: -1, y: -1 };

    // Bound handlers (so add/remove pairs match).
    this._onRhythmOutputs = this._onRhythmOutputs.bind(this);
    this._onTrainingDone = this._onTrainingDone.bind(this);
    this._onWeightsMoved = this._onWeightsMoved.bind(this);
    this._onVoiceCountChange = this._onVoiceCountChange.bind(this);
    this._snapshotSource = this._snapshotSource.bind(this);
    this._pollGamepads = this._pollGamepads.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTickTime = null;

    // Capture current CV hidden-layer shape from dualMlp for session export.
    if (this._dualMlp.cv && Array.isArray(this._dualMlp.cv.hiddenLayers)) {
      this._currentCvHidden = [...this._dualMlp.cv.hiddenLayers];
    }
    if (this._dualMlp.rhythm && Array.isArray(this._dualMlp.rhythm.hiddenLayers)) {
      this._currentRhythmHidden = [...this._dualMlp.rhythm.hiddenLayers];
    }

    // Subscribe to dualMlp events.
    this._dualMlp.addEventListener('rhythmoutputs', this._onRhythmOutputs);
    this._dualMlp.addEventListener('trainingdone', this._onTrainingDone);
    this._dualMlp.addEventListener('weightsmoved', this._onWeightsMoved);

    // Subscribe to voice-count changes.
    this._voiceEngine.addEventListener('voiceCountChange', this._onVoiceCountChange);

    // Bridge gamepad → dualMlp. If a preconfigured GamepadInput was passed in,
    // use its onMove. Otherwise set up our own rAF-driven polling across both sticks.
    if (this._gamepad) {
      // Respect any existing callback: wrap it so both fire.
      const prev = this._gamepad.onMove;
      this._gamepad.onMove = (x, y) => {
        try { if (typeof prev === 'function') prev(x, y); }
        catch (err) { console.warn('[UseqCeliumComposer] user onMove threw:', err); }
        // Caller-supplied gamepad only maps to one stick; default: left.
        this._handleLeftStick(x, y);
      };
    } else if (typeof globalThis.requestAnimationFrame === 'function') {
      // Use navigator.getGamepads polling. Handles both sticks simultaneously.
      this._rafHandle = globalThis.requestAnimationFrame(this._pollGamepads);
    }

    // Register snapshot source with the adapter.
    this._adapter.setSnapshotSource(this._snapshotSource);
  }

  stop() {
    if (!this._running) return;
    this._running = false;

    this._dualMlp.removeEventListener('rhythmoutputs', this._onRhythmOutputs);
    this._dualMlp.removeEventListener('trainingdone', this._onTrainingDone);
    this._dualMlp.removeEventListener('weightsmoved', this._onWeightsMoved);
    this._voiceEngine.removeEventListener('voiceCountChange', this._onVoiceCountChange);

    if (this._rafHandle !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }

    this._adapter.setSnapshotSource(null);
  }

  get running() { return this._running; }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  getBPM() { return this._voiceEngine.getBPM(); }

  setBPM(bpm) {
    const n = Number(bpm);
    if (!Number.isFinite(n)) throw new Error(`setBPM: not a number: ${bpm}`);
    const clamped = Math.max(MIN_BPM, Math.min(MAX_BPM, n));
    this._voiceEngine.setBPM(clamped);
    this.dispatchEvent(new CustomEvent('bpmchange', { detail: { bpm: clamped } }));
  }

  getVoiceCount() { return this._voiceEngine.getVoiceCount(); }

  /**
   * Change voice count. Triggers rhythm-MLP rebuild (nOutputs = n * 7).
   * Returns after the rebuild completes.
   */
  async setVoiceCount(n) {
    const clamped = Math.max(1, Math.min(4, Math.floor(n)));
    const prev = this._voiceEngine.getVoiceCount();
    if (clamped === prev) return;
    this._voiceEngine.setVoiceCount(clamped); // fires voiceCountChange → rebuilds rhythm MLP
    // We *await* the rebuild by re-triggering it inline so callers can sync on completion.
    await this._ensureRhythmArch(clamped, this._currentRhythmHidden);
  }

  /**
   * Handle an archchange event from arch-ui.
   *
   * @param {{role: 'rhythm'|'cv', nOutputs: number, hiddenLayers: number[], voiceCount?: number}} detail
   */
  async handleArchChange(detail) {
    if (!detail || !detail.role) return;
    if (detail.role === 'rhythm') {
      // arch-ui's voiceCount is authoritative when provided; otherwise infer.
      const vc = Number.isInteger(detail.voiceCount) ? detail.voiceCount : detail.nOutputs;
      this._currentRhythmHidden = [...detail.hiddenLayers];
      this._voiceEngine.setVoiceCount(vc);
      // Wait for rebuild (voiceCountChange handler kicked it off; but also cover the
      // no-change case where voiceCount didn't change but hidden layers did).
      await this._ensureRhythmArch(this._voiceEngine.getVoiceCount(), this._currentRhythmHidden);
    } else if (detail.role === 'cv') {
      this._currentCvHidden = [...detail.hiddenLayers];
      await this._dualMlp.rebuildCV({
        nOutputs: detail.nOutputs,
        hiddenLayers: detail.hiddenLayers,
      });
    }
    this.dispatchEvent(new CustomEvent('archchange', { detail: { ...detail } }));
  }

  /**
   * Emit a routingchange event. Caller (routing-ui's onChange) wires this up.
   * No internal state change — the router already owns the configs.
   */
  notifyRoutingChange() {
    this.dispatchEvent(new CustomEvent('routingchange', {
      detail: { configs: this._router.getAllConfigs() },
    }));
  }

  getCurrentRhythmHidden() { return [...this._currentRhythmHidden]; }
  getCurrentCvHidden() {
    return this._currentCvHidden ? [...this._currentCvHidden] : null;
  }

  // Convenience — used by adapter's exportSession
  get router() { return this._router; }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  async _ensureRhythmArch(voiceCount, hiddenLayers) {
    const nOut = voiceCount * 7; // VoiceEngine.PARAMS_PER_VOICE
    const rhythm = this._dualMlp.rhythm;
    const archMatch = rhythm &&
      rhythm.nOutputs === nOut &&
      Array.isArray(rhythm.hiddenLayers) &&
      rhythm.hiddenLayers.length === hiddenLayers.length &&
      rhythm.hiddenLayers.every((n, i) => n === hiddenLayers[i]);
    if (archMatch) return;
    await this._dualMlp.rebuildRhythm({ nOutputs: nOut, hiddenLayers });
  }

  _onVoiceCountChange(e) {
    // Fire-and-forget rebuild; handleArchChange does the awaited version.
    const vc = e?.detail?.voiceCount ?? this._voiceEngine.getVoiceCount();
    this._ensureRhythmArch(vc, this._currentRhythmHidden).catch((err) => {
      console.warn('[UseqCeliumComposer] rhythm rebuild failed:', err);
    });
  }

  _onRhythmOutputs(e) {
    const outputs = e?.detail?.outputs;
    if (!outputs) return;
    const expected = this._voiceEngine.getVoiceCount() * 7;
    if (outputs.length !== expected) {
      // Rhythm MLP is mid-rebuild or the voice count just changed; skip this frame.
      return;
    }
    try {
      this._voiceEngine.updateParams(outputs);
    } catch (err) {
      console.warn('[UseqCeliumComposer] voiceEngine.updateParams threw:', err);
    }
  }

  _onTrainingDone(e) {
    this.dispatchEvent(new CustomEvent('trainingdone', { detail: e?.detail || {} }));
  }

  _onWeightsMoved(e) {
    this.dispatchEvent(new CustomEvent('weightsmoved', { detail: e?.detail || {} }));
  }

  _handleLeftStick(x, y) {
    this._dualMlp.setGamepadLeftAxes(x, y).catch((err) => {
      console.warn('[UseqCeliumComposer] setGamepadLeftAxes failed:', err);
    });
  }

  _handleRightStick(x, y) {
    this._dualMlp.setGamepadRightAxes(x, y).catch((err) => {
      console.warn('[UseqCeliumComposer] setGamepadRightAxes failed:', err);
    });
  }

  _pollGamepads() {
    if (!this._running) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
        const pads = navigator.getGamepads() || [];
        let gp = null;
        for (const p of pads) { if (p && p.connected) { gp = p; break; } }
        if (gp && gp.axes && gp.axes.length >= 2) {
          const lx = mapAxis(gp.axes[0]);
          const ly = mapAxis(gp.axes[1]);
          if (Math.abs(lx - this._leftPrev.x) > 0.002 || Math.abs(ly - this._leftPrev.y) > 0.002) {
            this._leftPrev = { x: lx, y: ly };
            this._handleLeftStick(lx, ly);
          }
          if (gp.axes.length >= 4) {
            const rx = mapAxis(gp.axes[2]);
            const ry = mapAxis(gp.axes[3]);
            if (Math.abs(rx - this._rightPrev.x) > 0.002 || Math.abs(ry - this._rightPrev.y) > 0.002) {
              this._rightPrev = { x: rx, y: ry };
              this._handleRightStick(rx, ry);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[UseqCeliumComposer] gamepad poll error:', err);
    }
    if (this._running && typeof globalThis.requestAnimationFrame === 'function') {
      this._rafHandle = globalThis.requestAnimationFrame(this._pollGamepads);
    }
  }

  _snapshotSource() {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    let dtMs;
    if (this._lastTickTime === null) dtMs = 0;
    else dtMs = Math.max(0, Math.min(50, now - this._lastTickTime));
    this._lastTickTime = now;

    let voiceState;
    try {
      voiceState = this._voiceEngine.tick(dtMs);
    } catch (err) {
      console.warn('[UseqCeliumComposer] voiceEngine.tick threw:', err);
      voiceState = { gates: [], velocities: [] };
    }

    const cvOutputs = typeof this._dualMlp.getCVOutputs === 'function'
      ? this._dualMlp.getCVOutputs()
      : null;

    return this._router.compute(voiceState, cvOutputs);
  }
}

function mapAxis(v) {
  const n = Number.isFinite(v) ? v : 0;
  const m = (n + 1) * 0.5;
  return m < 0 ? 0 : m > 1 ? 1 : m;
}
