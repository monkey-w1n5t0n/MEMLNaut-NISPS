/**
 * icons.tsx — monochrome inline-SVG icon set for the dock / verdict / console
 * chrome. Every icon strokes/fills with `currentColor` (1.5px stroke, ~18px),
 * so colour is driven entirely by the consumer's CSS `color`:
 *
 *   active / focused  → var(--accent) (orange)
 *   unfocused         → the Settings unfocused colour (off-white / white / orange)
 *
 * No multicolour emoji here. When the Settings `monochromeIcons` flag is OFF the
 * dock may fall back to the prior glyph strings (see GLYPH_FALLBACK).
 *
 * British spelling in copy; these are presentational only.
 */
import type { CSSProperties } from 'react';

export interface IconProps {
  size?: number;
  style?: CSSProperties;
}

function svg(size: number, style: CSSProperties | undefined, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', ...style }}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Mode — output target/backend selector (stacked layers / target). */
export function ModeIcon({ size = 18, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <path d="M12 3 21 7.5 12 12 3 7.5 12 3Z" />
      <path d="M3 12.5 12 17l9-4.5" />
      <path d="M3 17 12 21.5 21 17" />
    </>,
  );
}

/** Sandwich — stacked parameter-landscape slabs (the layer toggle). */
export function SandwichIcon({ size = 18, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <path d="M3 6.5 12 3l9 3.5L12 10 3 6.5Z" />
      <path d="M3 12 12 15.5 21 12" />
      <path d="M3 17 12 20.5 21 17" />
    </>,
  );
}

/** Learning — a brain-ish node graph. */
export function LearningIcon({ size = 18, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <circle cx="7" cy="8" r="2" />
      <circle cx="17" cy="6" r="2" />
      <circle cx="16" cy="16" r="2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 8.6 15 6.6M8.4 9.6 14.6 14.6M9 16.4 14 16M7 10v5" />
    </>,
  );
}

/** Inputs — a 2D pad with a control dot. */
export function InputsIcon({ size = 18, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 4v16M4 12h16" strokeOpacity="0.45" />
      <circle cx="15" cy="9" r="2" fill="currentColor" stroke="none" />
    </>,
  );
}

/** Outputs — fader bank. */
export function OutputsIcon({ size = 18, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <path d="M6 4v16M12 4v16M18 4v16" />
      <circle cx="6" cy="14" r="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="2" fill="currentColor" stroke="none" />
    </>,
  );
}

/** Settings — gear. */
export function SettingsIcon({ size = 18, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
    </>,
  );
}

/** Help — question mark in a circle. */
export function HelpIcon({ size = 18, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.3 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.5 2-2.5 3.7" />
      <circle cx="12" cy="17.2" r="0.6" fill="currentColor" stroke="none" />
    </>,
  );
}

/** Dice — explore / re-roll into a scratchpad (a die showing five pips). */
export function DiceIcon({ size = 22, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
    </>,
  );
}

/** Close (✕). */
export function CloseIcon({ size = 14, style }: IconProps) {
  return svg(size, style, <path d="M6 6l12 12M18 6 6 18" />);
}

/** Expand / depth toggle (diagonal arrows). */
export function ExpandIcon({ size = 14, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <path d="M9 4H4v5M15 20h5v-5" />
      <path d="M20 4l-6 6M4 20l6-6" strokeOpacity="0.7" />
    </>,
  );
}

/** Particle / visual mode — orbiting dots. */
export function ParticleIcon({ size = 18, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="7" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="19" cy="9" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="16" cy="18" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="7" cy="17" r="1.3" fill="currentColor" stroke="none" />
    </>,
  );
}

/** MIDI — 5-pin DIN. */
export function MidiIcon({ size = 18, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="7" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="17" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8.6" cy="15.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.4" cy="15.5" r="0.9" fill="currentColor" stroke="none" />
    </>,
  );
}

/** OSC — concentric signal rings. */
export function OscIcon({ size = 18, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M6 6a9 9 0 0 0 0 12M18 6a9 9 0 0 1 0 12" strokeOpacity="0.6" />
    </>,
  );
}

/** Built-in synth — a waveform. */
export function SynthIcon({ size = 18, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M6 13c1.5-4 3-4 4.5 0s3 4 4.5 0" />
    </>,
  );
}

/** MEMLNaut Editor — USB / hardware-link plug. */
export function EditorIcon({ size = 18, style }: IconProps) {
  return svg(
    size,
    style,
    <>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 6.4V13" />
      <path d="M8.5 9.5 8.5 11a3.5 3.5 0 0 0 7 0V9.5" />
      <rect x="9" y="13" width="6" height="3" rx="1" />
      <path d="M12 16v3" />
    </>,
  );
}

/** Prior colour-emoji glyphs, for the monochrome-OFF fallback. */
export const GLYPH_FALLBACK = {
  mode: '⊞',
  learn: '🧠',
  inputs: '🎚',
  route: '🔀',
  settings: '⚙',
  help: '?',
  particles: '✦',
  midi: '🎹',
  osc: '◉',
  cv: '⎓',
  synth: '🔊',
  editor: '🔌',
} as const;
