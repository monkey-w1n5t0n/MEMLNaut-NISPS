/**
 * VerdictCluster — floating bottom-centre control, the app's main verdict.
 * ▽ perturb (thumbs-down) · ↺ undo · △ commit (thumbs-up), + A/B toggle.
 * Long-press perturb = full re-roll. Ported from `VerdictCluster.jsx`.
 *
 * The cluster reflects the ACTIVE feedback mode (workstream B; rl-feedback §0):
 *
 *   Explore & place (Mode 2, default):
 *     thumbs-DOWN = enter explore / cancel explore (NEVER a dislike);
 *     thumbs-UP   = place (when exploring) / commit a like (when not).
 *   Geometric dislike (Mode 1):
 *     thumbs-DOWN = dislike (push away);
 *     thumbs-UP   = like + train.
 *
 * Wiring (in ConsoleApp): onCommit / onPerturb dispatch on the mode; onReroll =
 * re-roll the scratchpad (Mode 2) or the real net.
 */
import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { FeedbackModeUI } from './types';

function ThumbIcon({ size = 24, down = false }: { size?: number; down?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: down ? 'rotate(180deg)' : 'none', display: 'block' }}
      aria-hidden="true"
    >
      <path d="M14 9V5a2.4 2.4 0 0 0-2.4-2.4L8 11v9h8.1a1.6 1.6 0 0 0 1.6-1.36l1.1-7.2A1.6 1.6 0 0 0 17.2 9z" />
      <path d="M8 20H5.6A1.6 1.6 0 0 1 4 18.4v-5.8A1.6 1.6 0 0 1 5.6 11H8" />
    </svg>
  );
}

export interface VerdictClusterProps {
  onPerturb: () => void;
  onUndo: () => void;
  onCommit: () => void;
  onReroll: () => void;
  canUndo: boolean;
  ab: 'A' | 'B';
  onToggleAB: () => void;
  onHoldA: (holding: boolean) => void;
  firstSession: boolean;
  /** Active feedback mode — drives the cluster's labels/tones (rl-feedback §0). */
  feedbackMode: FeedbackModeUI;
  /** True while a Mode-2 scratchpad session is active. */
  exploring: boolean;
  /** True while awaiting a manifold location pick after "place". */
  picking: boolean;
}

export function VerdictCluster({
  onPerturb,
  onUndo,
  onCommit,
  onReroll,
  canUndo,
  ab,
  onToggleAB,
  onHoldA,
  firstSession,
  feedbackMode,
  exploring,
  picking,
}: VerdictClusterProps) {
  const explore = feedbackMode === 'explore-and-place';
  // Labels per mode + session state.
  const downTitle = explore
    ? exploring
      ? 'Cancel explore — restore the real net'
      : 'Explore — re-roll into a scratchpad (hold to re-roll again)'
    : 'Dislike — push the sound away (hold to re-roll)';
  const upTitle = explore
    ? exploring
      ? picking
        ? 'Tap the manifold to place this sound'
        : 'Place — pick a manifold location for this sound'
      : 'Commit — keep the current sound'
    : 'Like — reinforce + train';
  const [hover, setHover] = useState(false);
  const lp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedReroll = useRef(false);

  const perturbDown = () => {
    firedReroll.current = false;
    lp.current = setTimeout(() => {
      firedReroll.current = true;
      onReroll();
    }, 600);
  };
  const perturbUp = () => {
    if (lp.current) clearTimeout(lp.current);
    if (!firedReroll.current) onPerturb();
  };

  const big = (extra: CSSProperties): CSSProperties => ({
    width: 64,
    height: 64,
    borderRadius: '50%',
    fontSize: 26,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-mono)',
    border: '1px solid var(--glass-line)',
    transition: 'transform var(--dur-fast) var(--ease-console), background var(--dur-fast)',
    ...extra,
  });

  return (
    <div
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        bottom: 28,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-3)',
        padding: 'var(--sp-2) var(--sp-3)',
        background: 'var(--glass)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid var(--glass-line)',
        borderRadius: 'var(--r-pill)',
        boxShadow: 'var(--shadow-2)',
        opacity: hover || firstSession ? 1 : 0.55,
        transition: 'opacity var(--dur-med) var(--ease-console)',
        zIndex: 40,
      }}
    >
      <button
        type="button"
        title={downTitle}
        onPointerDown={perturbDown}
        onPointerUp={perturbUp}
        onPointerLeave={() => {
          if (lp.current) clearTimeout(lp.current);
        }}
        style={big(
          explore
            ? exploring
              ? { background: 'rgba(0,204,255,0.16)', color: 'var(--accent-2)' }
              : { background: 'rgba(0,204,255,0.10)', color: 'var(--accent-2)' }
            : { background: 'rgba(255,68,102,0.16)', color: 'var(--danger)' },
        )}
        onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
        onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
      >
        {/* Explore-mode down is a re-roll/explore (↻), not a dislike thumb. */}
        {explore ? <span style={{ fontSize: 24, lineHeight: 1 }}>↻</span> : <ThumbIcon down />}
      </button>

      <button
        type="button"
        title="Undo (z)"
        onClick={onUndo}
        disabled={!canUndo}
        style={big({
          width: 48,
          height: 48,
          fontSize: 20,
          background: 'var(--bg-2)',
          color: 'var(--fg-mute)',
          opacity: canUndo ? 1 : 0.4,
          cursor: canUndo ? 'pointer' : 'not-allowed',
        })}
      >
        ↺
      </button>

      <button
        type="button"
        title={upTitle}
        onClick={onCommit}
        style={big({
          background: picking ? 'rgba(0,204,255,0.22)' : 'rgba(255,106,0,0.18)',
          color: picking ? 'var(--accent-2)' : 'var(--accent)',
          boxShadow: picking ? '0 0 16px var(--accent-2)' : '0 0 16px var(--glow-accent)',
        })}
        onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
        onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
      >
        {/* Explore-mode up is "place" (a pin glyph) once exploring. */}
        {explore && exploring ? <span style={{ fontSize: 22, lineHeight: 1 }}>⌖</span> : <ThumbIcon />}
      </button>
    </div>
  );
}
