/* Console 2.0 — Drawer contents. Each renderer takes (ctx, depth) where depth
   is 'peek' | 'expand' | 'full'; what shows is gated by depth (the schema-tier
   disclosure mechanism, simulated here).
   NOTE: these are the PLACEHOLDER drawers. The real dock contents are specified
   in docs/redesign/dock-spec.md (six drawers: Learning-Behaviour / Inputs /
   Outputs-Routing / Powerful Synth Engine / Particle-Visual / Help). */
const DRW_DS = window.ManifoldDesignSystem_490915;

function Chip({ children, tone }) {
  return (
    <span style={{
      fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em',
      color: tone || 'var(--fg-mute)', background: 'var(--bg-2)', border: '1px solid var(--line)',
      borderRadius: 'var(--r-pill)', padding: '2px 8px',
    }}>{children}</span>
  );
}
function SectionLabel({ children }) {
  return <div style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 'var(--sp-2)' }}>{children}</div>;
}

const PRESETS = ['Sculpt', 'Wander', 'Lock-in', 'Chaos', 'Glide', 'Pin & probe'];

function FeelDrawer(ctx, depth) {
  const { ControlAxis, PillToggle } = DRW_DS;
  const axes = [
    { key: 'boldness', label: 'Boldness', endpoints: ['Caution', 'Bold'], accent: 'var(--accent)' },
    { key: 'memory', label: 'Memory', endpoints: ['Amnesia', 'Elephant'], accent: 'var(--accent-2)' },
    { key: 'precision', label: 'Precision', endpoints: ['Raw', 'Precise'], accent: 'var(--accent)' },
  ];
  return (
    <React.Fragment>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip tone="var(--accent)">3 axes</Chip>
        <Chip>preset · {ctx.preset}</Chip>
        {ctx.offsetActive && <Chip tone="var(--accent-2)">offset active</Chip>}
      </div>
      <SectionLabel>Compound axes</SectionLabel>
      {axes.map((a) => (
        <ControlAxis key={a.key} label={a.label} endpoints={a.endpoints} accent={a.accent}
          value={ctx.axes[a.key]} onChange={(v) => ctx.setAxis(a.key, v)}
          preset={a.key === 'boldness' ? (ctx.axes.boldness > 0.66 ? 'explore' : 'steady') : undefined} />
      ))}
      <SectionLabel>Control presets</SectionLabel>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => ctx.setPreset(p)}
            style={{
              padding: '5px 10px', fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)', cursor: 'pointer',
              borderRadius: 'var(--r-pill)', border: `1px solid ${ctx.preset === p ? 'var(--accent)' : 'var(--line)'}`,
              background: ctx.preset === p ? 'rgba(255,106,0,0.15)' : 'var(--bg-2)',
              color: ctx.preset === p ? 'var(--accent)' : 'var(--fg-mute)',
            }}>{p}</button>
        ))}
      </div>
      {depth !== 'peek' && (
        <React.Fragment>
          <SectionLabel>Trim-pot offsets</SectionLabel>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
            Axis tweaks layer as offsets over the active preset. Double-tap an axis to re-link. An <span style={{ color: 'var(--accent-2)' }}>offset-active</span> dot marks divergence.
          </p>
        </React.Fragment>
      )}
    </React.Fragment>
  );
}

function ShapeDrawer(ctx, depth) {
  const { Button, Sparkline, Badge } = DRW_DS;
  return (
    <React.Fragment>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip tone="var(--accent)">examples {ctx.datasetCount}</Chip>
        <Chip>loss {ctx.loss.length ? ctx.loss[ctx.loss.length - 1].toExponential(1) : '—'}</Chip>
        {ctx.busy && <Chip tone="var(--accent-2)">training…</Chip>}
      </div>
      <SectionLabel>Reinforcement (default)</SectionLabel>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
        Use the + / − verdicts on the manifold. Every verdict auto-snapshots first — undo is consequence-free.
      </p>
      <SectionLabel>Examples (IML)</SectionLabel>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" variant={ctx.addingExample ? 'primary' : 'secondary'} onClick={ctx.onAddExample}>
          {ctx.addingExample ? '② store target' : '① add example'}
        </Button>
        <Button size="sm" onClick={ctx.onTrain} disabled={ctx.busy}>Train</Button>
        <Button size="sm" variant="ghost" onClick={ctx.onClear}>clear</Button>
      </div>
      <SectionLabel>Loss history</SectionLabel>
      <Sparkline data={ctx.loss.length ? ctx.loss : [0.5]} log width={depth === 'peek' ? 284 : 480} height={56} />
      {depth !== 'peek' && (
        <React.Fragment>
          <SectionLabel>Snapshot DAG · {ctx.snapshots.length}</SectionLabel>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflow: 'auto' }}>
            {ctx.snapshots.slice().reverse().map((s, idx) => (
              <li key={s.id}>
                <button type="button" onClick={() => ctx.onJump(s.id)} style={{
                  width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between',
                  background: idx === 0 ? 'var(--bg-3)' : 'var(--bg-2)', border: '1px solid var(--line)',
                  borderRadius: 'var(--r-1)', padding: '4px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)',
                }}>
                  <span style={{ color: idx === 0 ? 'var(--accent)' : 'var(--fg)' }}>{s.tag}</span>
                  <span style={{ color: 'var(--fg-dim)' }}>noise {s.noise.toFixed(2)}</span>
                </button>
              </li>
            ))}
          </ul>
        </React.Fragment>
      )}
    </React.Fragment>
  );
}

const STATUS_CYCLE = { off: 'fixed', fixed: 'live', live: 'off' };
const STATUS_COLOR = { off: 'var(--fg-dim)', fixed: 'var(--accent-2)', live: 'var(--accent)' };

