// GamepadInput — reusable gamepad polling module for NISPS playground
// Maps first stick axes to [0,1] with deadzone, polls via rAF, fires callbacks

export class GamepadInput {
  /**
   * @param {Object} options
   * @param {function(number, number)} options.onMove - called with (x, y) in [0,1] when stick moves
   * @param {function(string)} [options.onButton] - called with button name ('lb'|'rb') on press
   * @param {function(boolean)} [options.onConnectionChange] - called when gamepad connects/disconnects
   * @param {number} [options.deadzone=0.08] - axis deadzone threshold
   * @param {number} [options.moveThreshold=0.002] - minimum mapped change to trigger onMove
   * @param {number} [options.axisX=0] - gamepad axis index for X
   * @param {number} [options.axisY=1] - gamepad axis index for Y
   * @param {boolean} [options.invertY=false] - if true, invert Y axis (up = 0)
   */
  constructor(options = {}) {
    this.onMove = options.onMove || (() => {});
    this.onButton = options.onButton || null;
    this.onConnectionChange = options.onConnectionChange || null;
    this.deadzone = options.deadzone ?? 0.08;
    this.moveThreshold = options.moveThreshold ?? 0.002;
    this.axisX = options.axisX ?? 0;
    this.axisY = options.axisY ?? 1;
    this.invertY = options.invertY ?? false;

    this.connected = false;
    this._index = -1;
    this._lastAxes = [0.5, 0.5];
    this._buttonsPrev = [];
    this._polling = false;

    this._onConnected = this._onConnected.bind(this);
    this._onDisconnected = this._onDisconnected.bind(this);

    window.addEventListener('gamepadconnected', this._onConnected);
    window.addEventListener('gamepaddisconnected', this._onDisconnected);

    // Check if a gamepad is already connected
    this._findGamepad();
  }

  _onConnected(e) {
    if (this._index < 0) {
      this._index = e.gamepad.index;
    }
    this._setConnected(true);
  }

  _onDisconnected(e) {
    if (e.gamepad.index === this._index) {
      this._index = -1;
      // Try to find another connected gamepad
      this._findGamepad();
      if (this._index < 0) {
        this._setConnected(false);
      }
    }
  }

  _setConnected(value) {
    if (this.connected !== value) {
      this.connected = value;
      if (this.onConnectionChange) this.onConnectionChange(value);
    }
  }

  _findGamepad() {
    if (!navigator.getGamepads) return;
    const gamepads = navigator.getGamepads();
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i].connected) {
        this._index = i;
        this._setConnected(true);
        return;
      }
    }
  }

  /**
   * Poll the gamepad. Call this once per frame (e.g. inside requestAnimationFrame).
   * Returns true if stick moved.
   */
  poll() {
    if (!navigator.getGamepads) return false;
    const gamepads = navigator.getGamepads();
    let gp = null;

    if (this._index >= 0 && gamepads[this._index]?.connected) {
      gp = gamepads[this._index];
    } else {
      this._index = -1;
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]?.connected) {
          gp = gamepads[i];
          this._index = i;
          break;
        }
      }
    }

    const wasConnected = this.connected;
    this.connected = !!gp;
    if (wasConnected !== this.connected) {
      if (this.onConnectionChange) this.onConnectionChange(this.connected);
    }

    if (!gp) {
      this._buttonsPrev = [];
      return false;
    }

    // Axes
    const rawX = gp.axes[this.axisX] || 0;
    const rawY = gp.axes[this.axisY] || 0;
    const axisX = Math.abs(rawX) < this.deadzone ? 0 : rawX;
    const axisY = Math.abs(rawY) < this.deadzone ? 0 : rawY;
    let mappedX = (axisX + 1) * 0.5;
    let mappedY = (axisY + 1) * 0.5;
    if (this.invertY) mappedY = 1 - mappedY;

    const moved = Math.abs(mappedX - this._lastAxes[0]) > this.moveThreshold ||
                  Math.abs(mappedY - this._lastAxes[1]) > this.moveThreshold;

    if (moved) {
      this._lastAxes = [mappedX, mappedY];
      this.onMove(mappedX, mappedY);
    }

    // Buttons: LB=4, RB=5
    if (this.onButton) {
      const lbPressed = !!gp.buttons[4]?.pressed;
      const rbPressed = !!gp.buttons[5]?.pressed;
      const lbPrev = !!this._buttonsPrev[4];
      const rbPrev = !!this._buttonsPrev[5];

      if (lbPressed && !lbPrev) this.onButton('lb');
      if (rbPressed && !rbPrev) this.onButton('rb');

      this._buttonsPrev[4] = lbPressed;
      this._buttonsPrev[5] = rbPressed;
    }

    return moved;
  }

  /** Current mapped X position [0,1] */
  get x() { return this._lastAxes[0]; }

  /** Current mapped Y position [0,1] */
  get y() { return this._lastAxes[1]; }

  /** Clean up event listeners */
  destroy() {
    window.removeEventListener('gamepadconnected', this._onConnected);
    window.removeEventListener('gamepaddisconnected', this._onDisconnected);
  }
}
