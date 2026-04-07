/**
 * TrainingDrawer — Drawer panel with training controls.
 *
 * Contains:
 *   - Add Example button (captures current input/output as training example)
 *   - Train button (triggers async training)
 *   - Clear Ex button (clears examples only)
 *   - Clear All button (clears everything including loss history)
 *   - Randomize button (randomizes weights)
 *   - Loss plot canvas (shows loss history)
 *
 * Status line is rendered separately at the bottom of the screen.
 */

import {
  createSignal,
  onCleanup,
} from 'solid-js';
import type { MLStore } from '../../stores/ml-store';
import './drawer.css';

export interface TrainingDrawerProps {
  mlStore: MLStore;
  visible: boolean;
  onClose: () => void;
}

export default function TrainingDrawer(props: TrainingDrawerProps) {
  let lossCanvasRef: HTMLCanvasElement | undefined;

  // ─── Button handlers ───

  function onAddExample(): void {
    props.mlStore.addExample();
    flashButton('btn-add-example');
  }

  function onTrain(): void {
    const iml = props.mlStore.getActiveIml();
    if (!iml || (iml as any).isTraining) return;
    flashButton('btn-train');
    props.mlStore.trainAsync().then(() => {
      drawLossPlot();
    });
  }

  function onClearExamples(): void {
    props.mlStore.clearExamples();
    drawLossPlot();
  }

  function onClearAll(): void {
    props.mlStore.clearAll();
    drawLossPlot();
  }

  function onRandomize(): void {
    props.mlStore.randomise();
  }

  // ─── Button flash effect ───

  function flashButton(id: string): void {
    const btn = document.getElementById(id);
    if (btn) {
      btn.classList.add('flash');
      setTimeout(() => btn.classList.remove('flash'), 300);
    }
  }

  // ─── Loss plot drawing ───

  function drawLossPlot(): void {
    const canvas = lossCanvasRef;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const history = props.mlStore.getLossHistory();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, w, h);

    if (history.length < 2) return;

    const maxLoss = Math.max(...history.slice(-200)) || 1;
    const points = history.slice(-200);

    ctx.strokeStyle = 'rgba(255, 106, 0, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < points.length; i++) {
      const x = (i / (points.length - 1)) * w;
      const y = h - (points[i] / maxLoss) * h * 0.9;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  return (
    <div
      class={`drawer${props.visible ? '' : ' hidden'}`}
      id="drawer-training"
      data-drawer="training"
    >
      <div class="drawer-header">
        <span>Training</span>
        <button class="drawer-close" data-drawer="training" onClick={props.onClose}>
          ×
        </button>
      </div>
      <div class="drawer-body">
        <div class="action-row" id="examples-actions">
          <button class="action-btn" id="btn-add-example" onClick={onAddExample}>
            Add Example
          </button>
          <button class="action-btn accent" id="btn-train" onClick={onTrain}>
            Train
          </button>
          <button class="action-btn dim" id="btn-clear-examples" onClick={onClearExamples}>
            Clear Ex
          </button>
          <button class="action-btn dim" id="btn-clear-all" onClick={onClearAll}>
            Clear All
          </button>
          <button class="action-btn dim" id="btn-randomize" onClick={onRandomize}>
            Randomize
          </button>
        </div>
        <div class="loss-section">
          <label>Loss History</label>
          <canvas
            ref={lossCanvasRef}
            id="loss-canvas"
            width="280"
            height="80"
          />
        </div>
      </div>
    </div>
  );
}
