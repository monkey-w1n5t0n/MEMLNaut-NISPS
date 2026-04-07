/**
 * Joystick Component — Canvas-based touch/mouse joystick.
 *
 * Renders a circular joystick area with:
 *   - Crosshair grid background
 *   - Draggable thumb dot that follows pointer
 *   - Glow effect when touching
 *   - Follow mode (toggled by double-click) with badge and pulse
 *   - Noise ring indicator (RL exploration level)
 *   - Position readout at bottom
 *
 * Pointer events (unified mouse/touch):
 *   - pointerdown: start tracking, update position
 *   - pointermove: update position if dragging or follow mode
 *   - pointerup: end tracking (unless follow mode)
 *   - dblclick: toggle follow mode
 *
 * Position is reported in [0,1] range via InputStore.setJoystickPosition().
 * All values are clamped to [0,1].
 */

import {
  onMount,
  onCleanup,
  createEffect,
  createMemo,
  Show,
} from 'solid-js';
import type { InputStore } from '../../stores/input-store';
import type { MLStore } from '../../stores/ml-store';
import './joystick.css';

export interface JoystickProps {
  inputStore: InputStore;
  mlStore?: MLStore;
  size?: number;
}

export default function Joystick(props: JoystickProps) {
  let canvasRef: HTMLCanvasElement | undefined;
  const size = () => props.size ?? 180;

  // ─── Noise ring class computation ─────────────────────────────────

  const noiseRingClass = createMemo(() => {
    const mlStore = props.mlStore;
    if (!mlStore) return 'noise-ring';
    const noise = mlStore.noiseLevel();
    if (noise > 0.15) return 'noise-ring active high';
    if (noise > 0.01) return 'noise-ring active';
    return 'noise-ring';
  });

  // ─── Drawing ─────────────────────────────────────────────────────

  function draw(): void {
    const canvas = canvasRef;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = size();
    const r = s / 2;
    const x = props.inputStore.joyX();
    const y = props.inputStore.joyY();
    const touching = props.inputStore.isDragging();
    const follow = props.inputStore.followMode();

    ctx.clearRect(0, 0, s, s);

    // Background circle
    ctx.beginPath();
    ctx.arc(r, r, r - 4, 0, Math.PI * 2);
    ctx.strokeStyle = follow ? '#cc5500' : '#333';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Crosshairs
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r, 6);
    ctx.lineTo(r, s - 6);
    ctx.moveTo(6, r);
    ctx.lineTo(s - 6, r);
    ctx.stroke();

    // Grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(s * 0.25, 6);
    ctx.lineTo(s * 0.25, s - 6);
    ctx.moveTo(s * 0.75, 6);
    ctx.lineTo(s * 0.75, s - 6);
    ctx.moveTo(6, s * 0.25);
    ctx.lineTo(s - 6, s * 0.25);
    ctx.moveTo(6, s * 0.75);
    ctx.lineTo(s - 6, s * 0.75);
    ctx.stroke();
    ctx.setLineDash([]);

    // Thumb position
    const tx = x * s;
    const ty = y * s;

    // Glow
    if (touching) {
      const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, 24);
      grad.addColorStop(0, 'rgba(255, 106, 0, 0.3)');
      grad.addColorStop(1, 'rgba(255, 106, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(tx, ty, 24, 0, Math.PI * 2);
      ctx.fill();
    }

    // Thumb dot
    ctx.fillStyle = touching ? '#ff6a00' : '#666';
    ctx.beginPath();
    ctx.arc(tx, ty, 14, 0, Math.PI * 2);
    ctx.fill();

    // Position text
    ctx.fillStyle = follow ? '#cc5500' : '#555';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(follow ? 'FOLLOW' : 'HOLD', 8, s - 6);
    ctx.textAlign = 'right';
    ctx.fillText(`${x.toFixed(2)}, ${y.toFixed(2)}`, s - 8, s - 6);
  }

  // ─── Pointer handlers ────────────────────────────────────────────

  function updateFromPointer(clientX: number, clientY: number): void {
    const canvas = canvasRef;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;

    props.inputStore.setJoystickPosition(x, y);
  }

  function onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    const canvas = canvasRef;
    if (canvas) {
      canvas.setPointerCapture(e.pointerId);
    }
    props.inputStore.setDragging(true);
    updateFromPointer(e.clientX, e.clientY);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!props.inputStore.isDragging()) return;
    updateFromPointer(e.clientX, e.clientY);
  }

  function onPointerUp(_e: PointerEvent): void {
    if (props.inputStore.followMode()) return;
    props.inputStore.setDragging(false);
    // Re-draw without glow
    draw();
  }

  function onDoubleClick(e: MouseEvent): void {
    e.preventDefault();
    props.inputStore.toggleFollowMode();
    // Update position to where the double-click happened
    updateFromPointer(e.clientX, e.clientY);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  // Re-draw when signals change
  createEffect(() => {
    // Read all reactive dependencies
    props.inputStore.joyX();
    props.inputStore.joyY();
    props.inputStore.isDragging();
    props.inputStore.followMode();
    // Also track noise level (triggers redraw for noise-dependent visuals)
    if (props.mlStore) props.mlStore.noiseLevel();
    draw();
  });

  onMount(() => {
    draw();
  });

  return (
    <div class="joystick-container" id="joystick">
      <canvas
        ref={canvasRef}
        width={size()}
        height={size()}
        style={{ width: `${size()}px`, height: `${size()}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDblClick={onDoubleClick}
      />
      <div class={noiseRingClass()} id="noise-ring" />
      <Show when={props.inputStore.followMode()}>
        <div class="follow-badge">FOLLOW</div>
      </Show>
    </div>
  );
}
