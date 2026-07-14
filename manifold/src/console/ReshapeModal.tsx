/**
 * ReshapeModal — confirm modal for reshaping the runtime-shaped net (P2).
 *
 * Offered when the composed ACTIVE input-axis count changes to something other
 * than the net's current input arity (see ConsoleApp's reshape-offer effect).
 * The locked decision (manifold-mixed-inputs memory) is a "reset-on-reshape"
 * flow: warm-start the weights from the current net, reset examples + explore
 * state. Declining keeps the current (over-provisioned, zero-padded) net — so
 * the default 32-input head behaviour never changes unless the user opts in.
 *
 * Small inline modal in the house design language (no external dialog dep).
 */
import { Button } from '../primitives';

export interface ReshapeModalProps {
  /** Target input arity (the current active axis count). */
  target: number;
  /** The net's current input arity, for the copy. */
  current: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ReshapeModal({ target, current, onConfirm, onCancel }: ReshapeModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reshape the net"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(420px, 90vw)',
          background: 'var(--bg-1)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-2)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--fg)',
          padding: 'var(--sp-4, 18px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          style={{
            fontSize: 'var(--fs-sm)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--accent)',
          }}
        >
          Reshape the net?
        </div>
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', lineHeight: 1.7, color: 'var(--fg)' }}>
          Reshape the net to {target} input{target === 1 ? '' : 's'}? Weights are warm-started from
          the current {current}-input net; examples and exploration state reset.
        </p>
        <p style={{ margin: 0, fontSize: 9, lineHeight: 1.6, color: 'var(--fg-dim)' }}>
          Decline to keep the current net — the extra axes stay zero-padded (inert).
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Keep current
          </Button>
          <Button size="sm" variant="primary" onClick={onConfirm}>
            Reshape to {target}
          </Button>
        </div>
      </div>
    </div>
  );
}
