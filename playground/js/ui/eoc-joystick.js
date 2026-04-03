// EOC Independent mode joystick — minimal 2D touch/mouse input
// No zoom, no momentum, no input pipeline — just raw normalized X/Y

export class EOCJoystick {
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._x = 0.5;
    this._y = 0.5;
    this._dragging = false;
    this._onChange = null;
    this._bindEvents();
    this._draw();
  }

  get x() { return this._x; }
  get y() { return this._y; }
  set onChange(fn) { this._onChange = fn; }

  _bindEvents() {
    this._canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      this._dragging = true;
      this._canvas.setPointerCapture(e.pointerId);
      this._update(e);
    });
    this._canvas.addEventListener('pointermove', e => {
      if (this._dragging) this._update(e);
    });
    this._canvas.addEventListener('pointerup', e => {
      this._dragging = false;
      this._canvas.releasePointerCapture(e.pointerId);
    });
    this._canvas.addEventListener('pointercancel', e => {
      this._dragging = false;
    });
  }

  _update(e) {
    const rect = this._canvas.getBoundingClientRect();
    this._x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this._y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    this._draw();
    this._onChange?.(this._x, this._y);
  }

  _draw() {
    const ctx = this._ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;
    ctx.clearRect(0, 0, w, h);
    // Background
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, w, h);
    // Crosshairs
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();
    // Dot
    ctx.fillStyle = this._dragging ? '#5ff5ea' : '#4ecdc4';
    ctx.beginPath();
    ctx.arc(this._x * w, this._y * h, 6, 0, Math.PI * 2);
    ctx.fill();
    // Position label
    ctx.fillStyle = 'rgba(78,205,196,0.5)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${this._x.toFixed(2)}, ${this._y.toFixed(2)}`, w - 4, h - 4);
  }
}
