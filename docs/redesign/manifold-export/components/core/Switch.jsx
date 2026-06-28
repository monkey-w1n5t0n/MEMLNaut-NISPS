import React from 'react';

/**
 * Manifold Switch — compact toggle. On = orange track + glow. Optional label.
 */
export function Switch({ checked = false, onChange, label, disabled = false, style }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--fg)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, userSelect: 'none', ...style }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange && onChange(!checked)}
        style={{
          position: 'relative',
          width: 36,
          height: 20,
          padding: 0,
          borderRadius: 'var(--r-pill)',
          border: `1px solid ${checked ? 'var(--accent)' : 'var(--line)'}`,
          background: checked ? 'var(--accent)' : 'var(--bg-2)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)',
          boxShadow: checked ? '0 0 8px var(--glow-accent)' : 'none',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: checked ? 'var(--bg)' : 'var(--fg-mute)',
            transition: 'left var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease)',
          }}
        />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}
