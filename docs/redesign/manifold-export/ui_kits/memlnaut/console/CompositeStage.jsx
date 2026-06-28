/* Console 2.0 — CompositeStage: ONE continuous view that becomes inputs-first,
   outputs-first, or 50/50 by dragging a single divider. No discrete modes — the
   layout is a single ratio `split` ∈ [0,1] (= the input's share of the width):
     split → 1   inputs-first  (output demotes to a slim readout list, then a minimap)
     split = 0.5 dual / 50-50
     split → 0   outputs-first (input demotes to a pad, then a minimap)
   Pull the seam ALL THE WAY to an edge and the small side snaps shut, popping
   out as a draggable minimap rectangle that lives in any corner. Each panel
   chooses its own representation from its MEASURED width, so it never becomes a
   useless sliver — it demotes. Handle snaps to 0.14·0.33·0.5·0.66·0.86 with
   light magnetism; presets tween the ratio. */
function CompositeStage({ split, onSplit, mode, pos, onMove, noiseCap, pins, follow, onLongPress, params, values, onChange }) {
  const ref = React.useRef(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const drag = React.useRef(false);
  const splitRef = React.useRef(split); splitRef.current = split;

  const SNAPS = [0.14, 0.33, 0.5, 0.66, 0.86];
  const MAGNET = 0.026;
  const SHUT = 0.1; // pull past this and the small side collapses to a minimap

  // which corner each minimap rests in (persisted)
  const [inCorner, setInCorner] = React.useState(() => localStorage.getItem('mf-mm-incorner') || 'tl');
  const [outCorner, setOutCorner] = React.useState(() => localStorage.getItem('mf-mm-outcorner') || 'tl');
  React.useEffect(() => { localStorage.setItem('mf-mm-incorner', inCorner); }, [inCorner]);
  React.useEffect(() => { localStorage.setItem('mf-mm-outcorner', outCorner); }, [outCorner]);

  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    // Only commit non-zero measurements; some hosts lay out the flex child after
    // mount, so the first read can be 0. Keep ResizeObserver AND a setTimeout
    // kick loop (RO is withheld in some preview contexts) until width is real.
    const read = () => { if (el.clientWidth) setSize({ w: el.clientWidth, h: el.clientHeight }); };
    const ro = new ResizeObserver(read); ro.observe(el); read();
    let t = null, k = 0;
    const kick = () => { read(); if (!el.clientWidth && k++ < 80) t = setTimeout(kick, 40); };
    kick();
    return () => { ro.disconnect(); clearTimeout(t); };
  }, []);

  const setFromClientX = (clientX) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    let f = (clientX - r.left) / r.width;
    f = Math.max(0, Math.min(1, f));
    if (f < SHUT) f = 0;            // collapse input → minimap
    else if (f > 1 - SHUT) f = 1;  // collapse output → minimap
    else for (const s of SNAPS) if (Math.abs(f - s) < MAGNET) { f = s; break; }
    onSplit(f);
  };
  const down = (e) => { drag.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); setFromClientX(e.clientX); };
  const move = (e) => { if (drag.current) setFromClientX(e.clientX); };
  const up = (e) => { drag.current = false; e.currentTarget.releasePointerCapture?.(e.pointerId); };

  const tweenTo = (target) => {
    const start = splitRef.current, t0 = performance.now(), dur = 300;
    const ease = (p) => 1 - Math.pow(1 - p, 3);
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / dur);
      onSplit(start + (target - start) * ease(p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const { w, h } = size;
  const knownW = w > 0; // until measured, default both sides to their hero tier
  const collapsed = split <= 0.001 ? 'in' : split >= 0.999 ? 'out' : null;
  const wIn = w * split, wOut = w * (1 - split);
  const inTier = (!knownW || wIn >= 300) ? 'full' : 'pad';
  const outTier = (!knownW || wOut >= 230) ? 'field' : 'list';

  const DS = window.ManifoldDesignSystem_490915;
  const Pad = mode && mode.input === 'joystick' ? DS.VirtualJoystick : DS.XYPad;
  const tag = (text, side) => (
    <div style={{ position: 'absolute', top: 10, [side]: 12, zIndex: 8, pointerEvents: 'none',
      fontSize: 9, letterSpacing: '0.14em', color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>{text}</div>
  );

  // ---- INPUT panel content by tier (non-collapsed) ----
  const renderInput = () => {
    if (inTier === 'full') {
      return <window.Manifold pos={pos} onMove={onMove} noiseCap={noiseCap} pins={pins} follow={follow} onLongPress={onLongPress} />;
    }
    const s = Math.max(88, Math.min(wIn - 28, h - 88));
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <Pad size={s} position={pos} onMove={(x, y) => onMove(x, y)} showGrid />
        <span style={{ fontSize: 10, color: 'var(--fg-mute)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
          {pos[0].toFixed(2)}, {pos[1].toFixed(2)}
        </span>
      </div>
    );
  };

  // ---- OUTPUT panel content by tier (non-collapsed) ----
  const GC = { formant: '--accent', pitch: '--accent-2', amp: '--good', filter: '--warn', fx: '--info', mod: '--accent-3' };
  const renderOutput = () => {
    if (outTier === 'field') {
      return <window.OutputStage params={params} values={values} onChange={onChange} compact={wOut < 440} />;
    }
    return (
      <div style={{ position: 'absolute', inset: 0, padding: '34px 10px 12px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}>
        {params.map((p, i) => {
          const eff = values[i] ?? 0, gc = `var(${GC[p.group] || '--accent'})`, dim = p.status === 'off';
          const set = (cx, el) => { const r = el.getBoundingClientRect(); onChange(i, { val: Math.max(0, Math.min(1, (cx - r.left) / r.width)) }); };
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: dim ? 0.5 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontFamily: 'var(--font-mono)' }}>
                <span style={{ fontSize: 9, color: 'var(--fg-mute)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{p.name}</span>
                <span style={{ fontSize: 9, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{eff.toFixed(2)}</span>
              </div>
              <div onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); e.currentTarget._d = true; set(e.clientX, e.currentTarget); }}
                onPointerMove={(e) => { if (e.currentTarget._d) set(e.clientX, e.currentTarget); }}
                onPointerUp={(e) => { e.currentTarget._d = false; e.currentTarget.releasePointerCapture?.(e.pointerId); }}
                style={{ position: 'relative', height: 6, background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 999, cursor: 'ew-resize', touchAction: 'none' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${eff * 100}%`, background: gc, opacity: 0.6, borderRadius: 999 }} />
                <div style={{ position: 'absolute', left: `${eff * 100}%`, top: -2, width: 2, height: 10, marginLeft: -1, background: gc, boxShadow: `0 0 6px ${gc}` }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ---- minimap (the collapsed side as a draggable corner rectangle) ----
  const CORNERS = { tl: { top: 62, left: 14 }, tr: { top: 62, right: 14 }, bl: { bottom: 14, left: 14 }, br: { bottom: 14, right: 14 } };
  const [mmPos, setMmPos] = React.useState(null); // {x,y,side} while dragging
  const mmRef = React.useRef({ side: null });
  const mmDown = (side) => (e) => {
    const card = e.currentTarget.closest('[data-mm]'); if (!card || !ref.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const r = ref.current.getBoundingClientRect(), cr = card.getBoundingClientRect();
    mmRef.current = { side, dx: e.clientX - cr.left, dy: e.clientY - cr.top, cw: cr.width, ch: cr.height };
    setMmPos({ x: cr.left - r.left, y: cr.top - r.top, side });
  };
  const mmMove = (e) => {
    const m = mmRef.current; if (!m.side || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.width - m.cw - 8, e.clientX - r.left - m.dx));
    const y = Math.max(8, Math.min(r.height - m.ch - 8, e.clientY - r.top - m.dy));
    setMmPos({ x, y, side: m.side });
  };
  const mmUp = (e) => {
    const m = mmRef.current; if (!m.side || !ref.current) return;
    const r = ref.current.getBoundingClientRect(), p = mmPos || { x: 0, y: 0 };
    const corner = (p.y + m.ch / 2 < r.height / 2 ? 't' : 'b') + (p.x + m.cw / 2 < r.width / 2 ? 'l' : 'r');
    (m.side === 'in' ? setInCorner : setOutCorner)(corner);
    mmRef.current = { side: null }; setMmPos(null);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const miniCard = (side, corner, body) => {
    const dragging = mmPos && mmPos.side === side;
    const place = dragging ? { left: mmPos.x, top: mmPos.y } : CORNERS[corner];
    const restore = () => tweenTo(0.5);
    return (
      <div data-mm={side} style={{ position: 'absolute', zIndex: 65, ...place,
        background: 'var(--glass)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--glass-line)', borderRadius: 'var(--r-2)', boxShadow: 'var(--shadow-2)',
        padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* header = drag handle */}
        <div onPointerDown={mmDown(side)} onPointerMove={mmMove} onPointerUp={mmUp} onPointerCancel={mmUp}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'move', touchAction: 'none', userSelect: 'none' }}>
          <span style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--fg-mute)', fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: 'var(--fg-dim)' }}>⠿</span> {side === 'in' ? 'INPUT' : 'OUTPUT'}
          </span>
          <button type="button" onClick={restore} title="expand back to dual"
            style={{ border: 'none', background: 'transparent', color: 'var(--fg-dim)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>⤢</button>
        </div>
        {body}
      </div>
    );
  };
  const miniInput = () => miniCard('in', inCorner, (
    <Pad size={118} position={pos} onMove={(x, y) => onMove(x, y)} showGrid />
  ));
  const miniOutput = () => miniCard('out', outCorner, (
    <div style={{ width: 168 }}>
      <window.MiniMeters params={params} values={values} />
    </div>
  ));

  // ---- divider geometry ----
  const pctIn = Math.round(split * 100);
  const presetActive = Math.abs(split - 0.86) < 0.04 ? 'in' : Math.abs(split - 0.14) < 0.04 ? 'out' : Math.abs(split - 0.5) < 0.04 ? 'dual' : null;
  const presetBtn = (id, label, target) => (
    <button type="button" onClick={() => tweenTo(target)} title={label}
      style={{ fontSize: 9, letterSpacing: '0.08em', padding: '3px 9px', borderRadius: 'var(--r-pill)', cursor: 'pointer', fontFamily: 'var(--font-mono)',
        border: `1px solid ${presetActive === id ? 'var(--accent)' : 'transparent'}`,
        background: presetActive === id ? 'rgba(255,106,0,0.14)' : 'transparent',
        color: presetActive === id ? 'var(--accent)' : 'var(--fg-dim)' }}>{label}</button>
  );
  const handleLeft = split <= 0 ? '0%' : split >= 1 ? '100%' : `${split * 100}%`;
  const handleMargin = split <= 0 ? 0 : split >= 1 ? -18 : -9;

  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {collapsed === 'in' ? (
        <React.Fragment>
          <div style={{ position: 'absolute', inset: 0 }}>{tag('OUTPUT', 'right')}{renderOutput()}</div>
          {miniInput()}
        </React.Fragment>
      ) : collapsed === 'out' ? (
        <React.Fragment>
          <div style={{ position: 'absolute', inset: 0 }}>{tag('INPUT', 'left')}{renderInput()}</div>
          {miniOutput()}
        </React.Fragment>
      ) : (
        <React.Fragment>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${split * 100}%`, overflow: 'hidden' }}>
            {tag('INPUT', 'left')}{renderInput()}
          </div>
          <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${(1 - split) * 100}%`, borderLeft: '1px solid var(--line)', overflow: 'hidden' }}>
            {tag('OUTPUT', 'right')}{renderOutput()}
          </div>
          {SNAPS.map((s) => (
            <div key={s} style={{ position: 'absolute', top: 0, left: `${s * 100}%`, width: 1, height: 6, marginLeft: -0.5,
              background: 'var(--line-strong)', opacity: Math.abs(split - s) < 0.012 ? 0 : 0.6, pointerEvents: 'none', zIndex: 14 }} />
          ))}
        </React.Fragment>
      )}

      {/* the divider handle — at the seam, or an edge tab when collapsed */}
      <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={() => tweenTo(presetActive === 'dual' ? 0.86 : presetActive === 'in' ? 0.14 : 0.5)}
        title={collapsed ? 'pull to reveal' : 'drag to rebalance · double-click to cycle'}
        style={{ position: 'absolute', top: 0, bottom: 0, left: handleLeft, width: 18, marginLeft: handleMargin, zIndex: 26,
          cursor: 'col-resize', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: collapsed === 'out' ? 'auto' : 9, right: collapsed === 'out' ? 9 : 'auto',
          width: 1, background: 'var(--accent)', opacity: collapsed ? 0.5 : 0.35 }} />
        <div style={{ width: 6, height: 46, borderRadius: 999, background: 'var(--bg-3)', border: '1px solid var(--line-strong)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, boxShadow: '0 0 0 4px var(--bg)' }}>
          {[0, 1, 2].map((k) => <span key={k} style={{ width: 2, height: 2, borderRadius: '50%', background: 'var(--fg-mute)' }} />)}
        </div>
      </div>

      {/* presets + ratio readout, top-centre */}
      <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 16,
        display: 'flex', alignItems: 'center', gap: 4, background: 'var(--glass)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid var(--glass-line)', borderRadius: 'var(--r-pill)', padding: '3px 5px' }}>
        {presetBtn('in', 'input', 0.86)}
        {presetBtn('dual', 'dual', 0.5)}
        {presetBtn('out', 'output', 0.14)}
        <span style={{ width: 1, height: 14, background: 'var(--glass-line)' }} />
        <span style={{ fontSize: 9, color: 'var(--fg-mute)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', padding: '0 4px' }}>
          in {pctIn} · out {100 - pctIn}
        </span>
      </div>
    </div>
  );
}
window.CompositeStage = CompositeStage;
