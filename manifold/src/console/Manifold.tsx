/**
 * The Manifold — full-bleed input surface + joy-map visualisation. The canvas
 * bypasses React: it runs its own rAF loop and reads pos / noiseCap / pins
 * imperatively from a ref (`stateRef`), never per-frame React state. Pointer
 * input calls `onMove(x,y)` which (in ConsoleApp) drives `engine.setInput`.
 *
 * Ported faithfully from the window-global `Manifold.jsx`.
 */
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { FeedbackMarker, Pin } from './types';

export interface ManifoldProps {
  pos: [number, number];
  onMove: (x: number, y: number) => void;
  noiseCap?: number;
  pins?: Pin[];
  /** Feedback markers (both polarities) plotted at their input location. */
  markers?: FeedbackMarker[];
  /** Input-surface shape — rectangular XY map or circular joystick-style disc. */
  variant?: 'rectangular' | 'circular';
  frozen?: boolean;
  follow?: boolean;
  onLongPress?: (pos: [number, number]) => void;
  /**
   * PICK-LOCATION (Explore & place, rl-feedback §2.2 §3). While true, the next
   * pointer-down chooses the anchor location and calls {@link onPickLocation}
   * instead of the normal pan/drive — a transient marker is shown.
   */
  picking?: boolean;
  /** Called with the chosen [0,1]² location when a pick lands. */
  onPickLocation?: (x: number, y: number) => void;
}

