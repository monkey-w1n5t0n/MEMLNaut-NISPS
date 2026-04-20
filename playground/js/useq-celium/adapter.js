// UseqCeliumAdapter — uSEQ-Celium as a SynthEngine-shaped peer in the
// a-immersive engine/output-mode switcher.
//
// This mode does NOT produce audio: the adapter exists to own the lifecycle
// of the WebSerial bridge + the state-snapshot producer and to present the
// same surface (init/stop/setParam/displayName/id) that other engines do,
// so the rest of a-app.js doesn't need to special-case it.
//
// Round 3 composition: the adapter also owns the lifecycle of the
// DualMLPManager + VoiceEngine + ChannelRouter + UseqCeliumComposer, and
// mounts the mode UI (arch / training / bpm / routing) into the drawer when
// the mode becomes active.

import { UseqSerialBridge } from './serial-bridge.js';
import { StateProducer } from './state-producer.js';
import { DualMLPManager } from './dual-mlp.js';
import { VoiceEngine, PARAMS_PER_VOICE } from './voice-engine.js';
import { ChannelRouter } from './routing.js';
import { UseqCeliumComposer } from './composer.js';
import { mountArchUI } from './arch-ui.js';
import { mountTrainingUI } from './training-ui.js';
import { mountRoutingUI } from './routing-ui.js';

const DEFAULT_RHYTHM_HIDDEN = [16, 24];
const DEFAULT_CV_HIDDEN = [24, 32];
const DEFAULT_CV_NOUTPUTS = 11;

/** Safety: all-zero snapshot — gates low, every CV at 0. */
function zeroSnapshot() {
  return {
    gates: [false, false, false],
    cvMain: [0, 0, 0],
    cvExp: [0, 0, 0, 0, 0, 0, 0, 0],
  };
}

export class UseqCeliumAdapter {
  constructor() {
    this._bridge = null;
    this._producer = null;
    this._connectionCallbacks = new Set();
    this._connected = false;

    // Round-3 composition handles
    this._dualMlp = null;
    this._voiceEngine = null;
    this._router = null;
    this._composer = null;

    // UI handles (set during activate())
    this._archUI = null;
    this._trainingUI = null;
    this._routingUI = null;
    this._bpmUIDestroy = null;

    // Kept so activate() is idempotent w.r.t. the drawer.
    this._drawer = null;
    this._activated = false;

    // Panic state (opus47 final round): when panicked, the snapshot source is
    // replaced with zeros until resume() restores the composer source. Never
    // persisted.
    this._panicked = false;
    this._panicCallbacks = new Set();
    this._onKeyDown = null; // bound escape-to-panic handler, set in activate()
  }

  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  get id() { return 'useq-celium'; }
  get displayName() { return 'uSEQ-Celium'; }

  /**
   * No MLP-driven params are exposed through the SynthEngine interface —
   * routing is handled internally by the composer.
   */
  get paramMeta() { return []; }

  get paramCount() { return this.paramMeta.length; }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Construct bridge + producer. Both stay idle until the user clicks Connect.
   * The audioCtx argument is accepted for SynthEngine interface parity and
   * ignored — this mode doesn't produce audio.
   *
   * Idempotent.
   *
   * @param {AudioContext|null} _audioCtx
   */
  async init(_audioCtx) {
    if (this._bridge) return; // already initialised

    this._bridge = new UseqSerialBridge();
    this._bridge.addEventListener('connectionchange', (e) => {
      this._connected = !!e.detail?.connected;
      // If the port drops unexpectedly while the producer is running, stop it.
      if (!this._connected && this._producer?.running) {
        this._producer.stop();
      }
      for (const cb of this._connectionCallbacks) {
        try { cb(this._connected); }
        catch (err) { console.warn('[UseqCeliumAdapter] connection cb threw:', err); }
      }
    });

    this._producer = new StateProducer(this._bridge);

    // If a snapshot source was registered before init(), apply it now.
    if (this._pendingSource) {
      this._producer.setSource(this._pendingSource);
      this._pendingSource = null;
    }
  }

  /**
   * Stop the producer and close the serial port. Idempotent.
   */
  async stop() {
    if (this._producer) this._producer.stop();
    if (this._bridge) await this._bridge.disconnect();
  }

  dispose() {
    // Hard teardown: producer handle + bridge handle dropped.
    if (this._producer) this._producer.stop();
    this._producer = null;
    this._bridge = null;
    this._connectionCallbacks.clear();
  }

