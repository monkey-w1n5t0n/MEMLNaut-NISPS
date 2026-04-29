import { Component, createEffect } from 'solid-js';
import styles from './OutputDisplay.module.css';

export interface OutputDisplayProps {
  values: () => Float32Array;
  /** Optional labels per output. */
  labels?: ReadonlyArray<string>;
  /** Compact mode: thinner bars, no labels. */
  compact?: boolean;
  /** Pixel width. */
  width?: number;
  /** Pixel height. */
  height?: number;
  /** Optional bar color (default --accent). */
  color?: string;
  /** Show numeric label on hover (uses tooltip element). */
  showHover?: boolean;
}

export const OutputDisplay: Component<OutputDisplayProps> = (props) => {
  let canvasEl: HTMLCanvasElement | undefined;
  const compact = () => props.compact ?? false;

  createEffect(() => {
    if (!canvasEl) return;
    const values = props.values();
    const dpr = window.devicePixelRatio || 1;
    const w = (props.width ?? 320) * dpr;
    const h = (props.height ?? (compact() ? 40 : 80)) * dpr;
    if (canvasEl.width !== w || canvasEl.height !== h) {
      canvasEl.width = w;
      canvasEl.height = h;
    }
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    if (values.length === 0) return;

    const n = values.length;
    const barW = w / n;
    const color = props.color ?? '#ff6a00';
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(1, values[i] ?? 0));
      const bh = v * h;
      ctx.fillRect(i * barW, h - bh, Math.max(1, barW - dpr), bh);
    }
    // Mid-line guide
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();
  });

  return (
    <canvas
      ref={canvasEl}
      class={styles.canvas}
      classList={{ [styles.compact]: compact() }}
      style={{ width: `${props.width ?? 320}px`, height: `${props.height ?? (compact() ? 40 : 80)}px` }}
      role="img"
      aria-label={`Output bars (${props.values().length} channels)`}
    />
  );
};
