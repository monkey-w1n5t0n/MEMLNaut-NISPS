/* Console 2.0 — shared chrome for the simpler altitudes. */
const ALT_HREF = {
  in: { console: 'index.html', perform: 'perform.html', zen: 'zen.html' },
  split: { console: 'console-split.html', perform: 'perform-split.html', zen: 'zen-split.html' },
  out: { console: 'console-output.html', perform: 'perform-output.html', zen: 'zen-output.html' },
  composite: { console: 'console-composite.html', perform: 'perform-split.html', zen: 'zen-split.html' },
};
function AltitudeNav({ current, focus = 'in', style }) {
  const items = [
    { id: 'console', dots: '◆◆◆', label: 'Console' },
    { id: 'perform', dots: '◆◆', label: 'Perform' },
    { id: 'zen', dots: '◆', label: 'Zen' },
  ];
  const pill = (on) => ({ textDecoration: 'none', fontSize: 11, padding: '2px 8px', borderRadius: 'var(--r-pill)',
    color: on ? 'var(--accent)' : 'var(--fg-dim)', background: on ? 'rgba(255,106,0,0.14)' : 'transparent' });
  const foc = [['in', 'IN'], ['split', 'DUAL'], ['out', 'OUT'], ['composite', 'FLEX']];
  return (
    <div style={{ position: 'absolute', top: 12, right: 14, zIndex: 70, display: 'flex', gap: 6, alignItems: 'center',
      background: 'var(--glass)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      border: '1px solid var(--glass-line)', borderRadius: 'var(--r-pill)', padding: '4px 6px', ...style }}>
      {items.map((it) => (
        <a key={it.id} href={ALT_HREF[focus][it.id]} title={`${it.label} · ${focus}`}
          style={pill(it.id === current)}>{it.dots}</a>
      ))}
      <span style={{ width: 1, height: 16, background: 'var(--glass-line)' }} />
      {foc.map(([f, label]) => (
        <a key={f} href={ALT_HREF[f][current]} title={f === 'split' ? 'Input + output equal' : f === 'out' ? 'Output-first' : f === 'composite' ? 'Composite — drag to rebalance' : 'Input-first'}
          style={{ ...pill(focus === f), fontSize: 9, letterSpacing: '0.08em' }}>{label}</a>
      ))}
    </div>
  );
}

/* MiniMeters — glanceable read-only output bars (no interaction). */
function MiniMeters({ params, values }) {
  const GC = { formant: '--accent', pitch: '--accent-2', amp: '--good', filter: '--warn', fx: '--info', mod: '--accent-3' };
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
      {values.map((v, i) => (
        <div key={i} title={`${params[i].name}: ${v.toFixed(2)}`}
          style={{ width: 5, height: '100%', background: 'var(--bg-2)', borderRadius: 1, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${v * 100}%`,
            background: `var(${GC[params[i].group] || '--accent'})`, opacity: 0.3 + v * 0.6 }} />
        </div>
      ))}
    </div>
  );
}

/* CompactAxis — slim labelled feel slider for the Perform bar. */
function CompactAxis({ label, value, onChange, accent = 'var(--accent)' }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontFamily: 'var(--font-mono)' }}>
      <span style={{ width: 64, fontSize: 10, color: 'var(--fg-mute)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <input type="range" min="0" max="1" step="0.01" value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mf-slider-input" style={{ width: 120, '--mf-axis-accent': accent }} />
      <span style={{ width: '3ch', fontSize: 10, color: 'var(--fg-dim)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{value.toFixed(2)}</span>
    </label>
  );
}

window.AltitudeNav = AltitudeNav;
window.MiniMeters = MiniMeters;
window.CompactAxis = CompactAxis;