  get running() {
    return this._connected;
  }

  // ---------------------------------------------------------------------------
  // UI-facing actions (invoked by the mode drawer)
  // ---------------------------------------------------------------------------

  /** Prompt for port + start the 500Hz producer. Throws on failure. */
  async connect() {
    if (!this._bridge) await this.init(null);
    await this._bridge.connect();
    this._producer.start();
  }

  /** Stop producer + close port. Alias for stop() for UI symmetry. */
  async disconnect() {
    await this.stop();
  }

  // ---------------------------------------------------------------------------
  // Real-time control (routed internally via composer)
  // ---------------------------------------------------------------------------

  /** Composer owns the state-snapshot pipeline; setParam is unused here. */
  setParam(_index, _value) { /* no-op: routed via composer */ }

  noteOn(_note, _velocity = 0.7) { /* no-op: uSEQ-Celium is gate/CV */ }
  noteOff(_note) { /* no-op */ }

  /** SynthEngine parity — nothing to connect downstream since we have no audio. */
  getOutputNode() { return null; }

  // ---------------------------------------------------------------------------
  // Round-3 composition — activate / deactivate mode UI + pipeline
  // ---------------------------------------------------------------------------

  /**
   * Activate uSEQ-Celium mode: construct the dual-MLP, voice engine, router,
   * composer; mount ArchUI + TrainingUI + BPM slider + RoutingUI into the
   * drawer. Idempotent.
   *
   * @param {HTMLElement} drawerElement  the <div id="drawer-useq-celium"> (or its body)
   */
  async activate(drawerElement) {
    if (this._activated) return;
    if (!this._bridge) await this.init(null);

    // 1. Construct pipeline pieces.
    this._dualMlp = new DualMLPManager({
      rhythmArch: {
        nOutputs: 4 * PARAMS_PER_VOICE, // 4 voices × 7 params
        hiddenLayers: [...DEFAULT_RHYTHM_HIDDEN],
      },
      cvArch: {
        nOutputs: DEFAULT_CV_NOUTPUTS,
        hiddenLayers: [...DEFAULT_CV_HIDDEN],
      },
    });
    await this._dualMlp.init();

    this._voiceEngine = new VoiceEngine({ bpm: 120, voiceCount: 4 });
    this._router = new ChannelRouter(null);

    this._composer = new UseqCeliumComposer({
      adapter: this,
      dualMlp: this._dualMlp,
      voiceEngine: this._voiceEngine,
      router: this._router,
    });

    // 2. Mount UI (only if we got a drawer — tests may skip this).
    this._drawer = drawerElement || null;
    if (drawerElement) {
      this._mountUI(drawerElement);
    }

    // 3. Start composer (subscribes to events + registers snapshot source).
    this._composer.start();
    this._activated = true;

    // 4. Global Escape-to-panic while the mode is active. Stored so we can
    //    detach in deactivate().
    if (typeof document !== 'undefined') {
      this._onKeyDown = (e) => {
        if (e.key !== 'Escape') return;
        const drawer = this._drawer;
        // Only panic if the drawer is visible — keeps Escape free elsewhere.
        if (drawer && drawer.classList && drawer.classList.contains('hidden')) return;
        this.panic();
      };
      document.addEventListener('keydown', this._onKeyDown);
    }
  }

