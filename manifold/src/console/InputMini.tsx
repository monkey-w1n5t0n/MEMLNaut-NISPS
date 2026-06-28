/**
 * InputMini — the input demoted to a compact secondary control for output-first
 * views. Ported from `InputMini.jsx`.
 */
import { VirtualJoystick, XYPad } from '../primitives';
import type { MFMode } from './model';

export interface InputMiniProps {
  mode: MFMode;
  pos: [number, number];
  onMove: (x: number, y: number) => void;
  noiseCap?: number;
  size?: number;
  corner?: 'bottom-left' | 'bottom-right' | 'top-left';
  /** Input-map shape override (Settings). Falls back to the mode's input. */
  variant?: 'rectangular' | 'circular';
}

export function InputMini({
  mode,
  pos,
  onMove,
  size = 132,
  corner = 'bottom-left',
  variant,
}: InputMiniProps) {
  const circular = variant ? variant === 'circular' : mode.input === 'joystick';
  const place = {
    'bottom-left': { bottom: 14, left: 14 },
    'bottom-right': { bottom: 14, right: 14 },
    'top-left': { top: 14, left: 14 },
  }[corner];
  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 22,
        ...place,
        background: 'var(--glass)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--glass-line)',
        borderRadius: 'var(--r-2)',
        padding: 'var(--sp-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: 'var(--fg-dim)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          input · {circular ? 'joy' : 'xy'}
        </span>
        <span
          style={{ fontSize: 10, color: 'var(--fg-mute)', fontVariantNumeric: 'tabular-nums' }}
        >
          {pos[0].toFixed(2)},{pos[1].toFixed(2)}
        </span>
      </div>
      {circular ? (
        <VirtualJoystick size={size} position={pos} onMove={(x, y) => onMove(x, y)} />
      ) : (
        <XYPad size={size} position={pos} onMove={(x, y) => onMove(x, y)} showGrid />
      )}
    </div>
  );
}
