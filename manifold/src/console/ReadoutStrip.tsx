/**
 * ReadoutStrip — the output heatmap as a thin top control strip. Same model as
 * OutputStage. Ported from `ReadoutStrip.jsx`.
 */
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MFParam, ParamStatus } from './model';
import { OutputEditor } from './OutputEditor';

const RS_GROUP_COLOR: Record<string, string> = {
  formant: '--accent',
  pitch: '--accent-2',
  amp: '--good',
  filter: '--warn',
  fx: '--info',
  mod: '--accent-3',
};
const RS_NEXT: Record<ParamStatus, ParamStatus> = { off: 'fixed', fixed: 'live', live: 'off' };

export interface ReadoutStripProps {
  params: MFParam[];
  values: number[];
  onChange: (i: number, patch: Partial<MFParam>) => void;
  pinned: boolean;
  onTogglePin: () => void;
}

export function ReadoutStrip({ params, values, onChange, pinned, onTogglePin }: ReadoutStripProps) {
  const [open, setOpen] = useState<number | null>(null);
  const timers = useRef<{ open: ReturnType<typeof setTimeout> | null; close: ReturnType<typeof setTimeout> | null }>({
    open: null,
    close: null,
  });
  const drag = useRef<{ i: number; moved: boolean; startY: number; el: HTMLDivElement | null; alt: boolean }>({
    i: -1,
    moved: false,
    startY: 0,
    el: null,
    alt: false,
  });

  const scheduleOpen = (i: number) => {
    if (timers.current.close) clearTimeout(timers.current.close);
    if (timers.current.open) clearTimeout(timers.current.open);
    timers.current.open = setTimeout(() => setOpen(i), 110);
  };
  const scheduleClose = () => {
    if (timers.current.open) clearTimeout(timers.current.open);
    if (timers.current.close) clearTimeout(timers.current.close);
    timers.current.close = setTimeout(() => setOpen(null), 280);
  };
  const hold = () => {
    if (timers.current.close) clearTimeout(timers.current.close);
  };

  const valFromEvent = (el: HTMLDivElement, clientY: number) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>, i: number) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      i,
      moved: false,
      startY: e.clientY,
      el: e.currentTarget,
      alt: e.altKey || e.metaKey,
    };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>, i: number) => {
    const d = drag.current;
    if (d.i !== i) return;
    if (Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    if (d.moved && !d.alt && d.el) onChange(i, { val: valFromEvent(d.el, e.clientY) });
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>, i: number) => {
    const d = drag.current;
    if (d.i !== i) return;
    if (d.alt && !d.moved) onChange(i, { status: RS_NEXT[params[i].status] || 'live' });
    else if (!d.moved && d.el) onChange(i, { val: valFromEvent(d.el, e.clientY) });
    drag.current = { i: -1, moved: false, startY: 0, el: null, alt: false };
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 2,
        height: 76,
        padding: '0 2px',
        background: 'var(--glass)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--glass-line)',
        position: 'relative',
        zIndex: 30,
      }}
    >
      <button
        type="button"
        onClick={onTogglePin}
        title="Pin strip open"
        style={{
          flex: '0 0 auto',
          width: 30,
          border: 0,
          background: 'transparent',
          color: pinned ? 'var(--accent)' : 'var(--fg-dim)',
          cursor: 'pointer',
          fontSize: 'var(--fs-md)',
        }}
      >
        {pinned ? '📌' : '▾'}
      </button>
      {params.map((p, i) => {
        const eff = values[i] ?? 0;
        const gc = `var(${RS_GROUP_COLOR[p.group] || '--accent'})`;
        const dim = p.status === 'off';
        const placeRight = i > params.length - 5;
        return (
          <div
            key={i}
            style={{
              position: 'relative',
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
            onPointerLeave={scheduleClose}
          >
            <div
              onPointerEnter={() => scheduleOpen(i)}
              style={{
                textAlign: 'center',
                fontSize: 8,
                fontFamily: 'var(--font-mono)',
                lineHeight: '11px',
                cursor: 'help',
                color: p.status === 'live' ? 'var(--fg-dim)' : gc,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {p.name}
            </div>
            <div
              onPointerDown={(e) => down(e, i)}
              onPointerMove={(e) => move(e, i)}
              onPointerUp={(e) => up(e, i)}
              onPointerCancel={(e) => up(e, i)}
              style={{
                position: 'relative',
                flex: 1,
                background: 'var(--bg)',
                borderRadius: 2,
                overflow: 'hidden',
                cursor: 'ns-resize',
                opacity: dim ? 0.5 : 1,
                touchAction: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: `${eff * 100}%`,
                  background: gc,
                  opacity: 0.25 + eff * 0.6,
                  transition: 'height 60ms linear',
                }}
              />
              {p.status === 'live' && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: `${p.val * 100}%`,
                    height: 0,
                    borderTop: '1px dashed rgba(255,255,255,0.3)',
                  }}
                />
              )}
              {p.status !== 'live' && (
                <div
                  style={{
                    position: 'absolute',
                    top: 1,
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    fontSize: 8,
                    color: p.status === 'fixed' ? 'var(--accent-2)' : 'var(--fg-dim)',
                  }}
                >
                  {p.status === 'fixed' ? '⊟' : '∅'}
                </div>
              )}
            </div>
            {open === i && (
              <OutputEditor
                param={p}
                onChange={(patch) => onChange(i, patch)}
                onHold={hold}
                onLeave={scheduleClose}
                place={{ top: 'calc(100% + 6px)', [placeRight ? 'right' : 'left']: 0 }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
