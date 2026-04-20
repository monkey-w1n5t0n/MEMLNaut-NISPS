// UseqCeliumAdapter — uSEQ-Celium as a SynthEngine-shaped peer in the
// a-immersive engine/output-mode switcher.
//
// This mode does NOT produce audio: the adapter exists to own the lifecycle
// of the WebSerial bridge + the state-snapshot producer and to present the
// same surface (init/stop/setParam/displayName/id) that other engines do,
// so the rest of a-app.js doesn't need to special-case it.
//
// Scope at this stage is PLUMBING ONLY:
//   - Connect/disconnect the serial port on demand.
//   - When connected, poll at 500Hz and emit all-zero StateSnapshot packets
//     (observable on the firmware side via pio device monitor).
//   - Leave clearly-labelled extension points where later agents will plug
//     in ratioSeq / phasor / MLP routing.

import { UseqSerialBridge } from './serial-bridge.js';
import { StateProducer } from './state-producer.js';

export class UseqCeliumAdapter {
  constructor() {
    this._bridge = null;
    this._producer = null;
    this._connectionCallbacks = new Set();
    this._connected = false;
  }

  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  get id() { return 'useq-celium'; }
  get displayName() { return 'uSEQ-Celium'; }

  /**
   * No MLP-driven params yet.
   * TODO(opus47): populate in MLP-wiring step. Later agents will expose
   * a param vector for routing (e.g. CV targets, gate triggers, ratioSeq
   * controls) using the same shape as C15Adapter's C15_PARAM_META.
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
  // Real-time control (stub)
  // ---------------------------------------------------------------------------

  /**
   * EXTENSION POINT (opus47): later agents will wire MLP outputs here. For
   * now we warn loudly so an accidental pre-wire is visible in the console.
   */
  setParam(_index, _value) {
    if (!this._warnedSetParam) {
      console.warn('[UseqCeliumAdapter] setParam() called before routing is wired — ignoring.');
      this._warnedSetParam = true;
    }
  }

  noteOn(_note, _velocity = 0.7) { /* no-op: uSEQ-Celium is gate/CV */ }
  noteOff(_note) { /* no-op */ }

  /** SynthEngine parity — nothing to connect downstream since we have no audio. */
  getOutputNode() { return null; }

  // ---------------------------------------------------------------------------
  // Extension points (opus47)
  // ---------------------------------------------------------------------------

  /**
   * EXTENSION POINT (opus47): subscribe to bridge connection state changes.
   * Callback fires with `true` on connect, `false` on disconnect.
   * Returns an unsubscribe fn.
   */
  onConnectionChange(cb) {
    if (typeof cb !== 'function') return () => {};
    this._connectionCallbacks.add(cb);
    return () => this._connectionCallbacks.delete(cb);
  }

  /**
   * EXTENSION POINT (opus47): register a frame source. Later agents call
   * this with a function returning `{gates: number[3], cvMain: number[3],
   * cvExp: number[8]}` on each tick. Before it's registered, the default
   * source emits all zeros so the wire side of the pipeline is still
   * observable.
   *
   * Passing `null` reverts to the zeros source.
   */
  setSnapshotSource(sourceFn) {
    if (!this._producer) {
      // init() hasn't run yet — stash it for when the producer exists.
      this._pendingSource = sourceFn;
      return;
    }
    this._producer.setSource(sourceFn);
  }

  // ---------------------------------------------------------------------------
  // Introspection (useful for drawer + debug probes)
  // ---------------------------------------------------------------------------

  get bridge() { return this._bridge; }
  get producer() { return this._producer; }
  get connected() { return this._connected; }

  /** True iff WebSerial is available in the current browser. */
  static isSupported() {
    return UseqSerialBridge.isSupported();
  }
}
