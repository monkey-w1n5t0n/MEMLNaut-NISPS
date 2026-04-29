/**
 * Snapshot helpers — bridge sessionStore.pushSnapshot/popSnapshot to the
 * actual MLP weights via mlStore. Auto-snapshot before train/randomize/
 * thumbs-down.
 */

import { mlStore } from '../stores/ml-store';
import { sessionStore } from '../stores/session-store';
import { explorationStore } from '../stores/exploration-store';
import { inputStore } from '../stores/input-store';

/** Capture current weights + noise level + zoom level. */
export function autoSnapshot(tag: string): void {
  if (!mlStore.iml) return;
  const w = mlStore.getWeights();
  if (w.length === 0) return;
  sessionStore.pushSnapshot(tag, {
    noiseLevel: explorationStore.state.noiseLevel,
    zoomLevel: inputStore.config.zoom,
    weights: w,
  });
}

/**
 * Pop the most recent snapshot and restore weights. Returns true on success.
 */
export function undoLastSnapshot(): boolean {
  const snap = sessionStore.popSnapshot();
  if (!snap || !snap.weights) return false;
  if (!mlStore.iml) return false;
  try {
    mlStore.setWeights(snap.weights);
    explorationStore.setNoiseLevel(snap.noiseLevel);
    return true;
  } catch {
    return false;
  }
}

/** Restore a specific snapshot by id. */
export function restoreSnapshotById(id: string): boolean {
  const snap = sessionStore.jumpToSnapshot(id);
  if (!snap || !snap.weights) return false;
  if (!mlStore.iml) return false;
  try {
    mlStore.setWeights(snap.weights);
    explorationStore.setNoiseLevel(snap.noiseLevel);
    return true;
  } catch {
    return false;
  }
}

/**
 * A/B compare helpers — capture the current weights as A, the next state
 * becomes B. Toggle swaps in O(1).
 */
export function captureA(): void {
  if (!mlStore.iml) return;
  const w = mlStore.getWeights();
  if (w.length === 0) return;
  sessionStore.captureA({
    id: `a-${Date.now().toString(36)}`,
    tag: 'A',
    timestamp: Date.now(),
    noiseLevel: explorationStore.state.noiseLevel,
    zoomLevel: inputStore.config.zoom,
    weights: w,
  });
}

export function toggleAB(): 'A' | 'B' {
  if (!mlStore.iml) return sessionStore.state.ab.live;
  // Capture the current live state on first toggle.
  const cur = mlStore.getWeights();
  const live = sessionStore.state.ab.live;
  if (live === 'B' && !sessionStore.state.ab.b) {
    // First toggle from B → A: capture the current state as B.
    sessionStore.captureB({
      id: `b-${Date.now().toString(36)}`,
      tag: 'B',
      timestamp: Date.now(),
      noiseLevel: explorationStore.state.noiseLevel,
      zoomLevel: inputStore.config.zoom,
      weights: cur,
    });
  } else if (live === 'A') {
    // Going back from A → B: update B with the current edits before flipping.
    sessionStore.captureB({
      id: `b-${Date.now().toString(36)}`,
      tag: 'B',
      timestamp: Date.now(),
      noiseLevel: explorationStore.state.noiseLevel,
      zoomLevel: inputStore.config.zoom,
      weights: cur,
    });
  }
  const next = sessionStore.toggleAB();
  // Apply the side we just switched to.
  const target = next === 'A' ? sessionStore.state.ab.a : sessionStore.state.ab.b;
  if (target?.weights) {
    try { mlStore.setWeights(target.weights); } catch { /* ignore */ }
    explorationStore.setNoiseLevel(target.noiseLevel);
  }
  return next;
}

export function acceptB(): void {
  sessionStore.acceptB();
}

export function revertToA(): void {
  if (!mlStore.iml) {
    sessionStore.revertToA();
    return;
  }
  const a = sessionStore.state.ab.a;
  if (a?.weights) {
    try { mlStore.setWeights(a.weights); } catch { /* ignore */ }
    explorationStore.setNoiseLevel(a.noiseLevel);
  }
  sessionStore.revertToA();
}
