// Virtual touch joystick (Canvas-based)
// Outputs normalized X, Y in [0, 1]

export class VirtualJoystick {
  constructor(container, options = {}) {
    this.canvas = document.createElement('canvas');
    this.size = options.size || 180;
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.canvas.style.width = this.size + 'px';
    this.canvas.style.height = this.size + 'px';
    this.canvas.style.touchAction = 'none';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.x = 0.5;
    this.y = 0.5;
    this.touching = false;
    this.springBack = options.springBack ?? false;
    this.onChange = options.onChange || (() => {});

    // Touch events
    this.canvas.addEventListener('touchstart', this._onTouch.bind(this), { passive: false });
    this.canvas.addEventListener('touchmove', this._onTouch.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this._onRelease.bind(this));
    this.canvas.addEventListener('touchcancel', this._onRelease.bind(this));

    // Mouse fallback
    this.canvas.addEventListener('mousedown', (e) => {
      this.touching = true;
      this._updateFromEvent(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.touching) this._updateFromEvent(e);
    });
    window.addEventListener('mouseup', () => {
      if (this.touching) this._onRelease();
    });

    this.draw();
  }

  _onTouch(e) {
    e.preventDefault();
    const touch = e.touches[0];
    this.touching = true;
    const rect = this.canvas.getBoundingClientRect();
    this.x = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    this.y = Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height));
    this.onChange(this.x, this.y);
    this.draw();
  }

  _updateFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    this.onChange(this.x, this.y);
    this.draw();
  }

  _onRelease() {
    this.touching = false;
    if (this.springBack) {
      this.x = 0.5;
      this.y = 0.5;
      this.onChange(this.x, this.y);
    }
    this.draw();
  }

  draw() {
    const { ctx, size: s } = this;
    const r = s / 2;
    ctx.clearRect(0, 0, s, s);

    // Background circle
    ctx.beginPath();
    ctx.arc(r, r, r - 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Crosshairs
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r, 6); ctx.lineTo(r, s - 6);
    ctx.moveTo(6, r); ctx.lineTo(s - 6, r);
    ctx.stroke();

    // Grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(s * 0.25, 6); ctx.lineTo(s * 0.25, s - 6);
    ctx.moveTo(s * 0.75, 6); ctx.lineTo(s * 0.75, s - 6);
    ctx.moveTo(6, s * 0.25); ctx.lineTo(s - 6, s * 0.25);
    ctx.moveTo(6, s * 0.75); ctx.lineTo(s - 6, s * 0.75);
    ctx.stroke();
    ctx.setLineDash([]);

    // Thumb
    const tx = this.x * s;
    const ty = this.y * s;

    // Glow
    if (this.touching) {
      const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, 24);
      grad.addColorStop(0, 'rgba(0, 255, 136, 0.3)');
      grad.addColorStop(1, 'rgba(0, 255, 136, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(tx, ty, 24, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = this.touching ? '#00ff88' : '#666';
    ctx.beginPath();
    ctx.arc(tx, ty, 14, 0, Math.PI * 2);
    ctx.fill();

    // Position text
    ctx.fillStyle = '#555';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${this.x.toFixed(2)}, ${this.y.toFixed(2)}`, s - 8, s - 6);
  }
}
