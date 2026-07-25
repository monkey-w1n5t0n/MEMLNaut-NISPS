/**
 * ParticleStage — the Particle System output Mode's main view.
 *
 * Mirrors the a-immersive playground layout:
 *   • a full-bleed Canvas2D flow-field particle system (the main view), driven
 *     by the live model outputs (first 20) read each animation frame;
 *   • a thin horizontal heatmap strip across the top, one colored bar per
 *     visual output (Flow / Scale / Speed / …), each bar's width = its live
 *     value — the same `.heatmap-strip` the a-immersive app shows above the
 *     flow field (NOT the Boldness/Memory/Precision macro axes, which the
 *     deployed a-immersive never used);
 *   • a large circular pad that drives the 2D input (engine.setInput) — the
 *     "joystick" of the immersive app; its explicit edit handles reposition
 *     and resize it without making normal input gestures destructive.
 *
 * The canvas animates on its own rAF clock so particles keep flowing between
 * inferences; only the *field* parameters change when the MLP outputs do. The
 * heatmap bar widths are driven imperatively from the same loop so we don't
 * churn React state every frame.
 */
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEngine } from '../engine';
import { shapeValuesInto, type MFParam } from './model';
import { Manifold } from './Manifold';
import type { FeedbackMarker } from './types';
import {
  FlowFieldVisualizer,
  N_VISUAL_OUTPUTS,
  VISUAL_PARAM_COLORS,
  VISUAL_PARAM_NAMES,
} from './flow-field';

export interface ParticleStageProps {
  pos: [number, number];
  onMove: (x: number, y: number) => void;
  params: MFParam[];
  values: number[];
  onChange: (i: number, patch: Partial<MFParam>) => void;
  markers?: FeedbackMarker[];
}