function RouteDrawer(ctx, depth) {
  const { PillToggle, Badge } = DRW_DS;
  const counts = ctx.params.reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {});
  const rows = depth === 'peek' ? ctx.params.slice(0, 6) : ctx.params;
  return (
    <React.Fragment>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip>sources {ctx.mode.inN}/48</Chip>
        <Chip>targets {ctx.params.length}/{ctx.params.length}</Chip>
        <Chip tone="var(--accent)">live {counts.live || 0}</Chip>
        <Chip tone="var(--accent-2)">fixed {counts.fixed || 0}</Chip>
      </div>
      <SectionLabel>Input source</SectionLabel>
      <Badge tone="info">{ctx.mode.input === 'joystick' ? 'joystick' : ctx.mode.input === 'audio_in' ? 'mic (1-input)' : 'xy pad'}</Badge>
      <SectionLabel>Output backend</SectionLabel>
      <PillToggle value={ctx.outputBackend} onChange={ctx.setOutputBackend}
        options={[{ value: 'audio', label: 'Audio' }, { value: 'midi', label: 'MIDI' }, { value: 'osc', label: 'OSC' }, { value: 'cv', label: 'CV' }]} />
      <SectionLabel>Control points · off / fixed / live</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: depth === 'peek' ? 150 : 320, overflow: 'auto' }}>
        {rows.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-1)', padding: '4px 8px' }}>
            <span style={{ flex: 1, fontSize: 'var(--fs-xs)', color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-dim)' }}>{p.group}</span>
            <button type="button" onClick={() => ctx.cycleStatus(ctx.params.indexOf(p))}
              style={{ width: 52, fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em',
                border: `1px solid ${STATUS_COLOR[p.status]}`, color: STATUS_COLOR[p.status], background: 'transparent',
                borderRadius: 'var(--r-1)', padding: '2px 4px', cursor: 'pointer' }}>{p.status}</button>
          </div>
        ))}
      </div>
      {depth === 'full' && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: '8px 0 0', lineHeight: 1.6 }}>
          Full tier hosts the Emitters × Targets matrix + per-cell editor + staged-unlock opt-in (built for the modular mega-mode).
        </p>
      )}
    </React.Fragment>
  );
}

function GradientBars({ norms, status }) {
  const COLOR = { vanishing: 'var(--info)', exploding: 'var(--danger)', converged: 'var(--fg-mute)', healthy: 'var(--good)' };
  const max = Math.max(...norms, 0.0001);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 56, background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', padding: 6 }}>
      {norms.map((n, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: '100%', justifyContent: 'flex-end' }}>
          <div style={{ width: '100%', height: `${(n / max) * 100}%`, background: COLOR[status[i]] || 'var(--good)', borderRadius: 1 }} />
          <span style={{ fontSize: 8, color: 'var(--fg-dim)' }}>L{i}</span>
        </div>
      ))}
    </div>
  );
}

function HealthDrawer(ctx, depth) {
  const { Sparkline, Switch, Slider, Badge } = DRW_DS;
  const healthTone = ctx.health > 0.66 ? 'good' : ctx.health > 0.33 ? 'warn' : 'bad';
  return (
    <React.Fragment>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge tone={healthTone} dot>{healthTone === 'good' ? 'healthy' : healthTone === 'warn' ? 'drifting' : 'unstable'}</Badge>
        <Chip>rev {ctx.weightsRevision}</Chip>
      </div>
      <SectionLabel>Loss history</SectionLabel>
      <Sparkline data={ctx.loss.length ? ctx.loss : [0.5]} log width={depth === 'peek' ? 284 : 480} height={56} />
      <SectionLabel>Gradient flow · per layer</SectionLabel>
      <GradientBars norms={ctx.gradient} status={ctx.gradientStatus} />
      {depth !== 'peek' && (
        <React.Fragment>
          <SectionLabel>Lab controls</SectionLabel>
          <Switch checked={ctx.spread} onChange={ctx.setSpread} label="spread (Xavier regime)" />
          <Slider label="tame · output limiter" value={ctx.tame} min={0} max={1} step={0.01} onChange={ctx.setTame} />
          <Slider label="noise cap" value={ctx.noiseCap} min={0} max={0.5} step={0.01} onChange={ctx.setNoiseCap} />
        </React.Fragment>
      )}
    </React.Fragment>
  );
}

const KEYS = [['1–5', 'open drawers'], ['\\', 'full depth'], ['space / ↑', 'commit +'], ['↓', 'perturb −'], ['z', 'undo'], ['double-click dot', 'follow mode']];
function HelpDrawer(ctx, depth) {
  return (
    <React.Fragment>
      <SectionLabel>Keyboard</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {KEYS.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)' }}>
            <kbd style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-1)', padding: '1px 6px', color: 'var(--accent)' }}>{k}</kbd>
            <span style={{ color: 'var(--fg-mute)' }}>{v}</span>
          </div>
        ))}
      </div>
      <SectionLabel>The loop</SectionLabel>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.7 }}>
        Drag the manifold to explore. Hear something good → + to settle. Wrong → − to perturb. Went too far → ↺ undo. The screen reveals exactly as much machinery as you reach for.
      </p>
    </React.Fragment>
  );
}

window.DRAWERS = {
  shape: { icon: '◇', label: 'Shape', render: ShapeDrawer },
  feel: { icon: '◎', label: 'Feel', render: FeelDrawer },
  route: { icon: '⇄', label: 'Route', render: RouteDrawer },
  health: { icon: '♥', label: 'Health', render: HealthDrawer },
  help: { icon: '?', label: 'Help', render: HelpDrawer },
};
