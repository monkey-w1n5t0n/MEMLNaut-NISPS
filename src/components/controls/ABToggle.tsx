/**
 * ABToggle — A/B weight state comparison button with capture/accept/revert controls.
 *
 * When inactive, shows a single "AB" button that captures the current state as A
 * and enters A/B mode (the live state becomes B).
 *
 * When active, the button label shows which side is currently live (A or B) and
 * clicking it toggles between the two. Two mini action buttons appear:
 *   - Accept B: keep the current live state, exit A/B mode
 *   - Revert to A: restore the captured A state, exit A/B mode
 *
 * Designed to sit next to the RLButtons row.
 */

import { createSignal, Show } from 'solid-js';
import type { MLStore } from '../../stores/ml-store';
import type { ABCompare } from '../../core/ab-compare';
import './snapshot-popup.css';

export interface ABToggleProps {
  mlStore: MLStore;
  ab: ABCompare;
}

export default function ABToggle(props: ABToggleProps) {
  // Local reactive signals that mirror the AB state so the UI rerenders
  const [isActive, setIsActive] = createSignal(false);
  const [side, setSide] = createSignal<'A' | 'B' | null>(null);

  function captureA(): void {
    const iml = props.mlStore.getActiveIml();
    if (!iml) return;
    props.ab.capture({
      weights: iml._getFlatWeights(),
      noiseLevel: props.mlStore.noiseLevel(),
    });
    setIsActive(true);
    setSide('B'); // We start on the live (B) side
  }

  function toggle(): void {
    const iml = props.mlStore.getActiveIml();
    if (!iml) return;
    const restored = props.ab.toggle({
      weights: iml._getFlatWeights(),
      noiseLevel: props.mlStore.noiseLevel(),
    });
    if (restored) {
      iml._setFlatWeights(restored.weights);
      iml.process();
    }
    const current = props.ab.current();
    setSide(current);
  }

  function accept(): void {
    props.ab.accept();
    setIsActive(false);
    setSide(null);
  }

  function revert(): void {
    const restored = props.ab.revert();
    if (restored) {
      const iml = props.mlStore.getActiveIml();
      if (iml) {
        iml._setFlatWeights(restored.weights);
        iml.process();
      }
    }
    setIsActive(false);
    setSide(null);
  }

  return (
    <div class="ab-toggle-wrap">
      {/* Action buttons: only visible when A/B mode is active */}
      <Show when={isActive()}>
        <div class="ab-actions">
          <button class="ab-action-btn ab-accept-btn" onClick={accept} title="Keep current (B)">
            Keep B
          </button>
          <button class="ab-action-btn ab-revert-btn" onClick={revert} title="Restore A">
            Revert A
          </button>
        </div>
      </Show>

      {/* Main toggle button */}
      <button
        class={`ab-toggle-btn${isActive() ? ' ab-active' : ''}`}
        onClick={isActive() ? toggle : captureA}
        title={isActive() ? `Switch to ${side() === 'A' ? 'B' : 'A'}` : 'Capture A/B reference'}
      >
        <span class="ab-side-label">{isActive() ? side() : 'AB'}</span>
        <span class="ab-key-hint">A/B</span>
      </button>
    </div>
  );
}
