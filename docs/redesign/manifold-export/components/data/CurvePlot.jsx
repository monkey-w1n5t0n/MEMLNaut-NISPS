import React from 'react';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const CURVES = {
  linear: (x) => x,
  exp: (x) => (Math.exp(4 * x) - 1) / (Math.exp(4) - 1),
  log: (x) => Math.log(1 + x * (Math.exp(4) - 1)) / 4,
  square: (x) => x * x,
  sqrt: (x) => Math.sqrt(clamp01(x)),
  sigmoid: (x) => { const s = (v) => 1 / (1 + Math.exp(-(v - 0.5) * 8)); const lo = s(0), hi = s(1); return (s(x) - lo) / (hi - lo); },
  cubic: (x) => { const v = clamp01(x); return v * v * (3 - 2 * v); },
  centered_power: (x) => { const o = x - 0.5, sg = o < 0 ? -1 : 1; return clamp01((sg * Math.pow(Math.abs(o) * 2, 0.5)) / 2 + 0.5); },
};

/**
 * Manifold CurvePlot — renders one of the named response curves (or a custom
 * function f:[0,1]→[0,1]) on the dark grid. The brand's straight-line &
 * parabolic/bézier motif.
 */
export function CurvePlot({ curve = 'cubic', fn, width = 200, height = 120, color = 'var(--accent)', showAxes = true, ariaLabel, style }) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = width * dpr, h = height * dpr;
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const cs = getComputedStyle(cv);
    const resolve = (c) => { ctx.fillStyle = c; return ctx.fillStyle; };
    const stroke = color.startsWith('var(') ? cs.getPropertyValue(color.slice(4, -1).trim()).trim() || '#ff6a00' : color;
    const pad = 6 * dpr;

    if (showAxes) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    }
    const f = fn || CURVES[curve] || CURVES.linear;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    for (let p = 0; p <= 120; p++) {
      const x = p / 120, y = clamp01(f(x));
      const px = pad + x * (w - 2 * pad);
      const py = (h - pad) - y * (h - 2 * pad);
      p === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }, [curve, fn, width, height, color, showAxes]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={ariaLabel || `${curve} curve`}
      style={{ display: 'block', width, height, background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', ...style }}
    />
  );
}
