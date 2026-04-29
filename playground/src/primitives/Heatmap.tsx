import { Component, createEffect, onCleanup } from 'solid-js';
import styles from './Heatmap.module.css';

export type HeatmapColorMode = 'luminance' | 'variance' | 'divergence';

export interface HeatmapProps {
  /**
   * Reactive accessor returning a Float32Array. The array layout depends
   * on the color mode:
   *  - luminance: N*N values (mean output magnitude per cell)
   *  - variance:  N*N values (variance per cell)
   *  - divergence: N*N*S values where S is sample length per cell;
   *    only the first N*N are used as a scalar (precomputed). For
   *    arbitrary modes the caller should pre-reduce to N*N.
   *
   * If `samples` is empty the canvas is cleared.
   */
  samples: () => Float32Array;
  /** Number of cells per side (e.g. 16 → 16×16). */
  resolution: number;
  /** Color mode (affects palette interpretation). */
  colorMode: HeatmapColorMode;
  /** Optional palette as an array of CSS color stops. Default: dark→amber→white. */
  palette?: ReadonlyArray<string>;
  /** Pixel size of the canvas. Default 240. */
  size?: number;
  /** When true, draw cell borders for clarity. */
  showGrid?: boolean;
  ariaLabel?: string;
}

const DEFAULT_PALETTE = ['#1a0033', '#5a1f5a', '#a64f30', '#ff8030', '#ffe0a8', '#ffffff'];

function paletteRGB(palette: ReadonlyArray<string>): Array<[number, number, number]> {
  return palette.map((hex) => {
    const m = hex.replace('#', '');
    const r = parseInt(m.substring(0, 2), 16);
    const g = parseInt(m.substring(2, 4), 16);
    const b = parseInt(m.substring(4, 6), 16);
    return [r, g, b];
  });
}

function lerpRGB(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function sampleColor(palette: Array<[number, number, number]>, t: number): [number, number, number] {
  if (palette.length === 0) return [0, 0, 0];
  if (palette.length === 1) return palette[0]!;
  const tt = Math.max(0, Math.min(1, t));
  const seg = tt * (palette.length - 1);
  const idx = Math.min(palette.length - 2, Math.floor(seg));
  const frac = seg - idx;
  return lerpRGB(palette[idx]!, palette[idx + 1]!, frac);
}

export const Heatmap: Component<HeatmapProps> = (props) => {
  let canvasEl: HTMLCanvasElement | undefined;

  createEffect(() => {
    if (!canvasEl) return;
    const data = props.samples();
    const N = props.resolution;
    const palette = paletteRGB(props.palette ?? DEFAULT_PALETTE);
    const size = props.size ?? 240;
    const dpr = window.devicePixelRatio || 1;
    const pixelSize = size * dpr;
    if (canvasEl.width !== pixelSize || canvasEl.height !== pixelSize) {
      canvasEl.width = pixelSize;
      canvasEl.height = pixelSize;
    }
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, pixelSize, pixelSize);

    if (data.length === 0 || N <= 0) return;

    const cells = N * N;
    if (data.length < cells) return;

    // Find min/max for normalisation
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < cells; i++) {
      const v = data[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min;
    const cellPx = pixelSize / N;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const v = data[y * N + x] ?? 0;
        let t = range > 0 ? (v - min) / range : 0;
        // Color mode interpretation
        if (props.colorMode === 'variance') {
          // Map variance such that low variance → dark, high → bright
          t = Math.sqrt(t);
        } else if (props.colorMode === 'divergence') {
          // Divergence is signed-but-stored-as-magnitude — emphasize tails
          t = t * t;
        }
        const [r, g, b] = sampleColor(palette, t);
        ctx.fillStyle = `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
        ctx.fillRect(Math.floor(x * cellPx), Math.floor((N - 1 - y) * cellPx), Math.ceil(cellPx + 1), Math.ceil(cellPx + 1));
      }
    }

    if (props.showGrid) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      for (let i = 1; i < N; i++) {
        const p = Math.floor(i * cellPx) + 0.5;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, pixelSize);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(pixelSize, p);
        ctx.stroke();
      }
    }
  });

  return (
    <canvas
      ref={canvasEl}
      class={styles.canvas}
      style={{ width: `${props.size ?? 240}px`, height: `${props.size ?? 240}px` }}
      role="img"
      aria-label={props.ariaLabel ?? `Heatmap (${props.colorMode})`}
    />
  );
};