export function ParticleStage({ pos, onMove, params, values, onChange, markers = [] }: ParticleStageProps) {
  const engine = useEngine();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vizRef = useRef<FlowFieldVisualizer | null>(null);
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const outputsRef = useRef<Float32Array | null>(null);
  const displayOutputsRef = useRef<ArrayLike<number>>(values);
  const shapedOutputsRef = useRef(new Float32Array(N_VISUAL_OUTPUTS));
  const paramsRef = useRef(params);
  const hoverRef = useRef<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 12, y: 28 });
  const [clampMarker, setClampMarker] = useState<{ i: number; value: number } | null>(null);
  const [followMouse, setFollowMouse] = useState(false);
  const onMoveRef = useRef(onMove);
  const [padSize, setPadSize] = useState(200);
  const [padPosition, setPadPosition] = useState(() => ({
    left: 24,
    top: typeof window === 'undefined' ? 24 : Math.max(24, window.innerHeight - 224),
  }));
  const [padEdit, setPadEdit] = useState(false);
  const padGesture = useRef<{
    kind: 'move' | 'resize';
    startX: number;
    startY: number;
    left: number;
    top: number;
    size: number;
  } | null>(null);
  const clampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ i: number; moved: boolean; startX: number; el: HTMLDivElement | null }>({
    i: -1,
    moved: false,
    startX: 0,
    el: null,
  });
  paramsRef.current = params;
  onMoveRef.current = onMove;

  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

  const beginPadGesture = (e: ReactPointerEvent<HTMLElement>, kind: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    padGesture.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      left: padPosition.left,
      top: padPosition.top,
      size: padSize,
    };
  };

  const movePadGesture = (e: ReactPointerEvent<HTMLElement>) => {
    const gesture = padGesture.current;
    if (!gesture) return;
    e.preventDefault();
    e.stopPropagation();
    if (gesture.kind === 'move') {
      setPadPosition({
        left: clamp(gesture.left + e.clientX - gesture.startX, 8, Math.max(8, window.innerWidth - padSize - 56)),
        top: clamp(gesture.top + e.clientY - gesture.startY, 8, Math.max(8, window.innerHeight - padSize - 8)),
      });
    } else {
      const maxSize = Math.max(140, Math.min(window.innerWidth - gesture.left - 56, window.innerHeight - gesture.top - 8, 360));
      setPadSize(clamp(gesture.size + e.clientX - gesture.startX, 140, maxSize));
    }
  };

  const endPadGesture = (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    padGesture.current = null;
  };

  const toggleFollowMouse = (e?: ReactMouseEvent<HTMLDivElement>) => {
    e?.preventDefault();
    setFollowMouse((active) => !active);
  };

  const updateHover = (i: number, e: ReactPointerEvent<HTMLDivElement>) => {
    hoverRef.current = i;
    setHover(i);
    setTooltipPos({
      x: Math.min(e.clientX + 12, Math.max(12, window.innerWidth - 190)),
      y: Math.min(e.clientY + 12, Math.max(28, window.innerHeight - 32)),
    });
    const output = displayOutputsRef.current[i] ?? outputsRef.current?.[i] ?? 0;
    if (tooltipRef.current) tooltipRef.current.textContent = `${VISUAL_PARAM_NAMES[i]}: ${output.toFixed(3)}`;
  };

  const showClampMarker = (i: number, value: number) => {
    if (clampTimer.current) clearTimeout(clampTimer.current);
    setClampMarker({ i, value });
    clampTimer.current = setTimeout(() => {
      setClampMarker(null);
      clampTimer.current = null;
    }, 700);
  };

  const setSliderValue = (i: number, raw: number) => {
    const param = params[i];
    if (!param) return;
    const min = Math.max(0, Math.min(1, Math.min(param.min, param.max)));
    const max = Math.max(0, Math.min(1, Math.max(param.min, param.max)));
    const value = Math.max(min, Math.min(max, raw));
    if (value !== raw) showClampMarker(i, value);
    else setClampMarker(null);

    const span = max - min;
    const fixedValue = span > 0 ? (value - min) / span : 0;
    const temporary = param.manualOverride || param.status === 'live';
    onChange(i, {
      status: 'fixed',
      val: fixedValue,
      manualOverride: temporary ? true : undefined,
    });
  };

  const valueFromEvent = (el: HTMLDivElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>, i: number) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    updateHover(i, e);
    drag.current = { i, moved: false, startX: e.clientX, el: e.currentTarget };
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>, i: number) => {
    updateHover(i, e);
    const d = drag.current;
    if (d.i !== i || !d.el) return;
    if (Math.abs(e.clientX - d.startX) > 3) d.moved = true;
    if (d.moved) setSliderValue(i, valueFromEvent(d.el, e.clientX));
  };

  const up = (e: ReactPointerEvent<HTMLDivElement>, i: number) => {
    const d = drag.current;
    if (d.i !== i) return;
    if (!d.moved && d.el) setSliderValue(i, valueFromEvent(d.el, e.clientX));
    drag.current = { i: -1, moved: false, startX: 0, el: null };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viz = new FlowFieldVisualizer(canvas);
    vizRef.current = viz;

    let raf = 0;
    const tick = () => {
      const outputs = engine?.getOutputs();
      if (outputs) {
        outputsRef.current = outputs;
        const displayOutputs =
          paramsRef.current.length >= N_VISUAL_OUTPUTS
            ? shapeValuesInto(paramsRef.current, outputs, shapedOutputsRef.current)
            : outputs;
        displayOutputsRef.current = displayOutputs;
        viz.setParams(displayOutputs);
        // Drive the heatmap bar widths imperatively (cheap; no React churn).
        for (let i = 0; i < N_VISUAL_OUTPUTS; i++) {
          const bar = barsRef.current[i];
          if (bar) bar.style.width = `${Math.max(0, Math.min(1, displayOutputs[i] ?? 0)) * 100}%`;
        }
        // Keep the tooltip value live while hovering a cell.
        const h = hoverRef.current;
        if (h != null && tooltipRef.current) {
          tooltipRef.current.textContent = `${VISUAL_PARAM_NAMES[h]}: ${(displayOutputs[h] ?? 0).toFixed(3)}`;
        }
      }
      viz.draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => viz.resize());
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      vizRef.current = null;
    };
  }, [engine]);

  useEffect(() => {
    return () => {
      if (clampTimer.current) clearTimeout(clampTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!followMouse) return;
    const onWinMove = (e: PointerEvent) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      onMoveRef.current(clamp(e.clientX / w, 0, 1), clamp(1 - e.clientY / h, 0, 1));
    };
    const onWinKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFollowMouse(false);
    };
    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('keydown', onWinKey);
    return () => {
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('keydown', onWinKey);
    };
  }, [followMouse]);

  return (
    <div
      onDoubleClick={toggleFollowMouse}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: '#0d0d0d',
        cursor: followMouse ? 'none' : 'default',
      }}
    >
      {/* Main view — the flow-field particle system */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />

      {/* Top heatmap strip — one colored bar per visual output, width = value */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'flex-end',
          height: 22,
          padding: '2px 4px',
          background: 'var(--glass, rgba(13,13,13,0.5))',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
        onPointerLeave={() => {
          hoverRef.current = null;
          setHover(null);
        }}
      >
        <div
          style={{
            display: 'flex',
            flex: 1,
            gap: 1,
            height: 16,
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          {VISUAL_PARAM_NAMES.map((name, i) => (
            <div
              key={name}
              role="slider"
              aria-label={name}
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={values[i] ?? 0}
              onPointerEnter={(e) => updateHover(i, e)}
              onPointerDown={(e) => down(e, i)}
              onPointerMove={(e) => move(e, i)}
              onPointerUp={(e) => up(e, i)}
              onPointerCancel={(e) => up(e, i)}
              style={{
                position: 'relative',
                flex: 1,
                minWidth: 0,
                height: 16,
                background: 'rgba(255,255,255,0.04)',
                overflow: 'hidden',
                cursor: followMouse ? 'none' : 'ew-resize',
                touchAction: 'none',
              }}
            >
              <div
                ref={(el) => {
                  barsRef.current[i] = el;
                }}
                style={{
                  height: '100%',
                  width: '30%',
                  background: VISUAL_PARAM_COLORS[i],
                  borderRadius: '0 1px 1px 0',
                  filter: hover === i ? 'brightness(1.3)' : 'none',
                  pointerEvents: 'none',
                }}
              />
              {clampMarker?.i === i && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${clampMarker.value * 100}%`,
                    borderLeft: '1px dashed #ff4466',
                    boxShadow: '0 0 5px rgba(255,68,102,0.8)',
                    zIndex: 3,
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Hover tooltip (name + live value) */}
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          left: tooltipPos.x,
          top: tooltipPos.y,
          zIndex: 25,
          padding: '4px 10px',
          background: 'rgba(0,0,0,0.85)',
          border: '1px solid var(--line, rgba(255,255,255,0.12))',
          borderRadius: 6,
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          color: 'var(--fg, #eee)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          opacity: hover != null ? 1 : 0,
          transition: 'opacity 0.15s',
        }}
      />

      {followMouse && (
        <div
          style={{
            position: 'absolute',
            top: 30,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 26,
            padding: '4px 10px',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--r-pill)',
            background: 'rgba(0,0,0,0.78)',
            color: 'var(--accent)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            pointerEvents: 'none',
          }}
        >
          FOLLOW MOUSE · ESC OR DOUBLE-CLICK TO EXIT
        </div>
      )}

      {/* Adjustable circular pad — reuse Manifold's visual surface so Particle
          mode shows the same feedback marks and cursor trail as every other
          input presentation. The outer stage owns follow-mouse, therefore the
          embedded Manifold's double-click mode is disabled. */}
      <div
        style={{
          position: 'absolute',
          left: padPosition.left,
          top: padPosition.top,
          width: padSize,
          height: padSize,
          zIndex: 20,
          pointerEvents: 'none',
        }}
      >
        <div
          role="application"
          aria-label="particle input pad"
          tabIndex={padEdit || followMouse ? -1 : 0}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}
        >
          <Manifold
            pos={pos}
            onMove={onMove}
            markers={markers}
            variant="circular"
            frozen={padEdit || followMouse}
            followMouseEnabled={false}
          />
        </div>
        <button
          type="button"
          aria-label={padEdit ? 'Finish adjusting joystick' : 'Adjust joystick size and position'}
          title={padEdit ? 'Finish adjusting joystick' : 'Adjust joystick size and position'}
          onClick={(e) => {
            e.stopPropagation();
            setPadEdit((editing) => !editing);
          }}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            zIndex: 3,
            width: 24,
            height: 24,
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-1)',
            background: 'rgba(0,0,0,0.72)',
            color: 'var(--accent)',
            cursor: 'pointer',
            pointerEvents: 'auto',
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          {padEdit ? '✓' : '⋮'}
        </button>
        {padEdit && (
          <>
            <button
              type="button"
              aria-label="Move joystick"
              title="Drag to move joystick"
              onPointerDown={(e) => beginPadGesture(e, 'move')}
              onPointerMove={movePadGesture}
              onPointerUp={endPadGesture}
              onPointerCancel={endPadGesture}
              style={{
                position: 'absolute',
                top: 6,
                left: 6,
                zIndex: 3,
                width: 24,
                height: 24,
                border: '1px solid var(--accent)',
                borderRadius: 'var(--r-1)',
                background: 'rgba(0,0,0,0.72)',
                color: 'var(--accent)',
                cursor: 'move',
                pointerEvents: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                lineHeight: 1,
              }}
            >
              ✥
            </button>
            <button
              type="button"
              aria-label="Resize joystick"
              title="Drag to resize joystick"
              onPointerDown={(e) => beginPadGesture(e, 'resize')}
              onPointerMove={movePadGesture}
              onPointerUp={endPadGesture}
              onPointerCancel={endPadGesture}
              style={{
                position: 'absolute',
                right: 4,
                bottom: 4,
                zIndex: 3,
                width: 28,
                height: 28,
                border: '1px solid var(--accent)',
                borderRadius: 'var(--r-1)',
                background: 'rgba(0,0,0,0.72)',
                color: 'var(--accent)',
                cursor: 'nwse-resize',
                pointerEvents: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                lineHeight: 1,
              }}
            >
              ↘
            </button>
          </>
        )}
      </div>
    </div>
  );
}
