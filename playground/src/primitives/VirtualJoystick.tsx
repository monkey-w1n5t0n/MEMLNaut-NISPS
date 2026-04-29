import { Component, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import styles from './VirtualJoystick.module.css';

export interface VirtualJoystickProps {
  onMove: (x: number, y: number) => void;
  /** Optional controlled position [x, y] in [0,1]. */
  position?: () => readonly [number, number];
  disabled?: boolean;
  /** Pixel size of the square joystick area. */
  size?: number;
  /** Label for assistive tech. */
  ariaLabel?: string;
  /** Called on pointer up. */
  onRelease?: () => void;
  /** Called on pointer down (good for snapshots). */
  onGrab?: () => void;
}

const DEFAULT_SIZE = 200;

export const VirtualJoystick: Component<VirtualJoystickProps> = (props) => {
  const size = () => props.size ?? DEFAULT_SIZE;
  const [internalPos, setInternalPos] = createSignal<readonly [number, number]>([0.5, 0.5]);
  const [dragging, setDragging] = createSignal(false);

  let containerEl: HTMLDivElement | undefined;

  const pos = () => props.position?.() ?? internalPos();

  const updateFromEvent = (e: PointerEvent) => {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1 - (e.clientY - rect.top) / rect.height; // y-axis up
    const cx = Math.max(0, Math.min(1, x));
    const cy = Math.max(0, Math.min(1, y));
    // Constrain to circle
    const dx = cx - 0.5;
    const dy = cy - 0.5;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let outX = cx;
    let outY = cy;
    if (dist > 0.5 && dist > 1e-12) {
      outX = 0.5 + (dx / dist) * 0.5;
      outY = 0.5 + (dy / dist) * 0.5;
    }
    if (props.position === undefined) setInternalPos([outX, outY]);
    props.onMove(outX, outY);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (props.disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    props.onGrab?.();
    updateFromEvent(e);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging()) return;
    updateFromEvent(e);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging()) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDragging(false);
    props.onRelease?.();
  };

  // Keyboard accessibility: arrow keys nudge.
  const onKey = (e: KeyboardEvent) => {
    if (props.disabled) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    let [x, y] = pos();
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':  x -= step; break;
      case 'ArrowRight': x += step; break;
      case 'ArrowUp':    y += step; break;
      case 'ArrowDown':  y -= step; break;
      case 'Home':       x = 0.5; y = 0.5; break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
      if (props.position === undefined) setInternalPos([x, y]);
      props.onMove(x, y);
    }
  };

  const knobStyle = createMemo(() => {
    const [x, y] = pos();
    const px = x * size();
    const py = (1 - y) * size();
    return `transform: translate(${px}px, ${py}px) translate(-50%, -50%);`;
  });

  return (
    <div
      ref={containerEl}
      class={styles.container}
      classList={{ [styles.disabled]: !!props.disabled, [styles.dragging]: dragging() }}
      style={{ width: `${size()}px`, height: `${size()}px` }}
      role="application"
      tabIndex={props.disabled ? -1 : 0}
      aria-label={props.ariaLabel ?? 'virtual joystick'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKey}
    >
      <div class={styles.boundary} />
      <div class={styles.crosshair} aria-hidden="true">
        <div class={styles.hLine} />
        <div class={styles.vLine} />
      </div>
      <div class={styles.knob} style={knobStyle()} aria-hidden="true" />
    </div>
  );
};
