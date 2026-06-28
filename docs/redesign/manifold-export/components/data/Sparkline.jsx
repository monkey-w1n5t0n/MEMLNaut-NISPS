import React from 'react';

/**
 * Manifold Sparkline — a compact time-series trace (training loss, a feature
 * envelope). Cyan line on a faint grid, with an optional last-value readout.
 */
export function Sparkline({ data = [], width = 320, height = 70, color = 'var(--accent-2)', log = false, showLast = true, format, ariaLabel = 'time series', style }) {
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
    if (!data.length) return;

    const cs = getComputedStyle(cv);
    const stroke = color.startsWith('var(') ? cs.getPropertyValue(color.slice(4, -1).trim()).trim() || '#00ccff' : color;

    const ys = data.map((v) => (log ? Math.log(Math.max(1e-10, v) + 1) : v));
    let lo = Infinity, hi = -Infinity;
    for (const y of ys) { if (y < lo) lo = y; if (y > hi) hi = y; }
    if (hi === lo) hi = lo + 1e-6;

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = (i / 4) * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    for (let i = 0; i < ys.length; i++) {
      const x = (i / Math.max(1, ys.length - 1)) * w;
      const norm = (ys[i] - lo) / (hi - lo);
      const y = h - norm * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (showLast) {
      const last = data[data.length - 1];
      const txt = format ? format(last) : (typeof last === 'number' ? last.toExponential(2) : String(last));
      ctx.fillStyle = '#9a9a9a';
      ctx.font = `${10 * dpr}px ui-monospace, monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(txt, w - 4 * dpr, 12 * dpr);
    }
  }, [data, width, height, color, log, showLast]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      style={{ display: 'block', width, height, background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', ...style }}
    />
  );
}
