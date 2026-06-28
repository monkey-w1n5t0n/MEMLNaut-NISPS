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
import { useEngine } from '../engine';
import { VirtualJoystick } from '../primitives/VirtualJoystick';
import {
  FlowFieldVisualizer,
  N_VISUAL_OUTPUTS,
  VISUAL_PARAM_COLORS,
  VISUAL_PARAM_NAMES,
} from './flow-field';

export interface ParticleStageProps {
  pos: [number, number];
  onMove: (x: number, y: number) => void;
}

export function ParticleStage({ pos, onMove }: ParticleStageProps) {
  const engine = useEngine();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vizRef = useRef<FlowFieldVisualizer | null>(null);
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const outputsRef = useRef<Float32Array | null>(null);
  const hoverRef = useRef<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

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
        viz.setParams(outputs);
        // Drive the heatmap bar widths imperatively (cheap; no React churn).
        for (let i = 0; i < N_VISUAL_OUTPUTS; i++) {
          const bar = barsRef.current[i];
          if (bar) bar.style.width = `${Math.max(0, Math.min(1, outputs[i] ?? 0)) * 100}%`;
        }
        // Keep the tooltip value live while hovering a cell.
        const h = hoverRef.current;
        if (h != null && tooltipRef.current) {
          tooltipRef.current.textContent = `${VISUAL_PARAM_NAMES[h]}: ${(outputs[h] ?? 0).toFixed(3)}`;
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
              title={name}
              onPointerEnter={() => {
                hoverRef.current = i;
                setHover(i);
              }}
              style={{
                position: 'relative',
                flex: 1,
                minWidth: 0,
                height: 16,
                background: 'rgba(255,255,255,0.04)',
                overflow: 'hidden',
                cursor: 'pointer',
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
            </div>
          ))}
        </div>
      </div>

      {/* Hover tooltip (name + live value) */}
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute',
          top: 28,
          left: 8,
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
