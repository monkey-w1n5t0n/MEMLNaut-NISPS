/**
 * EOCJoystick — Small independent joystick for the EOC "Independent" NISPS mode.
 *
 * A 120x120 canvas joystick positioned in the bottom-left corner of the
 * viewport. Only visible when the EOCChain's nispsMode is 'independent'.
 *
 * Pointer event handling mirrors the main Joystick component but is
 * self-contained (no InputStore dependency) because it drives a separate
 * EOC-specific MLP input. Current position is reported via the onPosition
 * callback as normalised [0, 1] pairs.
 *
 * Props:
 *   visible    — whether to render (pass `chain.nispsMode === 'independent'`)
 *   onPosition — called with (x, y) in [0,1] on every pointer move
 */

import { createSignal, onMount, createEffect } from 'solid-js';
import './eoc-panel.css';

const SIZE = 120;

export interface EOCJoystickProps {
  visible: boolean;
  onPosition?: (x: number, y: number) => void;
}

export default function EOCJoystick(props: EOCJoystickProps) {
  let canvasRef: HTMLCanvasElement | undefined;

  const [x, setX] = createSignal(0.5);
  const [y, setY] = createSignal(0.5);
  const [dragging, setDragging] = createSignal(false);

  // ── Drawing ─────────────────────────────────────────────────────────────

  function draw(): void {
    const canvas = canvasRef;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = SIZE;
    const r = s / 2;
    const cx = x() * s;
    const cy = y() * s;
    const touching = dragging();

    ctx.clearRect(0, 0, s, s);

    // Background circle
    ctx.beginPath();
    ctx.arc(r, r, r - 3, 0, Math.PI * 2);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Crosshairs
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r, 5);
    ctx.lineTo(r, s - 5);
    ctx.moveTo(5, r);
    ctx.lineTo(s - 5, r);
    ctx.stroke();

    // Quarter grid (dashed)
    ctx.strokeStyle = '#1a1a1a';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(s * 0.25, 5);  ctx.lineTo(s * 0.25, s - 5);
    ctx.moveTo(s * 0.75, 5);  ctx.lineTo(s * 0.75, s - 5);
    ctx.moveTo(5, s * 0.25);  ctx.lineTo(s - 5, s * 0.25);
    ctx.moveTo(5, s * 0.75);  ctx.lineTo(s - 5, s * 0.75);
    ctx.stroke();
    ctx.setLineDash([]);

    // Glow when touching
    if (touching) {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18);
      grad.addColorStop(0, 'rgba(0, 212, 255, 0.3)');
      grad.addColorStop(1, 'rgba(0, 212, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fill();
    }

    // Thumb dot
    ctx.fillStyle = touching ? '#00d4ff' : '#555';
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fill();

    // Position label
    ctx.fillStyle = '#444';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${x().toFixed(2)},${y().toFixed(2)}`, s - 4, s - 3);
  }

  // ── Pointer utils ────────────────────────────────────────────────────────

  function updateFromPointer(clientX: number, clientY: number): void {
    const canvas = canvasRef;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    setX(nx);
    setY(ny);
    props.onPosition?.(nx, ny);
  }

  function onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    canvasRef?.setPointerCapture(e.pointerId);
    setDragging(true);
    updateFromPointer(e.clientX, e.clientY);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging()) return;
    updateFromPointer(e.clientX, e.clientY);
  }

  function onPointerUp(_e: PointerEvent): void {
    setDragging(false);
  }

  // ── Reactivity ──────────────────────────────────────────────────────────

  createEffect(() => {
    x(); y(); dragging();
    draw();
  });

  onMount(() => {
    draw();
  });

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      class="eoc-joystick-overlay"
      style={{ display: props.visible ? 'flex' : 'none' }}
      aria-hidden={!props.visible}
    >
      <canvas
        ref={canvasRef}
        class="eoc-joystick-canvas"
        width={SIZE}
        height={SIZE}
        style={{ width: `${SIZE}px`, height: `${SIZE}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <span class="eoc-joystick-label">FX</span>
    </div>
  );
}
