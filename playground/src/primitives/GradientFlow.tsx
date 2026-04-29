import { Component, createEffect } from 'solid-js';
import styles from './GradientFlow.module.css';

export type GradientStatus = 'vanishing' | 'exploding' | 'converged' | 'healthy';

export interface GradientFlowProps {
  /** Per-layer L2 norms of weight delta. */
  layerNorms: () => ReadonlyArray<number>;
  /** Per-layer status. Length must match layerNorms(). */
  status: () => ReadonlyArray<GradientStatus>;
  width?: number;
  height?: number;
  ariaLabel?: string;
}

const STATUS_COLOR: Record<GradientStatus, string> = {
  vanishing:  '#5b9eef',
  exploding:  '#ef5b5b',
  converged:  '#9a9a9a',
  healthy:    '#6bc26b',
};

export const GradientFlow: Component<GradientFlowProps> = (props) => {
  let canvasEl: HTMLCanvasElement | undefined;

  createEffect(() => {
    if (!canvasEl) return;
    const dpr = window.devicePixelRatio || 1;
    const w = (props.width ?? 240) * dpr;
    const h = (props.height ?? 80) * dpr;
    if (canvasEl.width !== w || canvasEl.height !== h) {
      canvasEl.width = w;
      canvasEl.height = h;
    }
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    const norms = props.layerNorms();
    const status = props.status();
    if (norms.length === 0) return;

    let max = 0;
    for (const n of norms) if (n > max) max = n;
    if (max <= 0) max = 1;

    const barW = w / norms.length;
    for (let i = 0; i < norms.length; i++) {
      const bh = (norms[i]! / max) * (h - 14 * dpr);
      const s = status[i] ?? 'healthy';
      ctx.fillStyle = STATUS_COLOR[s];
      ctx.fillRect(i * barW + 2, h - bh - 2, barW - 4, bh);
      ctx.fillStyle = '#5a5a5a';
      ctx.font = `${10 * dpr}px var(--font-mono)`;
      ctx.textAlign = 'center';
      ctx.fillText(`L${i}`, i * barW + barW / 2, h - 2);
    }
  });

  return (
    <canvas
      ref={canvasEl}
      class={styles.canvas}
      style={{ width: `${props.width ?? 240}px`, height: `${props.height ?? 80}px` }}
      role="img"
      aria-label={props.ariaLabel ?? 'Gradient flow per layer'}
    />
  );
};
