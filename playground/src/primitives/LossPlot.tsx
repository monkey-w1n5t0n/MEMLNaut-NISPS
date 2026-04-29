import { Component, createEffect } from 'solid-js';
import styles from './LossPlot.module.css';

export interface LossPlotProps {
  history: () => ReadonlyArray<number>;
  /** Maximum points to display (older points are dropped). Default 200. */
  maxPoints?: number;
  width?: number;
  height?: number;
  /** Use logarithmic Y-axis. Default true. */
  log?: boolean;
  /** Color of plot line. */
  color?: string;
  ariaLabel?: string;
}

export const LossPlot: Component<LossPlotProps> = (props) => {
  let canvasEl: HTMLCanvasElement | undefined;

  createEffect(() => {
    if (!canvasEl) return;
    const dpr = window.devicePixelRatio || 1;
    const w = (props.width ?? 320) * dpr;
    const h = (props.height ?? 80) * dpr;
    if (canvasEl.width !== w || canvasEl.height !== h) {
      canvasEl.width = w;
      canvasEl.height = h;
    }
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    const all = props.history();
    if (all.length === 0) return;

    const max = props.maxPoints ?? 200;
    const data = all.length > max ? all.slice(all.length - max) : all;
    const log = props.log !== false;

    const ys = data.map((v) => (log ? Math.log(Math.max(1e-10, v) + 1) : v));
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const y of ys) {
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    if (yMax === yMin) yMax = yMin + 1e-6;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (i / 4) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Plot line
    ctx.strokeStyle = props.color ?? '#00ccff';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    for (let i = 0; i < ys.length; i++) {
      const x = (i / Math.max(1, ys.length - 1)) * w;
      const norm = (ys[i]! - yMin) / (yMax - yMin);
      const y = h - norm * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Last value
    const last = data[data.length - 1]!;
    ctx.fillStyle = '#9a9a9a';
    ctx.font = `${10 * dpr}px var(--font-mono)`;
    ctx.textAlign = 'right';
    ctx.fillText(last.toExponential(2), w - 4 * dpr, 12 * dpr);
  });

  return (
    <canvas
      ref={canvasEl}
      class={styles.canvas}
      style={{ width: `${props.width ?? 320}px`, height: `${props.height ?? 80}px` }}
      role="img"
      aria-label={props.ariaLabel ?? 'Training loss over time'}
    />
  );
};
