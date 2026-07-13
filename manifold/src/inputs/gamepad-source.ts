/**
 * GamepadSource — physical gamepad via the Gamepad API.
 *
 * Stick mode:
 *  - 'single' → 2 axes  (left stick X/Y)
 *  - 'double' → 4 axes  (left stick X/Y + right stick X/Y)
 *
 * Standard-mapping gamepad axes are [-1,1]; we remap to [0,1] for the ML head
 * and apply a small radial deadzone (sticks rarely rest at exact centre). A
 * y-axis flip makes "stick up" = 1 (the API has up = -1).
 *
 * Pull-based: the Gamepad API is itself a poll-based snapshot
 * (`navigator.getGamepads()`), so `sample()` reads the live snapshot directly —
 * no event latching needed for axes. Buttons ARE edge-detected each frame (in
 * `poll()`, driven by the InputLayer loop) and surfaced as discrete actions.
 *
 * Graceful degrade: if the Gamepad API is missing OR no pad is connected, the
 * source reports `unavailable`/`connecting` and contributes its axes as 0.5
 * (centre) so it never destabilises the composed vector.
 */
import { BaseSource } from './base-source';
import type { InputSourceKind } from './types';

export type StickMode = 'single' | 'double';

const DEADZONE = 0.08;

/**
 * Standard-mapping button index → human label. The Inputs dock binds these to
 * verdict ops (see useInputLayer / ConsoleApp): LB/RB = down/up feedback, the
 * face buttons = randomise / nudge / undo, and a hold-and-move button drops a
 * repositioned example. The labels here keep the dock legend honest.
 */
const BUTTON_LABELS: Record<number, string> = {
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LB',
  5: 'RB',
  6: 'LT',
  7: 'RT',
  8: 'Back',
  9: 'Start',
  10: 'L3',
  11: 'R3',
  12: 'D↑',
  13: 'D↓',
  14: 'D←',
  15: 'D→',
};

export class GamepadSource extends BaseSource {
  readonly kind: InputSourceKind = 'gamepad';
  readonly label = 'Gamepad';

  private stickMode: StickMode = 'single';
  private padIndex: number | null = null;
  private running = false;
  /** Per-button last pressed-state for edge detection. */
  private buttonsDown: boolean[] = [];

  private onConnect = (e: GamepadEvent) => {
    if (this.padIndex === null) this.padIndex = e.gamepad.index;
    this.setStatus({ state: 'ready', message: `Gamepad: ${e.gamepad.id}` });
  };
  private onDisconnect = (e: GamepadEvent) => {
    if (e.gamepad.index === this.padIndex) {
      this.padIndex = null;
      this.setStatus({ state: 'connecting', message: 'Gamepad disconnected — press a button' });
    }
  };

  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  }

  setStickMode(mode: StickMode): void {
    this.stickMode = mode;
  }

  getStickMode(): StickMode {
    return this.stickMode;
  }

  axisCount(): number {
    return this.stickMode === 'double' ? 4 : 2;
  }

  axisLabels(): string[] {
    return this.stickMode === 'double'
      ? ['L-X', 'L-Y', 'R-X', 'R-Y']
      : ['L-X', 'L-Y'];
  }

  private activePad(): Gamepad | null {
    if (!this.isAvailable()) return null;
    const pads = navigator.getGamepads();
    if (this.padIndex !== null) {
      const p = pads[this.padIndex];
      if (p) return p;
    }
    // Fall back to the first connected pad.
    for (const p of pads) {
      if (p) {
        this.padIndex = p.index;
        return p;
      }
    }
    return null;
  }

  sample(out: Float32Array, offset: number): number {
    const n = this.axisCount();
    const pad = this.activePad();
    if (!pad) {
      for (let i = 0; i < n; i++) out[offset + i] = 0.5; // centre when absent
      return n;
    }
    // Left stick = axes 0,1; right stick = axes 2,3 (standard mapping). Each
    // stick is clamped to the unit disc (not per-axis), so a full diagonal push
    // lands ON the circular boundary rather than the square corner — matching
    // the on-screen circular input area and the engine's own circular clamp.
    const [lx, ly] = clampStick(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0)); // flip: up = 1
    out[offset] = lx;
    out[offset + 1] = ly;
    if (n === 4) {
      const [rx, ry] = clampStick(pad.axes[2] ?? 0, -(pad.axes[3] ?? 0));
      out[offset + 2] = rx;
      out[offset + 3] = ry;
    }
    return n;
  }

  /** Edge-detect button presses → discrete actions. Driven by InputLayer loop. */
  poll(): void {
    if (!this.running) return;
    const pad = this.activePad();
    if (!pad) return;
    if (this.buttonsDown.length !== pad.buttons.length) {
      this.buttonsDown = pad.buttons.map((b) => b.pressed);
      return; // first frame after (re)connect: prime, don't fire
    }
    for (let i = 0; i < pad.buttons.length; i++) {
      const pressed = pad.buttons[i].pressed;
      if (pressed && !this.buttonsDown[i]) {
        this.emitAction({
          source: this.kind,
          id: `button:${i}`,
          label: BUTTON_LABELS[i] ?? `Button ${i}`,
          value: pad.buttons[i].value || 1,
          phase: 'press',
        });
      } else if (!pressed && this.buttonsDown[i]) {
        this.emitAction({
          source: this.kind,
          id: `button:${i}`,
          label: BUTTON_LABELS[i] ?? `Button ${i}`,
          value: 0,
          phase: 'release',
        });
      }
      this.buttonsDown[i] = pressed;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (!this.isAvailable()) {
      this.setStatus({ state: 'unavailable', message: 'Gamepad API not supported in this browser' });
      return;
    }
    window.addEventListener('gamepadconnected', this.onConnect);
    window.addEventListener('gamepaddisconnected', this.onDisconnect);
    if (this.activePad()) {
      this.setStatus({ state: 'ready', message: 'Gamepad ready' });
    } else {
      this.setStatus({ state: 'connecting', message: 'Press a button on your gamepad to connect' });
    }
  }

  stop(): void {
    this.running = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('gamepadconnected', this.onConnect);
      window.removeEventListener('gamepaddisconnected', this.onDisconnect);
    }
    this.buttonsDown = [];
    this.setStatus({ state: 'idle', message: 'Gamepad off' });
  }
}

/** Apply the per-axis deadzone, returning a signed value in [-1,1]. */
function deadzoneAxis(v: number): number {
  if (v > -DEADZONE && v < DEADZONE) return 0;
  const x = v > 0 ? (v - DEADZONE) / (1 - DEADZONE) : (v + DEADZONE) / (1 - DEADZONE);
  return x < -1 ? -1 : x > 1 ? 1 : x;
}

/**
 * Map a raw stick (rawX, rawY with y already flipped so up = +) to two [0,1]
 * axes, clamping the stick *vector* to the unit disc first. This keeps full
 * deflection on the circular boundary in every direction (radially symmetric),
 * instead of letting a diagonal reach the square corner.
 */
function clampStick(rawX: number, rawY: number): [number, number] {
  let x = deadzoneAxis(rawX);
  let y = deadzoneAxis(rawY);
  const mag = Math.hypot(x, y);
  if (mag > 1) {
    x /= mag;
    y /= mag;
  }
  return [0.5 + 0.5 * x, 0.5 + 0.5 * y];
}