  /**
   * Deactivate: stop the composer, destroy UIs, dispose the dual-MLP. Leaves
   * the serial bridge alone (user may reconnect). Idempotent.
   */
  async deactivate() {
    if (!this._activated) return;
    this._activated = false;

    // Unwire panic state + key listener.
    this._panicked = false;
    if (this._onKeyDown && typeof document !== 'undefined') {
      document.removeEventListener('keydown', this._onKeyDown);
      this._onKeyDown = null;
    }

    if (this._composer) this._composer.stop();

    // Unmount UIs before tearing down state they reference.
    if (this._archUI) { try { this._archUI.destroy(); } catch { /* no-op */ } this._archUI = null; }
    if (this._trainingUI) { try { this._trainingUI.destroy(); } catch { /* no-op */ } this._trainingUI = null; }
    if (this._routingUI) { try { this._routingUI.destroy(); } catch { /* no-op */ } this._routingUI = null; }
    if (this._bpmUIDestroy) { try { this._bpmUIDestroy(); } catch { /* no-op */ } this._bpmUIDestroy = null; }

    // Unwire panic buttons.
    if (this._panicBtn && this._panicOnClick) {
      try { this._panicBtn.removeEventListener('click', this._panicOnClick); } catch { /* no-op */ }
    }
    if (this._resumeBtn && this._resumeOnClick) {
      try { this._resumeBtn.removeEventListener('click', this._resumeOnClick); } catch { /* no-op */ }
    }
    if (this._panicUnsub) { try { this._panicUnsub(); } catch { /* no-op */ } this._panicUnsub = null; }
    if (this._resumeBtn) this._resumeBtn.style.display = 'none';
    if (this._panicBtn) this._panicBtn.style.display = '';
    this._panicBtn = null;
    this._resumeBtn = null;
    this._panicOnClick = null;
    this._resumeOnClick = null;

    if (this._dualMlp) {
      try { this._dualMlp.dispose(); } catch { /* no-op */ }
    }
    this._dualMlp = null;
    this._voiceEngine = null;
    this._router = null;
    this._composer = null;
    this._drawer = null;
  }

  // ---------------------------------------------------------------------------
  // Composer proxies
  // ---------------------------------------------------------------------------

  getBPM() {
    return this._composer ? this._composer.getBPM() : 120;
  }

  setBPM(bpm) {
    if (!this._composer) return;
    this._composer.setBPM(bpm);
  }

  // ---------------------------------------------------------------------------
  // Panic / resume (safety)
  // ---------------------------------------------------------------------------

  /**
   * Safety: override the snapshot source with a zero source, force-send one
   * zero frame immediately, and leave the bridge connected. The composer is
   * left running (its source is temporarily replaced) so resume() can restore
   * it cheaply. Panic state is NOT persisted.
   */
  panic() {
    if (!this._producer) {
      // Even without a producer, flip the flag + notify so UI reflects state.
      this._panicked = true;
      this._notifyPanic(true);
      return;
    }
    // Replace the producer's source directly so the composer remains untouched.
    this._producer.setSource(zeroSnapshot);
    // Force-send one zero frame immediately (not waiting for next tick). The
    // producer's _tick is private; the public path is to call it via a fresh
    // writePacket on the bridge. Easiest + safe: construct zeros, encode, write.
    if (this._bridge && this._connected) {
      try {
        // Lazy-import encodeStateSnapshot without adding a top-level dep shuffle.
        import('./protocol.js').then(({ encodeStateSnapshot }) => {
          const z = zeroSnapshot();
          const gates = z.gates.map((g) => (g ? 1 : 0));
          const pkt = encodeStateSnapshot(0, gates, z.cvMain, z.cvExp);
          // Fire-and-forget; if the port is gone the bridge will reject and
          // we'll have done our best.
          return this._bridge.writePacket(pkt);
        }).catch((err) => {
          console.warn('[UseqCeliumAdapter] panic immediate write failed:', err);
        });
      } catch (err) {
        console.warn('[UseqCeliumAdapter] panic immediate write threw:', err);
      }
    }
    this._panicked = true;
    this._notifyPanic(true);
  }

  /**
   * Resume normal output: re-register the composer's snapshot source (if the
   * composer is running), clear the panic flag, notify subscribers.
   */
  resume() {
    if (!this._panicked) return;
    this._panicked = false;
    if (this._composer && this._composer.running) {
      // Bounce the composer to re-register its snapshot source. composer.stop()
      // detaches dualMlp listeners + gamepad poll + calls setSnapshotSource(null);
      // composer.start() re-attaches them. Cheap relative to a panic event.
      try {
        this._composer.stop();
        this._composer.start();
      } catch (err) {
        console.warn('[UseqCeliumAdapter] composer bounce on resume failed:', err);
        this._producer.setSource(null);
      }
    } else {
      // No composer — revert to defaultSource (zeros).
      this._producer.setSource(null);
    }
    this._notifyPanic(false);
  }

  get panicked() { return this._panicked; }

  /**
   * Subscribe to panic-state changes. Callback fires with `true` on panic,
   * `false` on resume. Returns an unsubscribe fn.
   */
  onPanicChange(cb) {
    if (typeof cb !== 'function') return () => {};
    this._panicCallbacks.add(cb);
    return () => this._panicCallbacks.delete(cb);
  }

