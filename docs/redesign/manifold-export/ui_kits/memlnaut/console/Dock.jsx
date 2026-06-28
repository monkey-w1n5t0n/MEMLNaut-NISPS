/* Console 2.0 — The Console: right-edge 48px dock rail + one mutually-exclusive
   drawer with three depth states (Peek 320 / Expand 520 / Full modal). */
function ModeSwitcher({ modes, modeId, setModeId }) {
  const [open, setOpen] = React.useState(false);
  const active = modes.find((m) => m.id === modeId) || modes[0];
  const classes = ['Synth', 'Sequencer', 'Controller', 'Visual'];
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} title={`Mode: ${active.label}`}
        style={{ width: 40, height: 40, borderRadius: 'var(--r-2)', border: '1px solid var(--accent)',
          background: 'rgba(255,106,0,0.12)', color: 'var(--accent)', cursor: 'pointer', fontSize: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{active.glyph || '⊞'}</button>
      {open && (
        <div style={{ position: 'absolute', top: 0, right: 'calc(100% + 8px)', width: 240, background: 'var(--glass)',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid var(--glass-line)',
          borderRadius: 'var(--r-2)', boxShadow: 'var(--shadow-2)', padding: 6, zIndex: 80 }}>
          {classes.map((cls) => {
            const items = modes.filter((m) => m.cls === cls);
            if (!items.length) return null;
            return (
              <div key={cls}>
                <div style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '6px 8px 2px' }}>{cls}</div>
                {items.map((m) => (
                  <button key={m.id} type="button" disabled={m.placeholder}
                    onClick={() => { if (m.placeholder) return; setModeId(m.id); setOpen(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                      background: m.id === modeId ? 'var(--bg-3)' : 'transparent', border: 0, borderRadius: 'var(--r-1)',
                      padding: '6px 8px', cursor: m.placeholder ? 'not-allowed' : 'pointer', opacity: m.placeholder ? 0.4 : 1,
                      fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: m.id === modeId ? 'var(--accent)' : 'var(--fg)' }}>
                    <span style={{ width: 16, textAlign: 'center' }}>{m.glyph || '·'}</span>{m.label}
                    {m.badge && <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--warn)' }}>{m.badge}</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Dock({ ctx, active, setActive, depth, setDepth }) {
  const sections = window.DRAWERS;
  const order = ['shape', 'feel', 'route', 'health', 'help'];

  const iconBtn = (key) => {
    const s = sections[key];
    const on = active === key;
    return (
      <button key={key} type="button" title={s.label} onClick={() => { setActive(on ? null : key); setDepth('peek'); }}
        style={{ position: 'relative', width: 40, height: 40, borderRadius: 'var(--r-2)', cursor: 'pointer',
          border: `1px solid ${on ? 'var(--accent)' : 'transparent'}`,
          background: on ? 'rgba(255,106,0,0.14)' : 'transparent', color: on ? 'var(--accent)' : 'var(--fg-mute)',
          fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background var(--dur-fast), color var(--dur-fast)' }}
        onMouseEnter={(e) => { if (!on) e.currentTarget.style.color = 'var(--fg)'; }}
        onMouseLeave={(e) => { if (!on) e.currentTarget.style.color = 'var(--fg-mute)'; }}>
        {s.icon}
        {key === 'feel' && active !== 'feel' && (
          <span style={{ position: 'absolute', bottom: 4, left: 6, right: 6, height: 2, borderRadius: 2,
            background: `linear-gradient(90deg, var(--accent) ${ctx.axes.boldness * 100}%, var(--line) 0)` }} />
        )}
      </button>
    );
  };

  const width = depth === 'expand' ? 520 : 320;
  const full = depth === 'full';
  const section = active ? sections[active] : null;

  return (
    <React.Fragment>
      {/* drawer */}
      {section && (
        <aside style={full ? {
          position: 'fixed', inset: 0, zIndex: 90, background: 'var(--glass)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          padding: 'var(--sp-6)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)',
        } : {
          position: 'absolute', top: 0, right: 48, bottom: 0, width, zIndex: 35,
          background: 'var(--glass)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          borderLeft: '1px solid var(--glass-line)', boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
          padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', overflow: 'auto',
          animation: 'mfDrawerIn var(--dur-med) var(--ease-console)',
        }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', borderBottom: '1px solid var(--glass-line)', paddingBottom: 'var(--sp-2)' }}>
            <span style={{ fontSize: 'var(--fs-md)', color: 'var(--accent)' }}>{section.icon}</span>
            <h3 style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--fg)' }}>{section.label}</h3>
            <span style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginLeft: 4 }}>{depth}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {!full && (
                <button type="button" title={depth === 'peek' ? 'More' : 'Peek'} onClick={() => setDepth(depth === 'peek' ? 'expand' : 'peek')}
                  style={dockMini}>⤢</button>
              )}
              <button type="button" title="Open full" onClick={() => setDepth(full ? 'peek' : 'full')} style={dockMini}>{full ? '⤡' : '⤢⤢'}</button>
              <button type="button" title="Close" onClick={() => setActive(null)} style={dockMini}>✕</button>
            </div>
          </header>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', flex: 1, ...(full ? { maxWidth: 720 } : {}) }}>
            {section.render(ctx, depth)}
          </div>
        </aside>
      )}

      {/* rail */}
      <nav style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 48, zIndex: 36,
        background: 'var(--glass)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderLeft: '1px solid var(--glass-line)', display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 'var(--sp-2)', padding: '8px 0' }}>
        <ModeSwitcher modes={ctx.modes} modeId={ctx.modeId} setModeId={ctx.setModeId} />
        <div style={{ width: 24, height: 1, background: 'var(--glass-line)', margin: '2px 0' }} />
        {order.map(iconBtn)}
      </nav>
    </React.Fragment>
  );
}
const dockMini = { width: 26, height: 24, borderRadius: 'var(--r-1)', border: '1px solid var(--line)', background: 'var(--bg-2)', color: 'var(--fg-mute)', cursor: 'pointer', fontSize: 11, lineHeight: 1 };
window.Dock = Dock;
