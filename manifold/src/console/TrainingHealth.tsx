/**
 * TrainingHealth — the advanced-surface answer to "is the network learning?".
 *
 * Every number here is read live out of the C++ core:
 *   - the loss curve is `nisps::ml::MLPCore::loss_history` (one entry per SGD
 *     iteration of the last training run), read through `nisps_ml_loss_history`
 *     and published on the spine by both the sync and the worker train paths;
 *   - the per-layer weight health is `nisps::ml::compute_layer_stats`, read
 *     through the already-plumbed `nisps_ml_get_layer_stats`.
 *
 * NOTHING is synthesised. When the core has no history (nothing trained yet)
 * this renders a plain "no training run yet" line rather than a plausible
 * placeholder plot — that distinction is the entire point of this panel
 * (ALIGNMENT defect 6 / simplification-plan §6.5e).
 *
 * It is a component (not a plain render helper like its sibling drawer
 * sections) precisely so it can hold the engine hooks and re-read on version
 * bumps without dragging the whole Console into a re-render.
 *
 * Surfaced only at the Learning drawer's `expanded` depth — Manifold's existing
 * advanced-surface mechanism (`DrawerDepth`), not a new flag.
 */
import { useEngine, useEngineVersion } from '../engine';

const W = 320;
const H = 64;

function fmt(v: number, dp = 4): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(dp);
}

function pct(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

const mono = {
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  color: 'var(--fg-mute)',
} as const;

/** Per-iteration loss curve, log-scaled on y (loss spans orders of magnitude). */
function LossPlot({ history }: { history: ReadonlyArray<number> }) {
  const n = history.length;
  // A single point has no curve to draw; the readout below still reports it.
  if (n < 2) return null;

  const logs = history.map((v) => Math.log10(Math.max(v, 1e-9)));
  let lo = Infinity;
  let hi = -Infinity;
  for (const l of logs) {
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  const span = hi - lo < 1e-6 ? 1 : hi - lo;

  const pts = logs
    .map((l, i) => {
      const x = (i / (n - 1)) * W;
      const y = H - ((l - lo) / span) * H;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Training loss over ${n} iterations, ${fmt(history[0])} down to ${fmt(history[n - 1])}`}
      style={{
        width: '100%',
        height: H,
        display: 'block',
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-sm, 4px)',
      }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function TrainingHealth() {
  const engine = useEngine();
  // Re-read on every engine state change (training publishes a new history).
  useEngineVersion(engine);

  if (!engine) {
    return <p style={{ ...mono, margin: 0 }}>engine not ready</p>;
  }

  const history = engine.lossHistory();
  const stats = engine.getLayerStats();
  const first = history.length ? history[0] : null;
  const last = history.length ? history[history.length - 1] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {history.length === 0 ? (
        <p style={{ ...mono, margin: 0 }}>
          no training run yet — the loss curve appears after the first fit
        </p>
      ) : (
        <>
          <LossPlot history={history} />
          <div style={{ ...mono, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span>{history.length} iter</span>
            <span>start {fmt(first ?? 0)}</span>
            <span style={{ color: 'var(--accent)' }}>end {fmt(last ?? 0)}</span>
            <span>
              {first !== null && last !== null && last < first
                ? 'converging'
                : 'not improving'}
            </span>
          </div>
        </>
      )}

      <table
        style={{ ...mono, width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}
      >
        <thead>
          <tr style={{ color: 'var(--fg-dim)' }}>
            <th style={{ textAlign: 'left', fontWeight: 400 }}>layer</th>
            <th style={{ fontWeight: 400 }}>mean|w|</th>
            <th style={{ fontWeight: 400 }}>max|w|</th>
            <th style={{ fontWeight: 400 }}>dead</th>
            <th style={{ fontWeight: 400 }}>sat</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s, i) => (
            <tr key={i}>
              <td style={{ textAlign: 'left' }}>L{i}</td>
              <td>{fmt(s.meanAbs, 3)}</td>
              <td>{fmt(s.maxAbs, 3)}</td>
              <td>{pct(s.deadFrac)}</td>
              <td>{pct(s.saturatingFrac)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ ...mono, margin: 0, color: 'var(--fg-dim)', lineHeight: 1.5 }}>
        dead = |w| &lt; 0.001, sat = |w| &gt; 3 (nisps/ml/stats.hpp). A layer that is
        mostly dead or mostly saturating is not learning usefully.
      </p>
    </div>
  );
}
