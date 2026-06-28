/* Console 2.0 — InputMini: the input demoted to a small secondary control for
   the output-first views. A compact joy-map / XY pad in a glass card; still
   drives inference, but no longer the hero. */
function InputMini({ mode, pos, onMove, noiseCap, size = 132, corner = 'bottom-left' }) {
  const DS = window.ManifoldDesignSystem_490915;
  const Pad = mode.input === 'joystick' ? DS.VirtualJoystick : DS.XYPad;
  const place = {
    'bottom-left': { bottom: 14, left: 14 },
    'bottom-right': { bottom: 14, right: 14 },
    'top-left': { top: 14, left: 14 },
  }[corner];
  return (
    <div style={{ position: 'absolute', zIndex: 22, ...place,
      background: 'var(--glass)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      border: '1px solid var(--glass-line)', borderRadius: 'var(--r-2)', padding: 'var(--sp-2)',
      display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>input · {mode.input === 'joystick' ? 'joy' : 'xy'}</span>
        <span style={{ fontSize: 10, color: 'var(--fg-mute)', fontVariantNumeric: 'tabular-nums' }}>{pos[0].toFixed(2)},{pos[1].toFixed(2)}</span>
      </div>
      <Pad size={size} position={pos} onMove={(x, y) => onMove(x, y)} showGrid />
    </div>
  );
}
window.InputMini = InputMini;
