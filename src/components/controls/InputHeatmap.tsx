/**
 * InputHeatmap — SolidJS canvas component.
 *
 * Renders a 2D color field on top of the joystick area showing what the MLP
 * produces across the input space. 16x16 = 256 inference points per update,
 * batched in a single WASM call via mlStore.inferBatch.
 *
 * Features:
 *   - Toggle via eye icon button (visible state preserved across unmounts)
 *   - 3 color modes: luminance / variance / divergence (cycle via mode label)
 *   - Zoom-aware resampling — when the input pipeline is zoomed, only the
 *     visible subregion of input space is sampled
 *   - Throttled to 200ms (max 5 updates/sec) to avoid WASM call saturation
 *   - Canvas is positioned as an overlay on the joystick area
 *
 * Props:
 *   mlStore      — provides inferBatch
 *   pipeline     — optional InputPipeline instance for zoom window queries
 *   width        — canvas width in px (should match joystick canvas)
 *   height       — canvas height in px
 *   class        — optional extra CSS class for the wrapper
 */

import { createSignal, createEffect, onCleanup, onMount, Show } from 'solid-js';
import type { MLStore } from '../../stores/ml-store';
import type { InputPipeline } from '../../core/input-pipeline';
import { InputHeatmap as InputHeatmapCore, COLOR_MODES } from '../../core/ui/input-heatmap';
import type { ColorMode, ZoomWindow } from '../../core/ui/input-heatmap';
import './input-heatmap.css';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface InputHeatmapProps {
  mlStore: MLStore;
  pipeline?: InputPipeline;
  width?: number;
  height?: number;
  class?: string;
}

// ─── Color mode labels ────────────────────────────────────────────────────────

const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  luminance:  'Lum',
  variance:   'Var',
  divergence: 'Div',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function InputHeatmap(props: InputHeatmapProps) {
  let canvasRef: HTMLCanvasElement | undefined;
  let rafId: number | undefined;
  let lastDrawTime = 0;

  // Singleton heatmap instance — persists across reactive updates
  const heatmap = new InputHeatmapCore({
    resolution: 16,
    throttle: 200, // 5 updates/sec max
    opacity: 0.55,
    enabled: false,
  });

  const [enabled, setEnabled] = createSignal(false);
  const [colorMode, setColorMode] = createSignal<ColorMode>('luminance');

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function getZoomWindow(): ZoomWindow | undefined {
    if (!props.pipeline) return undefined;
    try {
      const rect = props.pipeline.getZoomWindowRect();
      // Only use zoom window if actually zoomed (not full range)
      if (rect.x1 <= 0 && rect.y1 <= 0 && rect.x2 >= 1 && rect.y2 >= 1) {
        return undefined;
      }
      return rect;
    } catch {
      return undefined;
    }
  }

  function drawFrame(): void {
    if (!canvasRef || !enabled()) return;

    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;

    const now = performance.now();
    // Throttle the WASM batch call (update handles its own throttle too,
    // but we also gate the draw to avoid redundant canvas clears)
    const zoomWindow = getZoomWindow();

    heatmap.update(
      (points) => props.mlStore.inferBatch(points),
      { zoomWindow }
    );

    // Only redraw if we have data
    const w = canvasRef.width;
    const h = canvasRef.height;
    ctx.clearRect(0, 0, w, h);
    heatmap.draw(ctx, w, h);

    lastDrawTime = now;
  }

  function rafLoop(): void {
    drawFrame();
    if (enabled()) {
      rafId = requestAnimationFrame(rafLoop);
    }
  }

  function startLoop(): void {
    if (rafId != null) return;
    heatmap.invalidate(); // force immediate render on enable
    rafId = requestAnimationFrame(rafLoop);
  }

  function stopLoop(): void {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = undefined;
    }
    // Clear canvas when disabled
    if (canvasRef) {
      const ctx = canvasRef.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);
    }
  }

  // ─── Event handlers ─────────────────────────────────────────────────────────

  function toggleEnabled(): void {
    const next = !enabled();
    setEnabled(next);
    heatmap.setEnabled(next);
    if (next) {
      startLoop();
    } else {
      stopLoop();
    }
  }

  function cycleColorMode(): void {
    const next = heatmap.cycleColorMode();
    setColorMode(next);
    heatmap.invalidate();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  onMount(() => {
    if (enabled()) startLoop();
  });

  onCleanup(() => {
    stopLoop();
  });

  // Sync canvas size when props change
  createEffect(() => {
    if (!canvasRef) return;
    const w = props.width ?? 300;
    const h = props.height ?? 300;
    if (canvasRef.width !== w) canvasRef.width = w;
    if (canvasRef.height !== h) canvasRef.height = h;
  });

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div class={`input-heatmap-wrapper${props.class ? ' ' + props.class : ''}`}>
      {/* Canvas overlay — sits on top of joystick canvas via CSS */}
      <canvas
        ref={canvasRef}
        class="input-heatmap-canvas"
        width={props.width ?? 300}
        height={props.height ?? 300}
        aria-hidden="true"
      />

      {/* Controls — toggle eye and color mode chip */}
      <div class="input-heatmap-controls">
        <button
          class={`input-heatmap-toggle${enabled() ? ' active' : ''}`}
          onClick={toggleEnabled}
          title={enabled() ? 'Hide heatmap' : 'Show heatmap'}
          aria-label={enabled() ? 'Hide input heatmap' : 'Show input heatmap'}
        >
          <Show when={enabled()} fallback={<EyeOffIcon />}>
            <EyeIcon />
          </Show>
        </button>

        <Show when={enabled()}>
          <button
            class="input-heatmap-mode"
            onClick={cycleColorMode}
            title={`Color mode: ${colorMode()} — click to cycle`}
            aria-label={`Heatmap color mode: ${colorMode()}`}
          >
            {COLOR_MODE_LABELS[colorMode()]}
          </button>
        </Show>
      </div>
    </div>
  );
}

// ─── Icons (inline SVG) ───────────────────────────────────────────────────────

function EyeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
