/* Console 2.0 — OutputStage: the OUTPUT as the hero surface. A full-bleed field
   of parameter columns. Per column: name on top, value below it, then the bar.
   - drag / click a bar  → set the value
   - ⌥/alt-click a bar   → cycle state (off → fixed → live)
   - hover a column      → open the OutputEditor (state · min · max · value · curve) */
const OUT_GROUP_COLOR = {
  formant: '--accent', pitch: '--accent-2', amp: '--good', filter: '--warn', fx: '--info', mod: '--accent-3',
};
const OUT_NEXT = { off: 'fixed', fixed: 'live', live: 'off' };

function OutputStage({ params, values, onChange, compact = false }) {
  const [open, setOpen] = React.useState(null);
  const timers = React.useRef({ open: null, close: null });
  const drag = React.useRef({ i: -1, moved: false, startY: 0, el: null, alt: false });

  const scheduleOpen = (i) => { clearTimeout(timers.current.close); clearTimeout(timers.current.open); timers.current.open = setTimeout(() => setOpen(i), 110); };
  const scheduleClose = () => { clearTimeout(timers.current.open); clearTimeout(timers.current.close); timers.current.close = setTimeout(() => setOpen(null), 280); };
  const hold = () => clearTimeout(timers.current.close);

  const valFromEvent = (el, clientY) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height)); };
  const down = (e, i) => { e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = { i, moved: false, startY: e.clientY, el: e.currentTarget, alt: e.altKey || e.metaKey }; };
  const move = (e, i) => {
    const d = drag.current; if (d.i !== i) return;
    if (Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    if (d.moved && !d.alt) onChange(i, { val: valFromEvent(d.el, e.clientY) });
  };
  const up = (e, i) => {
    const d = drag.current; if (d.i !== i) return;
    if (d.alt && !d.moved) onChange(i, { status: OUT_NEXT[params[i].status] || 'live' });
    else if (!d.moved) onChange(i, { val: valFromEvent(d.el, e.clientY) });
    drag.current = { i: -1, moved: false, startY: 0, el: null, alt: false };
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'stretch', gap: compact ? 3 : 6, padding: compact ? 12 : '20px 28px' }}>
      {params.map((p, i) => {
        const eff = values[i] ?? 0;
        const gc = `var(${OUT_GROUP_COLOR[p.group] || '--accent'})`;
        const dim = p.status === 'off';
        const placeRight = i > params.length - 4;
        return (
          <div key={i} style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: compact ? 1 : 2 }}
            onPointerLeave={scheduleClose}>
            {/* hover target: name + number ONLY (not the bar) */}
            <div onPointerEnter={() => scheduleOpen(i)} style={{ cursor: 'help' }}>
            {/* name (top) */}
            <div style={{ textAlign: 'center', fontSize: compact ? 8 : 10, fontFamily: 'var(--font-mono)', color: p.status === 'live' ? 'var(--fg-mute)' : `var(${OUT_GROUP_COLOR[p.group] || '--accent'})`,
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', letterSpacing: '0.02em' }}>{p.name}</div>
            {/* number (below name) */}
            <div style={{ textAlign: 'center', fontSize: compact ? 9 : 11, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
              color: dim ? 'var(--fg-dim)' : 'var(--fg)' }}>{eff.toFixed(2)}</div>
            </div>
            {/* bar */}
            <div onPointerDown={(e) => down(e, i)} onPointerMove={(e) => move(e, i)} onPointerUp={(e) => up(e, i)} onPointerCancel={(e) => up(e, i)}
              style={{ position: 'relative', flex: 1, background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: compact ? 2 : 'var(--r-1)', overflow: 'hidden', cursor: 'ns-resize', opacity: dim ? 0.55 : 1, touchAction: 'none' }}>
              {[0.25, 0.5, 0.75].map((t) => <div key={t} style={{ position: 'absolute', left: 0, right: 0, bottom: `${t * 100}%`, height: 1, background: 'rgba(255,255,255,0.04)' }} />)}
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${eff * 100}%`, background: gc, opacity: 0.22 + eff * 0.6, transition: 'height 70ms linear' }} />
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${eff * 100}%`, height: 2, marginBottom: -1, background: gc, boxShadow: `0 0 8px ${gc}`, opacity: dim ? 0.4 : 0.9 }} />
              {/* static-value ghost when live */}
              {p.status === 'live' && (
                <div style={{ position: 'absolute', left: 1, right: 1, bottom: `${p.val * 100}%`, height: 0, borderTop: '1px dashed rgba(255,255,255,0.35)' }} />
              )}
              {/* state glyph */}
              <div style={{ position: 'absolute', top: 3, left: 0, right: 0, textAlign: 'center', fontSize: 9,
                color: p.status === 'live' ? 'transparent' : p.status === 'fixed' ? 'var(--accent-2)' : 'var(--fg-dim)' }}>
                {p.status === 'fixed' ? '⊟' : p.status === 'off' ? '∅' : ''}
              </div>
            </div>
            {open === i && !compact && (
              <window.OutputEditor param={p} onChange={(patch) => onChange(i, patch)} onHold={hold} onLeave={scheduleClose}
                place={{ top: 38, [placeRight ? 'right' : 'left']: 0 }} />
            )}
            {open === i && compact && (
              <window.OutputEditor param={p} onChange={(patch) => onChange(i, patch)} onHold={hold} onLeave={scheduleClose}
                place={{ top: 26, [placeRight ? 'right' : 'left']: 0 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
window.OutputStage = OutputStage;
