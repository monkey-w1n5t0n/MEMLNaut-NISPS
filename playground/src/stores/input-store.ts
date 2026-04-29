/**
 * Input store — input pipeline configuration + last-processed coordinate.
 *
 * Setters mutate the underlying Solid store (so subscribers re-run) and
 * schedule a debounced localStorage write.
 *
 * Architecture §7.1: zoom, anchor, anchor mode, deadzone, curve, smoothing,
 * momentum, invert.
 */

import { createStore, produce } from 'solid-js/store';
import {
  defaultInputConfig,
  defaultInputState,
  type AnchorMode,
  type InputConfig,
  type InputState,
  type MomentumZoomMode,
  ZOOM_MIN,
  ZOOM_MAX,
  DEADZONE_MAX,
  INPUT_CURVE_MIN,
  INPUT_CURVE_MAX,
  SMOOTHING_MAX,
} from '../input/pipeline';
import { schedulePersist, loadPersisted } from './persistence';
import { clamp } from '../output/curves';

const STORAGE_KEY = 'nisps:input';

interface PersistedInput {
  zoom: number;
  zoomX: number | null;
  zoomY: number | null;
  anchorX: number;
  anchorY: number;
  anchorMode: AnchorMode;
  deadzone: number;
  inputCurve: number;
  inputCurveX: number | null;
  inputCurveY: number | null;
  smoothing: number;
  momentumZoom: MomentumZoomMode;
  velocityWindow: number;
  invertX: boolean;
  invertY: boolean;
}

function loadInputConfig(): InputConfig {
  const base = defaultInputConfig();
  const persisted = loadPersisted<Partial<PersistedInput>>(STORAGE_KEY, {});
  return { ...base, ...persisted };
}

const [config, setConfig] = createStore<InputConfig>(loadInputConfig());

// Live state — NOT persisted; reset on reload.
const [liveState, setLiveState] = createStore<InputState>(defaultInputState());

function persist(): void {
  schedulePersist(STORAGE_KEY, () => ({ ...config }));
}

export const inputStore = {
  config,
  liveState,

  setZoom(zoom: number): void {
    const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    setConfig(produce((c) => {
      const prev = c.zoom;
      c.zoom = z;
      // Auto-anchor mode: snap anchor to current smoothed pos when zoom changes
      if (c.anchorMode === 'auto' && prev !== z) {
        c.anchorX = liveState.smoothedX;
        c.anchorY = liveState.smoothedY;
      }
    }));
    persist();
  },

  setZoomPerAxis(zoomX: number | null, zoomY: number | null): void {
    setConfig(produce((c) => {
      c.zoomX = zoomX !== null ? clamp(zoomX, ZOOM_MIN, ZOOM_MAX) : null;
      c.zoomY = zoomY !== null ? clamp(zoomY, ZOOM_MIN, ZOOM_MAX) : null;
      if (c.anchorMode === 'auto') {
        c.anchorX = liveState.smoothedX;
        c.anchorY = liveState.smoothedY;
      }
    }));
    persist();
  },

  setAnchor(x: number, y: number): void {
    setConfig(produce((c) => {
      c.anchorX = clamp(x, 0, 1);
      c.anchorY = clamp(y, 0, 1);
    }));
    persist();
  },

  setAnchorMode(mode: AnchorMode): void {
    setConfig(produce((c) => {
      c.anchorMode = mode;
      if (mode === 'center') {
        c.anchorX = 0.5;
        c.anchorY = 0.5;
      } else if (mode === 'auto') {
        c.anchorX = liveState.smoothedX;
        c.anchorY = liveState.smoothedY;
      }
    }));
    persist();
  },

  setDeadzone(d: number): void {
    setConfig(produce((c) => {
      c.deadzone = clamp(d, 0, DEADZONE_MAX);
    }));
    persist();
  },

  setInputCurve(exp: number): void {
    setConfig(produce((c) => {
      c.inputCurve = clamp(exp, INPUT_CURVE_MIN, INPUT_CURVE_MAX);
    }));
    persist();
  },

  setInputCurvePerAxis(expX: number | null, expY: number | null): void {
    setConfig(produce((c) => {
      c.inputCurveX = expX !== null ? clamp(expX, INPUT_CURVE_MIN, INPUT_CURVE_MAX) : null;
      c.inputCurveY = expY !== null ? clamp(expY, INPUT_CURVE_MIN, INPUT_CURVE_MAX) : null;
    }));
    persist();
  },

  setSmoothing(s: number): void {
    setConfig(produce((c) => {
      c.smoothing = clamp(s, 0, SMOOTHING_MAX);
    }));
    persist();
  },

  setMomentumZoom(mode: MomentumZoomMode): void {
    setConfig(produce((c) => {
      c.momentumZoom = mode;
    }));
    if (mode === 'off') {
      // Reset live momentum state
      setLiveState(produce((s) => {
        s.velocityHistory = [];
        s.momentumZoomMultiplier = 1;
      }));
    }
    persist();
  },

  setInvert(invertX: boolean, invertY: boolean): void {
    setConfig(produce((c) => {
      c.invertX = invertX;
      c.invertY = invertY;
    }));
    persist();
  },

  setVelocityWindow(ms: number): void {
    setConfig(produce((c) => {
      c.velocityWindow = clamp(ms, 50, 500);
    }));
    persist();
  },

  /** Update live state after running the pipeline. Not persisted. */
  __setLiveState(next: InputState): void {
    setLiveState(next);
  },

  reset(): void {
    setConfig(defaultInputConfig());
    setLiveState(defaultInputState());
    persist();
  },
};

export type InputStore = typeof inputStore;
