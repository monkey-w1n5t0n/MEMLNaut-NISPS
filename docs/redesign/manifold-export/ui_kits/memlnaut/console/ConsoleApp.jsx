/* Console 2.0 — the reactive spine + layout. One input → ML → output flow that
   every consumer (readout strip, manifold, health glow) reads. Pseudo-inference
   stands in for the WASM MLP; the structure mirrors the rewrite plan. */
const CA_DS = window.ManifoldDesignSystem_490915;

/* ---- shared model (modes + inference) lives in model.jsx ---- */
const MODES2 = window.MF_MODES;
const infer = window.MF_infer;
const seededGradient = window.MF_seededGradient;

let SNAP_ID = 0;

function ConsoleApp({ focus = 'in' }) {
  const [modeId, setModeId] = React.useState('paf_synth');
  const mode = MODES2.find((m) => m.id === modeId);
  const [params, setParams] = React.useState(() => mode.params.map((p) => ({ ...p })));
  const [pos, setPos] = React.useState([0.5, 0.5]);
  const [seed, setSeed] = React.useState(0.4);
  const [axes, setAxes] = React.useState({ boldness: 0.55, memory: 0.4, precision: 0.5 });
  const [preset, setPreset] = React.useState('Sculpt');
  const [noiseCap, setNoiseCap] = React.useState(0.12);
  const [examples, setExamples] = React.useState(0);
  const [addingExample, setAddingExample] = React.useState(false);
  const [loss, setLoss] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [snapshots, setSnapshots] = React.useState([]);
  const [ab, setAB] = React.useState('B');
  const [holdingA, setHoldingA] = React.useState(false);
  const aRef = React.useRef(null);
  const [spread, setSpread] = React.useState(false);
  const [tame, setTame] = React.useState(0.85);
  const [health, setHealth] = React.useState(0.8);
  const [rev, setRev] = React.useState(1);
  const [active, setActive] = React.useState('feel'); // auto-open Feel peek
  const [depth, setDepth] = React.useState('peek');
  const [follow, setFollow] = React.useState(false);
  const [split, setSplit] = React.useState(() => {
    const v = parseFloat(localStorage.getItem('mf-composite-split'));
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
  });
  React.useEffect(() => { localStorage.setItem('mf-composite-split', String(split)); }, [split]);
  const [stripPinned, setStripPinned] = React.useState(true);
  const [firstSession, setFirstSession] = React.useState(true);
  const [pins, setPins] = React.useState([]);

  // reset transient state on mode switch
  React.useEffect(() => {
    setParams(mode.params.map((p) => ({ ...p }))); setPos([0.5, 0.5]); setExamples(0);
    setLoss([]); setSnapshots([]); setSeed(0.4); setFollow(false); setPins([]);
    setActive('feel'); setDepth('peek');
  }, [modeId]);

  const effSeed = holdingA && aRef.current ? aRef.current.seed : seed;
  const values = React.useMemo(() => infer(pos, effSeed, params, axes), [pos, effSeed, params, axes]);
  const gradient = React.useMemo(() => seededGradient(rev), [rev]);

  const pushSnap = (tag) => setSnapshots((s) => [...s, { id: ++SNAP_ID, tag, noise: noiseCap, seed }].slice(-50));

  const commit = () => {
    setFirstSession(false); pushSnap('commit +'); setBusy(true);
    setNoiseCap((n) => Math.max(0.02, n * 0.7));
    setHealth((h) => Math.min(1, h + 0.08));
    setRev((r) => r + 1);
    setTimeout(() => {
      setLoss((prev) => { const base = prev.length ? prev[prev.length - 1] : 0.5; return [...prev, Math.max(0.004, base * (0.8 + Math.random() * 0.08))].slice(-120); });
      setBusy(false);
    }, 260);
  };
  const perturb = () => {
    setFirstSession(false); pushSnap('perturb −');
    setSeed((s) => s + (Math.random() - 0.5) * (noiseCap * 4 + 0.3));
    setNoiseCap((n) => Math.min(0.5, n + 0.06));
    setHealth((h) => Math.max(0.1, h - 0.06));
    setRev((r) => r + 1);
  };
  const reroll = () => { setFirstSession(false); pushSnap('re-roll'); setSeed(Math.random() * 6); setNoiseCap(0.4); setHealth(0.5); setRev((r) => r + 1); };
  const undo = () => setSnapshots((s) => {
    if (!s.length) return s;
    const last = s[s.length - 1]; setSeed(last.seed); setNoiseCap(last.noise); setRev((r) => r + 1);
    return s.slice(0, -1);
  });
  const train = () => { setBusy(true); setTimeout(() => { setLoss((p) => { const b = p.length ? p[p.length - 1] : 0.5; return [...p, Math.max(0.004, b * 0.82)].slice(-120); }); setBusy(false); }, 260); };
  const addExample = () => {
    if (!addingExample) { setAddingExample(true); return; }
    setAddingExample(false); setExamples((e) => e + 1); pushSnap('example'); train();
  };

  const setParam = (i, patch) => setParams((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const cycleStatus = (i) => setParams((ps) => ps.map((p, j) => (j === i ? { ...p, status: ({ off: 'fixed', fixed: 'live', live: 'off' })[p.status] } : p)));

  const toggleAB = () => {
    if (ab === 'B') { aRef.current = { seed }; setAB('A'); } else { if (aRef.current) setSeed(aRef.current.seed); setAB('B'); }
  };

  // keyboard accelerators
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const map = { '1': 'shape', '2': 'feel', '3': 'route', '4': 'health', '5': 'help' };
      if (map[e.key]) { setActive((a) => (a === map[e.key] ? null : map[e.key])); setDepth('peek'); }
      else if (e.key === '\\') setDepth((d) => (d === 'full' ? 'peek' : 'full'));
      else if (focus === 'composite' && e.key === '[') { e.preventDefault(); setSplit((s) => Math.max(0, s - 0.04)); }
      else if (focus === 'composite' && e.key === ']') { e.preventDefault(); setSplit((s) => Math.min(1, s + 0.04)); }
      else if (focus === 'composite' && (e.key === '=' || e.key === '0')) { e.preventDefault(); setSplit(0.5); }
      else if (e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); commit(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); perturb(); }
      else if (e.key.toLowerCase() === 'z') undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const ctx = {
    modes: MODES2, modeId, setModeId, mode,
    axes, setAxis: (k, v) => setAxes((s) => ({ ...s, [k]: v })),
    preset, setPreset, offsetActive: preset !== 'Sculpt',
    datasetCount: examples, loss, busy, addingExample,
    onAddExample: addExample, onTrain: train, onClear: () => { setExamples(0); setLoss([]); },
    snapshots, onJump: (id) => { const s = snapshots.find((x) => x.id === id); if (s) { setSeed(s.seed); setNoiseCap(s.noise); setRev((r) => r + 1); } },
    params, cycleStatus, outputBackend: 'audio', setOutputBackend: () => {},
    health, gradient: gradient.norms, gradientStatus: gradient.status, weightsRevision: rev,
    spread, setSpread, tame, setTame, noiseCap, setNoiseCap,
  };

  const healthColor = health > 0.66 ? 'rgba(107,194,107,' : health > 0.33 ? 'rgba(245,196,94,' : 'rgba(255,68,102,';
  const Input = mode.input;

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg)', overflow: 'hidden', fontFamily: 'var(--font-mono)' }}>
      <style>{`@keyframes mfDrawerIn{from{transform:translateX(16px)}to{transform:translateX(0)}}`}</style>

      {/* ambient health glow at the screen edge */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 25,
        boxShadow: `inset 0 0 120px ${healthColor}${0.05 + (1 - health) * 0.12})`, transition: 'box-shadow var(--dur-slow) var(--ease-console)' }} />

      {/* stage = manifold area (left of dock) */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 48, bottom: 0 }}>
        {/* readout strip (input-first only — promoted to the stage in output-first) */}
        {focus === 'in' && (stripPinned || mode.cls !== 'Synth') && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30 }}>
            <window.ReadoutStrip params={params} values={values} onChange={setParam} pinned={stripPinned} onTogglePin={() => setStripPinned((p) => !p)} />
          </div>
        )}

        {/* the stage: manifold (input-first) or output field (output-first) */}
        <div style={{ position: 'absolute', top: focus === 'in' && stripPinned ? 76 : 0, left: 0, right: 0, bottom: 0 }}>
          {focus === 'composite' ? (
            <window.CompositeStage split={split} onSplit={setSplit} mode={mode}
              pos={pos} onMove={(x, y) => setPos([x, y])} noiseCap={noiseCap} pins={pins} follow={follow}
              onLongPress={(p) => setPins((ps) => [...ps, { x: p[0], y: p[1], color: 'rgba(255,106,0,0.16)' }])}
              params={params} values={values} onChange={setParam} />
          ) : focus === 'split' ? (
            <window.SplitStage pos={pos} onMove={(x, y) => setPos([x, y])} noiseCap={noiseCap}
              pins={pins} follow={follow}
              onLongPress={(p) => setPins((ps) => [...ps, { x: p[0], y: p[1], color: 'rgba(255,106,0,0.16)' }])}
              params={params} values={values} onChange={setParam} />
          ) : focus === 'out' ? (
            <React.Fragment>
              <window.OutputStage params={params} values={values} onChange={setParam} />
              <window.InputMini mode={mode} pos={pos} onMove={(x, y) => setPos([x, y])} noiseCap={noiseCap} corner="bottom-left" />
            </React.Fragment>
          ) : (
            <window.Manifold pos={pos} onMove={(x, y) => setPos([x, y])} noiseCap={noiseCap} pins={pins}
              frozen={false} follow={follow}
              onLongPress={(p) => setPins((ps) => [...ps, { x: p[0], y: p[1], color: 'rgba(255,106,0,0.16)' }])} />
          )}

          {/* corner overlays */}
          <div style={{ position: 'absolute', top: 12, left: 14, zIndex: 20, pointerEvents: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <strong style={{ color: 'var(--accent)', fontSize: 'var(--fs-md)' }}>MEMLNaut</strong>
              <span style={{ color: 'var(--fg-mute)', fontSize: 'var(--fs-sm)' }}>{mode.label}</span>
              {mode.badge && <span style={{ fontSize: 9, color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 'var(--r-pill)', padding: '1px 6px' }}>{mode.badge}</span>}
            </div>
            <div style={{ color: 'var(--fg-dim)', fontSize: 'var(--fs-xs)', marginTop: 2 }}>{mode.cls.toLowerCase()} · {mode.input} · {params.length} targets</div>
          </div>

          <div style={{ position: 'absolute', bottom: 14, left: focus === 'out' ? 178 : 14, zIndex: 20, display: 'flex', gap: 8, fontFamily: 'var(--font-mono)' }}>
            <button type="button" onClick={() => setFollow((f) => !f)} title="Follow mode (hands-free drift)"
              style={{ fontSize: 'var(--fs-xs)', padding: '4px 10px', borderRadius: 'var(--r-pill)', cursor: 'pointer',
                border: `1px solid ${follow ? 'var(--good)' : 'var(--glass-line)'}`, background: 'var(--glass)',
                color: follow ? 'var(--good)' : 'var(--fg-mute)' }}>{follow ? '◉ follow' : '○ follow'}</button>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', alignSelf: 'center' }}>
              input ({pos[0].toFixed(2)}, {pos[1].toFixed(2)}) · noise {noiseCap.toFixed(3)} {holdingA && <span style={{ color: 'var(--accent-2)' }}>· preview A</span>}
            </span>
          </div>

          <window.VerdictCluster onPerturb={perturb} onUndo={undo} onCommit={commit} onReroll={reroll}
            canUndo={snapshots.length > 0} ab={ab} onToggleAB={toggleAB} onHoldA={setHoldingA} firstSession={firstSession} />

          <window.AltitudeNav current="console" focus={focus} style={{ top: 'auto', bottom: 14, right: 14 }} />
        </div>
      </div>

      <window.Dock ctx={ctx} active={active} setActive={setActive} depth={depth} setDepth={setDepth} />
    </div>
  );
}
window.ConsoleApp = ConsoleApp;
