import React from 'react';

/**
 * Manifold Slider — labeled horizontal range with a glowing orange thumb and
 * a tabular value readout. Controlled via value/onChange (0..max).
 */
export function Slider({
  label,
  value = 0,
  min = 0,
  max = 1,
  step = 0.01,
  unit = '',
  onChange,
  disabled = false,
  format,
  style,
}) {
  const pct = max > min ? (value - min) / (max - min) : 0;
  const display = format ? format(value) : (Number.isInteger(step) ? value : value.toFixed(2));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', fontFamily: 'var(--font-mono)', userSelect: 'none', opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto', ...style }}>
      {label && (
        <span style={{ color: 'var(--fg-mute)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      )}
      <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange && onChange(parseFloat(e.target.value))}
          style={{
            flex: 1,
            WebkitAppearance: 'none',
            appearance: 'none',
            background: 'transparent',
            height: 24,
            margin: 0,
            cursor: 'pointer',
            '--mf-pct': `${pct}`,
          }}
          className="mf-slider-input"
        />
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--fs-xs)', color: 'var(--fg-mute)', minWidth: '4ch', textAlign: 'right' }}>
          {display}{unit && <span style={{ color: 'var(--fg-dim)', marginLeft: 2 }}>{unit}</span>}
        </span>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        .mf-slider-input::-webkit-slider-runnable-track { height: 4px; border-radius: 999px; background: linear-gradient(to right, var(--accent) 0%, var(--accent) calc(var(--mf-pct) * 100%), var(--bg-3) 0%); }
        .mf-slider-input::-moz-range-track { height: 4px; border-radius: 999px; background: var(--bg-3); }
        .mf-slider-input::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--accent); margin-top: -6px; box-shadow: 0 0 8px var(--glow-accent); cursor: pointer; transition: transform var(--dur-fast) var(--ease); }
        .mf-slider-input::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: var(--accent); border: none; box-shadow: 0 0 8px var(--glow-accent); }
        .mf-slider-input:hover::-webkit-slider-thumb { transform: scale(1.15); }
        .mf-slider-input:focus { outline: none; }
        .mf-slider-input:focus::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--glow-focus); }
      ` }} />
    </div>
  );
}
