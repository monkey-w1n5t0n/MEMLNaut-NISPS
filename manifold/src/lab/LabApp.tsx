/**
 * The hidden ML lab page (`?lab=1`). Not linked from the product UI.
 *
 * Runs simulated musicians (personas with hidden goals) against Manifold's
 * real engine in Web Workers, under the shipped defaults and variations of
 * them, and says which defaults would make learning work better — with paired
 * confidence intervals, and a confirm run for the combined recommendation.
 * See docs/specs/plans/ml-lab-spec.md (Phase 3) for the method and its limits.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '../primitives/Button';
import { Switch } from '../primitives/Switch';
import type { EpisodeResult } from './episode';
import type { GoalKind } from './goals';
import { PERSONAS } from './personas';
import { LabPool } from './pool';
import { applies, BOOT_IO, canon, configKey, describeDiff, KNOBS, PRESETS, SHIPPED, type FeedbackModeId, type KnobKey, type LabConfig, type LikeModeId } from './settings';
import {
  originFrom,
  pairedDelta,
  planConfirm,
  planGrid,
  planOat,
  planPresets,
  recommend,
  summarise,
  type ConfigSummary,
  type Plan,
  type PlanKind,
  type Stat,
} from './sweep';

const LAST_KEY = 'mf-lab-last-2';

const KIND_LABEL: Record<PlanKind, string> = { oat: 'one-at-a-time', grid: 'grid', compare: 'presets', confirm: 'confirm' };

interface RunState {
  kind: PlanKind;
  configs: LabConfig[];
  origin: LabConfig;
  total: number;
  results: EpisodeResult[];
  done: number;
  failed: number;
  started: number;
  finished: number | null;
  /** Loaded from the previous visit (localStorage), not run in this tab. */
  restored?: boolean;
}

const page: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'auto',
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  padding: 'var(--sp-5) var(--sp-4)',
};
const card: CSSProperties = {
  background: 'var(--surface-panel)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-2)',
  padding: 'var(--sp-4)',
  marginBottom: 'var(--sp-4)',
  maxWidth: 1180,
};
const h2: CSSProperties = { fontSize: 'var(--fs-md)', margin: '0 0 var(--sp-3)', color: 'var(--fg)' };
const dim: CSSProperties = { color: 'var(--fg-dim)' };
const th: CSSProperties = { textAlign: 'left', padding: '4px 8px', color: 'var(--fg-dim)', fontWeight: 400, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '4px 8px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
// Config names can be long; let them wrap so the numeric columns stay on the card.
const tdWrap: CSSProperties = { ...td, whiteSpace: 'normal', overflowWrap: 'anywhere', minWidth: 220, maxWidth: 420 };
const switchRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px 24px' };
const switchGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '8px 16px', maxWidth: 820 };

const pts = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;
const fmtVal = (v: number | string) => (typeof v === 'number' ? String(v) : v);
const shortDiff = (d: string) =>
  d.replace('feedbackMode=explore-and-place', 'explore & place').replace('feedbackMode=geometric-dislike', 'push away');
const modeName = (m: FeedbackModeId) => (m === 'geometric-dislike' ? 'Push away' : 'Explore & place');
const likeName = (l: LikeModeId) => (l === 'burst' ? 'burst learning' : 'background learning');

