// Phase 2 UI — Undo button, A/B Compare toggle, Region Pin, Parameter Pin icons
//
// Adds Phase 2 controls to the immersive app:
//   - Undo button (near RL thumbs) with badge showing snapshot depth + long-press list
//   - A/B toggle button pair near RL buttons
//   - Region pin: long-press on joy-map (>500ms) pins the current zoom window
//   - Parameter pin: pin icon overlay on synth visualizer bars
//
// All state management is delegated to the data modules (SnapshotStack, ABCompare,
// RegionPinManager, ParamPinManager). This module only builds DOM and dispatches events.
//
// Usage:
//   import { initPhase2UI } from './phase2-ui.js';
//   const phase2 = initPhase2UI({
//     snapshotStack, abCompare, regionPins, paramPins,
//     getWeights, setWeights, getNoiseLevel, setNoiseLevel,
//     getZoomWindow, onRegionPin, onParamPinToggle,
//   });

export function initPhase2UI(options) {
  const {
    snapshotStack,
    abCompare,
    regionPins,
    paramPins,
    // Callbacks the app provides so we can read/write state
    getWeights,         // () => Array<number>  (flat weights)
    setWeights,         // (weights: Array<number>) => void
    getNoiseLevel,      // () => number
    setNoiseLevel,      // (level: number) => void
    getZoomLevel,       // () => number
    getZoomWindow,      // () => { x1, y1, x2, y2 } | null
    getTrainingData,    // () => { features, labels }
    runInference,       // () => void  (re-run inference after weight change)
    joyMapCanvas,       // the joy-map canvas element (for long-press detection)
    synthVisualizer,    // SynthVisualizer instance (for param pin overlay)
  } = options;

  // ---- Inject styles ----
  injectPhase2Styles();

  // ==== 1. UNDO BUTTON ====

  const $rlButtons = document.getElementById('rl-buttons');

  const $undoBtn = document.createElement('button');
  $undoBtn.className = 'rl-btn phase2-undo-btn';
  $undoBtn.title = 'Undo (long-press for history)';
  $undoBtn.innerHTML = `
    <span class="rl-icon phase2-undo-icon">&#8617;</span>
    <span class="phase2-undo-badge" id="phase2-undo-badge">0</span>
  `;

  // Insert undo button at the start of the RL buttons container
  if ($rlButtons) {
    $rlButtons.insertBefore($undoBtn, $rlButtons.firstChild);
  }

  const $undoBadge = $undoBtn.querySelector('#phase2-undo-badge');

  function updateUndoBadge() {
    const depth = snapshotStack.depth;
    $undoBadge.textContent = depth;
    $undoBadge.classList.toggle('hidden', depth === 0);
    $undoBtn.disabled = depth === 0;
  }
  updateUndoBadge();

  // Tap: single undo
  $undoBtn.addEventListener('click', () => {
    const state = snapshotStack.pop();
    if (state) {
      setWeights(state.weights);
      setNoiseLevel(state.noiseLevel);
      runInference();
    }
    updateUndoBadge();
  });

  // Long-press: show snapshot list popup
  let _undoLongPressTimer = null;
  let _undoLongPressActive = false;

  $undoBtn.addEventListener('pointerdown', (e) => {
    _undoLongPressActive = false;
    _undoLongPressTimer = setTimeout(() => {
      _undoLongPressActive = true;
      showSnapshotListPopup();
    }, 500);
  });

  $undoBtn.addEventListener('pointerup', () => {
    clearTimeout(_undoLongPressTimer);
  });

  $undoBtn.addEventListener('pointerleave', () => {
    clearTimeout(_undoLongPressTimer);
  });

  // Prevent click from firing after long-press
  $undoBtn.addEventListener('click', (e) => {
    if (_undoLongPressActive) {
      e.stopImmediatePropagation();
      _undoLongPressActive = false;
    }
  }, true);

  // Snapshot list popup
  let $snapshotPopup = null;

  function showSnapshotListPopup() {
    removeSnapshotPopup();

    const snapshots = snapshotStack.list();
    if (snapshots.length === 0) return;

    $snapshotPopup = document.createElement('div');
    $snapshotPopup.className = 'phase2-snapshot-popup';

    const header = document.createElement('div');
    header.className = 'phase2-snapshot-popup-header';
    header.textContent = 'Snapshot History';
    $snapshotPopup.appendChild(header);

    const list = document.createElement('div');
    list.className = 'phase2-snapshot-list';

    // Show newest first
    for (let i = snapshots.length - 1; i >= 0; i--) {
      const snap = snapshots[i];
      const item = document.createElement('button');
      item.className = 'phase2-snapshot-item';
      const age = formatAge(snap.timestamp);
      item.innerHTML = `
        <span class="phase2-snap-tag">${escapeHtml(snap.tag)}</span>
        <span class="phase2-snap-age">${age}</span>
      `;
      item.addEventListener('click', () => {
        const state = snapshotStack.jumpTo(snap.index);
        if (state) {
          setWeights(state.weights);
          setNoiseLevel(state.noiseLevel);
          runInference();
        }
        updateUndoBadge();
        removeSnapshotPopup();
      });
      list.appendChild(item);
    }

    $snapshotPopup.appendChild(list);
    document.body.appendChild($snapshotPopup);

    // Position near the undo button
    const rect = $undoBtn.getBoundingClientRect();
    $snapshotPopup.style.left = `${rect.left}px`;
    $snapshotPopup.style.bottom = `${window.innerHeight - rect.top + 8}px`;

    // Close on click outside
    setTimeout(() => {
      document.addEventListener('pointerdown', handlePopupOutsideClick);
    }, 50);
  }

  function handlePopupOutsideClick(e) {
    if ($snapshotPopup && !$snapshotPopup.contains(e.target)) {
      removeSnapshotPopup();
    }
  }

  function removeSnapshotPopup() {
    if ($snapshotPopup) {
      $snapshotPopup.remove();
      $snapshotPopup = null;
      document.removeEventListener('pointerdown', handlePopupOutsideClick);
    }
  }

  // Listen for snapshot events to update badge
  document.addEventListener('snapshot:push', updateUndoBadge);
  document.addEventListener('snapshot:pop', updateUndoBadge);
  document.addEventListener('snapshot:jump', updateUndoBadge);
  document.addEventListener('snapshot:clear', updateUndoBadge);

  // ==== 2. A/B COMPARE TOGGLE ====

  const $abContainer = document.createElement('div');
  $abContainer.className = 'phase2-ab-container';
  $abContainer.innerHTML = `
    <button class="phase2-ab-btn phase2-ab-capture" id="phase2-ab-capture" title="Capture A (reference)">A</button>
    <button class="phase2-ab-btn phase2-ab-toggle hidden" id="phase2-ab-toggle" title="Toggle A/B">A/B</button>
    <button class="phase2-ab-btn phase2-ab-accept hidden" id="phase2-ab-accept" title="Accept B (keep current)">Accept B</button>
    <button class="phase2-ab-btn phase2-ab-revert hidden" id="phase2-ab-revert" title="Revert to A">Revert A</button>
  `;

  if ($rlButtons) {
    $rlButtons.appendChild($abContainer);
  }

  const $abCapture = $abContainer.querySelector('#phase2-ab-capture');
  const $abToggle = $abContainer.querySelector('#phase2-ab-toggle');
  const $abAccept = $abContainer.querySelector('#phase2-ab-accept');
  const $abRevert = $abContainer.querySelector('#phase2-ab-revert');

  function updateABUI() {
    const active = abCompare.active;
    const side = abCompare.current;

    $abCapture.classList.toggle('hidden', active);
    $abToggle.classList.toggle('hidden', !active);
    $abAccept.classList.toggle('hidden', !active);
    $abRevert.classList.toggle('hidden', !active);

    if (active) {
      $abToggle.textContent = side === 'a' ? 'A' : 'B';
      $abToggle.classList.toggle('phase2-ab-side-a', side === 'a');
      $abToggle.classList.toggle('phase2-ab-side-b', side === 'b');
    }
  }

  $abCapture.addEventListener('click', () => {
    abCompare.captureA({
      weights: getWeights(),
      noiseLevel: getNoiseLevel(),
    });
    updateABUI();
  });

  $abToggle.addEventListener('click', () => {
    const state = abCompare.toggle({
      weights: getWeights(),
      noiseLevel: getNoiseLevel(),
    });
    if (state) {
      setWeights(state.weights);
      setNoiseLevel(state.noiseLevel);
      runInference();
    }
    updateABUI();
  });

  $abAccept.addEventListener('click', () => {
    abCompare.acceptB();
    updateABUI();
  });

  $abRevert.addEventListener('click', () => {
    const state = abCompare.revertToA();
    if (state) {
      setWeights(state.weights);
      setNoiseLevel(state.noiseLevel);
      runInference();
    }
    updateABUI();
  });

  // Listen for AB events
  document.addEventListener('ab:activate', updateABUI);
  document.addEventListener('ab:toggle', updateABUI);
  document.addEventListener('ab:deactivate', updateABUI);

  // ==== 3. REGION PIN (long-press on joy-map) ====

  let _regionLongPressTimer = null;

  if (joyMapCanvas) {
    joyMapCanvas.addEventListener('pointerdown', (e) => {
      _regionLongPressTimer = setTimeout(() => {
        // Pin the current zoom window as a region
        const zoomWindow = getZoomWindow ? getZoomWindow() : null;
        let region;
        if (zoomWindow) {
          region = {
            x1: zoomWindow.x1,
            y1: zoomWindow.y1,
            x2: zoomWindow.x2,
            y2: zoomWindow.y2,
          };
        } else {
          // No zoom — pin the full space (not very useful, but valid)
          region = { x1: 0, y1: 0, x2: 1, y2: 1 };
        }

        // Snapshot before pinning
        snapshotStack.push('before region pin', {
          weights: getWeights(),
          noiseLevel: getNoiseLevel(),
          zoomLevel: getZoomLevel ? getZoomLevel() : 1.0,
        });
        updateUndoBadge();

        const data = getTrainingData ? getTrainingData() : { features: [], labels: [] };
        const pinId = regionPins.pin(region, data);

        if (pinId >= 0) {
          // Flash feedback
          joyMapCanvas.classList.add('phase2-pin-flash');
          setTimeout(() => joyMapCanvas.classList.remove('phase2-pin-flash'), 300);

          // Update joy-map overlay
          syncJoyMapPins();
        }
      }, 500);
    });

    joyMapCanvas.addEventListener('pointerup', () => {
      clearTimeout(_regionLongPressTimer);
    });

    joyMapCanvas.addEventListener('pointerleave', () => {
      clearTimeout(_regionLongPressTimer);
    });

    // Prevent context menu on long-press
    joyMapCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Keep joy-map overlay in sync when pins change
  function syncJoyMapPins() {
    document.dispatchEvent(new CustomEvent('regionpin:sync', {
      detail: { regions: regionPins.getRegions() },
    }));
  }

  document.addEventListener('regionpin:add', syncJoyMapPins);
  document.addEventListener('regionpin:remove', syncJoyMapPins);

  // ==== 4. PARAMETER PIN (overlay on synth visualizer) ====

  // Param pin state is tracked by paramPins (ParamPinManager).
  // We add a click handler to the synth visualizer canvas to toggle pins.
  // The SynthVisualizer's draw loop can check paramPins.isPinned(i) for rendering.

  if (synthVisualizer && synthVisualizer.canvas) {
    // Double-tap on a param bar to toggle pin
    let _lastParamTapTime = 0;
    let _lastParamTapIndex = -1;

    synthVisualizer.canvas.addEventListener('pointerdown', (e) => {
      const idx = synthVisualizer.hitTest(e.clientX, e.clientY);
      if (idx < 0) return;

      const now = Date.now();
      if (now - _lastParamTapTime < 400 && idx === _lastParamTapIndex) {
        // Double-tap: toggle pin
        const newState = paramPins.toggle(idx);
        // Visual feedback is handled by the draw loop checking paramPins
        _lastParamTapTime = 0;
        _lastParamTapIndex = -1;
      } else {
        _lastParamTapTime = now;
        _lastParamTapIndex = idx;
      }
    });
  }

  // ==== PUBLIC API ====

  /**
   * Push a snapshot (called by app before destructive operations).
   * @param {string} tag
   */
  function pushSnapshot(tag) {
    snapshotStack.push(tag, {
      weights: getWeights(),
      noiseLevel: getNoiseLevel(),
      zoomLevel: getZoomLevel ? getZoomLevel() : 1.0,
    });
    updateUndoBadge();
  }

  /**
   * Cleanup all Phase 2 UI elements.
   */
  function destroy() {
    $undoBtn.remove();
    $abContainer.remove();
    removeSnapshotPopup();
    document.removeEventListener('snapshot:push', updateUndoBadge);
    document.removeEventListener('snapshot:pop', updateUndoBadge);
    document.removeEventListener('snapshot:jump', updateUndoBadge);
    document.removeEventListener('snapshot:clear', updateUndoBadge);
    document.removeEventListener('ab:activate', updateABUI);
    document.removeEventListener('ab:toggle', updateABUI);
    document.removeEventListener('ab:deactivate', updateABUI);
    document.removeEventListener('regionpin:add', syncJoyMapPins);
    document.removeEventListener('regionpin:remove', syncJoyMapPins);
    const styleEl = document.getElementById('phase2-styles');
    if (styleEl) styleEl.remove();
  }

  return {
    pushSnapshot,
    updateUndoBadge,
    syncJoyMapPins,
    destroy,
  };
}

// ---- Helpers ----

function formatAge(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- CSS ----

function injectPhase2Styles() {
  if (document.getElementById('phase2-styles')) return;

  const style = document.createElement('style');
  style.id = 'phase2-styles';
  style.textContent = `
/* ==== Phase 2: Undo Button ==== */
.phase2-undo-btn {
  position: relative;
}

.phase2-undo-icon {
  font-size: 18px;
  line-height: 1;
}

.phase2-undo-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  background: var(--accent, #ff6a00);
  color: #000;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  pointer-events: none;
  transition: opacity 0.15s;
}

.phase2-undo-badge.hidden {
  opacity: 0;
}

.phase2-undo-btn:disabled {
  opacity: 0.3;
  pointer-events: none;
}

/* ==== Phase 2: Snapshot Popup ==== */
.phase2-snapshot-popup {
  position: fixed;
  z-index: 100;
  width: 240px;
  max-height: 300px;
  background: rgba(0, 0, 0, 0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
}

.phase2-snapshot-popup-header {
  padding: 10px 12px 8px;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.phase2-snapshot-list {
  overflow-y: auto;
  max-height: 250px;
  -webkit-overflow-scrolling: touch;
}

.phase2-snapshot-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.1s;
  text-align: left;
}

.phase2-snapshot-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.phase2-snap-tag {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 8px;
}

.phase2-snap-age {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.35);
  white-space: nowrap;
}

/* ==== Phase 2: A/B Compare ==== */
.phase2-ab-container {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-left: 6px;
}

.phase2-ab-btn {
  height: 36px;
  min-width: 36px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: var(--glass-bg, rgba(13, 13, 13, 0.65));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: rgba(255, 255, 255, 0.7);
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 0 10px;
  transition: all 0.15s;
  white-space: nowrap;
}

.phase2-ab-btn:hover {
  border-color: rgba(255, 255, 255, 0.25);
  color: white;
}

.phase2-ab-btn.hidden {
  display: none;
}

/* A/B side indicators */
.phase2-ab-side-a {
  border-color: #4488ff;
  color: #4488ff;
  background: rgba(68, 136, 255, 0.12);
}

.phase2-ab-side-b {
  border-color: #ff8844;
  color: #ff8844;
  background: rgba(255, 136, 68, 0.12);
}

.phase2-ab-capture {
  border-color: rgba(68, 136, 255, 0.4);
  color: rgba(68, 136, 255, 0.8);
}

.phase2-ab-accept {
  border-color: rgba(139, 195, 74, 0.4);
  color: rgba(139, 195, 74, 0.9);
  font-size: 10px;
}

.phase2-ab-revert {
  border-color: rgba(255, 152, 0, 0.4);
  color: rgba(255, 152, 0, 0.9);
  font-size: 10px;
}

/* ==== Phase 2: Region Pin Flash ==== */
.phase2-pin-flash {
  animation: phase2-pin-flash-anim 0.3s ease-out;
}

@keyframes phase2-pin-flash-anim {
  0% { box-shadow: 0 0 0 0 rgba(0, 188, 212, 0.5); }
  100% { box-shadow: 0 0 0 12px rgba(0, 188, 212, 0); }
}

/* ==== Phase 2: Param Pin overlay (rendered on synth visualizer) ==== */
/* Lock icon styling — drawn by SynthVisualizer, these are for any DOM overlays */
.phase2-param-pinned-bar {
  opacity: 0.5;
}

/* ==== Responsive ==== */
@media (max-width: 600px) {
  .phase2-ab-container {
    gap: 3px;
    margin-left: 4px;
  }
  .phase2-ab-btn {
    height: 32px;
    min-width: 32px;
    font-size: 10px;
    padding: 0 8px;
  }
  .phase2-snapshot-popup {
    width: 200px;
  }
}
`;
  document.head.appendChild(style);
}
