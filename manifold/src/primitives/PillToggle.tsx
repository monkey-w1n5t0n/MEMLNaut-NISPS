import type { CSSProperties, ReactNode } from 'react';

export interface PillOption<T extends string | number = string> {
  value: T;
  label: ReactNode;
}

export interface PillToggleProps<T extends string | number = string> {
  options?: PillOption<T>[];
  value?: T;
  onChange?: (value: T) => void;
  ariaLabel?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

/**
 * Manifold PillToggle — segmented radio control in a pill capsule.
 * The selected segment fills solid orange. Options: [{value,label}].
 */
export function PillToggle<T extends string | number = string>({
  options = [],
  value,
  onChange,
  ariaLabel = 'segmented control',
  disabled = false,
  style,
}: PillToggleProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-pill)',
        padding: 2,
        gap: 2,
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        ...style,
      }}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange?.(opt.value)}
            style={{
              background: selected ? 'var(--accent)' : 'transparent',
              color: selected ? 'var(--bg)' : 'var(--fg-mute)',
              border: 0,
              borderRadius: 'var(--r-pill)',
              padding: '6px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              cursor: 'pointer',
              transition:
                'background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)',
            }}
            onMouseEnter={(e) => {
              if (!selected) e.currentTarget.style.color = 'var(--fg)';
            }}
            onMouseLeave={(e) => {
              if (!selected) e.currentTarget.style.color = 'var(--fg-mute)';
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
