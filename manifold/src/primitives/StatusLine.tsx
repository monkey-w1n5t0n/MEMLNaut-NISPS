import { Fragment } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export type StatusTone = 'accent' | 'cyan' | 'good' | 'warn' | 'bad';

export interface StatusItemObject {
  label?: ReactNode;
  value: ReactNode;
  tone?: StatusTone;
}

export type StatusItem = string | StatusItemObject;

export interface StatusLineProps {
  items?: StatusItem[];
  style?: CSSProperties;
}

const TONE_COLORS: Record<StatusTone, string> = {
  accent: 'var(--accent)',
  cyan: 'var(--accent-2)',
  good: 'var(--good)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
};

/**
 * Manifold StatusLine — the dim mono readout strip at the bottom of a mode.
 * Pass an array of items; strings render plain, {label,value,tone} render a
 * labelled readout. Items are joined with the house middle-dot separator.
 */
export function StatusLine({ items = [], style }: StatusLineProps) {
  return (
    <p
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--sp-2)',
        margin: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-xs)',
        color: 'var(--fg-dim)',
        ...style,
      }}
    >
      {items.map((it, i) => {
        const isObj = it !== null && typeof it === 'object';
        const toneColor =
          isObj && it.tone ? (TONE_COLORS[it.tone] ?? null) : null;
        return (
          <Fragment key={i}>
            {i > 0 && <span aria-hidden="true">·</span>}
            {isObj ? (
              <span style={{ color: toneColor || 'var(--fg-dim)' }}>
                {it.label && <span style={{ color: 'var(--fg-dim)' }}>{it.label} </span>}
                <span
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    color: toneColor || 'var(--fg-mute)',
                  }}
                >
                  {it.value}
                </span>
              </span>
            ) : (
              <span>{it}</span>
            )}
          </Fragment>
        );
      })}
    </p>
  );
}
