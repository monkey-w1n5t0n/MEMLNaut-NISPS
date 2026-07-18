/**
 * Pipeline config types (one-core-engine P4).
 *
 * The input/output PROCESSING now lives in the C++/WASM core
 * (nisps/pipeline/{input,output}_chain.hpp); state is owned C++-side per
 * pipeline handle. These are the TS-side CONFIG shapes the front-end fills in
 * and the spine forwards into the WASM wrappers (WasmIML.setInputConfig /
 * setOutputConfig). No behaviour maths lives here — this is a types-only module
 * plus pure defaults, the residue of the deleted input-pipeline.ts /
 * output-pipeline.ts.
 *
 * The 15-float input wire layout the config maps onto is documented in
 * nisps/wasm/bindings.cpp (nisps_input_set_config).
 */

export type MomentumZoomMode = 'off' | 'gentle' | 'strong';
export type AnchorMode = 'auto' | 'sticky' | 'center';

/** Config-range constants (UI clamps + defaults). Kept for the front-end. */
export const ZOOM_MIN = 0.01;
export const ZOOM_MAX = 1.0;
export const FREEZE_THRESHOLD = ZOOM_MIN;
export const DEADZONE_MAX = 0.4;
export const INPUT_CURVE_MIN = 0.2;
export const INPUT_CURVE_MAX = 5.0;
export const SMOOTHING_MAX = 0.95;
export const VELOCITY_WINDOW_DEFAULT = 150; // ms
export const GLOBAL_CURVE_MIN = 0.2;
export const GLOBAL_CURVE_MAX = 5.0;
export const SLEW_RATE_MIN = 0.005;

export interface InputConfig {
  /** Global zoom level [0.01, 1.0]. */
  zoom: number;
  /** Optional per-axis zoom; overrides global when not null. */
  zoomX: number | null;
  zoomY: number | null;
  /** Anchor point [0,1]^2 (used in sticky/auto modes). */
  anchorX: number;
  anchorY: number;
  anchorMode: AnchorMode;
  /** Deadzone fraction of half-travel [0, 0.4]. */
  deadzone: number;
  /** Centred power curve exponent [0.2, 5.0] (1.0 = linear). */
  inputCurve: number;
  inputCurveX: number | null;
  inputCurveY: number | null;
  /** EMA smoothing factor [0, 0.95]. */
  smoothing: number;
  /** Momentum-as-zoom preset. */
  momentumZoom: MomentumZoomMode;
  /** Velocity window in MILLISECONDS (mapped to seconds at the wire). */
  velocityWindow: number;
  /** Per-axis inversion. */
  invertX: boolean;
  invertY: boolean;
}

export interface OutputConfig {
  /** Power curve exponent applied to ALL outputs. 1 = linear. */
  globalCurve: number;
  /** EMA smoothing factor [0, 0.95]. */
  smoothing: number;
  /** Max change per second per output. Infinity = unlimited (→ 0 at the wire). */
  slewRate: number;
  /** Global freeze gate. */
  freezeOutput: boolean;
  /** Per-output freeze mask (1 = frozen). null clears it. */
  freezeMask: Uint8Array | null;
}

/** Result of one input-pipeline step (mirrors the C++ InputChainResult). */
export interface InputProcessResult {
  x: number;
  y: number;
  frozen: boolean;
}

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

export function defaultOutputConfig(): OutputConfig {
  return {
    globalCurve: 1.0,
    smoothing: 0,
    slewRate: Infinity,
    freezeOutput: false,
    freezeMask: null,
  };
}

/** anchorMode string → wire int (0 auto / 1 sticky / 2 centre). */
export function anchorModeToInt(m: AnchorMode): number {
  return m === 'sticky' ? 1 : m === 'center' ? 2 : 0;
}

/** momentumZoom string → wire int (0 off / 1 gentle / 2 strong). */
export function momentumModeToInt(m: MomentumZoomMode): number {
  return m === 'gentle' ? 1 : m === 'strong' ? 2 : 0;
}
