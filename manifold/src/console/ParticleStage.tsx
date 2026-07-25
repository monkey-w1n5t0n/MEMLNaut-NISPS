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
 *   • a small circular pad in the bottom-left corner that drives the 2D input
 *     (engine.setInput) — the "joystick" of the immersive app.
 *
 * The canvas animates on its own rAF clock so particles keep flowing between
 * inferences; only the *field* parameters change when the MLP outputs do. The
 * heatmap bar widths are driven imperatively from the same loop so we don't
 * churn React state every frame.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEngine } from '../engine';
import { VirtualJoystick } from '../primitives/VirtualJoystick';
import type { MFParam } from './model';
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
}

export function ParticleStage({ pos, onMove, params, values, onChange }: ParticleStageProps) {
  const engine = useEngine();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vizRef = useRef<FlowFieldVisualizer | null>(null);
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const outputsRef = useRef<Float32Array | null>(null);
  const valuesRef = useRef(values);
  const hoverRef = useRef<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 12, y: 28 });
  const [clampMarker, setClampMarker] = useState<{ i: number; value: number } | null>(null);
  const clampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ i: number; moved: boolean; startX: number; el: HTMLDivElement | null }>({
    i: -1,
    moved: false,
    startX: 0,
    el: null,
  });
  valuesRef.current = values;

  const updateHover = (i: number, e: ReactPointerEvent<HTMLDivElement>) => {
    hoverRef.current = i;
    setHover(i);
    setTooltipPos({
      x: Math.min(e.clientX + 12, Math.max(12, window.innerWidth - 190)),
      y: Math.min(e.clientY + 12, Math.max(28, window.innerHeight - 32)),
    });
    const output = valuesRef.current[i] ?? outputsRef.current?.[i] ?? 0;
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
        const displayOutputs = valuesRef.current.length >= N_VISUAL_OUTPUTS ? valuesRef.current : outputs;
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

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0d0d0d' }}>
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
                cursor: 'ew-resize',
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

      {/* Bottom-left circular pad — drives the 2D input */}
      <div style={{ position: 'absolute', left: 18, bottom: 18, zIndex: 20 }}>
        <VirtualJoystick size={120} position={pos} onMove={onMove} ariaLabel="particle input pad" />
      </div>
    </div>
  );
}
