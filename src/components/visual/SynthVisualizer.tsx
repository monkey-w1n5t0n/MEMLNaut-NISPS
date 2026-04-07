/**
 * SynthVisualizer Component — Fullscreen Canvas2D bar chart for synth outputs.
 *
 * Renders grouped vertical bars for all 126 C15 synth parameter outputs.
 * Owns its own rAF render loop (per architecture: "each canvas owns its rAF").
 * Reads from bus topic 'output.synth' to update displayed parameter values.
 *
 * Active when outputMode === 'synth'. Replaces FlowField in that mode.
 * Canvas resizes with its container via ResizeObserver.
 * Drag-to-edit is enabled in synth mode — dragging a bar calls
 * mlStore._updateOutputs() with the modified output array.
 */

import {
  onMount,
  onCleanup,
  createEffect,
} from 'solid-js';
import type { MLStore } from '../../stores/ml-store';
import { SynthVisualizer as SynthVisualizerCore } from '../../core/ui/synth-visualizer';
import { N_SYNTH_OUTPUTS } from '../../stores/ml-store';
import './synth-visualizer.css';

export interface SynthVisualizerProps {
  mlStore: MLStore;
}

export default function SynthVisualizer(props: SynthVisualizerProps) {
  let canvasRef: HTMLCanvasElement | undefined;
  let visualizer: SynthVisualizerCore | undefined;
  let rafId = 0;

  // ─── Resize ───────────────────────────────────────────────────────────────

  function handleResize(): void {
    if (!canvasRef) return;
    if (!visualizer) {
      visualizer = new SynthVisualizerCore(canvasRef);
      setupDragCallback();
    } else {
      visualizer.resize();
    }
  }

  // ─── Drag-to-edit callback ────────────────────────────────────────────────

  function setupDragCallback(): void {
    if (!visualizer) return;
    visualizer.setDragCallback((paramIndex: number, value: number) => {
      // Clone the current outputs and apply the drag edit
      const current = props.mlStore.outputs();
      const next = new Float32Array(current.length);
      next.set(current);
      if (paramIndex >= 0 && paramIndex < next.length) {
        next[paramIndex] = value;
      }
      props.mlStore._updateOutputs(next);
    });
  }

  // ─── rAF render loop ─────────────────────────────────────────────────────

  function animate(): void {
    if (!visualizer) return;
    visualizer.draw();
    rafId = requestAnimationFrame(animate);
  }

  function startLoop(): void {
    stopLoop();
    rafId = requestAnimationFrame(animate);
  }

  function stopLoop(): void {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  // ─── Mount ────────────────────────────────────────────────────────────────

  onMount(() => {
    if (!canvasRef) return;

    // ResizeObserver fires once the canvas has real CSS dimensions — avoids
    // the default 300x150 canvas size that appears before layout.
    const observer = new ResizeObserver(() => {
      handleResize();
    });
    observer.observe(canvasRef);
    onCleanup(() => observer.disconnect());

    window.addEventListener('resize', handleResize);
    onCleanup(() => window.removeEventListener('resize', handleResize));
  });

  // ─── React to output mode ─────────────────────────────────────────────────

  createEffect(() => {
    const mode = props.mlStore.state.outputMode;

    if (mode === 'synth') {
      // Ensure visualizer is created even if ResizeObserver hasn't fired yet
      if (!visualizer && canvasRef) {
        const rect = canvasRef.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          visualizer = new SynthVisualizerCore(canvasRef);
          setupDragCallback();
        }
      }
      if (visualizer) {
        visualizer.enableInteraction(true);
        startLoop();
      }
    } else {
      if (visualizer) {
        visualizer.enableInteraction(false);
      }
      stopLoop();
    }
  });

  // ─── Sync ML outputs to visualizer params via bus ─────────────────────────
  // We use the direct outputs() signal here — this runs in a reactive context
  // so SolidJS tracks it, and we push to the visualizer on each change.

  createEffect(() => {
    const outputs = props.mlStore.outputs();
    const mode = props.mlStore.state.outputMode;
    if (mode === 'synth' && visualizer) {
      visualizer.setParams(outputs);
    }
  });

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  onCleanup(() => {
    stopLoop();
    visualizer?.dispose();
    visualizer = undefined;
  });

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <canvas
      ref={canvasRef}
      id="synth-visualizer-canvas"
      class="synth-visualizer-canvas"
      aria-label={`Synth parameter visualizer — ${N_SYNTH_OUTPUTS} parameters`}
    />
  );
}
