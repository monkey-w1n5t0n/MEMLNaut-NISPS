/**
 * ParticleStage — the Particle System output Mode's main view.
 *
 * Mirrors the a-immersive playground layout:
 *   • a full-bleed Canvas2D flow-field particle system (the main view), driven
 *     by the live model outputs (first 20) read each animation frame;
 *   • a horizontal macro-axis slider bar across the top (Boldness / Memory /
 *     Precision), the same compound axes the rest of the console uses;
 *   • a small circular pad in the bottom-left corner that drives the 2D input
 *     (engine.setInput) — the "joystick" of the immersive app.
 *
 * The canvas animates on its own rAF clock so particles keep flowing between
 * inferences; only the *field* parameters change when the MLP outputs do.
 */
import { useEffect, useRef } from 'react';
import { useEngine } from '../engine';
import { ControlAxis } from '../primitives/ControlAxis';
import { VirtualJoystick } from '../primitives/VirtualJoystick';
import { FlowFieldVisualizer } from './flow-field';
import type { Axes } from './types';

export interface ParticleStageProps {
  pos: [number, number];
  onMove: (x: number, y: number) => void;
  axes: Axes;
  setAxis: (k: keyof Axes, v: number) => void;
}

export function ParticleStage({ pos, onMove, axes, setAxis }: ParticleStageProps) {
  const engine = useEngine();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vizRef = useRef<FlowFieldVisualizer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viz = new FlowFieldVisualizer(canvas);
    vizRef.current = viz;

    let raf = 0;
    const tick = () => {
      const outputs = engine?.getOutputs();
      if (outputs) viz.setParams(outputs);
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

      {/* Top horizontal macro-axis slider bar (Boldness / Memory / Precision) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          display: 'flex',
          gap: 'var(--sp-2)',
          padding: 'var(--sp-2) var(--sp-3)',
          alignItems: 'center',
          background: 'var(--glass)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <strong
          style={{
            color: 'var(--accent)',
            fontSize: 'var(--fs-md)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
            paddingRight: 'var(--sp-2)',
          }}
        >
          MEMLNaut
        </strong>
        <ControlAxis
          label="Boldness"
          endpoints={['Caution', 'Bold']}
          value={axes.boldness}
          onChange={(v) => setAxis('boldness', v)}
          style={{ flex: 1 }}
        />
        <ControlAxis
          label="Memory"
          endpoints={['Amnesia', 'Elephant']}
          value={axes.memory}
          onChange={(v) => setAxis('memory', v)}
          accent="var(--accent-2)"
          style={{ flex: 1 }}
        />
        <ControlAxis
          label="Precision"
          endpoints={['Raw', 'Precise']}
          value={axes.precision}
          onChange={(v) => setAxis('precision', v)}
          accent="var(--ok, var(--accent))"
          style={{ flex: 1 }}
        />
      </div>

      {/* Bottom-left circular pad — drives the 2D input */}
      <div style={{ position: 'absolute', left: 18, bottom: 18, zIndex: 20 }}>
        <VirtualJoystick size={120} position={pos} onMove={onMove} ariaLabel="particle input pad" />
      </div>
    </div>
  );
}
