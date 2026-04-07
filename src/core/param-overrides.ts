/**
 * Param Overrides — per-parameter curve/min/max/freeze controls.
 *
 * Ported from playground/js/synth/param-map.js (applyCurve, applyGroupOverride)
 * and playground/js/a-app.js (visualOverrides array pattern).
 *
 * Each parameter can have its output shaped by:
 *   curve: [0,1] — 0.5 = linear, <0.5 = compress low end, >0.5 = expand
 *   min/max: [0,1] — output range mapping
 *   frozen: boolean — if true, output holds fixedValue
 *   fixedValue: [0,1] — the value used when frozen
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface ParamOverride {
  /** Response curve factor [0,1]. 0.5 = linear */
  curve: number;
  /** Output range minimum [0,1] */
  min: number;
  /** Output range maximum [0,1] */
  max: number;
  /** Whether the parameter is frozen (held at fixedValue) */
  frozen: boolean;
  /** The value to hold when frozen [0,1] */
  fixedValue: number;
}

/** Create a default override with no transformation */
export function createDefaultOverride(): ParamOverride {
  return {
    curve: 0.5,
    min: 0,
    max: 1,
    frozen: false,
    fixedValue: 0.5,
  };
}

/** Create an array of default overrides */
export function createDefaultOverrides(count: number): ParamOverride[] {
  return Array.from({ length: count }, () => createDefaultOverride());
}

// ─── Curve Math ─────────────────────────────────────────────────────

/**
 * Apply a response curve to a value.
 * @param value Input value [0,1]
 * @param curveFactor Curve factor [0,1] — 0.5 = linear (no change)
 * @returns Curved value [0,1]
 */
export function applyCurve(value: number, curveFactor: number): number {
  if (curveFactor === 0.5) return value;
  const exponent = Math.pow(2, 4 * (curveFactor - 0.5));
  return Math.pow(Math.max(0, Math.min(1, value)), exponent);
}

/**
 * Apply full override transformation: curve + min/max range.
 * @param rawValue Raw ML output [0,1]
 * @param override Override settings
 * @returns Transformed value
 */
export function applyOverride(rawValue: number, override: ParamOverride): number {
  const curved = applyCurve(rawValue, override.curve);
  return override.min + curved * (override.max - override.min);
}

/**
 * Apply override to a raw value, respecting frozen state.
 * If frozen, returns fixedValue; otherwise applies curve + range.
 */
export function applyOverrideWithFreeze(rawValue: number, override: ParamOverride): number {
  if (override.frozen) return override.fixedValue;
  return applyOverride(rawValue, override);
}

/**
 * Draw a response curve on a canvas element.
 * @param ctx Canvas 2D context
 * @param curveFactor Curve factor [0,1]
 * @param color Stroke color
 * @param w Canvas width
 * @param h Canvas height
 */
export function drawCurveOnCanvas(
  ctx: CanvasRenderingContext2D,
  curveFactor: number,
  color: string,
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(0, 0, w, h);

  // Linear reference line
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w, 0);
  ctx.stroke();

  // Curve
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.min(2, w / 16);
  ctx.beginPath();
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const v = applyCurve(t, curveFactor);
    const px = t * w;
    const py = (1 - v) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}
