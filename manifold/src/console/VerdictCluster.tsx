/**
 * VerdictCluster — floating bottom-centre control, the app's main verdict.
 * ▽ perturb (thumbs-down) · ↺ undo · △ commit (thumbs-up).
 * Explore mode retains the ported long-press re-roll gesture. Push away fires
 * once on pointer-down and never reinterprets a hold as randomisation.
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
 * Wiring (in ConsoleApp): onCommit / onPerturb dispatch on the mode; onReroll
 * is the Explore-mode long-press path; onRandomise is the explicit secondary
 * control.
 */
import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { FeedbackModeUI } from './types';
import { DiceIcon } from './icons';

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
  /** Small bounded weight perturbation of the current net (left half of the pill). */
  onNudge: () => void;
  /** Full re-roll of the current net (right half of the pill). */
  onRandomise: () => void;
  canUndo: boolean;
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
  onNudge,
  onRandomise,
  canUndo,
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
    : 'Dislike — push the sound away';
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

  const cancelLongPress = () => {
    if (lp.current) {
      clearTimeout(lp.current);
      lp.current = null;
    }
  };
  const perturbDown = () => {
    cancelLongPress();
    if (!explore) {
      onPerturb();
      return;
    }
    firedReroll.current = false;
    lp.current = setTimeout(() => {
      lp.current = null;
      firedReroll.current = true;
      onReroll();
    }, 600);
  };
  const perturbUp = () => {
    if (!explore) return;
    cancelLongPress();
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

  // Two halves of the secondary pill (nudge | randomise).
  const pillHalf = (extra: CSSProperties): CSSProperties => ({
    flex: 1,
    height: 30,
    border: 0,
    background: 'transparent',
    color: 'var(--fg-mute)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--fs-xs)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    transition: 'background var(--dur-fast), color var(--dur-fast)',
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
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--sp-2)',
        opacity: hover || firstSession ? 1 : 0.55,
        transition: 'opacity var(--dur-med) var(--ease-console)',
        zIndex: 40,
      }}
    >
      <div
        style={{
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
        }}
      >
        <button
          type="button"
          title={downTitle}
          onPointerDown={perturbDown}
          onPointerUp={perturbUp}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          style={big({
            background: explore && exploring ? 'rgba(255,106,0,0.22)' : 'rgba(255,106,0,0.16)',
            color: 'var(--accent)',
          })}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {/* Explore mode = dice (re-roll into a scratchpad); dislike mode = thumb-down. */}
          {explore ? <DiceIcon size={24} /> : <ThumbIcon down />}
        </button>

        <button
          type="button"
          title="Undo (z)"
          onClick={onUndo}
          disabled={!canUndo}
          style={big({
            width: 36,
            height: 36,
            fontSize: 16,
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
          style={big(
            picking
              ? {
                  background: 'rgba(0,204,255,0.22)',
                  color: 'var(--accent-2)',
                  boxShadow: '0 0 16px var(--accent-2)',
                }
              : {
                  background: 'rgba(107,194,107,0.20)',
                  color: 'var(--good)',
                  boxShadow: '0 0 16px rgba(107,194,107,0.45)',
                },
          )}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.08)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {/* Explore-mode up is "place" (a pin glyph) once exploring. */}
          {explore && exploring ? <span style={{ fontSize: 22, lineHeight: 1 }}>⌖</span> : <ThumbIcon />}
        </button>
      </div>

      {/* Secondary pill — two halves: nudge (small perturbation) | randomise (full re-roll). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          width: 220,
          background: 'var(--glass)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid var(--glass-line)',
          borderRadius: 'var(--r-pill)',
          boxShadow: 'var(--shadow-2)',
          overflow: 'hidden',
        }}
      >
        <button
          type="button"
          title="Nudge — small bounded perturbation of the current net"
          onClick={onNudge}
          style={pillHalf({ borderRight: '1px solid var(--glass-line)' })}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,106,0,0.12)';
            e.currentTarget.style.color = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--fg-mute)';
          }}
        >
          nudge
        </button>
        <button
          type="button"
          title="Randomise — full re-roll of the current net"
          onClick={onRandomise}
          style={pillHalf({})}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,106,0,0.12)';
            e.currentTarget.style.color = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--fg-mute)';
          }}
        >
          randomise
        </button>
      </div>
    </div>
  );
}
