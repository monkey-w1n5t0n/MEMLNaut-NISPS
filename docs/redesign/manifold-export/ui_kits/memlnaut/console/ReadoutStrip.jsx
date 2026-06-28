/* Console 2.0 — Readout strip: the output heatmap as a control surface (the
   thin top strip in Console). Same model as OutputStage:
   - drag / click a cell → set value
   - ⌥/alt-click a cell  → cycle state (off → fixed → live)
   - hover a cell        → open the OutputEditor */
const RS_GROUP_COLOR = {
  formant: '--accent', pitch: '--accent-2', amp: '--good', filter: '--warn', fx: '--info', mod: '--accent-3',
};
const RS_NEXT = { off: 'fixed', fixed: 'live', live: 'off' };

function ReadoutStrip({ params, values, onChange, pinned, onTogglePin }) {
  const [open, setOpen] = React.useState(null);
  const timers = React.useRef({ open: null, close: null });
  const drag = React.useRef({ i: -1, moved: false, startY: 0, el: null, alt: false });

  const scheduleOpen = (i) => { clearTimeout(timers.current.close); clearTimeout(timers.current.open); timers.current.open = setTimeout(() => setOpen(i), 110); };
  const scheduleClose = () => { clearTimeout(timers.current.open); clearTimeout(timers.current.close); timers.current.close = setTimeout(() => setOpen(null), 280); };
  const hold = () => clearTimeout(timers.current.close);

  const valFromEvent = (el, clientY) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height)); };
  const down = (e, i) => { e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = { i, moved: false, startY: e.clientY, el: e.currentTarget, alt: e.altKey || e.metaKey }; };
  const move = (e, i) => { const d = drag.current; if (d.i !== i) return; if (Math.abs(e.clientY - d.startY) > 3) d.moved = true; if (d.moved && !d.alt) onChange(i, { val: valFromEvent(d.el, e.clientY) }); };
  const up = (e, i) => {
    const d = drag.current; if (d.i !== i) return;
    if (d.alt && !d.moved) onChange(i, { status: RS_NEXT[params[i].status] || 'live' });
    else if (!d.moved) onChange(i, { val: valFromEvent(d.el, e.clientY) });
    drag.current = { i: -1, moved: false, startY: 0, el: null, alt: false };
  };

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 2, height: 76, padding: '0 2px',
      background: 'var(--glass)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--glass-line)', position: 'relative', zIndex: 30 }}>
      <button type="button" onClick={onTogglePin} title="Pin strip open"
        style={{ flex: '0 0 auto', width: 30, border: 0, background: 'transparent', color: pinned ? 'var(--accent)' : 'var(--fg-dim)', cursor: 'pointer', fontSize: 'var(--fs-md)' }}>
        {pinned ? '📌' : '▾'}
      </button>
      {params.map((p, i) => {
        const eff = values[i] ?? 0;
        const gc = `var(${RS_GROUP_COLOR[p.group] || '--accent'})`;
        const dim = p.status === 'off';
        const placeRight = i > params.length - 5;
        return (
          <div key={i} style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
            onPointerLeave={scheduleClose}>
            {/* hover target: name ONLY (not the bar) */}
            <div onPointerEnter={() => scheduleOpen(i)} style={{ textAlign: 'center', fontSize: 8, fontFamily: 'var(--font-mono)', lineHeight: '11px', cursor: 'help',
              color: p.status === 'live' ? 'var(--fg-dim)' : gc, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{p.name}</div>
            <div onPointerDown={(e) => down(e, i)} onPointerMove={(e) => move(e, i)} onPointerUp={(e) => up(e, i)} onPointerCancel={(e) => up(e, i)}
              style={{ position: 'relative', flex: 1, background: 'var(--bg)', borderRadius: 2, overflow: 'hidden', cursor: 'ns-resize', opacity: dim ? 0.5 : 1, touchAction: 'none' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${eff * 100}%`, background: gc, opacity: 0.25 + eff * 0.6, transition: 'height 60ms linear' }} />
              {p.status === 'live' && <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${p.val * 100}%`, height: 0, borderTop: '1px dashed rgba(255,255,255,0.3)' }} />}
              {p.status !== 'live' && <div style={{ position: 'absolute', top: 1, left: 0, right: 0, textAlign: 'center', fontSize: 8, color: p.status === 'fixed' ? 'var(--accent-2)' : 'var(--fg-dim)' }}>{p.status === 'fixed' ? '⊟' : '∅'}</div>}
            </div>
            {open === i && (
              <window.OutputEditor param={p} onChange={(patch) => onChange(i, patch)} onHold={hold} onLeave={scheduleClose}
                place={{ top: 'calc(100% + 6px)', [placeRight ? 'right' : 'left']: 0 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
window.ReadoutStrip = ReadoutStrip;
