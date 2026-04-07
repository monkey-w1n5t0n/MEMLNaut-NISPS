/**
 * useInputPipeline — SolidJS hook wrapping the InputPipeline math module.
 *
 * Sits between raw joystick signals (input-store) and the ML engine (ml-store).
 * When joyX or joyY changes, the pipeline processes the raw position through
 * deadzone → zoom → curve → smoothing → momentum and sends the result to
 * mlStore.setInputs().
 *
 * The Precision compound axis in ControlSurface drives pipeline config via
 * setConfig(). Other callers (e.g. ControlSurfaceUI) can also call setConfig()
 * directly on the returned controller.
 */

import { createEffect, onCleanup } from 'solid-js';
import { InputPipeline } from '../core/input-pipeline';
import type { InputPipelineConfig } from '../core/input-pipeline';
import type { InputStore } from '../stores/input-store';
import type { MLStore } from '../stores/ml-store';

// ─── Controller Interface ─────────────────────────────────────────────────────

export interface InputPipelineController {
  /** Update pipeline config (called by ControlSurface axis changes) */
  setConfig(partial: Partial<InputPipelineConfig>): void;
  /** Get current config snapshot */
  getConfig(): Required<InputPipelineConfig>;
  /** Get the pipeline instance for direct access */
  getPipeline(): InputPipeline;
  /** Get the last processed position */
  getProcessedPosition(): { x: number; y: number };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Create a reactive bridge between raw joystick input and the ML engine.
 *
 * @param inputStore - Raw joystick position signals
 * @param mlStore    - ML engine; receives processed coordinates via setInputs
 * @returns          InputPipelineController for config updates and direct access
 */
export function useInputPipeline(
  inputStore: InputStore,
  mlStore: MLStore,
): InputPipelineController {
  // Create the pipeline (2 axes: X and Y)
  const pipeline = new InputPipeline(2);

  // Track last processed position for external queries
  let processedX = 0.5;
  let processedY = 0.5;

  // Track time between effect runs for frame-rate-independent smoothing
  let lastFrameTime: number | null = null;

  // Reactive effect — runs whenever joyX() or joyY() changes.
  // Both signals are read inside the effect so SolidJS tracks both as deps.
  createEffect(() => {
    const rawX = inputStore.joyX();
    const rawY = inputStore.joyY();

    // Compute dt in seconds since last effect run
    const now = performance.now();
    const dt = lastFrameTime !== null ? (now - lastFrameTime) / 1000 : 0;
    lastFrameTime = now;

    // Run through the full pipeline (deadzone → zoom → curve → smoothing → momentum)
    const result = pipeline.process(rawX, rawY, dt);

    processedX = result.x;
    processedY = result.y;

    // Forward processed coordinates to the ML engine
    mlStore.setInputs(result.x, result.y);
  });

  // Reset lastFrameTime on cleanup so stale deltas don't carry over if the
  // hook is re-created (e.g. HMR or component remount).
  onCleanup(() => {
    lastFrameTime = null;
  });

  // ─── Controller ───────────────────────────────────────────────────────────

  const controller: InputPipelineController = {
    setConfig(partial: Partial<InputPipelineConfig>): void {
      pipeline.setConfig(partial);
    },

    getConfig(): Required<InputPipelineConfig> {
      return pipeline.getConfig();
    },

    getPipeline(): InputPipeline {
      return pipeline;
    },

    getProcessedPosition(): { x: number; y: number } {
      return { x: processedX, y: processedY };
    },
  };

  return controller;
}
