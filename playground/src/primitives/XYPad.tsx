import { Component, createMemo, createSignal } from 'solid-js';
import styles from './XYPad.module.css';

export interface XYPadProps {
  onMove: (x: number, y: number) => void;
  position?: () => readonly [number, number];
  disabled?: boolean;
  /** Width and height in px. Default 240. */
  size?: number;
  /** Show internal grid lines. */
  showGrid?: boolean;
  ariaLabel?: string;
  onRelease?: () => void;
  onGrab?: () => void;
}

export const XYPad: Component<XYPadProps> = (props) => {
  const size = () => props.size ?? 240;
  const showGrid = () => props.showGrid ?? true;
  const [internalPos, setInternalPos] = createSignal<readonly [number, number]>([0.5, 0.5]);
  const [dragging, setDragging] = createSignal(false);
  let containerEl: HTMLDivElement | undefined;

  const pos = () => props.position?.() ?? internalPos();

  const updateFromEvent = (e: PointerEvent) => {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    if (props.position === undefined) setInternalPos([x, y]);
    props.onMove(x, y);
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

  const dotStyle = createMemo(() => {
    const [x, y] = pos();
    const px = x * size();
    const py = (1 - y) * size();
    return `transform: translate(${px}px, ${py}px) translate(-50%, -50%);`;
  });

  return (
    <div
      ref={containerEl}
      class={styles.pad}
      classList={{ [styles.disabled]: !!props.disabled, [styles.dragging]: dragging() }}
      style={{ width: `${size()}px`, height: `${size()}px` }}
      role="application"
      tabIndex={props.disabled ? -1 : 0}
      aria-label={props.ariaLabel ?? 'XY pad'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKey}
    >
      {showGrid() && (
        <div class={styles.grid} aria-hidden="true">
          <div class={styles.gridH} />
          <div class={styles.gridV} />
        </div>
      )}
      <div class={styles.dot} style={dotStyle()} aria-hidden="true" />
    </div>
  );
};
