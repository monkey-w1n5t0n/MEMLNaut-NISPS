import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

export interface XYPadProps {
  size?: number;
  showGrid?: boolean;
  /** Controlled position as [x, y] in [0,1], y-up. Omit for uncontrolled. */
  position?: [number, number];
  onMove?: (x: number, y: number) => void;
  onGrab?: () => void;
  onRelease?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  style?: CSSProperties;
}

/**
 * Manifold XYPad — square control surface. Drag the glowing cyan dot; emits
 * normalised (x, y) in [0,1] with y-up. Uncontrolled by default; pass
 * `position` + `onMove` to control it.
 */
export function XYPad({
  size = 240,
  showGrid = true,
  position,
  onMove,
  onGrab,
  onRelease,
  disabled = false,
  ariaLabel = 'XY pad',
  style,
}: XYPadProps) {
  const [internal, setInternal] = useState<[number, number]>([0.5, 0.5]);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pos = position ?? internal;

  const update = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    if (!position) setInternal([x, y]);
    onMove?.(x, y);
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    onGrab?.();
    update(e);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging) update(e);
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
    onRelease?.();
  };

  const [x, y] = pos;
  return (
    <div
      ref={ref}
      role="application"
      aria-label={ariaLabel}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      style={{
        position: 'relative',
        width: size,
        height: size,
        background: 'var(--bg-1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-2)',
        touchAction: 'none',
        cursor: 'crosshair',
        outline: 'none',
        userSelect: 'none',
        overflow: 'hidden',
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        ...style,
      }}
    >
      {showGrid && (
        <div
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, opacity: 0.5, pointerEvents: 'none' }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '50%',
              height: 1,
              background: 'var(--line-strong)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '50%',
              width: 1,
              background: 'var(--line-strong)',
            }}
          />
        </div>
      )}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: 'var(--accent-2)',
          boxShadow: '0 0 10px var(--glow-accent-2)',
          transform: `translate(${x * size}px, ${(1 - y) * size}px) translate(-50%, -50%)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
