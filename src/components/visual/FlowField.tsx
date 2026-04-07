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

  // Resize handler — updates canvas buffer dimensions and reinitializes particles
  function handleResize(): void {
    if (!canvasRef) return;
    if (!visualizer) {
      visualizer = new FlowFieldVisualizer(canvasRef);
    } else {
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

  onMount(() => {
    if (!canvasRef) return;

    // Set up resize observer — this fires after the canvas has layout dimensions,
    // avoiding the default 300x150 canvas size problem
    const observer = new ResizeObserver(() => {
      handleResize();
    });
    observer.observe(canvasRef);
    onCleanup(() => observer.disconnect());

    // Also handle window resize as fallback
    window.addEventListener('resize', handleResize);
    onCleanup(() => window.removeEventListener('resize', handleResize));
  });

  // Start/stop render loop based on output mode
  createEffect(() => {
    const mode = props.mlStore.state.outputMode;
    if (mode === 'visual') {
      // If visualizer isn't created yet (e.g. first effect run before ResizeObserver fires),
      // create it now — but only if canvas has real dimensions (not default 300x150)
      if (!visualizer && canvasRef) {
        const rect = canvasRef.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          visualizer = new FlowFieldVisualizer(canvasRef);
        }
      }
      if (visualizer) {
        startLoop();
      }
    } else {
      stopLoop();
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
