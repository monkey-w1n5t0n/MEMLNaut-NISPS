/**
 * SandwichStage — the N-dimensional "parameter sandwich" as a centre stage,
 * driven by the REAL engine (the same `EngineApi` instance the rest of the
 * console uses). Ported from the standalone /learn renderer.
 *
 * Each layer is one output channel of the MLP, sampled across the 2-D input
 * grid via `engine.inferBatch` → that surface IS the parameter's landscape.
 * The grid is re-sampled only when the net changes (`version`); a per-frame
 * rAF reads `engine.getOutputs()` for the live probe at the current input.
 *
 * Three-zone metaphor (input → MLP stack → outputs): this component owns the
 * MIDDLE zone. ConsoleApp docks a shrunken Manifold (left) and OutputStage
 * (right) around it. Drag the canvas to orbit; it lands top-down (a flat 2-D
 * map) and tilts into the 3-D stack. The stack is centred and grows to fill
 * the available height as more parameters are shown.
 */
import { useEffect, useRef } from 'react';
import type { EngineApi } from '../engine';

const GRID = 12;
const N = GRID;
const SX = 300, SZ = 300, LAYER_GAP = 120, ZAMP = 92, MARGIN = 34;
// Reference scale: each layer adds a fixed ~px gap (so the stack GROWS with the
// layer count) until it would overflow, at which point the fit scale caps it.
const REF_SCALE = 0.8;

export interface SandwichStageProps {
  engine: EngineApi;
  /** Engine version counter — re-sample the landscape grid when it bumps. */
  version: number;
  /** Current 2-D input (drives the probe column). */
  pos: [number, number];
  /** How many output channels to render as layers (top→down). */
  layerCount: number;
  /** Per-layer labels (the mode's param names). */
  names: string[];
}

