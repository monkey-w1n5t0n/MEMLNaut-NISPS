/**
 * FlowField Component — Fullscreen Canvas2D particle system.
 *
 * Renders a flow-field visualization driven by the first 20 ML outputs.
 * Owns its own rAF render loop (per architecture: "each canvas owns its rAF").
 * Reads the ML store's outputs signal each frame to update particle parameters.
 *
 * Canvas resizes with window via ResizeObserver.
 * Only active when outputMode === 'visual'.
 */

import {
  onMount,
  onCleanup,
  createEffect,
  Show,
} from 'solid-js';
import type { MLStore } from '../../stores/ml-store';
import { FlowFieldVisualizer } from '../../core/ui/flow-field';
import './flowfield.css';

export interface FlowFieldProps {
  mlStore: MLStore;
}

export default function FlowField(props: FlowFieldProps) {
  let canvasRef: HTMLCanvasElement | undefined;
  let visualizer: FlowFieldVisualizer | undefined;
  let rafId: number = 0;

  // Resize handler — updates canvas buffer dimensions
  function handleResize(): void {
    if (visualizer && canvasRef) {
      visualizer.resize();
      visualizer.initParticles();
    }
  }

  // rAF render loop — only runs when in visual mode
  function animate(): void {
    if (!visualizer) return;
    const outputs = props.mlStore.outputs();
    visualizer.setParams(outputs);
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

  // Start/stop render loop based on output mode
  createEffect(() => {
    const mode = props.mlStore.state.outputMode;
    if (mode === 'visual' && canvasRef) {
      if (!visualizer) {
        visualizer = new FlowFieldVisualizer(canvasRef);
      }
      startLoop();
    } else {
      stopLoop();
    }
  });

  onMount(() => {
    // Set up resize observer
    if (canvasRef) {
      const observer = new ResizeObserver(() => {
        handleResize();
      });
      observer.observe(canvasRef);
      onCleanup(() => observer.disconnect());
    }
  });

  onCleanup(() => {
    stopLoop();
    visualizer = undefined;
  });

  return (
    <canvas
      ref={canvasRef}
      id="flowfield-canvas"
      class="flowfield-canvas"
    />
  );
}
