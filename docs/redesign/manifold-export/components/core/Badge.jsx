import React from 'react';

const TONES = {
  neutral: { fg: 'var(--fg-mute)', bd: 'var(--line)', bg: 'var(--bg-2)' },
  accent:  { fg: 'var(--accent)', bd: 'rgba(255,106,0,0.4)', bg: 'rgba(255,106,0,0.12)' },
  good:    { fg: 'var(--good)', bd: 'rgba(107,194,107,0.4)', bg: 'rgba(107,194,107,0.14)' },
  warn:    { fg: 'var(--warn)', bd: 'rgba(245,196,94,0.4)', bg: 'rgba(245,196,94,0.14)' },
  bad:     { fg: 'var(--bad)', bd: 'rgba(239,91,91,0.4)', bg: 'rgba(239,91,91,0.14)' },
  info:    { fg: 'var(--info)', bd: 'rgba(91,158,239,0.4)', bg: 'rgba(91,158,239,0.14)' },
};

/**
 * Manifold Badge — small status capsule. `dot` prepends a status dot;
 * `tone` sets the color. Use for state labels (frozen, training, healthy).
 */
export function Badge({ children, tone = 'neutral', dot = false, style }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--sp-1)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-xs)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: t.fg,
        background: t.bg,
        border: `1px solid ${t.bd}`,
        borderRadius: 'var(--r-pill)',
        padding: '2px 10px',
        lineHeight: 1.6,
        ...style,
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.fg, boxShadow: `0 0 6px ${t.fg}` }} />}
      {children}
    </span>
  );
}
