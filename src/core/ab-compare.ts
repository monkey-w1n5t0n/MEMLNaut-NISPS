/**
 * ABCompare — Rapid toggle between two weight states.
 *
 * Workflow:
 *   1. Call capture() to save current state as reference "A" and enter A/B mode.
 *   2. User continues exploring — this becomes the live "B" state.
 *   3. toggle() switches instantly between A and B (caller passes current live state).
 *   4. accept() keeps B (live state), discards A, and exits A/B mode.
 *   5. revert() restores A and discards B.
 *
 * Ported from playground/js/ui/ab-compare.js.
 */

export interface ABState {
  weights: number[];
  noiseLevel: number;
}

type ABSide = 'A' | 'B';

export interface ABCompare {
  /** Save current state as A and enter A/B mode (current live becomes B). */
  capture(state: ABState): void;
  /** Whether A/B mode is currently active. */
  isActive(): boolean;
  /**
   * Toggle between A and B.
   * Caller must pass current live state so we can snapshot the side being left.
   * Returns the state for the side we are switching TO, so the caller can restore it.
   */
  toggle(currentLiveState: ABState): ABState | null;
  /** Which side is currently active: 'A' or 'B' (or null if inactive). */
  current(): ABSide | null;
  /** Keep B (live state), discard A, exit A/B mode. Nothing to restore. */
  accept(): void;
  /**
   * Restore A state, discard B, exit A/B mode.
   * Returns the A state to restore, or null if not active.
   */
  revert(): ABState | null;
  /** Cancel A/B mode without choosing a side. Stays on current live state. */
  cancel(): void;
}

interface InternalState {
  weights: number[];
  noiseLevel: number;
}

export function createABCompare(): ABCompare {
  let _a: InternalState | null = null;
  let _b: InternalState | null = null;
  let _current: 'a' | 'b' | null = null;

  function cloneState(s: InternalState): InternalState {
    return {
      weights: [...s.weights],
      noiseLevel: s.noiseLevel,
    };
  }

  function toInternal(state: ABState): InternalState {
    return {
      weights: Array.isArray(state.weights)
        ? [...state.weights]
        : Array.from(state.weights),
      noiseLevel: state.noiseLevel ?? 0,
    };
  }

  function dispatch(type: string, detail: Record<string, unknown>): void {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }

  return {
    capture(state: ABState): void {
      _a = toInternal(state);
      _b = null; // B is "live" — captured on first toggle away from B
      _current = 'b'; // We're currently hearing the live B side
      dispatch('ab:activate', { side: 'b' });
    },

    isActive(): boolean {
      return _current !== null;
    },

    toggle(currentLiveState: ABState): ABState | null {
      if (_current === null) return null;

      if (_current === 'b') {
        // Switching B → A: save live state as B, return A
        _b = toInternal(currentLiveState);
        _current = 'a';
        dispatch('ab:toggle', { side: 'a' });
        return _a ? cloneState(_a) : null;
      } else {
        // Switching A → B: update A from current (in case user tweaked it), return B
        _a = toInternal(currentLiveState);
        _current = 'b';
        dispatch('ab:toggle', { side: 'b' });
        return _b ? cloneState(_b) : null;
      }
    },

    current(): ABSide | null {
      if (_current === null) return null;
      return _current === 'a' ? 'A' : 'B';
    },

    accept(): void {
      _a = null;
      _b = null;
      _current = null;
      dispatch('ab:deactivate', { accepted: 'b' });
    },

    revert(): ABState | null {
      if (!_a) return null;
      const state = cloneState(_a);
      _a = null;
      _b = null;
      _current = null;
      dispatch('ab:deactivate', { accepted: 'a' });
      return state;
    },

    cancel(): void {
      _a = null;
      _b = null;
      _current = null;
      dispatch('ab:deactivate', { accepted: null });
    },
  };
}
