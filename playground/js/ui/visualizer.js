// Flow field particle system with Canvas2D
// Controlled by 8 output parameters from the IML network

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
      this.particles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        id: i,
      });
    }
    // Clear canvas to black
    this.ctx.fillStyle = '#0d0d0d';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  // Set parameters from IML output (all values 0-1)
  setParams(outputs) {
    if (!outputs || outputs.length < 8) return;
    this.params.angleOffset = outputs[0] * TWO_PI;
    this.params.scale = 0.001 + outputs[1] * 0.009;
    this.params.speed = 0.5 + outputs[2] * 4.5;
    this.params.hueBase = outputs[3] * 360;
    this.params.hueSpread = outputs[4] * 120;
    this.params.particleSize = 1 + outputs[5] * 5;
    this.params.fadeRate = 0.01 + outputs[6] * 0.14;
    this.params.turbulence = outputs[7] * 2;
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
      p.x += vx;
      p.y += vy;

      // Wrap around edges
      if (p.x < 0) p.x += width;
      if (p.x > width) p.x -= width;
      if (p.y < 0) p.y += height;
      if (p.y > height) p.y -= height;

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
