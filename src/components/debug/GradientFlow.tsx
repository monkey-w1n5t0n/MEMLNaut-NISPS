/**
 * GradientFlow — Canvas component showing per-layer gradient bars with health colors.
 *
 * Gradient flow analysis requires before/after weight snapshots around a training
 * step.  The component exposes a GradientFlowHandle ref so the caller can wire
 * captureBeforeTrain / captureAfterTrain around their training calls:
 *
 *   let gradRef: GradientFlowHandle | undefined;
 *   // ...
 *   gradRef?.captureBeforeTrain();
 *   await mlStore.trainAsync();
 *   gradRef?.captureAfterTrain();
 *
 * The canvas redraws automatically after captureAfterTrain and also on the
 * periodic redraw interval so the display stays fresh.
 *
 * Props:
 *   mlStore       — ML store instance
 *   layerSizes    — full architecture e.g. [2, 32, 48, 64, 20] (default: joy MLP visual mode)
 *   width         — canvas pixel width  (default 120)
 *   height        — canvas pixel height (default 56)
 *   intervalMs    — passive redraw interval in ms (default 2000)
 *   ref           — optional setter to receive the GradientFlowHandle
 */

import { onMount, onCleanup } from 'solid-js';
import type { MLStore } from '../../stores/ml-store';
import {
  GradientFlowIndicator,
  type GradientFlowStatus,
} from '../../core/gradient-flow';
import {
  N_JOY_INPUTS,
  N_VISUAL_OUTPUTS,
  HIDDEN_LAYERS_JOY,
} from '../../stores/ml-store';
import './debug-panel.css';

// ─── Public handle ────────────────────────────────────────────────────────

export interface GradientFlowHandle {
  /** Call immediately before a training step to snapshot pre-train weights. */
  captureBeforeTrain(): void;
  /** Call immediately after a training step to compute and display gradient flow. */
  captureAfterTrain(): void;
}

// ─── Props ────────────────────────────────────────────────────────────────

export interface GradientFlowProps {
  mlStore: MLStore;
  /** Full MLP architecture including input + output counts. Default: joy visual [2,32,48,64,20]. */
  layerSizes?: number[];
  width?: number;
  height?: number;
  /** Passive redraw interval in ms. Default: 2000. */
  intervalMs?: number;
  /** Ref setter — receives a GradientFlowHandle after mount. */
  ref?: (handle: GradientFlowHandle) => void;
}

// ─── Default layer sizes ──────────────────────────────────────────────────

const DEFAULT_LAYER_SIZES = [N_JOY_INPUTS, ...HIDDEN_LAYERS_JOY, N_VISUAL_OUTPUTS];

// ─── Component ────────────────────────────────────────────────────────────

export default function GradientFlow(props: GradientFlowProps) {
  const width  = () => props.width  ?? 120;
  const height = () => props.height ?? 56;
  const interval = () => props.intervalMs ?? 2000;
  const layerSizes = () => props.layerSizes ?? DEFAULT_LAYER_SIZES;

  let canvasRef: HTMLCanvasElement | undefined;
  let indicator = new GradientFlowIndicator(layerSizes());

  function redraw(): void {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width(), height());
    indicator.draw(ctx, 0, 0, width(), height());
  }

  // Imperative handle exposed via ref prop
  const handle: GradientFlowHandle = {
    captureBeforeTrain(): void {
      const weights = props.mlStore.getWeights();
      indicator.captureBeforeTrain(weights);
    },
    captureAfterTrain(): void {
      const weights = props.mlStore.getWeights();
      indicator.captureAfterTrain(weights);
      redraw();
    },
  };

  onMount(() => {
    // Expose handle to parent via ref prop
    if (props.ref) props.ref(handle);

    // Initial draw (no data yet — shows placeholder)
    redraw();

    // Passive redraw interval (useful if the parent doesn't use captureAfterTrain)
    const id = setInterval(redraw, interval());
    onCleanup(() => clearInterval(id));
  });

  function statusClass(): string {
    const flow = indicator.getFlow();
    if (!flow) return 'debug-panel__status';
    return `debug-panel__status debug-panel__status--${flow.status}`;
  }

  function statusText(): string {
    const flow = indicator.getFlow();
    if (!flow) return '—';
    return flow.status;
  }

  return (
    <div class="debug-panel" style={{ width: `${width() + 12}px` }}>
      <div class="debug-panel__label">Gradient Flow</div>
      <canvas
        ref={canvasRef}
        class="debug-panel__canvas"
        width={width()}
        height={height()}
      />
      <div class={statusClass()}>{statusText()}</div>
    </div>
  );
}
