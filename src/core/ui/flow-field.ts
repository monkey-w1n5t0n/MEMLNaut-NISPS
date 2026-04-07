/**
 * FlowFieldVisualizer — Canvas2D particle system driven by ML outputs.
 *
 * Transplanted from playground/js/ui/visualizer.js with TypeScript types.
 * Uses the first 20 ML outputs to control flow field parameters:
 *   p0:  angleOffset    — flow direction
 *   p1:  scale          — pattern size
 *   p2:  speed          — particle speed
 *   p3:  hueBase        — base color
 *   p4:  hueSpread      — color variation
 *   p5:  particleSize   — dot radius
 *   p6:  fadeRate        — trail length
 *   p7:  turbulence     — chaos
 *   p8:  attractStrength — pull toward screen center
 *   p9:  attractRadius   — radius where attraction is strongest
 *   p10: dispersionRate  — speed of outward dispersion pulses
 *   p11: dispersionAmount — strength of outward dispersion
 *   p12: particleLifetime — average frames before respawn
 *   p13: respawnStyle    — 0=random, 1=edge, 2=center-burst
 *   p14: advectionMode   — flow→orbit→radial blend
 *   p15: inertia         — velocity memory
 *   p16: drag            — velocity damping
 *   p17: repulsorStrength — repulsor force amount
 *   p18: repulsorCount    — number of active repulsors
 *   p19: repulsorOrbitRate — repulsor orbital speed
 */

const TWO_PI = Math.PI * 2;

// ─── Value noise (no dependencies) ────────────────────────────────────

const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a: number, b: number, t: number): number { return a + t * (b - a); }

function grad(hash: number, x: number, y: number): number {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

function noise2D(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = PERM[PERM[X] + Y];
  const ab = PERM[PERM[X] + Y + 1];
  const ba = PERM[PERM[X + 1] + Y];
  const bb = PERM[PERM[X + 1] + Y + 1];

  return lerp(
    lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
    lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
    v
  );
}

// ─── Particle interface ────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  id: number;
  age: number;
  life: number;
  vx: number;
  vy: number;
}

// ─── Parameters ────────────────────────────────────────────────────────

export interface FlowFieldParams {
  angleOffset: number;
  scale: number;
  speed: number;
  hueBase: number;
  hueSpread: number;
  particleSize: number;
  fadeRate: number;
  turbulence: number;
  attractStrength: number;
  attractRadius: number;
  dispersionRate: number;
  dispersionAmount: number;
  particleLifetime: number;
  respawnStyle: number;
  advectionMode: number;
  inertia: number;
  drag: number;
  repulsorStrength: number;
  repulsorCount: number;
  repulsorOrbitRate: number;
}

// ─── Visualizer ────────────────────────────────────────────────────────

