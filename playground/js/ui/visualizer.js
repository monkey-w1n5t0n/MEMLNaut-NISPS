// Flow field particle system with Canvas2D
// Controlled by 14 output parameters from the IML network

// Simple value noise (no dependencies)
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

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }

function grad(hash, x, y) {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

function noise2D(x, y) {
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

const TWO_PI = Math.PI * 2;

export class FlowFieldVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.numParticles = 400;
    this.time = 0;

    // Parameters (all 0-1 from IML, mapped to visual ranges)
    this.params = {
      angleOffset: 0,    // p0: flow direction
      scale: 0.005,      // p1: pattern size
      speed: 2,          // p2: particle speed
      hueBase: 180,      // p3: base color
      hueSpread: 60,     // p4: color variation
      particleSize: 3,   // p5: dot radius
      fadeRate: 0.05,     // p6: trail length
      turbulence: 1,     // p7: chaos
      attractStrength: 0.8, // p8: pull toward screen center
      attractRadius: 200,   // p9: radius where attraction is strongest
      dispersionRate: 2.0,  // p10: speed of outward dispersion pulses
      dispersionAmount: 1.0, // p11: strength of outward dispersion
      particleLifetime: 220, // p12: average frames before respawn
      respawnStyle: 0.0,    // p13: 0=random, 1=edge, 2=center-burst
    };

    this.resize();
    this.initParticles();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  initParticles() {
    this.particles = [];
    for (let i = 0; i < this.numParticles; i++) {
      this.particles.push(this.makeParticle(i));
    }
    // Clear canvas to black
    this.ctx.fillStyle = '#0d0d0d';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  makeParticle(id) {
    return {
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      id,
      age: Math.floor(Math.random() * this.params.particleLifetime),
      life: this.computeLifetime(),
    };
  }

  computeLifetime() {
    const variance = 0.65 + Math.random() * 0.7;
    return Math.max(10, Math.floor(this.params.particleLifetime * variance));
  }

  respawnParticle(p) {
    const mode = Math.min(2, Math.floor(this.params.respawnStyle * 2.999));
    const { width, height } = this;

    if (mode === 1) {
      // Edge respawn
      const side = Math.floor(Math.random() * 4);
      if (side === 0) { p.x = Math.random() * width; p.y = 0; }
      if (side === 1) { p.x = width; p.y = Math.random() * height; }
      if (side === 2) { p.x = Math.random() * width; p.y = height; }
      if (side === 3) { p.x = 0; p.y = Math.random() * height; }
    } else if (mode === 2) {
      // Center-burst respawn
      const angle = Math.random() * TWO_PI;
      const r = Math.random() * Math.min(width, height) * 0.08;
      p.x = width * 0.5 + Math.cos(angle) * r;
      p.y = height * 0.5 + Math.sin(angle) * r;
    } else {
      // Random respawn
      p.x = Math.random() * width;
      p.y = Math.random() * height;
    }

    p.age = 0;
    p.life = this.computeLifetime();
  }

  // Set parameters from IML output (all values 0-1)
  setParams(outputs) {
    if (!outputs || outputs.length < 14) return;
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
  }

  draw() {
    const { ctx, width, height, params } = this;
    this.time += 0.003;

    // Fade existing content (creates trails)
    ctx.fillStyle = `rgba(13, 13, 13, ${params.fadeRate})`;
    ctx.fillRect(0, 0, width, height);

    for (const p of this.particles) {
      // Sample flow field
      const nx = p.x * params.scale;
      const ny = p.y * params.scale;
      const angle = noise2D(nx + this.time, ny) * TWO_PI + params.angleOffset;
      const curl = noise2D(nx + 100, ny + 100 + this.time * 0.5) * params.turbulence;

      // Move particle
      const vx = Math.cos(angle + curl) * params.speed;
      const vy = Math.sin(angle + curl) * params.speed;
      let nextX = p.x + vx;
      let nextY = p.y + vy;

      // Central attractor keeps trajectories from sticking to the outer edges.
      const cx = width * 0.5;
      const cy = height * 0.5;
      const dx = cx - nextX;
      const dy = cy - nextY;
      const dist = Math.hypot(dx, dy) + 1e-6;
      const nxCenter = dx / dist;
      const nyCenter = dy / dist;
      const normalizedDist = Math.min(dist / params.attractRadius, 2);
      const falloff = 1 / (1 + normalizedDist * normalizedDist);
      nextX += nxCenter * params.attractStrength * falloff;
      nextY += nyCenter * params.attractStrength * falloff;

      // Time-varying dispersion pushes particles outward near the center.
      const dispersionPulse = 0.5 + 0.5 * Math.sin(this.time * params.dispersionRate + p.id * 0.07);
      const dispersionForce = params.dispersionAmount * dispersionPulse * falloff;
      nextX -= nxCenter * dispersionForce;
      nextY -= nyCenter * dispersionForce;

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
