/**
 * Input pipeline — pure TS port of legacy `js/ui/input-pipeline.js`.
 *
 * Stages (in order), each input/output in [0,1]:
 *   0. Invert (per-axis flip)
 *   1. Deadzone (suppress jitter near center, remap live zone to [0,1])
 *   2. Circular clamp (constrain to unit disk centered at 0.5,0.5)
 *   3. Zoom (narrow window around anchor, modulated by momentum)
 *   4. Centered power curve (per-axis exponent)
 *   5. EMA smoothing (frame-rate-independent)
 *   6. Momentum-as-zoom update (consumed next frame)
 *
 * `processInput` is a pure function over (raw, cfg, prev): returns the new
 * processed coordinate plus the next-frame state. Consumer (input-store)
 * holds the state and calls this each frame.
 *
 * Math is intentionally bit-for-bit equivalent to the legacy implementation.
 */

import { clamp, curveCenteredPower } from './curves';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ZOOM_MIN = 0.01;
export const ZOOM_MAX = 1.0;
export const FREEZE_THRESHOLD = ZOOM_MIN;

export const DEADZONE_MAX = 0.4;
export const INPUT_CURVE_MIN = 0.2;
export const INPUT_CURVE_MAX = 5.0;
export const SMOOTHING_MAX = 0.95;
export const VELOCITY_WINDOW_DEFAULT = 150; // ms

const REFERENCE_DT = 1 / 60;

export type MomentumZoomMode = 'off' | 'gentle' | 'strong';
export type AnchorMode = 'auto' | 'sticky' | 'center';

interface MomentumPreset {
  factor: number;
  minZoomMul: number;
  maxZoomMul: number;
}

