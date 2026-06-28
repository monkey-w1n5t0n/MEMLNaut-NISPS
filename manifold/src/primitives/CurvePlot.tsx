import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

export type CurveName =
  | 'linear'
  | 'exp'
  | 'log'
  | 'square'
  | 'sqrt'
  | 'sigmoid'
  | 'cubic'
  | 'centered_power';

export interface CurvePlotProps {
  /** One of the named response curves. Ignored when `fn` is provided. */
  curve?: CurveName;
  /** Custom response function f:[0,1]→[0,1]. Overrides `curve`. */
  fn?: (x: number) => number;
  width?: number;
  height?: number;
  /** Stroke colour (any CSS colour or var()). */
  color?: string;
  showAxes?: boolean;
  ariaLabel?: string;
  style?: CSSProperties;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const CURVES: Record<CurveName, (x: number) => number> = {
  linear: (x) => x,
  exp: (x) => (Math.exp(4 * x) - 1) / (Math.exp(4) - 1),
  log: (x) => Math.log(1 + x * (Math.exp(4) - 1)) / 4,
  square: (x) => x * x,
  sqrt: (x) => Math.sqrt(clamp01(x)),
  sigmoid: (x) => {
    const s = (v: number) => 1 / (1 + Math.exp(-(v - 0.5) * 8));
    const lo = s(0);
    const hi = s(1);
    return (s(x) - lo) / (hi - lo);
  },
  cubic: (x) => {
    const v = clamp01(x);
    return v * v * (3 - 2 * v);
  },
  centered_power: (x) => {
    const o = x - 0.5;
    const sg = o < 0 ? -1 : 1;
    return clamp01((sg * Math.pow(Math.abs(o) * 2, 0.5)) / 2 + 0.5);
  },
};

/**
 * Manifold CurvePlot — renders one of the named response curves (or a custom
 * function f:[0,1]→[0,1]) on the dark grid. The brand's straight-line &
 * parabolic/bézier motif.
 */
export function CurvePlot({
  curve = 'cubic',
  fn,
  width = 200,
  height = 120,
  color = 'var(--accent)',
  showAxes = true,
  ariaLabel,
  style,
}: CurvePlotProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = width * dpr;
    const h = height * dpr;
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const cs = getComputedStyle(cv);
    const stroke = color.startsWith('var(')
      ? cs.getPropertyValue(color.slice(4, -1).trim()).trim() || '#ff6a00'
      : color;
    const pad = 6 * dpr;

    if (showAxes) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
    }
    const f = fn || CURVES[curve] || CURVES.linear;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    for (let p = 0; p <= 120; p++) {
      const x = p / 120;
      const y = clamp01(f(x));
      const px = pad + x * (w - 2 * pad);
      const py = h - pad - y * (h - 2 * pad);
      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }, [curve, fn, width, height, color, showAxes]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={ariaLabel || `${curve} curve`}
      style={{
        display: 'block',
        width,
        height,
        background: 'var(--bg-1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-2)',
        ...style,
      }}
    />
  );
}