export function SandwichStage({ engine, version, pos, layerCount, names }: SandwichStageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<Float32Array | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const Kref = useRef(layerCount);
  Kref.current = Math.max(1, layerCount);
  const namesRef = useRef(names);
  namesRef.current = names;
  const yaw = useRef(0);
  const pitch = useRef(Math.PI / 2); // top-down (looks 2-D) until you tilt it
  const view = useRef({ cw: 800, ch: 600, scale: 1, ceny: 0 });

  const OUT = engine.architecture.outputSize;

  // ---- re-sample the landscape grid whenever the net changes ----
  useEffect(() => {
    const pts: [number, number][] = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pts.push([i / N, j / N]);
    try {
      gridRef.current = engine.inferBatch(pts);
    } catch {
      gridRef.current = null;
    }
  }, [engine, version]);

  // ---- render loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    const computeView = () => {
      const v = view.current;
      const K = Kref.current;
      v.ceny = -(K - 1) * LAYER_GAP / 2 + ZAMP / 2; // centroid (centre vertically)
      let R = 1;
      for (let k = 0; k < K; k++) for (const z of [0, 1]) for (const gx of [-0.5, 0.5]) for (const gy of [-0.5, 0.5]) {
        const X = gx * SX, Y = (-k * LAYER_GAP + z * ZAMP) - v.ceny, Z = gy * SZ;
        const d = Math.sqrt(X * X + Y * Y + Z * Z);
        if (d > R) R = d;
      }
      const fit = (Math.min(v.cw, v.ch) / 2 - MARGIN) / R;
      v.scale = Math.min(REF_SCALE, fit); // grow with K, then cap to fit
    };
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      view.current.cw = Math.max(160, Math.round(r.width));
      view.current.ch = Math.max(160, Math.round(r.height));
      canvas.width = view.current.cw * DPR;
      canvas.height = view.current.ch * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      computeView();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const project = (gx: number, gy: number, zv: number, k: number) => {
      const v = view.current;
      const X = gx * SX, Y = (-k * LAYER_GAP + zv * ZAMP) - v.ceny, Z = -gy * SZ;
      const cyA = Math.cos(yaw.current), syA = Math.sin(yaw.current);
      const x1 = X * cyA - Z * syA, z1 = X * syA + Z * cyA;
      const cpA = Math.cos(pitch.current), spA = Math.sin(pitch.current);
      const y2 = Y * cpA - z1 * spA, z2 = Y * spA + z1 * cpA;
      return { x: v.cw / 2 + x1 * v.scale, y: v.ch / 2 - y2 * v.scale, depth: z2, wx: X, wy: Y, wz: Z };
    };
    const hueOf = (k: number, K: number) => (K > 1 ? 26 + (196 - 26) * k / (K - 1) : 26);
    const colCss = (k: number, K: number, a: number) => `hsla(${hueOf(k, K).toFixed(0)},85%,60%,${a})`;
    const LIGHT = (() => { const v = [0.35, 0.86, 0.36]; const m = Math.hypot(v[0], v[1], v[2]); return [v[0] / m, v[1] / m, v[2] / m]; })();
    const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

    let raf = 0;
    const draw = () => {
      const v = view.current;
      const K = Kref.current;
      const grid = gridRef.current;
      computeView();
      ctx.clearRect(0, 0, v.cw, v.ch);
      const H = (k: number, i: number, j: number) => (grid ? grid[(j * (N + 1) + i) * OUT + k] : 0.5);

      const quads: { a: any; b: any; d: any; e: any; hue: number; L: number; depth: number }[] = [];
      const labels: { x: number; y: number; hue: number; name: string }[] = [];
      for (let k = 0; k < K; k++) {
        const hue = hueOf(k, K);
        const P: { x: number; y: number; depth: number; wx: number; wy: number; wz: number }[][] = [];
        for (let j = 0; j <= N; j++) { P[j] = []; for (let i = 0; i <= N; i++) P[j][i] = project(i / N - 0.5, j / N - 0.5, H(k, i, j), k); }
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const a = P[j][i], b = P[j][i + 1], d = P[j + 1][i + 1], e = P[j + 1][i];
          const ux = d.wx - a.wx, uy = d.wy - a.wy, uz = d.wz - a.wz, vx = b.wx - e.wx, vy = b.wy - e.wy, vz = b.wz - e.wz;
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nm = Math.hypot(nx, ny, nz) || 1;
          const L = clamp(0.32 + 0.62 * Math.abs((nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nm));
          quads.push({ a, b, d, e, hue, L, depth: (a.depth + b.depth + d.depth + e.depth) / 4 });
        }
        const lp = project(-0.5, 0.5, H(k, 0, N), k);
        labels.push({ x: lp.x, y: lp.y, hue, name: namesRef.current[k] || `p${k}` });
      }
      quads.sort((p, q) => q.depth - p.depth);
      for (const Q of quads) {
        ctx.fillStyle = `hsla(${Q.hue},80%,${(26 + Q.L * 44).toFixed(0)}%,0.66)`;
        ctx.strokeStyle = `hsla(${Q.hue},80%,82%,0.18)`; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(Q.a.x, Q.a.y); ctx.lineTo(Q.b.x, Q.b.y); ctx.lineTo(Q.d.x, Q.d.y); ctx.lineTo(Q.e.x, Q.e.y); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      ctx.font = '11px var(--font-mono, monospace)'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const Lb of labels) { ctx.fillStyle = `hsla(${Lb.hue},85%,74%,0.95)`; ctx.fillText(Lb.name, Lb.x - 6, Lb.y); }

      // probe column at the current input, marker on each slab from the LIVE output
      const out = engine.getOutputs();
      const gx = posRef.current[0] - 0.5, gy = posRef.current[1] - 0.5;
      const top = project(gx, gy, 1.18, 0), bot = project(gx, gy, -0.18, K - 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.stroke(); ctx.setLineDash([]);
      for (let k = 0; k < K; k++) {
        const val = clamp(out[k] ?? 0.5);
        const p = project(gx, gy, val, k), fl = project(gx, gy, 0, k);
        ctx.strokeStyle = colCss(k, K, 0.5); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(fl.x, fl.y); ctx.stroke();
        ctx.fillStyle = colCss(k, K, 1); ctx.shadowColor = colCss(k, K, 1); ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = 'var(--bg, #0d0d0d)'; ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [engine, OUT]);

  // ---- drag to orbit (yaw + pitch; pitch up to π/2 = exact top-down) ----
  const rotating = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={(e) => {
          rotating.current = true;
          (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
          last.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          if (!rotating.current) return;
          yaw.current += (e.clientX - last.current.x) * 0.01;
          pitch.current = Math.max(0.06, Math.min(Math.PI / 2, pitch.current + (e.clientY - last.current.y) * 0.008));
          last.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => { rotating.current = false; }}
        onPointerCancel={() => { rotating.current = false; }}
      />
      <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', fontSize: 9, letterSpacing: '0.12em', color: 'var(--fg-dim)', pointerEvents: 'none', fontFamily: 'var(--font-mono)' }}>
        PARAMETER SANDWICH · drag to rotate · top-down = the flat 2-D map
      </div>
    </div>
  );
}
