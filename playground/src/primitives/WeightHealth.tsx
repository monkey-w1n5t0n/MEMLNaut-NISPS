import { Component, createEffect, createMemo } from 'solid-js';
import styles from './WeightHealth.module.css';

export type WeightStatus = 'dead' | 'saturating' | 'healthy';

export interface WeightHealthProps {
  /** 10-bin histogram of weight magnitudes. */
  histogram: () => ReadonlyArray<number>;
  status: () => WeightStatus;
  /** Pixel width of histogram. */
  width?: number;
  height?: number;
  ariaLabel?: string;
}

const STATUS_COLORS: Record<WeightStatus, { glow: string; text: string }> = {
  dead:        { glow: 'rgba(140, 140, 140, 0.45)', text: 'DEAD' },
  saturating:  { glow: 'rgba(245, 196, 94, 0.6)',   text: 'SATURATING' },
  healthy:     { glow: 'rgba(107, 194, 107, 0.45)', text: 'HEALTHY' },
};

export const WeightHealth: Component<WeightHealthProps> = (props) => {
  let canvasEl: HTMLCanvasElement | undefined;
  const status = () => props.status();

  createEffect(() => {
    if (!canvasEl) return;
    const dpr = window.devicePixelRatio || 1;
    const w = (props.width ?? 200) * dpr;
    const h = (props.height ?? 60) * dpr;
    if (canvasEl.width !== w || canvasEl.height !== h) {
      canvasEl.width = w;
      canvasEl.height = h;
    }
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    const bins = props.histogram();
    if (bins.length === 0) return;
    let maxBin = 0;
    for (const b of bins) if (b > maxBin) maxBin = b;
    if (maxBin <= 0) maxBin = 1;

    const colors: Record<WeightStatus, string> = {
      dead: 'rgba(140, 140, 140, 0.7)',
      saturating: 'rgba(245, 196, 94, 0.85)',
      healthy: 'rgba(107, 194, 107, 0.85)',
    };
    ctx.fillStyle = colors[status()];
    const binW = w / bins.length;
    for (let i = 0; i < bins.length; i++) {
      const bh = (bins[i]! / maxBin) * h;
      ctx.fillRect(i * binW + 1, h - bh, binW - 2, bh);
    }
  });

  const glowStyle = createMemo(() => `box-shadow: 0 0 18px ${STATUS_COLORS[status()].glow};`);

  return (
    <div class={styles.wrap}>
      <canvas
        ref={canvasEl}
        class={styles.canvas}
        classList={{ [styles.pulsing]: status() === 'saturating' }}
        style={{ width: `${props.width ?? 200}px`, height: `${props.height ?? 60}px` }}
        role="img"
        aria-label={props.ariaLabel ?? 'Weight health histogram'}
      />
      <div class={styles.label} style={glowStyle()}>
        {STATUS_COLORS[status()].text}
      </div>
    </div>
  );
};
