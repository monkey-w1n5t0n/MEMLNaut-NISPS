/**
 * HelpOverlay — Fullscreen help/intro panel.
 *
 * Shown automatically on first visit (unless `nisps-help-seen` in localStorage)
 * and on demand via the Help dock icon.
 *
 * Dismissal paths:
 *   - Click "Got it" button
 *   - Press Escape
 *   - Click outside the content panel (on the dark backdrop)
 *
 * On close, writes `nisps-help-seen=1` to localStorage so the overlay
 * does not appear again on next visit.
 */

import { onMount, onCleanup, Show } from 'solid-js';
import './help-overlay.css';

export interface HelpOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export default function HelpOverlay(props: HelpOverlayProps) {
  function dismiss(): void {
    localStorage.setItem('nisps-help-seen', '1');
    props.onClose();
  }

  function handleBackdropClick(e: MouseEvent): void {
    // Only close when clicking the backdrop itself, not the panel inside it
    if ((e.target as HTMLElement).classList.contains('help-overlay')) {
      dismiss();
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      dismiss();
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <Show when={props.visible}>
      <div class="help-overlay" onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-label="Help">
        <div class="help-panel">

          {/* ---- Header ---- */}
          <div class="help-header">
            <span class="help-title">MEMLNaut NISPS</span>
            <button class="help-close-x" onClick={dismiss} aria-label="Close help">&times;</button>
          </div>

          {/* ---- Keyboard shortcuts ---- */}
          <div class="help-section">
            <div class="help-section-title">Keyboard shortcuts</div>
            <div class="help-shortcut-grid">
              <span class="help-key">1</span>
              <span class="help-key-desc">Explore — add noise to weights (thumbs-down)</span>

              <span class="help-key">2</span>
              <span class="help-key-desc">Keep — lock in current sound (thumbs-up)</span>

              <span class="help-key">Z</span>
              <span class="help-key-desc">Undo — restore previous weight state</span>

              <span class="help-key">R</span>
              <span class="help-key-desc">Randomise — re-initialise all network weights</span>

              <span class="help-key">T</span>
              <span class="help-key-desc">Train — run a training pass on collected examples</span>

              <span class="help-key">Space</span>
              <span class="help-key-desc">Follow mode — joystick locks to current position</span>

              <span class="help-key">C</span>
              <span class="help-key-desc">Clear — remove all examples and reset training</span>
            </div>
          </div>

          {/* ---- Joystick ---- */}
          <div class="help-section">
            <div class="help-section-title">Joystick</div>
            <div class="help-info-list">
              <div class="help-info-row">
                <span class="help-info-label">Drag</span>
                <span>Move the input position. The MLP maps X/Y to all output parameters in real time.</span>
              </div>
              <div class="help-info-row">
                <span class="help-info-label">Double-click</span>
                <span>Toggle follow mode — the anchor locks to where you lift your finger, keeping outputs frozen while you reposition.</span>
              </div>
            </div>
          </div>

          {/* ---- Examples training ---- */}
          <div class="help-section">
            <div class="help-section-title">Training with examples</div>
            <div class="help-info-list">
              <div class="help-info-row">
                <span class="help-info-label">Set targets</span>
                <span>Move sliders in the Training drawer to the sound you want at a given joystick position.</span>
              </div>
              <div class="help-info-row">
                <span class="help-info-label">Add example</span>
                <span>Click "Add" to record the current input + target. Move to a different position and repeat.</span>
              </div>
              <div class="help-info-row">
                <span class="help-info-label">Train</span>
                <span>Press T or "Train" to fit the network to your examples. Loss curve shows convergence.</span>
              </div>
            </div>
          </div>

          {/* ---- RL mode ---- */}
          <div class="help-section">
            <div class="help-section-title">Reinforcement learning mode</div>
            <div class="help-info-list">
              <div class="help-info-row">
                <span class="help-info-label">+ (thumbs-up)</span>
                <span>Keep this — records the current sound as a positive example and decays the exploration noise.</span>
              </div>
              <div class="help-info-row">
                <span class="help-info-label">&#8722; (thumbs-down)</span>
                <span>Explore more — nudges weights with random noise to search for new sounds at this position.</span>
              </div>
              <div class="help-info-row">
                <span class="help-info-label">&#8634; (undo)</span>
                <span>Rolls back to the weight state before the last thumbs-down, preserving your best finds.</span>
              </div>
            </div>
          </div>

          {/* ---- Output modes ---- */}
          <div class="help-section">
            <div class="help-section-title">Output modes</div>
            <div class="help-mode-grid">
              <span class="help-mode-chip"><strong>Visual</strong> — particle flow field driven by first 20 outputs</span>
              <span class="help-mode-chip"><strong>Synth (C15)</strong> — 126 outputs control the C15 WASM synthesizer</span>
              <span class="help-mode-chip"><strong>Additive</strong> — outputs drive additive/FM tone generation</span>
              <span class="help-mode-chip"><strong>MIDI CC</strong> — outputs mapped to configurable MIDI CC messages</span>
              <span class="help-mode-chip"><strong>Audio Canvas</strong> — 36 outputs drive a generative audio sampler</span>
            </div>
            <div style={{ 'margin-top': '8px', 'font-size': '10px', color: '#777' }}>
              Switch modes via the Mode drawer (Mode icon in the dock).
            </div>
          </div>

          {/* ---- Dismiss ---- */}
          <div class="help-dismiss-row">
            <button class="help-dismiss-btn" onClick={dismiss}>Got it</button>
          </div>

        </div>
      </div>
    </Show>
  );
}
