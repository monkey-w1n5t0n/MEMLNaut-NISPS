import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /** Optional leading glyph rendered before the children. */
  glyph?: ReactNode;
  /** Active (pressed/selected) styling for secondary/ghost variants. */
  active?: boolean;
  style?: CSSProperties;
}

interface VariantStyle {
  background: string;
  borderColor: string;
  color: string;
  fontWeight?: number;
}

/**
 * Manifold Button — terminal-styled action.
 * Variants: primary (solid orange), secondary (outlined raised), ghost (text).
 * Sizes: sm, md, lg. Optional leading glyph.
 */
export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  disabled = false,
  glyph,
  active = false,
  type = 'button',
  onClick,
  style,
  ...rest
}: ButtonProps) {
  const sizes: Record<ButtonSize, { padding: string; fontSize: string; height: number }> = {
    sm: { padding: '4px 12px', fontSize: 'var(--fs-xs)', height: 28 },
    md: { padding: '8px 12px', fontSize: 'var(--fs-sm)', height: 34 },
    lg: { padding: '10px 18px', fontSize: 'var(--fs-md)', height: 44 },
  };
  const s = sizes[size] ?? sizes.md;

  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--sp-2)',
    fontFamily: 'var(--font-mono)',
    fontSize: s.fontSize,
    height: s.height,
    padding: s.padding,
    borderRadius: 'var(--r-1)',
    border: '1px solid var(--line)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    userSelect: 'none',
    transition:
      'background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)',
    whiteSpace: 'nowrap',
  };

  const variants: Record<ButtonVariant, VariantStyle> = {
    primary: {
      background: 'var(--accent)',
      borderColor: 'var(--accent)',
      color: 'var(--bg)',
      fontWeight: 600,
    },
    secondary: {
      background: active ? 'var(--bg-3)' : 'var(--bg-2)',
      borderColor: active ? 'var(--accent)' : 'var(--line)',
      color: active ? 'var(--accent)' : 'var(--fg)',
    },
    ghost: {
      background: 'transparent',
      borderColor: 'transparent',
      color: active ? 'var(--accent)' : 'var(--fg-mute)',
    },
  };

  const v = variants[variant] ?? variants.secondary;
  const disabledStyle: CSSProperties | null = disabled
    ? { opacity: 0.45, color: 'var(--fg-dim)', boxShadow: 'none' }
    : null;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{ ...base, ...v, ...disabledStyle, ...style }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (variant === 'secondary') {
          e.currentTarget.style.background = 'var(--bg-3)';
          e.currentTarget.style.borderColor = 'var(--line-strong)';
        }
        if (variant === 'ghost') e.currentTarget.style.color = 'var(--fg)';
        if (variant === 'primary') e.currentTarget.style.background = 'var(--accent-3)';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = v.background;
        e.currentTarget.style.borderColor = v.borderColor;
        e.currentTarget.style.color = v.color;
      }}
      {...rest}
    >
      {glyph && (
        <span aria-hidden="true" style={{ fontSize: '1.1em', lineHeight: 1 }}>
          {glyph}
        </span>
      )}
      {children}
    </button>
  );
}
