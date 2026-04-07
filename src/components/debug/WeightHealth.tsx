/**
 * WeightHealth — Canvas component showing weight magnitude histogram + status.
 *
 * Reads weights from the ML store on a configurable interval (default 1000 ms),
 * runs WeightHealthIndicator.update(), then redraws the canvas.
 *
 * Props:
 *   mlStore       — ML store instance
 *   width         — canvas pixel width (default 120)
 *   height        — canvas pixel height (default 40)
 *   intervalMs    — polling interval in milliseconds (default 1000)
 */

import { onMount, onCleanup } from 'solid-js';
import type { MLStore } from '../../stores/ml-store';
import { WeightHealthIndicator } from '../../core/weight-health';
import './debug-panel.css';

export interface WeightHealthProps {
  mlStore: MLStore;
  width?: number;
  height?: number;
  /** How often to poll weights and redraw, in ms. Default: 1000. */
  intervalMs?: number;
}

export default function WeightHealth(props: WeightHealthProps) {
  const width  = () => props.width  ?? 120;
  const height = () => props.height ?? 40;
  const interval = () => props.intervalMs ?? 1000;

  let canvasRef: HTMLCanvasElement | undefined;
  const indicator = new WeightHealthIndicator();

  function tick(): void {
    const weights = props.mlStore.getWeights();
    indicator.update(weights);

    if (!canvasRef) return;
    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width(), height());
    indicator.draw(ctx, 0, 0, width(), height());
  }

  onMount(() => {
    // Run one tick immediately so the canvas is not blank on first render
    tick();

    const id = setInterval(tick, interval());
    onCleanup(() => clearInterval(id));
  });

  // Derive the BEM modifier for the status badge from the last computed status
  function statusClass(): string {
    const s = indicator.getStatus();
    if (!s) return 'debug-panel__status';
    return `debug-panel__status debug-panel__status--${s.health}`;
  }

  function statusText(): string {
    const s = indicator.getStatus();
    if (!s) return '—';
    if (s.health === 'healthy')    return 'healthy';
    if (s.health === 'saturating') return `sat ${(s.saturatedFraction * 100).toFixed(0)}%`;
    return `dead ${(s.deadFraction * 100).toFixed(0)}%`;
  }

  return (
    <div class="debug-panel" style={{ width: `${width() + 12}px` }}>
      <div class="debug-panel__label">Weights</div>
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
