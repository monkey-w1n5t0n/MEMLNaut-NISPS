import React from 'react';

/**
 * Manifold Panel — the house surface: bg-1 fill, 1px hairline border, 8px
 * radius, no shadow. Optional header row with an uppercase title + actions,
 * separated by a hairline.
 */
export function Panel({ title, label, actions, children, padding = 'var(--sp-3)', style }) {
  return (
    <section
      style={{
        background: 'var(--bg-1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-2)',
        fontFamily: 'var(--font-mono)',
        color: 'var(--fg)',
        ...style,
      }}
    >
      {(title || label || actions) && (
        <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: 'var(--sp-2) var(--sp-3)', borderBottom: '1px solid var(--line)' }}>
          {label && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>}
          {title && <h3 style={{ margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--fg)' }}>{title}</h3>}
          {actions && <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-2)' }}>{actions}</div>}
        </header>
      )}
      <div style={{ padding }}>{children}</div>
    </section>
  );
}
