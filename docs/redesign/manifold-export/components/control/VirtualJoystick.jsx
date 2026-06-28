import React from 'react';

/**
 * Manifold VirtualJoystick — circular control. Drag the glowing orange knob;
 * motion is constrained to the circle. Emits normalized (x, y) in [0,1], y-up.
 */
export function VirtualJoystick({ size = 200, position, onMove, onGrab, onRelease, disabled = false, ariaLabel = 'virtual joystick', style }) {
  const [internal, setInternal] = React.useState([0.5, 0.5]);
  const [dragging, setDragging] = React.useState(false);
  const ref = React.useRef(null);
  const pos = position || internal;

  const update = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    let y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    const dx = x - 0.5, dy = y - 0.5;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0.5 && dist > 1e-12) { x = 0.5 + (dx / dist) * 0.5; y = 0.5 + (dy / dist) * 0.5; }
    if (!position) setInternal([x, y]);
    onMove && onMove(x, y);
  };

  const down = (e) => { if (disabled) return; e.currentTarget.setPointerCapture?.(e.pointerId); setDragging(true); onGrab && onGrab(); update(e); };
  const move = (e) => { if (dragging) update(e); };
  const up = (e) => { if (!dragging) return; e.currentTarget.releasePointerCapture?.(e.pointerId); setDragging(false); onRelease && onRelease(); };

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
        borderRadius: '50%',
        touchAction: 'none',
        cursor: dragging ? 'grabbing' : 'grab',
        outline: 'none',
        userSelect: 'none',
        overflow: 'hidden',
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        ...style,
      }}
    >
      <div style={{ position: 'absolute', inset: '6%', borderRadius: '50%', border: '1px dashed var(--line-strong)', pointerEvents: 'none' }} />
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, opacity: 0.4, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'var(--line-strong)' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'var(--line-strong)' }} />
      </div>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: 'var(--accent)',
          boxShadow: '0 0 12px var(--glow-accent)',
          transform: `translate(${x * size}px, ${(1 - y) * size}px) translate(-50%, -50%)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
