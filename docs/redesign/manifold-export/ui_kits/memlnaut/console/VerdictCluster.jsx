/* Console 2.0 — Verdict cluster: floating bottom-center, the app's main control.
   ▽ perturb · ↺ undo · △ commit, + A/B toggle. Long-press perturb = full re-roll.
   Rests at low opacity, full on hover. */
function ThumbIcon({ size = 24, down = false }) {
  // Minimal line-icon thumb, hairline stroke in currentColor.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: down ? 'rotate(180deg)' : 'none', display: 'block' }} aria-hidden="true">
      <path d="M14 9V5a2.4 2.4 0 0 0-2.4-2.4L8 11v9h8.1a1.6 1.6 0 0 0 1.6-1.36l1.1-7.2A1.6 1.6 0 0 0 17.2 9z" />
      <path d="M8 20H5.6A1.6 1.6 0 0 1 4 18.4v-5.8A1.6 1.6 0 0 1 5.6 11H8" />
    </svg>
  );
}
window.ThumbIcon = ThumbIcon;

function VerdictCluster({ onPerturb, onUndo, onCommit, onReroll, canUndo, ab, onToggleAB, onHoldA, firstSession }) {
  const [hover, setHover] = React.useState(false);
  const lp = React.useRef(null);
  const firedReroll = React.useRef(false);

  const perturbDown = () => {
    firedReroll.current = false;
    lp.current = setTimeout(() => { firedReroll.current = true; onReroll(); }, 600);
  };
  const perturbUp = () => { clearTimeout(lp.current); if (!firedReroll.current) onPerturb(); };

  const big = (extra) => ({
    width: 64, height: 64, borderRadius: '50%', fontSize: 26, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)',
    border: '1px solid var(--glass-line)', transition: 'transform var(--dur-fast) var(--ease-console), background var(--dur-fast)', ...extra,
  });

  return (
    <div
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
      style={{
        position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-2) var(--sp-3)',
        background: 'var(--glass)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid var(--glass-line)', borderRadius: 'var(--r-pill)', boxShadow: 'var(--shadow-2)',
        opacity: hover || firstSession ? 1 : 0.55, transition: 'opacity var(--dur-med) var(--ease-console)', zIndex: 40,
      }}
    >
      <button type="button" title="Perturb — thumbs down (hold to re-roll)"
        onPointerDown={perturbDown} onPointerUp={perturbUp} onPointerLeave={() => clearTimeout(lp.current)}
        style={big({ background: 'rgba(255,68,102,0.16)', color: 'var(--danger)' })}
        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}><ThumbIcon down /></button>

      <button type="button" title="Undo (z)" onClick={onUndo} disabled={!canUndo}
        style={big({ width: 48, height: 48, fontSize: 20, background: 'var(--bg-2)', color: 'var(--fg-mute)', opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'not-allowed' })}>↺</button>

      <button type="button" title="Commit — thumbs up" onClick={onCommit}
        style={big({ background: 'rgba(255,106,0,0.18)', color: 'var(--accent)', boxShadow: '0 0 16px var(--glow-accent)' })}
        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}><ThumbIcon /></button>

      <div style={{ width: 1, height: 36, background: 'var(--glass-line)', margin: '0 2px' }} />

      <div
        title="A/B compare — hold to preview A"
        onPointerDown={() => onHoldA(true)} onPointerUp={() => onHoldA(false)} onPointerLeave={() => onHoldA(false)}
        onClick={onToggleAB}
        style={{ display: 'flex', borderRadius: 'var(--r-pill)', overflow: 'hidden', border: '1px solid var(--glass-line)', cursor: 'pointer', userSelect: 'none' }}>
        {['A', 'B'].map((k) => (
          <span key={k} style={{
            padding: '8px 14px', fontSize: 'var(--fs-sm)', fontWeight: 600,
            background: ab === k ? 'var(--accent)' : 'transparent', color: ab === k ? 'var(--bg)' : 'var(--fg-mute)',
          }}>{k}</span>
        ))}
      </div>
    </div>
  );
}
window.VerdictCluster = VerdictCluster;
