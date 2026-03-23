// ShapeSeq Namespaced Event Bus
// Lightweight pub/sub with seq.*/ml.*/ui.* namespaces and wildcard support.

// ── Event name constants ────────────────────────────────────────────

export const SEQ = Object.freeze({
  STEP:         'seq.step',
  NOTE_ON:      'seq.noteOn',
  NOTE_OFF:     'seq.noteOff',
  PARAM_CHANGE: 'seq.paramChange',
  LOOP_START:   'seq.loopStart',
});

export const ML = Object.freeze({
  TRAINED:      'ml.trained',
  FROZEN:       'ml.frozen',
  UNFROZEN:     'ml.unfrozen',
  DELTA_UPDATE: 'ml.deltaUpdate',
});

export const UI = Object.freeze({
  PARAM_SELECT:  'ui.paramSelect',
  CHAIN_EDIT:    'ui.chainEdit',
  PRESET_LOAD:   'ui.presetLoad',
  FREEZE_TOGGLE: 'ui.freezeToggle',
});

// ── Bus implementation ──────────────────────────────────────────────

export class EventBus {
  /** @param {AudioContext} [audioCtx] - optional, used for seq.* timestamps */
  constructor(audioCtx) {
    this._listeners = new Map();   // event -> Set<callback>
    this._wildcards = new Map();   // namespace prefix (e.g. "seq") -> Set<callback>
    this._audioCtx = audioCtx ?? null;
  }

  /** Provide or replace the AudioContext used for seq.* timestamps. */
  setAudioContext(ctx) {
    this._audioCtx = ctx;
  }

  /**
   * Subscribe to an event or a wildcard namespace.
   *   on('seq.step', cb)   — exact match
   *   on('seq.*', cb)      — all events in the seq namespace
   */
  on(event, callback) {
    if (event.endsWith('.*')) {
      const ns = event.slice(0, -2); // "seq.*" -> "seq"
      if (!this._wildcards.has(ns)) this._wildcards.set(ns, new Set());
      this._wildcards.get(ns).add(callback);
    } else {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event).add(callback);
    }
  }

  /** Unsubscribe. Mirrors the on() signature. */
  off(event, callback) {
    if (event.endsWith('.*')) {
      const ns = event.slice(0, -2);
      const set = this._wildcards.get(ns);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this._wildcards.delete(ns);
      }
    } else {
      const set = this._listeners.get(event);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this._listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event.
   * A `timestamp` field is added automatically:
   *   - seq.* events use AudioContext.currentTime (seconds)
   *   - all others use performance.now() (milliseconds)
   */
  emit(event, data = {}) {
    const ns = event.split('.')[0];
    const stamped = Object.assign({ timestamp: this._stamp(ns) }, data);

    // Exact listeners
    const exact = this._listeners.get(event);
    if (exact) {
      for (const cb of exact) cb(stamped, event);
    }

    // Wildcard listeners for this namespace
    const wild = this._wildcards.get(ns);
    if (wild) {
      for (const cb of wild) cb(stamped, event);
    }
  }

  // ── private ──

  _stamp(ns) {
    if (ns === 'seq' && this._audioCtx) return this._audioCtx.currentTime;
    return performance.now();
  }
}

// ── Singleton convenience ───────────────────────────────────────────

let _default = null;

/** Return (and lazily create) the shared default bus. */
export function getDefaultBus(audioCtx) {
  if (!_default) _default = new EventBus(audioCtx);
  else if (audioCtx) _default.setAudioContext(audioCtx);
  return _default;
}
