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
    this.followMode = false;
    this.springBack = options.springBack ?? false;
    this.trackpadScale = Math.max(1, options.trackpadScale || 1);
    this.onChange = options.onChange || (() => {});
    this.onFollowModeChange = options.onFollowModeChange || (() => {});

    // Touch events
    this.canvas.addEventListener('touchstart', this._onTouch.bind(this), { passive: false });
    this.canvas.addEventListener('touchmove', this._onTouch.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this._onRelease.bind(this));
    this.canvas.addEventListener('touchcancel', this._onRelease.bind(this));

    // Mouse fallback
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.followMode) {
        this._updateFromEvent(e);
        return;
      }
      this.touching = true;
      this._updateFromEvent(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.followMode) {
        this._updateFromEvent(e, true);
      } else if (this.touching) {
        this._updateFromEvent(e);
      }
    });
    window.addEventListener('mouseup', () => {
      if (this.touching && !this.followMode) this._onRelease();
    });
    this.canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.setFollowMode(!this.followMode);
      this._updateFromEvent(e, true);
    });

    this.draw();
  }

  _onTouch(e) {
    e.preventDefault();
    const touch = e.touches[0];
    this.touching = true;
    this._updateFromClient(touch.clientX, touch.clientY);
  }

  _getTrackingRect() {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width * this.trackpadScale;
    const h = rect.height * this.trackpadScale;
    return {
      left: rect.left - (w - rect.width) * 0.5,
      top: rect.top - (h - rect.height) * 0.5,
      width: w,
      height: h,
    };
  }

  _updateFromClient(clientX, clientY) {
    const rect = this._getTrackingRect();
    this.x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    this.y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    this.onChange(this.x, this.y);
    this.draw();
  }

  _isInsideTrackingRect(clientX, clientY) {
    const rect = this._getTrackingRect();
    return clientX >= rect.left && clientX <= rect.left + rect.width &&
      clientY >= rect.top && clientY <= rect.top + rect.height;
  }

  _updateFromEvent(e, requireInside = false) {
    if (requireInside && !this._isInsideTrackingRect(e.clientX, e.clientY)) return;
    this._updateFromClient(e.clientX, e.clientY);
  }

  _onRelease() {
    if (this.followMode) return;
    this.touching = false;
    if (this.springBack) {
      this.x = 0.5;
      this.y = 0.5;
      this.onChange(this.x, this.y);
    }
    this.draw();
  }

  setPosition(x, y, options = {}) {
    const { emit = true, touching = false } = options;
    this.x = Math.max(0, Math.min(1, x));
    this.y = Math.max(0, Math.min(1, y));
    this.touching = touching;
    if (emit) this.onChange(this.x, this.y);
    this.draw();
  }

  setFollowMode(enabled) {
    this.followMode = !!enabled;
    this.touching = this.followMode || this.touching;
    this.onFollowModeChange(this.followMode);
    this.draw();
  }

  draw() {
    const { ctx, size: s } = this;
    const r = s / 2;
    ctx.clearRect(0, 0, s, s);

    // Background circle
    ctx.beginPath();
    ctx.arc(r, r, r - 4, 0, Math.PI * 2);
    ctx.strokeStyle = this.followMode ? '#00cc6a' : '#333';
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
    ctx.fillStyle = this.followMode ? '#00cc6a' : '#555';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(this.followMode ? 'FOLLOW' : 'HOLD', 8, s - 6);
    ctx.textAlign = 'right';
    ctx.fillText(`${this.x.toFixed(2)}, ${this.y.toFixed(2)}`, s - 8, s - 6);
  }
}
