// A/B Compare — Rapid toggle between two weight states
//
// Workflow:
//   1. User presses "A" to capture current state as the reference
//   2. User continues exploring (this becomes the live "B" state)
//   3. Toggle switches instantly between A and B
//   4. "Accept B" discards A and exits A/B mode
//   5. "Revert to A" restores the A snapshot and discards B
//
// The state object stored for each side includes weights, noiseLevel, and
// an optional controlState (for any control surface params worth preserving).
//
// Usage:
//   import { ABCompare } from './ab-compare.js';
//   const ab = new ABCompare();
//   ab.captureA({ weights, noiseLevel, controlState });
//   // ... user explores ...
//   const stateToRestore = ab.toggle(); // switches to A, returns A's state
//   const stateToRestore2 = ab.toggle(); // switches back to B, returns B's state

export class ABCompare {
  constructor() {
    this._a = null;   // { weights, noiseLevel, controlState }
    this._b = null;   // { weights, noiseLevel, controlState }
    this._current = null; // 'a' | 'b' | null (null = inactive)
  }

  // ---- Public API ----

  /**
   * Capture the current state as side "A" and enter A/B mode.
   * The live state after this call becomes "B".
   * @param {{ weights: Array, noiseLevel: number, controlState?: any }} state
   */
  captureA(state) {
    this._a = {
      weights: Array.isArray(state.weights)
        ? [...state.weights]
        : Array.from(state.weights),
      noiseLevel: state.noiseLevel ?? 0,
      controlState: state.controlState ?? null,
    };
    this._b = null; // B is "live" — captured on first toggle away from B
    this._current = 'b'; // We're currently hearing the B (live) side
    this._dispatch('ab:activate', { side: 'b' });
  }

  /**
   * Whether A/B mode is currently active.
   * @returns {boolean}
   */
  get active() {
    return this._current !== null;
  }

  /**
   * Which side is currently active: 'a', 'b', or null if inactive.
   * @returns {'a'|'b'|null}
   */
  get current() {
    return this._current;
  }

  /**
   * Toggle between A and B. Returns the state for whichever side we're
   * switching TO, so the caller can restore weights/noise from it.
   *
   * The caller must pass the current live state so we can snapshot whichever
   * side we're leaving.
   *
   * @param {{ weights: Array, noiseLevel: number, controlState?: any }} currentLiveState
   * @returns {{ weights: Array, noiseLevel: number, controlState?: any }|null}
   */
  toggle(currentLiveState) {
    if (!this.active) return null;

    if (this._current === 'b') {
      // Switching B → A: save current live state as B, return A
      this._b = {
        weights: Array.isArray(currentLiveState.weights)
          ? [...currentLiveState.weights]
          : Array.from(currentLiveState.weights),
        noiseLevel: currentLiveState.noiseLevel ?? 0,
        controlState: currentLiveState.controlState ?? null,
      };
      this._current = 'a';
      this._dispatch('ab:toggle', { side: 'a' });
      return this._cloneState(this._a);
    } else {
      // Switching A → B: save current live state as A, return B
      this._a = {
        weights: Array.isArray(currentLiveState.weights)
          ? [...currentLiveState.weights]
          : Array.from(currentLiveState.weights),
        noiseLevel: currentLiveState.noiseLevel ?? 0,
        controlState: currentLiveState.controlState ?? null,
      };
      this._current = 'b';
      this._dispatch('ab:toggle', { side: 'b' });
      return this._cloneState(this._b);
    }
  }

  /**
   * Accept B: discard A, exit A/B mode.
   * The current live state (B) is kept as-is — nothing to restore.
   */
  acceptB() {
    this._a = null;
    this._b = null;
    this._current = null;
    this._dispatch('ab:deactivate', { accepted: 'b' });
  }

  /**
   * Revert to A: restore A state and discard B, exit A/B mode.
   * @returns {{ weights: Array, noiseLevel: number, controlState?: any }|null}
   */
  revertToA() {
    if (!this._a) return null;
    const state = this._cloneState(this._a);
    this._a = null;
    this._b = null;
    this._current = null;
    this._dispatch('ab:deactivate', { accepted: 'a' });
    return state;
  }

  /**
   * Cancel A/B mode without choosing. Stays on current live state.
   */
  cancel() {
    this._a = null;
    this._b = null;
    this._current = null;
    this._dispatch('ab:deactivate', { accepted: null });
  }

  // ---- Internal ----

  _cloneState(s) {
    if (!s) return null;
    return {
      weights: [...s.weights],
      noiseLevel: s.noiseLevel,
      controlState: s.controlState,
    };
  }

  _dispatch(type, detail) {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
