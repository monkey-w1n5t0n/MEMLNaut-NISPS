/**
 * CurvePad — a square response-curve plot. Vertical drag reshapes the curve.
 * `curve` is 0..1 where ~0.43 reads as linear; mirrors the engine's applyCurve.
 * Ported from `CurvePad.jsx`.
 */
import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface CurvePadProps {
  curve?: number;
  onChange?: (c: number) => void;
  size?: number;
}

export function CurvePad({ curve = 0.5, onChange, size = 116 }: CurvePadProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef({ active: false, startY: 0, startC: 0 });

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr;
    cv.height = size * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    for (const t of [0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.moveTo(t * size, 0);
      ctx.lineTo(t * size, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, t * size);
      ctx.lineTo(size, t * size);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, size);
    ctx.lineTo(size, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    const css = getComputedStyle(cv);
    const accent = css.getPropertyValue('--accent').trim() || '#ff6a00';
    const e = 0.25 + curve * 1.75;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const pad = 3;
    for (let p = 0; p <= 80; p++) {
      const xv = p / 80;
      const yv = Math.pow(xv, e);
      const px = pad + xv * (size - 2 * pad);
      const py = size - pad - yv * (size - 2 * pad);
      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }, [curve, size]);

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { active: true, startY: e.clientY, startC: curve };
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d.active) return;
    const dc = (e.clientY - d.startY) / size;
    onChange?.(Math.max(0, Math.min(1, d.startC + dc)));
  };
  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drag.current.active = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 10,
            color: 'var(--fg-mute)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          curve
        </span>
        <span
          style={{ fontSize: 10, color: 'var(--fg-dim)', fontVariantNumeric: 'tabular-nums' }}
        >
          {(0.25 + curve * 1.75).toFixed(2)}
        </span>
      </div>
      <canvas
        ref={ref}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        title="Drag vertically to reshape"
        style={{
          width: size,
          height: size,
          display: 'block',
          cursor: 'ns-resize',
          background: 'var(--bg-1)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-1)',
          touchAction: 'none',
        }}
      />
    </div>
  );
}
