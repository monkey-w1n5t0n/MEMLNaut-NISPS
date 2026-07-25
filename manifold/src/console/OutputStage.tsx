/**
 * OutputStage — the OUTPUT as the hero surface. A full-bleed field of parameter
 * columns. Drag/click a bar sets value; ⌥/alt-click cycles state; hover opens
 * the OutputEditor. Ported from `OutputStage.jsx`.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MFParam, ParamStatus } from './model';
import { GROUP_COLOR } from './model';
import { OutputEditor } from './OutputEditor';

const OUT_NEXT: Record<ParamStatus, ParamStatus> = { off: 'fixed', fixed: 'live', live: 'off' };

export interface OutputStageProps {
  params: MFParam[];
  values: number[];
  onChange: (i: number, patch: Partial<MFParam>) => void;
  compact?: boolean;
}

export function OutputStage({ params, values, onChange, compact = false }: OutputStageProps) {
  const [open, setOpen] = useState<number | null>(null);
  const [clampMarker, setClampMarker] = useState<{ id: string; value: number } | null>(null);
  const timers = useRef<{ open: ReturnType<typeof setTimeout> | null; close: ReturnType<typeof setTimeout> | null }>({
    open: null,
    close: null,
  });
  const clampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    return () => {
      if (clampTimer.current) clearTimeout(clampTimer.current);
    };
  }, []);

  const valFromEvent = (el: HTMLDivElement, clientY: number) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
  };
  const showClampMarker = (id: string, value: number) => {
    if (clampTimer.current) clearTimeout(clampTimer.current);
    setClampMarker({ id, value });
    clampTimer.current = setTimeout(() => {
      setClampMarker(null);
      clampTimer.current = null;
    }, 700);
  };
  const clearClampMarker = () => {
    if (clampTimer.current) clearTimeout(clampTimer.current);
    clampTimer.current = null;
    setClampMarker(null);
  };
  const setSliderValue = (i: number, raw: number) => {
    const param = params[i];
    if (!param) return;
    const min = Math.max(0, Math.min(1, Math.min(param.min, param.max)));
    const max = Math.max(0, Math.min(1, Math.max(param.min, param.max)));
    const value = Math.max(min, Math.min(max, raw));
    const wasClamped = value !== raw;
    if (wasClamped) showClampMarker(param.id, value);
    else clearClampMarker();

    const span = max - min;
    const fixedValue = span > 0 ? (value - min) / span : 0;
    const temporary = param.manualOverride || param.status === 'live';
    onChange(i, {
      status: 'fixed',
      val: fixedValue,
      manualOverride: temporary ? true : undefined,
    });
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
    if (d.moved && !d.alt && d.el) setSliderValue(i, valFromEvent(d.el, e.clientY));
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>, i: number) => {
    const d = drag.current;
    if (d.i !== i) return;
    if (d.alt && !d.moved) {
      clearClampMarker();
      onChange(i, { status: OUT_NEXT[params[i].status] || 'live', manualOverride: undefined });
    } else if (!d.moved && d.el) setSliderValue(i, valFromEvent(d.el, e.clientY));
    drag.current = { i: -1, moved: false, startY: 0, el: null, alt: false };
  };

  return (
    <div
      data-testid="output-stage"
      data-output-count={params.length}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'stretch',
        gap: compact ? 3 : 6,
        padding: compact ? 12 : '20px 28px',
      }}
    >
      {params.map((p, i) => {
        const eff = values[i] ?? 0;
        const gc = `var(${GROUP_COLOR[p.group] || '--accent'})`;
        const dim = p.status === 'off';
        const placeRight = i > params.length - 4;
        return (
          <div
            key={i}
            style={{
              position: 'relative',
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: compact ? 1 : 2,
            }}
            onPointerLeave={scheduleClose}
          >
            <div onPointerEnter={() => scheduleOpen(i)} style={{ cursor: 'help' }}>
              <div
                style={{
                  textAlign: 'center',
                  fontSize: compact ? 8 : 10,
                  fontFamily: 'var(--font-mono)',
                  color:
                    p.status === 'live'
                      ? 'var(--fg-mute)'
                      : `var(${GROUP_COLOR[p.group] || '--accent'})`,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  letterSpacing: '0.02em',
                }}
              >
                {p.name}
              </div>
              <div
                style={{
                  textAlign: 'center',
                  fontSize: compact ? 9 : 11,
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  color: dim ? 'var(--fg-dim)' : 'var(--fg)',
                }}
              >
                {eff.toFixed(2)}
              </div>
            </div>
            <div
              onPointerDown={(e) => down(e, i)}
              onPointerMove={(e) => move(e, i)}
              onPointerUp={(e) => up(e, i)}
              onPointerCancel={(e) => up(e, i)}
              style={{
                position: 'relative',
                flex: 1,
                background: 'var(--bg-1)',
                border: '1px solid var(--line)',
                borderRadius: compact ? 2 : 'var(--r-1)',
                overflow: 'hidden',
                cursor: 'ns-resize',
                opacity: dim ? 0.55 : 1,
                touchAction: 'none',
              }}
            >
              {[0.25, 0.5, 0.75].map((t) => (
                <div
                  key={t}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: `${t * 100}%`,
                    height: 1,
                    background: 'rgba(255,255,255,0.04)',
                  }}
                />
              ))}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: `${eff * 100}%`,
                  background: gc,
                  opacity: 0.22 + eff * 0.6,
                  transition: 'height 70ms linear',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: `${eff * 100}%`,
                  height: 2,
                  marginBottom: -1,
                  background: gc,
                  boxShadow: `0 0 8px ${gc}`,
                  opacity: dim ? 0.4 : 0.9,
                }}
              />
              {p.status === 'live' && (
                <div
                  style={{
                    position: 'absolute',
                    left: 1,
                    right: 1,
                    bottom: `${p.val * 100}%`,
                    height: 0,
                    borderTop: '1px dashed rgba(255,255,255,0.35)',
                  }}
                />
              )}
              {clampMarker?.id === p.id && (
                <div
                  style={{
                    position: 'absolute',
                    left: 1,
                    right: 1,
                    bottom: `${clampMarker.value * 100}%`,
                    height: 0,
                    borderTop: '1px dashed #ff4466',
                    boxShadow: '0 0 5px rgba(255,68,102,0.8)',
                    zIndex: 3,
                    pointerEvents: 'none',
                  }}
                />
              )}
              <div
                style={{
                  position: 'absolute',
                  top: 3,
                  left: 0,
                  right: 0,
                  textAlign: 'center',
                  fontSize: 9,
                  color:
                    p.status === 'live'
                      ? 'transparent'
                      : p.status === 'fixed'
                        ? 'var(--accent-2)'
                        : 'var(--fg-dim)',
                }}
              >
                {p.status === 'fixed' ? '⊟' : p.status === 'off' ? '∅' : ''}
              </div>
            </div>
            {open === i && !compact && (
              <OutputEditor
                param={p}
                onChange={(patch) => onChange(i, patch)}
                onHold={hold}
                onLeave={scheduleClose}
                place={{ top: 38, [placeRight ? 'right' : 'left']: 0 }}
              />
            )}
            {open === i && compact && (
              <OutputEditor
                param={p}
                onChange={(patch) => onChange(i, patch)}
                onHold={hold}
                onLeave={scheduleClose}
                place={{ top: 26, [placeRight ? 'right' : 'left']: 0 }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