const MOMENTUM_PRESETS: Record<MomentumZoomMode, MomentumPreset | null> = {
  off: null,
  gentle: { factor: 0.6, minZoomMul: 0.3, maxZoomMul: 1.0 },
  strong: { factor: 1.5, minZoomMul: 0.15, maxZoomMul: 1.0 },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InputConfig {
  /** Global zoom level [0.01, 1.0] */
  zoom: number;
  /** Optional per-axis zoom; overrides global when not null */
  zoomX: number | null;
  zoomY: number | null;
  /** Anchor point [0,1]^2 (used in sticky/auto modes) */
  anchorX: number;
  anchorY: number;
  anchorMode: AnchorMode;
  /** Deadzone fraction of half-travel [0, 0.4] */
  deadzone: number;
  /** Centered power curve exponent [0.2, 5.0] (1.0 = linear) */
  inputCurve: number;
  inputCurveX: number | null;
  inputCurveY: number | null;
  /** EMA smoothing factor [0, 0.95] */
  smoothing: number;
  /** Momentum-as-zoom preset */
  momentumZoom: MomentumZoomMode;
  velocityWindow: number;
  /** Per-axis inversion */
  invertX: boolean;
  invertY: boolean;
}

export interface InputState {
  /** Last smoothed output x; seed at 0.5 */
  smoothedX: number;
  smoothedY: number;
  /** Velocity history ring used for momentum-zoom */
  velocityHistory: ReadonlyArray<{ x: number; y: number; t: number }>;
  /** Most recent momentum-zoom multiplier (1 = no scale) */
  momentumZoomMultiplier: number;
  /** Whether last process call returned frozen=true */
  frozen: boolean;
}

export interface ProcessResult {
  x: number;
  y: number;
  frozen: boolean;
  /** Next frame's state — consumer should keep this and pass it back. */
  state: InputState;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultInputConfig(): InputConfig {
  return {
    zoom: 1.0,
    zoomX: null,
    zoomY: null,
    anchorX: 0.5,
    anchorY: 0.5,
    anchorMode: 'center',
    deadzone: 0,
    inputCurve: 1.0,
    inputCurveX: null,
    inputCurveY: null,
    smoothing: 0,
    momentumZoom: 'off',
    velocityWindow: VELOCITY_WINDOW_DEFAULT,
    invertX: false,
    invertY: false,
  };
}

export function defaultInputState(): InputState {
  return {
    smoothedX: 0.5,
    smoothedY: 0.5,
    velocityHistory: [],
    momentumZoomMultiplier: 1,
    frozen: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyDeadzone(input: number, deadzone: number): number {
  if (deadzone <= 0) return input;
  const offset = input - 0.5;
  const absOff = Math.abs(offset);
  const halfDz = deadzone * 0.5;
  if (absOff <= halfDz) return 0.5;
  const sign = offset < 0 ? -1 : 1;
  const remapped = ((absOff - halfDz) / (0.5 - halfDz)) * 0.5;
  return 0.5 + sign * remapped;
}

function applyZoom(input: number, anchor: number, zoomLevel: number): number {
  return clamp(anchor + (input - 0.5) * zoomLevel, 0, 1);
}

function emaSmooth(prev: number, raw: number, smoothing: number, dt: number): number {
  if (smoothing <= 0) return raw;
  const effectiveDt = dt > 0 ? dt : REFERENCE_DT;
  const alpha = 1 - smoothing;
  const alphaEff = 1 - Math.pow(1 - alpha, effectiveDt / REFERENCE_DT);
  return prev + alphaEff * (raw - prev);
}

function updateMomentumZoomMultiplier(
  cfg: InputConfig,
  state: InputState,
  rawX: number,
  rawY: number,
  dt: number,
): { multiplier: number; history: InputState['velocityHistory'] } {
  const preset = MOMENTUM_PRESETS[cfg.momentumZoom];
  if (!preset) {
    return { multiplier: 1, history: [] };
  }
  const now = performance.now();
  const window = cfg.velocityWindow;
  // Append, drop entries older than `window` ms
  const trimmed = state.velocityHistory.filter((p) => now - p.t <= window);
  const newHist = [...trimmed, { x: rawX, y: rawY, t: now }];
  if (newHist.length < 2) {
    return { multiplier: 1, history: newHist };
  }
  const a = newHist[0]!;
  const b = newHist[newHist.length - 1]!;
  const dtMs = b.t - a.t;
  if (dtMs <= 0) return { multiplier: state.momentumZoomMultiplier, history: newHist };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const speed = dist / (dtMs / 1000); // [0,1]-space units per second
  const normSpeed = clamp(speed * preset.factor, 0, 1);
  // Higher speed → smaller multiplier (zoom out faster movements)
  const target = preset.maxZoomMul - (preset.maxZoomMul - preset.minZoomMul) * normSpeed;
  // Smooth toward target so the zoom doesn't jitter
  const smoothCoeff = clamp(dt * 6, 0, 1);
  const next = state.momentumZoomMultiplier + smoothCoeff * (target - state.momentumZoomMultiplier);
  return { multiplier: next, history: newHist };
}

function resolveAnchorX(cfg: InputConfig, state: InputState): number {
  if (cfg.anchorMode === 'center') return 0.5;
  if (cfg.anchorMode === 'sticky') return cfg.anchorX;
  // auto: use stored anchor (input-store updates it on zoom changes)
  return cfg.anchorX;
}

function resolveAnchorY(cfg: InputConfig, state: InputState): number {
  if (cfg.anchorMode === 'center') return 0.5;
  if (cfg.anchorMode === 'sticky') return cfg.anchorY;
  return cfg.anchorY;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process raw 2D input through the pipeline.
 *
 * @param raw    raw input [x, y] in [0,1]
 * @param cfg    pipeline configuration
 * @param state  prior state (use {@link defaultInputState} on first call)
 * @param dt     seconds since last call (default 1/60)
 */
export function processInput(
  raw: readonly [number, number],
  cfg: InputConfig,
  state: InputState,
  dt: number = REFERENCE_DT,
): ProcessResult {
  const safeDt = Math.max(0, dt);
  const baseZoomX = cfg.zoomX ?? cfg.zoom;
  const baseZoomY = cfg.zoomY ?? cfg.zoom;

  const frozenX = baseZoomX <= FREEZE_THRESHOLD;
  const frozenY = baseZoomY <= FREEZE_THRESHOLD;
  const fullyFrozen = frozenX && frozenY;

  if (fullyFrozen) {
    return {
      x: state.smoothedX,
      y: state.smoothedY,
      frozen: true,
      state: { ...state, frozen: true },
    };
  }

  let [rawX, rawY] = raw;

  // 0. Invert
  let x = cfg.invertX ? 1 - rawX : rawX;
  let y = cfg.invertY ? 1 - rawY : rawY;

  // 1. Deadzone
  x = applyDeadzone(x, cfg.deadzone);
  y = applyDeadzone(y, cfg.deadzone);

  // 2. Circular clamp to unit disk centered at (0.5, 0.5)
  {
    const cx = x - 0.5;
    const cy = y - 0.5;
    const dist = Math.sqrt(cx * cx + cy * cy);
    if (dist > 0.5 && dist > 1e-12) {
      const scale = 0.5 / dist;
      x = 0.5 + cx * scale;
      y = 0.5 + cy * scale;
    }
  }

  // 3. Zoom around anchor (with momentum modulation)
  const anchorX = resolveAnchorX(cfg, state);
  const anchorY = resolveAnchorY(cfg, state);
  const effZoomX = frozenX
    ? FREEZE_THRESHOLD
    : clamp(baseZoomX * state.momentumZoomMultiplier, ZOOM_MIN, ZOOM_MAX);
  const effZoomY = frozenY
    ? FREEZE_THRESHOLD
    : clamp(baseZoomY * state.momentumZoomMultiplier, ZOOM_MIN, ZOOM_MAX);
  x = frozenX ? state.smoothedX : applyZoom(x, anchorX, effZoomX);
  y = frozenY ? state.smoothedY : applyZoom(y, anchorY, effZoomY);

  // 4. Centered power curve
  const curveX = cfg.inputCurveX ?? cfg.inputCurve;
  const curveY = cfg.inputCurveY ?? cfg.inputCurve;
  if (!frozenX) x = curveCenteredPower(x, curveX);
  if (!frozenY) y = curveCenteredPower(y, curveY);

  // 5. EMA smoothing
  const smoothedX = frozenX ? state.smoothedX : emaSmooth(state.smoothedX, x, cfg.smoothing, safeDt);
  const smoothedY = frozenY ? state.smoothedY : emaSmooth(state.smoothedY, y, cfg.smoothing, safeDt);

  // 6. Update momentum-zoom for next frame
  const { multiplier, history } = updateMomentumZoomMultiplier(cfg, state, rawX, rawY, safeDt);

  return {
    x: smoothedX,
    y: smoothedY,
    frozen: false,
    state: {
      smoothedX,
      smoothedY,
      velocityHistory: history,
      momentumZoomMultiplier: multiplier,
      frozen: false,
    },
  };
}