export function Manifold({
  pos,
  onMove,
  noiseCap = 0.1,
  pins = [],
  markers = [],
  variant = 'rectangular',
  frozen = false,
  follow = false,
  onLongPress,
  picking = false,
  onPickLocation,
}: ManifoldProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ pos, noiseCap, pins, markers, variant, frozen, follow, picking });
  const trailRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const draggingRef = useRef(false);
  const driftRef = useRef({ vx: 0.0011, vy: 0.0008 });
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Transient "just placed" marker location (manifold space), for a brief flash.
  const placedRef = useRef<{ x: number; y: number; t: number } | null>(null);

  // FOLLOW-MOUSE mode: double-click the input mark to glue the knob to the
  // cursor, then it tracks the mouse anywhere on screen (the whole viewport maps
  // onto this surface's [0,1]² space). Escape or a second double-click exits.
  const [followMouse, setFollowMouse] = useState(false);
  const followMouseRef = useRef(false);
  followMouseRef.current = followMouse;
  // onMove can change identity each render; keep a ref so the global listener
  // never has to be re-installed per frame while following.
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  stateRef.current = { pos, noiseCap, pins, markers, variant, frozen, follow, picking };

  // push trail point whenever pos changes
  useEffect(() => {
    trailRef.current.push({ x: pos[0], y: pos[1], t: performance.now() });
    if (trailRef.current.length > 240) trailRef.current.shift();
  }, [pos[0], pos[1]]);

  /**
   * Map a pointer event to a normalised [0,1]² position. In the circular
   * variant the position is clamped to the inscribed disc (knob stays on/inside
   * the boundary), keeping the [0,1]² normalisation consistent across both.
   */
  const posFromEvent = (e: ReactPointerEvent<HTMLDivElement>): [number, number] | null => {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (stateRef.current.variant === 'circular') {
      // Map the pointer relative to the *inscribed circle* the canvas draws (see
      // `drawRadius` below): a unit-disc vector around the centre, so the knob
      // tracks the cursor inside the disc and snaps to the rim outside it. This
      // keeps the reachable area a true circle on a non-square surface (where a
      // [0,1]² clamp would render as an ellipse spilling past the drawn rim).
      const radius = Math.min(r.width, r.height) / 2 - 2;
      if (radius <= 0) return [0.5, 0.5];
      let vx = (e.clientX - r.left - r.width / 2) / radius;
      let vy = (r.height / 2 - (e.clientY - r.top)) / radius; // screen y is down; flip so up = +
      const mag = Math.hypot(vx, vy);
      if (mag > 1) {
        vx /= mag;
        vy /= mag;
      }
      return [0.5 + 0.5 * vx, 0.5 + 0.5 * vy];
    }
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    return [x, y];
  };

  const setFromEvent = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = posFromEvent(e);
    if (p) onMove(p[0], p[1]);
  };

  /**
   * FOLLOW-MOUSE mapping: turn an absolute viewport coordinate (client px) into
   * a normalised [0,1]² manifold position. The *whole window* maps onto this
   * surface's space so the knob genuinely tracks the cursor across the entire
   * UI — left edge → x=0, right edge → x=1 — regardless of where (or how small)
   * this surface sits. The circular variant clamps to the inscribed unit disc.
   */
  const posFromClient = (clientX: number, clientY: number): [number, number] => {
    const W = window.innerWidth || 1;
    const H = window.innerHeight || 1;
    const nx = clientX / W;
    const ny = 1 - clientY / H; // screen y is down; flip so up = +
    if (stateRef.current.variant === 'circular') {
      let vx = (nx - 0.5) * 2;
      let vy = (ny - 0.5) * 2;
      const mag = Math.hypot(vx, vy);
      if (mag > 1) {
        vx /= mag;
        vy /= mag;
      }
      return [0.5 + 0.5 * vx, 0.5 + 0.5 * vy];
    }
    return [Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny))];
  };

  /** Screen-pixel (client) position of the drawn input mark, for the hit-test. */
  const knobClient = (r: DOMRect, p: [number, number]): [number, number] => {
    if (stateRef.current.variant === 'circular') {
      const radius = Math.min(r.width, r.height) / 2 - 2;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      return [cx + (p[0] - 0.5) * 2 * radius, cy - (p[1] - 0.5) * 2 * radius];
    }
    return [r.left + p[0] * r.width, r.top + (1 - p[1]) * r.height];
  };

  /**
   * Double-click toggles follow-mouse mode. Entering requires the click to land
   * on the input mark (within ~36px of the knob); a second double-click — the
   * mark is now under the cursor — exits.
   */
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (stateRef.current.frozen || stateRef.current.picking) return;
    if (followMouseRef.current) {
      setFollowMouse(false);
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const [kx, ky] = knobClient(r, stateRef.current.pos);
    if (Math.hypot(e.clientX - kx, e.clientY - ky) <= 36) setFollowMouse(true);
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stateRef.current.frozen) return;
    // While following the mouse, the global listener owns the knob — don't start
    // a pan/long-press drag (double-click still fires to exit).
    if (followMouseRef.current) return;
    // PICK-LOCATION: when placing, this pointer-down picks the anchor location
    // (rl-feedback §2.2 §3) and does NOT start a pan/drive drag.
    if (stateRef.current.picking) {
      const p = posFromEvent(e);
      if (!p) return;
      placedRef.current = { x: p[0], y: p[1], t: performance.now() };
      onPickLocation?.(p[0], p[1]);
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setFromEvent(e);
    if (lpTimer.current) clearTimeout(lpTimer.current);
    lpTimer.current = setTimeout(() => {
      onLongPress?.(stateRef.current.pos);
    }, 600);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (followMouseRef.current) return;
    if (draggingRef.current) {
      setFromEvent(e);
      if (lpTimer.current) clearTimeout(lpTimer.current);
    }
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (lpTimer.current) clearTimeout(lpTimer.current);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const css = getComputedStyle(document.documentElement);
    const C = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
    const accent = C('--accent', '#ff6a00');
    const cyan = C('--accent-2', '#00ccff');

    const dpr = window.devicePixelRatio || 1;
    let lastW = -1;
    let lastH = -1;
    const ensureSize = (W: number, H: number) => {
      if (W === lastW && H === lastH) return;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastW = W;
      lastH = H;
    };

    const draw = () => {
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      if (W === 0 || H === 0) return;
      ensureSize(W, H);
      const {
        pos: p,
        noiseCap: nc,
        pins: pn,
        markers: mk,
        variant: vr,
        frozen: fz,
        follow: fl,
        picking: pk,
      } = stateRef.current;
      const now = performance.now();
      const circular = vr === 'circular';
      // Disc geometry (inscribed circle centred in the surface).
      const cx = W / 2;
      const cy = H / 2;
      const radius = Math.min(W, H) / 2 - 2;
      // Map a normalised [0,1] coord to a screen pixel. The rectangular variant
      // spreads [0,1]² across the full surface; the circular variant maps the
      // central unit disc onto the inscribed circle so the [0,1]² clamp lines up
      // exactly with the drawn rim (and stays a true circle when W ≠ H). x and y
      // map independently (the circular transform is separable).
      const sx = circular ? (nx: number) => cx + (nx - 0.5) * 2 * radius : (nx: number) => nx * W;
      const sy = circular ? (ny: number) => cy - (ny - 0.5) * 2 * radius : (ny: number) => (1 - ny) * H;

      if (fl && !draggingRef.current && !fz && !followMouseRef.current) {
        let [x, y] = p;
        const d = driftRef.current;
        x += d.vx;
        y += d.vy;
        if (x < 0.05 || x > 0.95) d.vx *= -1;
        if (y < 0.05 || y > 0.95) d.vy *= -1;
        x = Math.max(0.05, Math.min(0.95, x));
        y = Math.max(0.05, Math.min(0.95, y));
        if (circular) {
          // Keep the auto-drift inside the disc too, so it never wanders past
          // the drawn rim into the corners.
          const dx = x - 0.5;
          const dy = y - 0.5;
          const dd = Math.hypot(dx, dy);
          if (dd > 0.5) {
            x = 0.5 + (dx / dd) * 0.5;
            y = 0.5 + (dy / dd) * 0.5;
          }
        }
        onMove(x, y);
      }

      ctx.clearRect(0, 0, W, H);

      // In the circular variant, clip everything (grid, trail, marks) to the disc.
      if (circular) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();
      }

      const minor = 32;
      const major = 8;
      ctx.lineWidth = 1;
      for (let i = 0; i <= minor; i++) {
        const t = i / minor;
        const isMajor = i % (minor / major) === 0;
        ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.022)';
        ctx.beginPath();
        ctx.moveTo(t * W, 0);
        ctx.lineTo(t * W, H);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, t * H);
        ctx.lineTo(W, t * H);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H);
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();

      // Circular radial guide rings (joystick-style) inside the clip.
      if (circular) {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (const f of [0.33, 0.66]) {
          ctx.beginPath();
          ctx.arc(cx, cy, radius * f, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const px = sx(p[0]);
      const py = sy(p[1]);

      for (const pin of pn) {
        const ppx = sx(pin.x);
        const ppy = sy(pin.y);
        ctx.fillStyle = pin.color || 'rgba(255,106,0,0.18)';
        ctx.beginPath();
        ctx.arc(ppx, ppy, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ppx, ppy, 34, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Feedback markers: positive = filled accent dot, negative = open red
      // ring. Plotted at the input location each verdict was given (session).
      for (const m of mk) {
        const mx = sx(m.x);
        const my = sy(m.y);
        if (m.polarity === 'positive') {
          ctx.fillStyle = 'rgba(255,106,0,0.9)';
          ctx.beginPath();
          ctx.arc(mx, my, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,106,0,0.35)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(mx, my, 8.5, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeStyle = 'rgba(255,68,102,0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(mx, my, 6.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const LIFE = 5000;
      const pts = trailRef.current;
      ctx.lineWidth = 2;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const age = now - b.t;
        if (age > LIFE) continue;
        const alpha = (1 - age / LIFE) * 0.5;
        ctx.strokeStyle = `rgba(0,204,255,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(sx(a.x), sy(a.y));
        ctx.lineTo(sx(b.x), sy(b.y));
        ctx.stroke();
      }

      // Noise-cap exploration rings hidden for now (kept for possible later use).
      void nc;

      ctx.shadowColor = fz ? cyan : accent;
      ctx.shadowBlur = 18;
      ctx.fillStyle = fz ? cyan : accent;
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0d0d0d';
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();

      // PICK-LOCATION affordance: a pulsing dashed reticle prompting the tap.
      if (pk) {
        const pulse = 0.5 + Math.sin(now / 320) * 0.5;
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = `rgba(0,204,255,${0.45 + pulse * 0.45})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 22 + pulse * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Transient "just placed" anchor flash (~900ms).
      const placed = placedRef.current;
      if (placed) {
        const age = now - placed.t;
        if (age > 900) {
          placedRef.current = null;
        } else {
          const a = 1 - age / 900;
          const mx = sx(placed.x);
          const my = sy(placed.y);
          ctx.strokeStyle = `rgba(0,204,255,${a})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(mx, my, 10 + (1 - a) * 28, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = `rgba(0,204,255,${a * 0.4})`;
          ctx.beginPath();
          ctx.arc(mx, my, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Restore the disc clip + draw the crisp circular boundary on the edge.
      if (circular) {
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let kicks = 0;
    const kick = () => {
      draw();
      if (lastW <= 0 && kicks++ < 80) timer = setTimeout(kick, 40);
    };
    kick();
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // FOLLOW-MOUSE: while active, a window-level listener drives the knob from the
  // raw cursor position (anywhere on screen), and Escape exits. Kept on `window`
  // so it keeps tracking even when the cursor leaves this surface.
  useEffect(() => {
    if (!followMouse) return;
    const onWinMove = (e: PointerEvent) => {
      if (stateRef.current.frozen) return;
      const p = posFromClient(e.clientX, e.clientY);
      onMoveRef.current(p[0], p[1]);
    };
    const onWinKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFollowMouse(false);
    };
    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('keydown', onWinKey);
    return () => {
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('keydown', onWinKey);
    };
    // posFromClient/onMoveRef read live refs, so [followMouse] is the only dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followMouse]);

  return (
    <div
      ref={wrapRef}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        inset: 0,
        cursor: frozen ? 'not-allowed' : picking ? 'cell' : followMouse ? 'none' : 'crosshair',
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {followMouse && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 10px',
            fontSize: 'var(--fs-xs)',
            color: 'var(--accent)',
            background: 'rgba(13,13,13,0.7)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-1)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 30,
          }}
        >
          <span style={{ fontSize: 8 }}>●</span> following mouse — Esc / double-click to exit
        </div>
      )}
    </div>
  );
}
