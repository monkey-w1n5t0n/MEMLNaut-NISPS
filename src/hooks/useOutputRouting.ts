/**
 * useOutputRouting — reactive backbone that routes ML outputs to the active
 * output consumer via the signal bus.
 *
 * Architecture:
 *   ml-store.outputs() → apply overrides → route by mode:
 *     'visual'       → bus.emit('output.visual',      processed)
 *     'synth'        → bus.emit('output.synth',       processed)  [throttled to 20fps]
 *     'midi-cc'      → bus.emit('output.midi',        processed)
 *     'audio-canvas' → bus.emit('output.audiocanvas', processed)
 *
 *   Always (unthrottled):
 *     → bus.emit('output.heatmap', raw)   [raw, pre-override — for heatmap strip]
 *
 * Synth throttle:
 *   - Emits at most once per 50ms (≈20fps).
 *   - Additionally skips emission when no element in the processed array has
 *     changed by more than 0.002 from the last emitted value (dead zone).
 *
 * Called once at the app root — sets up reactive effects with no return value.
 */

import { createEffect, onCleanup } from 'solid-js';
import type { MLStore } from '../stores/ml-store';
import type { SignalBus } from '../bus/signal-bus';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum interval between 'output.synth' emissions in milliseconds (20fps). */
const SYNTH_THROTTLE_MS = 50;

/** Dead-zone threshold for synth throttle — skip emit if max delta is below this. */
const SYNTH_DEAD_ZONE = 0.002;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOutputRouting(
  mlStore: MLStore,
  bus: SignalBus,
): void {
  // ─── Ensure all bus topics exist before any effect fires ─────────────────

  const visualTopic    = bus.createTopic<Float32Array>('output.visual');
  const synthTopic     = bus.createTopic<Float32Array>('output.synth');
  const midiTopic      = bus.createTopic<Float32Array>('output.midi');
  const audioCanvasTopic = bus.createTopic<Float32Array>('output.audiocanvas');
  const heatmapTopic   = bus.createTopic<Float32Array>('output.heatmap');

  // ─── Synth throttle state (mutable, non-reactive) ────────────────────────

  let lastSynthEmitMs = 0;
  let lastSynthValues: Float32Array | null = null;

  // ─── Reactive effect — re-runs whenever outputs() or outputMode changes ──

  createEffect(() => {
    // Access both reactive dependencies so SolidJS tracks them.
    const rawOutputs = mlStore.outputs();
    const mode = mlStore.state.outputMode;

    // Always emit raw outputs to the heatmap topic (no overrides applied).
    // Slice to a new Float32Array so downstream consumers can't mutate the
    // signal's internal value.
    heatmapTopic.emit(rawOutputs.slice());

    // Apply per-parameter overrides (freeze, curve, range).
    const processed = mlStore.applyAllOverrides(rawOutputs);

    switch (mode) {
      case 'visual': {
        visualTopic.emit(processed);
        break;
      }

      case 'synth': {
        const now = performance.now();
        const elapsed = now - lastSynthEmitMs;

        if (elapsed < SYNTH_THROTTLE_MS) {
          // Within throttle window — skip emission.
          break;
        }

        // Dead-zone check: skip if nothing changed significantly.
        if (lastSynthValues !== null && lastSynthValues.length === processed.length) {
          let maxDelta = 0;
          for (let i = 0; i < processed.length; i++) {
            const delta = Math.abs(processed[i] - lastSynthValues[i]);
            if (delta > maxDelta) maxDelta = delta;
          }
          if (maxDelta <= SYNTH_DEAD_ZONE) {
            break;
          }
        }

        lastSynthEmitMs = now;
        lastSynthValues = processed.slice();
        synthTopic.emit(processed);
        break;
      }

      case 'midi-cc': {
        midiTopic.emit(processed);
        break;
      }

      case 'audio-canvas': {
        audioCanvasTopic.emit(processed);
        break;
      }
    }
  });

  // Reset synth throttle state when the component owning this hook is cleaned up.
  onCleanup(() => {
    lastSynthValues = null;
    lastSynthEmitMs = 0;
  });
}