  _notifyPanic(state) {
    for (const cb of this._panicCallbacks) {
      try { cb(!!state); }
      catch (err) { console.warn('[UseqCeliumAdapter] panic cb threw:', err); }
    }
  }

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------

  /**
   * Serialise full session state: bpm, voiceCount, per-MLP hidden layers,
   * routing configs, and MLP weights.
   *
   * Safe to call only after activate() (requires composer + dualMlp).
   */
  exportSession() {
    if (!this._composer || !this._dualMlp) {
      throw new Error('UseqCeliumAdapter.exportSession: activate() first');
    }
    return {
      version: 1,
      bpm: this._composer.getBPM(),
      voiceCount: this._composer.getVoiceCount(),
      rhythmHidden: this._composer.getCurrentRhythmHidden(),
      cvHidden: this._composer.getCurrentCvHidden(),
      routing: this._router.getAllConfigs(),
      mlps: this._dualMlp.exportSession(),
    };
  }

  /**
   * Restore session state. Tolerant of missing fields — anything absent keeps
   * the current value.
   */
  async importSession(state) {
    if (!this._composer || !this._dualMlp) {
      throw new Error('UseqCeliumAdapter.importSession: activate() first');
    }
    if (!state || typeof state !== 'object') return;

    // MLPs first — architecture changes here rebuild, so routing validity for
    // cv-mlp indices needs to follow.
    if (state.mlps) {
      try { await this._dualMlp.importSession(state.mlps); }
      catch (err) { console.warn('[UseqCeliumAdapter] mlp import failed:', err); }
    }

    if (Number.isFinite(state.bpm)) {
      try { this._composer.setBPM(state.bpm); } catch { /* no-op */ }
    }

    if (Number.isInteger(state.voiceCount)) {
      try { await this._composer.setVoiceCount(state.voiceCount); } catch { /* no-op */ }
    }

    if (Array.isArray(state.routing)) {
      try { this._router.importConfigs(state.routing); }
      catch (err) { console.warn('[UseqCeliumAdapter] routing import failed:', err); }
    }

    // Refresh mounted UIs to reflect the loaded state.
    if (this._routingUI) this._routingUI.refresh();
    if (this._archUI && this._archUI.setDefaults) {
      this._archUI.setDefaults({
        rhythm: {
          voiceCount: this._composer.getVoiceCount(),
          hiddenLayers: this._composer.getCurrentRhythmHidden(),
        },
        cv: {
          nOutputs: this._dualMlp.cv?.nOutputs ?? DEFAULT_CV_NOUTPUTS,
          hiddenLayers: this._composer.getCurrentCvHidden() || DEFAULT_CV_HIDDEN,
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Extension points
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to bridge connection state changes.
   * Callback fires with `true` on connect, `false` on disconnect.
   * Returns an unsubscribe fn.
   */
  onConnectionChange(cb) {
    if (typeof cb !== 'function') return () => {};
    this._connectionCallbacks.add(cb);
    return () => this._connectionCallbacks.delete(cb);
  }

  /**
   * ESCAPE HATCH: manually register a frame source, overriding the composer's.
   * Tests use this to inject a fake. Passing `null` reverts to zeros.
   * When activate() is called later, the composer will overwrite this.
   */
  setSnapshotSource(sourceFn) {
    if (!this._producer) {
      this._pendingSource = sourceFn;
      return;
    }
    this._producer.setSource(sourceFn);
  }

  // ---------------------------------------------------------------------------
  // Introspection
  // ---------------------------------------------------------------------------

  get bridge() { return this._bridge; }
  get producer() { return this._producer; }
  get connected() { return this._connected; }
  get dualMlp() { return this._dualMlp; }
  get voiceEngine() { return this._voiceEngine; }
  get router() { return this._router; }
  get composer() { return this._composer; }

  /** True iff WebSerial is available in the current browser. */
  static isSupported() {
    return UseqSerialBridge.isSupported();
  }

  // ---------------------------------------------------------------------------
  // Private: UI mounting
  // ---------------------------------------------------------------------------

  _mountUI(drawerElement) {
    // Look for child containers. The drawer HTML may wrap these in an inner
    // drawer-body; try the body first, fall back to the drawer itself.
    const body = drawerElement.querySelector('#useq-celium-panel') || drawerElement;

    const archContainer = body.querySelector('#useq-arch-container');
    const trainingContainer = body.querySelector('#useq-training-container');
    const bpmContainer = body.querySelector('#useq-bpm-container');
    const routingContainer = body.querySelector('#useq-routing-container');

    // Panic / resume buttons (safety).
    const panicBtn = body.querySelector('#useq-panic-btn');
    const resumeBtn = body.querySelector('#useq-resume-btn');
    const statusEl = body.querySelector('#useq-status');
    if (panicBtn && resumeBtn) {
      this._panicBtn = panicBtn;
      this._resumeBtn = resumeBtn;
      this._prevStatusText = statusEl ? statusEl.textContent : '';
      this._panicOnClick = () => this.panic();
      this._resumeOnClick = () => this.resume();
      panicBtn.addEventListener('click', this._panicOnClick);
      resumeBtn.addEventListener('click', this._resumeOnClick);
      this._panicUnsub = this.onPanicChange((state) => {
        panicBtn.style.display = state ? 'none' : '';
        resumeBtn.style.display = state ? '' : 'none';
        if (statusEl) {
          if (state) {
            this._prevStatusText = statusEl.textContent;
            statusEl.textContent = 'PANIC — outputs zeroed';
          } else {
            // Let the connection callback repaint if connected; otherwise clear.
            statusEl.textContent = this._connected
              ? 'connected — streaming'
              : (this._prevStatusText || 'disconnected');
          }
        }
      });
    }

    if (archContainer) {
      this._archUI = mountArchUI(archContainer, {
        initial: {
          rhythm: {
            voiceCount: this._composer.getVoiceCount(),
            hiddenLayers: this._composer.getCurrentRhythmHidden(),
          },
          cv: {
            nOutputs: this._dualMlp.cv.nOutputs,
            hiddenLayers: this._composer.getCurrentCvHidden() || DEFAULT_CV_HIDDEN,
          },
        },
      });
      archContainer.addEventListener('archchange', async (e) => {
        try { await this._composer.handleArchChange(e.detail); }
        catch (err) { console.warn('[UseqCeliumAdapter] archchange handling failed:', err); }
      });
    }

    if (trainingContainer) {
      this._trainingUI = mountTrainingUI(trainingContainer, this._dualMlp);
    }

    if (bpmContainer) {
      this._bpmUIDestroy = this._mountBPMSlider(bpmContainer);
    }

    if (routingContainer) {
      this._routingUI = mountRoutingUI(routingContainer, this._router, {
        voiceCount: this._composer.getVoiceCount(),
        onChange: () => this._composer.notifyRoutingChange(),
      });
      // Keep routing-ui's voice lists in sync when voiceCount changes.
      this._composer.addEventListener('archchange', (ev) => {
        if (ev?.detail?.role === 'rhythm' && this._routingUI) {
          this._routingUI.setVoiceCount(this._composer.getVoiceCount());
        }
      });
    }
  }

  _mountBPMSlider(container) {
    container.innerHTML = '';
    container.classList.add('useq-bpm-ui');
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    wrap.style.fontSize = '12px';
    wrap.style.fontFamily = 'sans-serif';
    wrap.style.padding = '4px 0';

    const label = document.createElement('label');
    label.textContent = 'BPM';
    label.style.minWidth = '32px';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '30';
    slider.max = '300';
    slider.step = '1';
    slider.value = String(Math.round(this._composer.getBPM()));
    slider.style.flex = '1';

    const readout = document.createElement('span');
    readout.style.minWidth = '36px';
    readout.style.fontFamily = 'monospace';
    readout.textContent = slider.value;

    wrap.appendChild(label);
    wrap.appendChild(slider);
    wrap.appendChild(readout);
    container.appendChild(wrap);

    const onInput = () => {
      const v = parseInt(slider.value, 10);
      if (Number.isFinite(v)) {
        this._composer.setBPM(v);
        readout.textContent = String(v);
      }
    };
    slider.addEventListener('input', onInput);

    const onBPMChange = (e) => {
      const v = Math.round(e?.detail?.bpm ?? this._composer.getBPM());
      if (String(v) !== slider.value) {
        slider.value = String(v);
        readout.textContent = String(v);
      }
    };
    this._composer.addEventListener('bpmchange', onBPMChange);

    return () => {
      slider.removeEventListener('input', onInput);
      if (this._composer) this._composer.removeEventListener('bpmchange', onBPMChange);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      container.classList.remove('useq-bpm-ui');
    };
  }
}