function Delta({ s }: { s: Stat | undefined }) {
  if (!s || s.n === 0) return <span style={dim}>–</span>;
  const up = s.n > 1 && s.mean - s.ci > 0;
  const down = s.n > 1 && s.mean + s.ci < 0;
  const color = up ? 'var(--good)' : down ? 'var(--bad)' : 'var(--fg)';
  return (
    <span style={{ color }}>
      {pts(s.mean)} <span style={dim}>± {(s.ci * 100).toFixed(1)}</span> {up ? '▲' : down ? '▼' : ''}
    </span>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--sp-3)' }}>
        <h2 style={h2}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Δ-vs-base for each candidate of one knob, with 95% whiskers. */
function KnobChart({ knob, base, results }: { knob: (typeof KNOBS)[number]; base: LabConfig; results: EpisodeResult[] }) {
  const baseKey = configKey(base);
  const rows = knob.candidates.map((v) => {
    const key = configKey({ ...base, [knob.key]: v } as LabConfig);
    return { v, s: key === baseKey ? { n: 1, mean: 0, ci: 0 } : pairedDelta(results, key, baseKey), isBase: v === base[knob.key] };
  }).filter((r) => r.s.n > 0);
  if (rows.length < 2) return null;
  const W = 250, H = 96, pad = 18;
  const ext = Math.max(0.02, ...rows.map((r) => Math.abs(r.s.mean) + r.s.ci));
  const y = (d: number) => H / 2 - (d / ext) * (H / 2 - 10);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, rows.length - 1);
  return (
    <div style={{ display: 'inline-block', marginRight: 'var(--sp-4)', marginBottom: 'var(--sp-3)', verticalAlign: 'top' }}>
      <div style={{ ...dim, fontSize: 'var(--fs-xs)', marginBottom: 2 }}>{knob.label}</div>
      <svg width={W} height={H + 16} role="img" aria-label={`${knob.label} sensitivity`}>
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeDasharray="3 3" />
        {rows.map((r, i) => {
          const up = r.s.n > 1 && r.s.mean - r.s.ci > 0;
          const down = r.s.n > 1 && r.s.mean + r.s.ci < 0;
          const c = r.isBase ? 'var(--accent)' : up ? 'var(--good)' : down ? 'var(--bad)' : 'var(--fg-dim)';
          return (
            <g key={String(r.v)}>
              <title>{`${knob.key}=${r.v}: ${pts(r.s.mean)} ± ${(r.s.ci * 100).toFixed(1)} pts vs this base`}</title>
              <line x1={x(i)} x2={x(i)} y1={y(r.s.mean - r.s.ci)} y2={y(r.s.mean + r.s.ci)} stroke={c} />
              <circle cx={x(i)} cy={y(r.s.mean)} r={r.isBase ? 4.5 : 3.5} fill={r.isBase ? 'none' : c} stroke={c} strokeWidth={1.5} />
              <text x={x(i)} y={H + 12} fill="var(--fg-dim)" fontSize="10" textAnchor="middle">{fmtVal(r.v)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LabApp() {
  const [seeds, setSeeds] = useState(8);
  const [goals, setGoals] = useState<GoalKind[]>(['place', 'taste']);
  const [personas, setPersonas] = useState<string[]>(PERSONAS.map((p) => p.id));
  const [knobs, setKnobs] = useState<KnobKey[]>(KNOBS.map((k) => k.key));
  const [workers, setWorkers] = useState(() => Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
  const [gridA, setGridA] = useState<KnobKey>('learningRate');
  const [gridB, setGridB] = useState<KnobKey>('optimMaxAdjLr');
  const [gridMode, setGridMode] = useState<FeedbackModeId>(SHIPPED.feedbackMode);
  const [run, setRun] = useState<RunState | null>(() => {
    try {
      const raw = localStorage.getItem(LAST_KEY);
      const r = raw ? (JSON.parse(raw) as Partial<RunState>) : null;
      // Anything from an older layout of this page is dropped, not guessed at.
      return r && Array.isArray(r.configs) && Array.isArray(r.results) && r.origin ? ({ ...r, restored: true } as RunState) : null;
    } catch {
      return null;
    }
  });
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);
  const poolRef = useRef<LabPool | null>(null);

  useEffect(() => () => poolRef.current?.stop(), []);

  const opts = { seeds, goals, personas };
  const oatPreview = useMemo(() => planOat(opts, knobs), [seeds, goals, personas, knobs]); // eslint-disable-line react-hooks/exhaustive-deps

  const gridPreview = useMemo(
    () => planGrid(opts, gridA, gridB, originFrom({ feedbackMode: gridMode })),
    [seeds, goals, personas, gridA, gridB, gridMode], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const presetPreview = useMemo(() => planPresets(PRESETS, opts), [seeds, goals, personas]); // eslint-disable-line react-hooks/exhaustive-deps

  const summaries: ConfigSummary[] = useMemo(
    () => (run ? summarise(run.configs, run.results, run.origin) : []),
    [run, run?.results.length], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const rec = useMemo(() => (run && run.kind === 'oat' ? recommend(run.results, run.origin) : null), [run, run?.results.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(plan: Plan) {
    if (running) return;
    const state: RunState = {
      kind: plan.kind, configs: plan.configs, origin: plan.origin, total: plan.specs.length,
      results: [], done: 0, failed: 0, started: Date.now(), finished: null,
    };
    setRun(state);
    setRunning(true);
    const pool = new LabPool(workers);
    poolRef.current = pool;
    let lastPaint = 0;
    const final = await pool.run(plan.specs, (r, p) => {
      state.results.push(r);
      state.done = p.done;
      state.failed = p.failed;
      const now = performance.now();
      if (now - lastPaint > 400) {
        lastPaint = now;
        setRun({ ...state });
      }
    });
    state.done = final.done;
    state.failed = final.failed;
    state.finished = Date.now();
    setRun({ ...state });
    setRunning(false);
    poolRef.current = null;
    try {
      // Curves are the bulk of a result; the summary needs none of them.
      localStorage.setItem(LAST_KEY, JSON.stringify({ ...state, results: state.results.map((r) => ({ ...r, curve: [] })) }));
    } catch {
      /* quota / private mode: the run is still on screen and exportable */
    }
  }

  function stop() {
    poolRef.current?.stop();
  }

  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const elapsed = run ? ((run.finished ?? Date.now()) - run.started) / 1000 : 0;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const total = run?.total ?? 0;
  const eta = run && run.done > 0 && running ? (elapsed / run.done) * (total - run.done) : 0;
  const originSummary = run ? summaries.find((s) => s.key === configKey(run.origin)) : undefined;
  const originIsShipped = run ? configKey(run.origin) === configKey(SHIPPED as LabConfig) : true;
  const vs = originIsShipped ? 'shipped' : 'the origin';
  const gridKnobs = KNOBS.filter((k) => k.kind !== 'enum');

  return (
    <div style={page}>
      <header style={{ ...card, background: 'transparent', border: 'none', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 'var(--fs-xl)', color: 'var(--accent)' }}>ML Lab</strong>
          <span style={dim}>hidden · simulated musicians play the real engine to choose Manifold&apos;s defaults</span>
          <a href={window.location.pathname} style={{ marginLeft: 'auto', color: 'var(--text-link)' }}>open Manifold →</a>
        </div>
        <p style={{ ...dim, maxWidth: 900, lineHeight: 'var(--lh-normal)' }}>
          Each episode is one persona with a hidden goal — <b>place</b> (put specific sounds at specific spots) or{' '}
          <b>taste</b> (fill the pad with sounds they like, with variety) — playing {BOOT_IO.modeId} ({BOOT_IO.inputSize} →{' '}
          {SHIPPED.h1}/{SHIPPED.h2}/{SHIPPED.h3} → {BOOT_IO.outputSize}) through the same controller calls the console makes. Every config
          plays the same episodes, so Δ is a paired difference in score points (0–100) against what ships. Scores are provisional
          proxies until calibrated against real play. Two side measures: <b>lurch</b> (how much the playable mapping moves per
          gesture) and <b>like error</b> (how well liked sounds are still played at the end).
        </p>
      </header>

      <Section title="Shipped defaults">
        <table style={{ borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>knob</th><th style={th}>shipped</th><th style={th}>candidates</th><th style={th}>source</th></tr></thead>
          <tbody>
            {KNOBS.map((k) => (
              <tr key={k.key}>
                <td style={td}>
                  {k.label}
                  {k.onlyIn ? <span style={dim}> ({k.onlyIn === 'explore-and-place' ? 'explore & place' : 'push away'} only)</span> : null}
                  {k.onlyLike ? <span style={dim}> ({likeName(k.onlyLike)} only)</span> : null}
                </td>
                <td style={{ ...td, color: 'var(--accent)' }}>{fmtVal(SHIPPED[k.key])}</td>
                <td style={{ ...td, ...dim }}>{k.candidates.map(fmtVal).join(' · ')}</td>
                <td style={{ ...td, ...dim, fontSize: 'var(--fs-xs)' }}>{k.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Presets" aside={<span style={dim}>whole configs to compare head to head</span>}>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>preset</th><th style={th}>differs from shipped by</th><th style={th}>what it is</th></tr></thead>
          <tbody>
            {PRESETS.map((p) => (
              <tr key={p.id}>
                <td style={td}>{p.label}</td>
                <td style={{ ...tdWrap, fontSize: 'var(--fs-xs)' }}>{shortDiff(describeDiff(p.config))}</td>
                <td style={{ ...tdWrap, ...dim, fontSize: 'var(--fs-xs)', maxWidth: 480 }}>{p.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Section>

      <Section title="Sweep">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-5)', alignItems: 'flex-start' }}>
          <label>seeds per persona × goal{' '}
            <input type="number" min={2} max={64} value={seeds} onChange={(e) => setSeeds(Math.max(2, Math.min(64, Number(e.target.value) || 2)))}
              style={{ width: 56, background: 'var(--bg-2)', color: 'var(--fg)', border: '1px solid var(--border)', fontFamily: 'inherit' }} />
          </label>
          <label>workers{' '}
            <input type="number" min={1} max={32} value={workers} onChange={(e) => setWorkers(Math.max(1, Math.min(32, Number(e.target.value) || 1)))}
              style={{ width: 48, background: 'var(--bg-2)', color: 'var(--fg)', border: '1px solid var(--border)', fontFamily: 'inherit' }} />
          </label>
          <div>
            <div style={dim}>goals</div>
            <div style={switchRow}>
              {(['place', 'taste'] as GoalKind[]).map((g) => (
                <Switch key={g} label={g} checked={goals.includes(g)} onChange={() => setGoals((xs) => toggle(xs, g))} />
              ))}
            </div>
          </div>
          <div>
            <div style={dim}>personas</div>
            <div style={switchRow}>
              {PERSONAS.map((p) => (
                <Switch key={p.id} label={p.label} checked={personas.includes(p.id)} onChange={() => setPersonas((xs) => toggle(xs, p.id))} />
              ))}
            </div>
          </div>
          <div>
            <div style={dim}>vary (one at a time)</div>
            <div style={switchGrid}>
              {KNOBS.filter((k) => k.key !== 'feedbackMode' && k.key !== 'likeMode').map((k) => (
                <Switch key={k.key} label={k.label} checked={knobs.includes(k.key)} onChange={() => setKnobs((xs) => toggle(xs, k.key))} />
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', marginTop: 'var(--sp-4)', flexWrap: 'wrap' }}>
          <Button variant="primary" disabled={running || !goals.length || !personas.length} onClick={() => start(oatPreview)}>
            Run one-at-a-time ({oatPreview.configs.length} configs · {oatPreview.specs.length} episodes)
          </Button>
          {rec && rec.recs.length > 0 && (
            <Button disabled={running} onClick={() => start(planConfirm([rec.proposed], opts, run?.origin ?? originFrom()))}>
              Confirm combined recommendation
            </Button>
          )}
          <Button disabled={running || !goals.length || !personas.length} onClick={() => start(presetPreview)}>
            Compare presets ({presetPreview.configs.length} · {presetPreview.specs.length} episodes, held-out seeds)
          </Button>
          {running && <Button onClick={stop}>Stop</Button>}
          {run && !running && (
            <Button variant="ghost" onClick={() => download(`manifold-lab-${new Date().toISOString().slice(0, 19)}.json`, { schema: 'manifold-lab/2', shipped: SHIPPED, ...run, summaries, recommendation: rec })}>
              Export JSON
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <span style={dim}>grid</span>
          {[[gridA, setGridA], [gridB, setGridB]].map(([v, set], i) => (
            <select key={i} value={v as KnobKey} onChange={(e) => (set as (k: KnobKey) => void)(e.target.value as KnobKey)}
              style={{ background: 'var(--bg-2)', color: 'var(--fg)', border: '1px solid var(--border)', fontFamily: 'inherit' }}>
              {gridKnobs.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          ))}
          <span style={dim}>in</span>
          <select value={gridMode} onChange={(e) => setGridMode(e.target.value as FeedbackModeId)}
            style={{ background: 'var(--bg-2)', color: 'var(--fg)', border: '1px solid var(--border)', fontFamily: 'inherit' }}>
            <option value="geometric-dislike">Push away</option>
            <option value="explore-and-place">Explore &amp; place</option>
          </select>
          <Button disabled={running || gridA === gridB || !goals.length || !personas.length} onClick={() => start(gridPreview)}>
            Run grid ({gridPreview.configs.length} configs · {gridPreview.specs.length} episodes)
          </Button>
        </div>
        {run && (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <div style={{ height: 6, background: 'var(--surface-track)', borderRadius: 3, overflow: 'hidden', maxWidth: 600 }}>
              <div style={{ height: '100%', width: `${total ? (100 * run.done) / total : 0}%`, background: 'var(--accent)' }} />
            </div>
            <div style={{ ...dim, marginTop: 4 }}>
              {KIND_LABEL[run.kind]} · {run.done}/{total} episodes
              {run.failed ? ` · ${run.failed} failed` : ''} · {elapsed.toFixed(0)} s{running && eta ? ` · ~${eta.toFixed(0)} s left` : ''}
              {run.restored ? ' · restored from your last visit' : ''}
            </div>
          </div>
        )}
      </Section>

      {rec && (
        <Section title="Recommendation">
          {rec.recs.length === 0 ? (
            <p style={dim}>Nothing credibly beats {vs} at this sample size (every 95% interval crosses zero). More seeds narrow the intervals.</p>
          ) : (
            <>
              <table style={{ borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>change</th><th style={th}>from → to</th><th style={th}>Δ (95% CI)</th><th style={th}>where</th></tr></thead>
                <tbody>
                  {rec.recs.map((r) => (
                    <tr key={r.key}>
                      <td style={td}>{KNOBS.find((k) => k.key === r.key)?.label}</td>
                      <td style={td}>{fmtVal(r.from)} → <b style={{ color: 'var(--accent)' }}>{fmtVal(r.to)}</b></td>
                      <td style={td}><Delta s={r.delta} /></td>
                      <td style={{ ...td, ...dim, fontSize: 'var(--fs-xs)' }}>{KNOBS.find((k) => k.key === r.key)?.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ ...dim, marginTop: 'var(--sp-3)' }}>
                Each change was measured alone. Run <i>Confirm combined recommendation</i> before shipping them together — knobs
                interact, and the confirm run uses held-out seeds, so it also corrects for having picked the winners on these ones.
                Note a knob can only be seen to matter where it applies: the optimiser step cap and the like learning rate interact
                (run the grid), and dislike settings only exist in push-away.
              </p>
            </>
          )}
        </Section>
      )}

      {run && run.kind === 'oat' && run.results.length > 0 && (
        <Section title="Sensitivity" aside={<span style={dim}>Δ vs that base · ○ = the base&apos;s own value</span>}>
          {(['geometric-dislike', 'explore-and-place'] as const).flatMap((m) =>
            (['burst', 'background'] as const).map((l) => {
              const base = canon({ ...run.origin, feedbackMode: m, likeMode: l });
              if (!run.results.some((r) => r.configKey === configKey(base))) return null;
              const shown = KNOBS.filter((k) => k.key !== 'feedbackMode' && k.key !== 'likeMode' && applies(k, base));
              return (
                <div key={`${m}-${l}`} style={{ marginBottom: 'var(--sp-3)' }}>
                  <div style={{ marginBottom: 'var(--sp-2)' }}>
                    {modeName(m)} · {likeName(l)}
                    {m === SHIPPED.feedbackMode && l === SHIPPED.likeMode ? <span style={dim}> (shipped)</span> : null}
                  </div>
                  {shown.map((k) => <KnobChart key={k.key} knob={k} base={base} results={run.results} />)}
                </div>
              );
            }),
          )}
        </Section>
      )}

      {summaries.length > 0 && (
        <Section title="All configs" aside={originSummary ? <span style={dim}>{vs} scores {(originSummary.score.mean * 100).toFixed(1)} ± {(originSummary.score.ci * 100).toFixed(1)}</span> : null}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>config (differences from shipped)</th><th style={th}>score</th><th style={th}>Δ vs {vs}</th>
                  <th style={th}>wins</th><th style={th}>place Δ</th><th style={th}>taste Δ</th>
                  <th style={th} title="Mean movement of the playable mapping per gesture (0–1 per output). Lower = steadier instrument.">lurch</th>
                  <th style={th} title="Error, at the end, between what the net plays where the musician liked/placed a sound and the sound they liked. Lower = teaching survived.">like error</th>
                  <th style={th}>ms/episode</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.key}>
                    <td style={tdWrap}>{shortDiff(s.diff)}</td>
                    <td style={td}>{(s.score.mean * 100).toFixed(1)}</td>
                    <td style={td}><Delta s={s.delta} /></td>
                    <td style={td}>{(s.winRate * 100).toFixed(0)}%</td>
                    <td style={td}><Delta s={s.deltaByGoal.place} /></td>
                    <td style={td}><Delta s={s.deltaByGoal.taste} /></td>
                    <td style={td}>{s.lurch.mean.toFixed(3)}</td>
                    <td style={td}>{s.likeErr.n ? s.likeErr.mean.toFixed(3) : '–'}</td>
                    <td style={{ ...td, ...dim }}>{s.wallMs.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
