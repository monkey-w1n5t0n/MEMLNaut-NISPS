/**
 * DualRange — one bounded, dual-thumb control for an output's routing range.
 * The same control is used by the main-view output editor and the Outputs
 * drawer so min/max edits have identical interaction and clamping semantics.
 */
import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface DualRangeProps {
  min: number;
  max: number;
  onMin: (value: number) => void;
  onMax: (value: number) => void;
}

export function DualRange({ min, max, onMin, onMax }: DualRangeProps) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ which: 'min' | 'max' | null }>({ which: null });

  const valueAt = (clientX: number) => {
    const el = track.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const apply = (value: number) => {
    if (drag.current.which === 'min') onMin(Math.min(value, max));
    else if (drag.current.which === 'max') onMax(Math.max(value, min));
  };

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const value = valueAt(event.clientX);
    drag.current.which = Math.abs(value - min) <= Math.abs(value - max) ? 'min' : 'max';
    apply(value);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current.which) apply(valueAt(event.clientX));
  };

  const up = () => {
    drag.current.which = null;
  };

  return (
    <div
      ref={track}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      title={`range ${min.toFixed(2)}–${max.toFixed(2)}`}
      style={{
        position: 'relative',
        height: 16,
        flex: 1,
        minWidth: 60,
        background: 'var(--bg-1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-pill)',
        cursor: 'ew-resize',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${min * 100}%`,
          right: `${(1 - max) * 100}%`,
          background: 'linear-gradient(90deg, #4488ff, var(--accent))',
          opacity: 0.4,
          borderRadius: 'var(--r-pill)',
        }}
      />
      <Thumb pct={min} color="#4488ff" />
      <Thumb pct={max} color="var(--accent)" />
    </div>
  );
}

function Thumb({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: `${pct * 100}%`,
        width: 10,
        height: 10,
        marginLeft: -5,
        marginTop: -5,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 6px ${color}`,
      }}
    />
  );
}
