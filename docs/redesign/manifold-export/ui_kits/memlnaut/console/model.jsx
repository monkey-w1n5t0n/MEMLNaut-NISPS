/* Console 2.0 — shared instrument model. Pure data + inference used by all
   three altitudes (Console / Perform / Zen) so they share one spine. */
function mkParams(spec) {
  const out = [];
  for (const [group, names] of spec) {
    names.forEach((name) => out.push({ name, group, status: 'live', val: 0.5, min: 0, max: 1, curve: 0.5 }));
  }
  return out;
}
const MF_MODES = [
  { id: 'paf_synth', label: 'PAF Synth', cls: 'Synth', glyph: '∿', input: 'xy',
    params: mkParams([['formant', ['F1', 'F2', 'F3', 'tilt', 'spread', 'skirt']], ['pitch', ['root', 'glide', 'detune']], ['amp', ['gain', 'attack', 'decay']], ['filter', ['cutoff', 'res', 'env']], ['fx', ['drive', 'air', 'width']]]) },
  { id: 'channel_strip', label: 'Channel Strip', cls: 'Synth', glyph: '▤', input: 'joystick',
    params: mkParams([['filter', ['lo', 'loMid', 'hiMid', 'hi']], ['amp', ['comp', 'gate', 'makeup']], ['fx', ['sat', 'width', 'glue', 'tilt', 'air']]]) },
  { id: 'verb_fx', label: 'Verb FX', cls: 'Synth', glyph: '◞', input: 'joystick',
    params: mkParams([['fx', ['size', 'decay', 'damp', 'diff']], ['mod', ['rate', 'depth']], ['filter', ['lo', 'hi']]]) },
  { id: 'elysiamorf', label: 'Elysiamorf', cls: 'Synth', glyph: '❋', input: 'xy',
    params: mkParams([['formant', ['grain', 'size', 'pos', 'spray']], ['mod', ['rate', 'depth', 'jitter']], ['amp', ['gain', 'env']], ['filter', ['cutoff', 'res']], ['fx', ['blur', 'shimmer', 'freeze', 'width']]]) },
  { id: 'memlcelium', label: 'MEML Celium', cls: 'Sequencer', glyph: '☷', input: 'xy',
    params: mkParams([['mod', ['cvA', 'cvB', 'gate', 'div']], ['pitch', ['root', 'scale', 'oct']], ['amp', ['vca', 'slew']]]) },
  { id: 'breakor', label: 'Breakor', cls: 'Sequencer', glyph: '⊟', input: 'joystick',
    params: mkParams([['mod', ['density', 'swing', 'fill', 'stutter']], ['amp', ['punch', 'decay']], ['filter', ['tone', 'crush']], ['fx', ['glitch', 'rev']]]) },
  { id: 'sound_analysis_midi', label: 'Sound Analysis → MIDI', cls: 'Controller', glyph: '⇉', input: 'audio_in', badge: '1-input',
    params: mkParams([['mod', ['cc1', 'cc2', 'cc3', 'cc4']], ['pitch', ['note', 'bend']], ['amp', ['vel', 'press']]]) },
  { id: 'visualizer', label: 'Visualizer', cls: 'Visual', glyph: '◑', input: 'xy',
    params: mkParams([['mod', ['hue', 'sat', 'flow', 'warp']], ['amp', ['bloom', 'fade']], ['fx', ['grain', 'trail']]]) },
  { id: 'c15', label: 'C15', cls: 'Synth', glyph: '◆', input: 'xy', placeholder: true, badge: 'soon', params: mkParams([['amp', ['a', 'b']]]) },
];

function applyCurve(v, c) { const e = 0.25 + c * 1.75; return Math.pow(Math.max(0, Math.min(1, v)), e); }
function MF_infer(pos, seed, params) {
  const [x, y] = pos;
  return params.map((p, i) => {
    if (p.status === 'off') return 0;                 // deactivated → muted
    if (p.status === 'fixed') return p.val ?? 0.5;    // deactivated → held static
    // live → driven by the model, shaped by min/max/curve
    const a = Math.sin(x * (1.2 + i * 0.19) * Math.PI + i * 0.7 + seed) * 0.5 + 0.5;
    const b = Math.cos(y * (0.9 + i * 0.13) * Math.PI - i * 0.4 - seed * 0.5) * 0.5 + 0.5;
    let v = a * 0.55 + b * 0.45;
    v = p.min + applyCurve(v, p.curve) * (p.max - p.min);
    return Math.max(0, Math.min(1, v));
  });
}
function MF_seededGradient(rev) {
  const n = 4, norms = [], status = [];
  for (let i = 0; i < n; i++) {
    const r = Math.abs(Math.sin((rev + 1) * (i + 1) * 12.9898) * 43758.5453 % 1);
    norms.push(0.2 + r * 0.8);
    status.push(r > 0.85 ? 'exploding' : r < 0.18 ? 'vanishing' : r < 0.3 ? 'converged' : 'healthy');
  }
  return { norms, status };
}