export class FlowFieldVisualizer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  particles: Particle[];
  numParticles: number;
  time: number;
  width: number;
  height: number;
  params: FlowFieldParams;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.particles = [];
    this.numParticles = 400;
    this.time = 0;
    this.width = 0;
    this.height = 0;

    // Default parameters
    this.params = {
      angleOffset: 0,
      scale: 0.005,
      speed: 2,
      hueBase: 180,
      hueSpread: 60,
      particleSize: 3,
      fadeRate: 0.05,
      turbulence: 1,
      attractStrength: 0.8,
      attractRadius: 200,
      dispersionRate: 2.0,
      dispersionAmount: 1.0,
      particleLifetime: 220,
      respawnStyle: 0.0,
      advectionMode: 0.0,
      inertia: 0.2,
      drag: 0.02,
      repulsorStrength: 0.0,
      repulsorCount: 0,
      repulsorOrbitRate: 0.8,
    };

    this.resize();
    this.initParticles();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  initParticles(): void {
    this.particles = [];
    for (let i = 0; i < this.numParticles; i++) {
      this.particles.push(this.makeParticle(i));
    }
    // Clear canvas to black
    this.ctx.fillStyle = '#0d0d0d';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  makeParticle(id: number): Particle {
    return {
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      id,
      age: Math.floor(Math.random() * this.params.particleLifetime),
      life: this.computeLifetime(),
      vx: 0,
      vy: 0,
    };
  }

  computeLifetime(): number {
    const variance = 0.65 + Math.random() * 0.7;
    return Math.max(10, Math.floor(this.params.particleLifetime * variance));
  }

  respawnParticle(p: Particle): void {
    const mode = Math.min(2, Math.floor(this.params.respawnStyle * 2.999));
    const { width, height } = this;

    if (mode === 1) {
      // Edge respawn
      const side = Math.floor(Math.random() * 4);
      if (side === 0) { p.x = Math.random() * width; p.y = 0; }
      if (side === 1) { p.x = width; p.y = Math.random() * height; }
      if (side === 2) { p.x = Math.random() * width; p.y = height; }
      if (side === 3) { p.x = 0; p.y = Math.random() * height; }
      const towardCenterX = width * 0.5 - p.x;
      const towardCenterY = height * 0.5 - p.y;
      const inwardDist = Math.hypot(towardCenterX, towardCenterY) + 1e-6;
      p.vx = (towardCenterX / inwardDist) * 2.0;
      p.vy = (towardCenterY / inwardDist) * 2.0;
    } else if (mode === 2) {
      // Center-burst respawn
      const angle = Math.random() * TWO_PI;
      const r = Math.random() * Math.min(width, height) * 0.08;
      p.x = width * 0.5 + Math.cos(angle) * r;
      p.y = height * 0.5 + Math.sin(angle) * r;
      p.vx = Math.cos(angle) * 2.5;
      p.vy = Math.sin(angle) * 2.5;
    } else {
      // Random respawn
      p.x = Math.random() * width;
      p.y = Math.random() * height;
      p.vx = (Math.random() * 2 - 1) * 0.5;
      p.vy = (Math.random() * 2 - 1) * 0.5;
    }

    p.age = 0;
    p.life = this.computeLifetime();
  }

  /** Set parameters from ML output (all values 0-1, first 20 outputs) */
  setParams(outputs: Float32Array | number[]): void {
    if (!outputs || outputs.length < 20) return;
    this.params.angleOffset = outputs[0] * TWO_PI;
    this.params.scale = 0.001 + outputs[1] * 0.009;
    this.params.speed = 0.5 + outputs[2] * 4.5;
    this.params.hueBase = outputs[3] * 360;
    this.params.hueSpread = outputs[4] * 120;
    this.params.particleSize = 1 + outputs[5] * 5;
    this.params.fadeRate = 0.01 + outputs[6] * 0.14;
    this.params.turbulence = outputs[7] * 2;
    this.params.attractStrength = 0.1 + outputs[8] * 2.9;
    this.params.attractRadius = 40 + outputs[9] * 420;
    this.params.dispersionRate = 0.2 + outputs[10] * 8;
    this.params.dispersionAmount = outputs[11] * 3;
    this.params.particleLifetime = 30 + outputs[12] * 470;
    this.params.respawnStyle = outputs[13];
    this.params.advectionMode = outputs[14];
    this.params.inertia = outputs[15] * 0.98;
    this.params.drag = outputs[16] * 0.35;
    this.params.repulsorStrength = outputs[17] * 4.5;
    this.params.repulsorCount = Math.floor(outputs[18] * 4.999);
    this.params.repulsorOrbitRate = 0.1 + outputs[19] * 2.9;
  }

  /** Draw one frame of the particle system */
  draw(): void {
    const { ctx, width, height, params } = this;
    if (width === 0 || height === 0) return;
    this.time += 0.003;

    // Fade existing content (creates trails)
    ctx.fillStyle = `rgba(13, 13, 13, ${params.fadeRate})`;
    ctx.fillRect(0, 0, width, height);

    for (const p of this.particles) {
      const cx = width * 0.5;
      const cy = height * 0.5;

      // Sample flow field
      const nx = p.x * params.scale;
      const ny = p.y * params.scale;
      const angle = noise2D(nx + this.time, ny) * TWO_PI + params.angleOffset;
      const curl = noise2D(nx + 100, ny + 100 + this.time * 0.5) * params.turbulence;

      // Mix between three advection fields
      const flowVx = Math.cos(angle + curl) * params.speed;
      const flowVy = Math.sin(angle + curl) * params.speed;
      const fromCenterX = p.x - cx;
      const fromCenterY = p.y - cy;
      const centerDist = Math.hypot(fromCenterX, fromCenterY) + 1e-6;
      const radialX = fromCenterX / centerDist;
      const radialY = fromCenterY / centerDist;
      const orbitX = -radialY;
      const orbitY = radialX;
      const orbitVx = orbitX * params.speed;
      const orbitVy = orbitY * params.speed;
      const radialVx = radialX * params.speed;
      const radialVy = radialY * params.speed;

      const modeBlend = params.advectionMode * 2;
      let targetVx: number;
      let targetVy: number;
      if (modeBlend < 1) {
        targetVx = lerp(flowVx, orbitVx, modeBlend);
        targetVy = lerp(flowVy, orbitVy, modeBlend);
      } else {
        targetVx = lerp(orbitVx, radialVx, modeBlend - 1);
        targetVy = lerp(orbitVy, radialVy, modeBlend - 1);
      }
      p.vx = p.vx * params.inertia + targetVx * (1 - params.inertia);
      p.vy = p.vy * params.inertia + targetVy * (1 - params.inertia);
      p.vx *= (1 - params.drag);
      p.vy *= (1 - params.drag);
      let nextX = p.x + p.vx;
      let nextY = p.y + p.vy;

      // Central attractor
      const dx = cx - nextX;
      const dy = cy - nextY;
      const dist = Math.hypot(dx, dy) + 1e-6;
      const nxCenter = dx / dist;
      const nyCenter = dy / dist;
      const normalizedDist = Math.min(dist / params.attractRadius, 2);
      const falloff = 1 / (1 + normalizedDist * normalizedDist);
      nextX += nxCenter * params.attractStrength * falloff;
      nextY += nyCenter * params.attractStrength * falloff;

      // Time-varying dispersion
      const dispersionPulse = 0.5 + 0.5 * Math.sin(this.time * params.dispersionRate + p.id * 0.07);
      const dispersionForce = params.dispersionAmount * dispersionPulse * falloff;
      nextX -= nxCenter * dispersionForce;
      nextY -= nyCenter * dispersionForce;

      // Orbiting repulsor points
      const repulsorRadius = Math.min(width, height) * 0.28;
      for (let r = 0; r < params.repulsorCount; r++) {
        const phase = this.time * params.repulsorOrbitRate + (r / 4) * TWO_PI;
        const wobble = 0.6 + 0.15 * r;
        const rx = cx + Math.cos(phase * (1.0 + wobble)) * repulsorRadius;
        const ry = cy + Math.sin(phase * (1.3 + wobble)) * repulsorRadius;
        const repulseDx = nextX - rx;
        const repulseDy = nextY - ry;
        const distSq = repulseDx * repulseDx + repulseDy * repulseDy + 160;
        const distInv = 1 / Math.sqrt(distSq);
        const force = params.repulsorStrength * (650 / distSq);
        nextX += repulseDx * distInv * force;
        nextY += repulseDy * distInv * force;
      }

      p.x = nextX;
      p.y = nextY;

      // Wrap around edges
      if (p.x < 0) p.x += width;
      if (p.x > width) p.x -= width;
      if (p.y < 0) p.y += height;
      if (p.y > height) p.y -= height;

      p.age += 1;
      if (p.age >= p.life) this.respawnParticle(p);

      // Color based on particle id + hue params
      const hue = (params.hueBase + (p.id / this.numParticles) * params.hueSpread) % 360;
      const lightness = 50 + Math.sin(p.id * 0.1 + this.time) * 15;

      ctx.fillStyle = `hsl(${hue}, 75%, ${lightness}%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, params.particleSize, 0, TWO_PI);
      ctx.fill();
    }
  }
}
