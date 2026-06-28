import React from 'react';

/**
 * Manifold StatusLine — the dim mono readout strip at the bottom of a mode.
 * Pass an array of items; strings render plain, {label,value,tone} render a
 * labeled readout. Items are joined with the house middle-dot separator.
 */
export function StatusLine({ items = [], style }) {
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
      }}
    >
      {items.map((it, i) => {
        const isObj = it && typeof it === 'object';
        const toneColor = isObj && it.tone
          ? { accent: 'var(--accent)', cyan: 'var(--accent-2)', good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' }[it.tone]
          : null;
        return (
          <React.Fragment key={i}>
            {i > 0 && <span aria-hidden="true">·</span>}
            {isObj ? (
              <span style={{ color: toneColor || 'var(--fg-dim)' }}>
                {it.label && <span style={{ color: 'var(--fg-dim)' }}>{it.label} </span>}
                <span style={{ fontVariantNumeric: 'tabular-nums', color: toneColor || 'var(--fg-mute)' }}>{it.value}</span>
              </span>
            ) : (
              <span>{it}</span>
            )}
          </React.Fragment>
        );
      })}
    </p>
  );
}