/* useInstrument — the shared reactive spine + verdict/training actions.
   Returns flat state + actions; each view renders as much of it as it needs. */
let MF_SNAP_ID = 0;
function useInstrument(initialMode) {
  const [modeId, setModeId] = React.useState(initialMode || 'paf_synth');
  const mode = MF_MODES.find((m) => m.id === modeId) || MF_MODES[0];
  const [params, setParams] = React.useState(() => mode.params.map((p) => ({ ...p })));
  const [pos, setPos] = React.useState([0.5, 0.5]);
  const [seed, setSeed] = React.useState(0.4);
  const [axes, setAxes] = React.useState({ boldness: 0.55, memory: 0.4, precision: 0.5 });
  const [noiseCap, setNoiseCap] = React.useState(0.12);
  const [examples, setExamples] = React.useState(0);
  const [loss, setLoss] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [snapshots, setSnapshots] = React.useState([]);
  const [ab, setAB] = React.useState('B');
  const [holdingA, setHoldingA] = React.useState(false);
  const aRef = React.useRef(null);
  const [health, setHealth] = React.useState(0.8);
  const [rev, setRev] = React.useState(1);
  const [follow, setFollow] = React.useState(false);
  const [pins, setPins] = React.useState([]);
  const [firstSession, setFirstSession] = React.useState(true);

  React.useEffect(() => {
    setParams(mode.params.map((p) => ({ ...p }))); setPos([0.5, 0.5]); setExamples(0);
    setLoss([]); setSnapshots([]); setSeed(0.4); setFollow(false); setPins([]); setHealth(0.8); setRev(1);
  }, [modeId]);

  const effSeed = holdingA && aRef.current ? aRef.current.seed : seed;
  const values = React.useMemo(() => MF_infer(pos, effSeed, params), [pos, effSeed, params]);
  const gradient = React.useMemo(() => MF_seededGradient(rev), [rev]);

  const pushSnap = (tag) => setSnapshots((s) => [...s, { id: ++MF_SNAP_ID, tag, noise: noiseCap, seed }].slice(-50));
  const commit = () => {
    setFirstSession(false); pushSnap('commit +'); setBusy(true);
    setNoiseCap((n) => Math.max(0.02, n * 0.7)); setHealth((h) => Math.min(1, h + 0.08)); setRev((r) => r + 1);
    setTimeout(() => { setLoss((prev) => { const b = prev.length ? prev[prev.length - 1] : 0.5; return [...prev, Math.max(0.004, b * (0.8 + Math.random() * 0.08))].slice(-120); }); setBusy(false); }, 260);
  };
  const perturb = () => {
    setFirstSession(false); pushSnap('perturb −');
    setSeed((s) => s + (Math.random() - 0.5) * (noiseCap * 4 + 0.3));
    setNoiseCap((n) => Math.min(0.5, n + 0.06)); setHealth((h) => Math.max(0.1, h - 0.06)); setRev((r) => r + 1);
  };
  const reroll = () => { setFirstSession(false); pushSnap('re-roll'); setSeed(Math.random() * 6); setNoiseCap(0.4); setHealth(0.5); setRev((r) => r + 1); };
  const undo = () => setSnapshots((s) => { if (!s.length) return s; const last = s[s.length - 1]; setSeed(last.seed); setNoiseCap(last.noise); setRev((r) => r + 1); return s.slice(0, -1); });
  const train = () => { setBusy(true); setTimeout(() => { setLoss((p) => { const b = p.length ? p[p.length - 1] : 0.5; return [...p, Math.max(0.004, b * 0.82)].slice(-120); }); setBusy(false); }, 260); };
  const setParam = (i, patch) => setParams((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const cycleStatus = (i) => setParams((ps) => ps.map((p, j) => (j === i ? { ...p, status: ({ off: 'fixed', fixed: 'live', live: 'off' })[p.status] } : p)));
  const toggleAB = () => { if (ab === 'B') { aRef.current = { seed }; setAB('A'); } else { if (aRef.current) setSeed(aRef.current.seed); setAB('B'); } };
  const cycleMode = (dir = 1) => {
    const live = MF_MODES.filter((m) => !m.placeholder);
    const i = live.findIndex((m) => m.id === modeId);
    setModeId(live[(i + dir + live.length) % live.length].id);
  };

  return {
    MODES: MF_MODES, modeId, setModeId, cycleMode, mode, params, setParam, cycleStatus,
    pos, setPos, seed, values, axes, setAxes, setAxis: (k, v) => setAxes((s) => ({ ...s, [k]: v })),
    noiseCap, setNoiseCap, examples, loss, busy, train,
    snapshots, commit, perturb, reroll, undo, ab, toggleAB, holdingA, setHoldingA,
    health, rev, gradient, follow, setFollow, pins, setPins, firstSession,
  };
}

window.MF_MODES = MF_MODES;
window.MF_infer = MF_infer;
window.MF_seededGradient = MF_seededGradient;
window.useInstrument = useInstrument;
