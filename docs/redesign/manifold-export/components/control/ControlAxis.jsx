import React from 'react';

/**
 * Manifold ControlAxis — a named macro slider with bipolar endpoint labels
 * (e.g. Boldness: Caution ↔ Bold). Shows a live preset tag and value. The
 * track accent can be themed per-axis via `accent`.
 */
export function ControlAxis({ label, endpoints = ['', ''], value = 0.5, onChange, preset, accent = 'var(--accent)', disabled = false, style }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-1)',
        background: 'var(--bg-1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-2)',
        padding: 'var(--sp-2) var(--sp-3)',
        fontFamily: 'var(--font-mono)',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)' }}>
        <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg)', flex: 1 }}>{label}</span>
        {preset && <span style={{ color: accent, fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{preset}</span>}
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-mute)', fontSize: 'var(--fs-xs)', minWidth: '4ch', textAlign: 'right' }}>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange && onChange(parseFloat(e.target.value))}
        className="mf-axis-input"
        style={{ WebkitAppearance: 'none', appearance: 'none', width: '100%', height: 24, background: 'transparent', margin: 0, cursor: 'pointer', '--mf-axis-accent': accent }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-dim)' }}>
        <span>{endpoints[0]}</span>
        <span>{endpoints[1]}</span>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        .mf-axis-input::-webkit-slider-runnable-track { height: 6px; border-radius: 999px; background: var(--bg-3); }
        .mf-axis-input::-moz-range-track { height: 6px; border-radius: 999px; background: var(--bg-3); }
        .mf-axis-input::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--mf-axis-accent, var(--accent)); margin-top: -6px; box-shadow: 0 0 10px var(--mf-axis-accent, var(--accent)); cursor: pointer; }
        .mf-axis-input::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: var(--mf-axis-accent, var(--accent)); border: none; box-shadow: 0 0 10px var(--mf-axis-accent, var(--accent)); }
        .mf-axis-input:focus { outline: none; }
      ` }} />
    </div>
  );
}
