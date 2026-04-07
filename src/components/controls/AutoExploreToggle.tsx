/**
 * AutoExploreToggle — small circular button that starts/stops AutoExplore.
 *
 * Shows a progress ring that fills over each interval, giving visual feedback
 * of when the next auto-step will fire.  A brief pulse animation plays each
 * time a step fires.
 *
 * The component drives a `requestAnimationFrame` loop while active to keep the
 * ring progress up-to-date.
 */

import { createSignal, onCleanup, onMount } from 'solid-js';
import type { AutoExplore } from '../../core/auto-explore';
import './auto-explore.css';

export interface AutoExploreToggleProps {
  autoExplore: AutoExplore;
  /** Optional aria-label override. */
  label?: string;
}

// Geometry for the SVG ring: radius chosen so it sits just outside the 56px button.
// button = 56px, ring extends +6px (3px each side) → outer size ≈ 62px
// We'll use a 62×62 viewBox. Ring circle centre at (31, 31).
const SVG_SIZE = 62;
const CENTRE = SVG_SIZE / 2;   // 31
const RADIUS = 28;             // stroke will sit ~3px inside the outer edge
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈ 175.9

export default function AutoExploreToggle(props: AutoExploreToggleProps) {
  const [isActive, setIsActive] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [pulsing, setPulsing] = createSignal(false);

  let rafId = 0;
  // Track step count so we detect when a new step fires during rAF ticks.
  let _lastProgress = 0;

  function tick() {
    if (!isActive()) {
      setProgress(0);
      return;
    }
    const p = props.autoExplore.getProgress();

    // Detect a step firing: progress reset from high back to near-zero
    if (_lastProgress > 0.85 && p < 0.15) {
      triggerPulse();
    }
    _lastProgress = p;
    setProgress(p);

    rafId = requestAnimationFrame(tick);
  }

  function triggerPulse() {
    setPulsing(true);
    setTimeout(() => setPulsing(false), 400);
  }

  function handleClick() {
    props.autoExplore.toggle();
    const nowActive = props.autoExplore.active;
    setIsActive(nowActive);

    if (nowActive) {
      _lastProgress = 0;
      rafId = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafId);
      setProgress(0);
      _lastProgress = 0;
    }
  }

  // Register pulse-on-step via the explore callback, in addition to rAF detection,
  // so the pulse fires even if rAF misses the exact reset frame.
  onMount(() => {
    const existingCallback = (props.autoExplore as { _callback?: unknown })._callback;
    props.autoExplore.onExplore((evt) => {
      triggerPulse();
      // Forward to any previously registered callback so we don't break wiring.
      if (typeof existingCallback === 'function') {
        (existingCallback as (e: typeof evt) => void)(evt);
      }
    });
  });

  onCleanup(() => {
    cancelAnimationFrame(rafId);
  });

  // Ring fill: dashoffset decreases as progress increases (ring fills clockwise)
  const dashOffset = () => CIRCUMFERENCE * (1 - progress());

  const btnClass = () => {
    let c = 'ae-btn';
    if (isActive()) c += ' ae-btn--active';
    if (pulsing()) c += ' ae-btn--pulse';
    return c;
  };

  return (
    <div class="ae-wrap">
      <button
        class={btnClass()}
        onClick={handleClick}
        aria-label={props.label ?? (isActive() ? 'Stop auto-explore' : 'Start auto-explore')}
        aria-pressed={isActive()}
        title={isActive() ? 'Auto-explore running — tap to stop' : 'Auto-explore — tap to start'}
      >
        {/* SVG progress ring rendered on top of the button content */}
        <svg
          class="ae-ring"
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          aria-hidden="true"
        >
          {/* Background track */}
          <circle
            class="ae-ring-track"
            cx={CENTRE}
            cy={CENTRE}
            r={RADIUS}
          />
          {/* Animated fill */}
          <circle
            class="ae-ring-fill"
            cx={CENTRE}
            cy={CENTRE}
            r={RADIUS}
            stroke-dasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            stroke-dashoffset={dashOffset()}
          />
        </svg>

        {/* Button label */}
        <span class="ae-icon">{isActive() ? '\u25a0' : '\u25b6'}</span>
        <span class="ae-label">auto</span>
      </button>
    </div>
  );
}
