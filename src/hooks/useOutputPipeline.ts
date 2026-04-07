/**
 * useOutputPipeline — SolidJS hook wrapping the OutputPipeline math module.
 *
 * Sits between ml-store raw outputs and useOutputRouting. Manages an
 * OutputPipeline instance sized to the current output count, keeping it
 * synchronized with output-store pipeline config via reactive effects.
 *
 * This hook does NOT run automatically on every frame — it provides the
 * pipeline instance and a process() method. The inference loop or
 * useOutputRouting calls process() at the appropriate time.
 *
 * Pipeline stages (in order):
 *   1. Global Curve   — power curve applied to all outputs
 *   2. Output Smoothing — per-output EMA (frame-rate-independent)
 *   3. Slew Rate Limiting — max change per second per output
 *   4. Freeze Gate    — when frozen, outputs don't update
 */

import { createEffect, onCleanup } from 'solid-js';
import { OutputPipeline } from '../core/output-pipeline';
import type { MLStore } from '../stores/ml-store';
import type { OutputStore } from '../stores/output-store';

// ─── Controller Interface ─────────────────────────────────────────────────────

export interface OutputPipelineController {
  /** Process raw outputs through the pipeline */
  process(rawOutputs: Float32Array, dt: number): Float32Array;
  /** Get the pipeline instance for direct access */
  getPipeline(): OutputPipeline;
  /** Update config from control surface params */
  updateFromControlSurface(params: {
    globalCurve: number;
    outputSmoothing: number;
    outputSlewRate: number;
  }): void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Create a reactive output pipeline bridging ml-store raw outputs and downstream
 * consumers (useOutputRouting, visualizers, etc.).
 *
 * @param mlStore     - ML engine; provides outputCount() for pipeline sizing
 * @param outputStore - Output store; provides pipeline config signals
 * @returns           OutputPipelineController for process() calls and direct access
 */
export function useOutputPipeline(
  mlStore: MLStore,
  outputStore: OutputStore,
): OutputPipelineController {
  // Mutable reference to the active pipeline and its current output count.
  // Wrapped in an object so the controller closure always reads the current instance.
  const initialCount = mlStore.outputCount();
  const ref = {
    pipeline: new OutputPipeline(initialCount),
    outputCount: initialCount,
  };

  // ─── Effect: recreate pipeline when output count changes (mode switches) ──

  createEffect(() => {
    const count = mlStore.outputCount();

    // Skip if the pipeline is already sized correctly.
    if (count === ref.outputCount) return;

    ref.pipeline = new OutputPipeline(count);
    ref.outputCount = count;

    // Re-apply current config to the new pipeline instance immediately so that
    // the first process() call after a mode switch uses the right settings.
    const pipeline = ref.pipeline;
    pipeline.setGlobalCurve(outputStore.state.pipeline.globalCurve);
    pipeline.setSmoothing(outputStore.state.pipeline.smoothing);
    pipeline.setSlewRate(outputStore.state.pipeline.slewRate);
    pipeline.setFrozen(outputStore.state.pipeline.freezeGate);
  });

  // ─── Effect: sync pipeline config from output-store ──────────────────────

  createEffect(() => {
    // Read all reactive pipeline config values so SolidJS tracks each as a dep.
    const globalCurve  = outputStore.globalCurve();
    const smoothing    = outputStore.smoothing();
    const slewRate     = outputStore.slewRate();
    const freezeGate   = outputStore.freezeGate();

    const pipeline = ref.pipeline;
    pipeline.setGlobalCurve(globalCurve);
    pipeline.setSmoothing(smoothing);
    pipeline.setSlewRate(slewRate);
    pipeline.setFrozen(freezeGate);
  });

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  onCleanup(() => {
    // OutputPipeline has no async resources or subscriptions to release,
    // but nulling the ref prevents stale closures from accidentally writing
    // into a pipeline that is no longer active.
    (ref as any).pipeline = null;
  });

  // ─── Controller ───────────────────────────────────────────────────────────

  const controller: OutputPipelineController = {
    process(rawOutputs: Float32Array, dt: number): Float32Array {
      return ref.pipeline.process(rawOutputs, dt);
    },

    getPipeline(): OutputPipeline {
      return ref.pipeline;
    },

    updateFromControlSurface(params: {
      globalCurve: number;
      outputSmoothing: number;
      outputSlewRate: number;
    }): void {
      // Delegate to the output store so the UI stays in sync with whatever the
      // control surface sets. The reactive effect above will propagate the new
      // values into the pipeline automatically.
      outputStore.setPipelineConfig({
        globalCurve: params.globalCurve,
        smoothing: params.outputSmoothing,
        slewRate: params.outputSlewRate,
      });
    },
  };

  return controller;
}
