/**
 * XYPadSource — the existing on-screen XY pad / joystick / manifold drag,
 * wrapped as a 2-axis InputSource.
 *
 * Push-based: the pad's `onMove(x, y)` handler calls `pushAxes(x, y)`, which
 * latches the values. `sample()` reads them back through the standard pull path
 * so the XY pad composes identically with poll-based sources (MIDI/gamepad).
 *
 * This is always available (it's an on-screen widget), so it starts `ready`.
 */
import { BaseSource } from './base-source';
import type { InputSourceKind } from './types';

export class XYPadSource extends BaseSource {
  readonly kind: InputSourceKind = 'xy-pad';
  readonly label = 'XY pad';

  private x = 0.5;
  private y = 0.5;

  constructor() {
    super({ state: 'ready', message: 'XY pad ready' });
  }

  axisCount(): number {
    return 2;
  }

  axisLabels(): string[] {
    return ['X', 'Y'];
  }

  /** Latch the latest pad position (∈ [0,1]). Called from the pad's onMove. */
  pushAxes(x: number, y: number): void {
    this.x = clamp01(x);
    this.y = clamp01(y);
  }

  sample(out: Float32Array, offset: number): number {
    out[offset] = this.x;
    out[offset + 1] = this.y;
    return 2;
  }

  start(): void {
    this.setStatus({ state: 'ready', message: 'XY pad ready' });
  }

  stop(): void {
    this.setStatus({ state: 'idle', message: 'XY pad off' });
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
