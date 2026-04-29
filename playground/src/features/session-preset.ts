/**
 * Session preset — full app-state snapshot for save/load and URL sharing.
 *
 * A preset captures: control axes + offsets, exploration config, output
 * pipeline settings, input pipeline settings, mode override map, the
 * active mode id. ML weights are NOT included by default (large), but
 * `serializeWithWeights` is provided for power users.
 *
 * URL sharing uses a compact encoding:
 *   ?session=<base64url(JSON)>
 *   ?boldness=...&memory=...&precision=...
 * Either form rehydrates on next load.
 */

import { controlStore } from '../stores/control-store';
import { explorationStore } from '../stores/exploration-store';
import { modeStore } from '../stores/mode-store';
import { inputStore } from '../stores/input-store';
import { outputStore } from '../stores/output-store';
import { mlStore } from '../stores/ml-store';
import { sessionStore } from '../stores/session-store';

export interface SessionPresetPayload {
  v: 1;
  modeId: string | null;
  control: {
    boldness: number;
    memory: number;
    precision: number;
    presetId: string | null;
    offsets: typeof controlStore.state.offsets;
  };
  exploration: {
    spread: number;
    noiseFloor: number;
    noiseCap: number;
    noiseGrowth: number;
    noiseDecay: number;
    learningRate: number;
    weightDecay: number;
  };
  output: {
    globalCurve: number;
    smoothing: number;
    slewRate: number | null; // null encodes Infinity
    freezeOutput: boolean;
  };
  input: {
    zoom: number;
    anchorMode: 'auto' | 'sticky' | 'center';
    deadzone: number;
    inputCurve: number;
    smoothing: number;
    momentumZoom: 'off' | 'gentle' | 'strong';
    invertX: boolean;
    invertY: boolean;
  };
  modeOverrides: typeof modeStore.state.overrides;
  /** Base64-encoded weights, optional. */
  weights?: string;
}

function encode(s: string): string {
  // base64url encoding
  const b64 = btoa(s);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(s: string): string | null {
  try {
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    return atob(b64);
  } catch {
    return null;
  }
}

function f32ToBase64(arr: Float32Array): string {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return encode(s);
}

function base64ToF32(s: string): Float32Array | null {
  const raw = decode(s);
  if (!raw) return null;
  const u8 = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
  // Round to 4 bytes
  const len = u8.byteLength - (u8.byteLength % 4);
  return new Float32Array(u8.buffer, u8.byteOffset, len / 4).slice();
}

/**
 * Read every store and assemble a SessionPresetPayload. If
 * `withWeights = true`, also encodes the current MLP weight blob.
 */
export function captureSessionPreset(withWeights: boolean = false): SessionPresetPayload {
  const c = controlStore.state;
  const e = explorationStore.state;
  const o = outputStore.config;
  const i = inputStore.config;

  const payload: SessionPresetPayload = {
    v: 1,
    modeId: modeStore.state.activeModeId,
    control: {
      boldness: c.boldness,
      memory: c.memory,
      precision: c.precision,
      presetId: c.presetId,
      offsets: JSON.parse(JSON.stringify(c.offsets)),
    },
    exploration: {
      spread: e.spread,
      noiseFloor: e.noiseFloor,
      noiseCap: e.noiseCap,
      noiseGrowth: e.noiseGrowth,
      noiseDecay: e.noiseDecay,
      learningRate: e.learningRate,
      weightDecay: e.weightDecay,
    },
    output: {
      globalCurve: o.globalCurve,
      smoothing: o.smoothing,
      slewRate: isFinite(o.slewRate) ? o.slewRate : null,
      freezeOutput: o.freezeOutput,
    },
    input: {
      zoom: i.zoom,
      anchorMode: i.anchorMode,
      deadzone: i.deadzone,
      inputCurve: i.inputCurve,
      smoothing: i.smoothing,
      momentumZoom: i.momentumZoom,
      invertX: i.invertX,
      invertY: i.invertY,
    },
    modeOverrides: JSON.parse(JSON.stringify(modeStore.state.overrides)),
  };

  if (withWeights) {
    const w = mlStore.getWeights();
    if (w.length > 0) {
      payload.weights = f32ToBase64(w);
    }
  }
  return payload;
}

/**
 * Restore a SessionPresetPayload into all stores. Best-effort: missing
 * fields fall back to current values. Returns true if at least one store
 * was modified.
 */
export function restoreSessionPreset(payload: SessionPresetPayload): boolean {
  if (!payload || payload.v !== 1) return false;

  // Mode first (so override map is keyed correctly).
  if (payload.modeId && payload.modeId !== modeStore.state.activeModeId) {
    modeStore.switchMode(payload.modeId);
  }

  // Control axes & offsets.
  if (payload.control) {
    controlStore.setAxis('boldness', payload.control.boldness);
    controlStore.setAxis('memory', payload.control.memory);
    controlStore.setAxis('precision', payload.control.precision);
    if (payload.control.presetId) controlStore.applyPreset(payload.control.presetId);
    // Manually rewrite offsets — the store doesn't have a public bulk setter
    // (control-store doesn't expose it because it's a private field).
    // Use clearOffsets + setOffset roundtrip.
    for (const axis of ['boldness', 'memory', 'precision'] as const) {
      controlStore.clearOffsets(axis);
      const off = payload.control.offsets[axis] ?? {};
      for (const [k, v] of Object.entries(off)) {
        if (typeof v === 'number') controlStore.setOffset(axis, k, v);
      }
    }
  }

  if (payload.exploration) {
    explorationStore.setSpread(payload.exploration.spread);
    explorationStore.setNoiseFloor(payload.exploration.noiseFloor);
    explorationStore.setNoiseCap(payload.exploration.noiseCap);
    explorationStore.setNoiseGrowth(payload.exploration.noiseGrowth);
    explorationStore.setNoiseDecay(payload.exploration.noiseDecay);
    explorationStore.setLearningRate(payload.exploration.learningRate);
    explorationStore.setWeightDecay(payload.exploration.weightDecay);
  }

  if (payload.output) {
    outputStore.setGlobalCurve(payload.output.globalCurve);
    outputStore.setSmoothing(payload.output.smoothing);
    outputStore.setSlewRate(payload.output.slewRate ?? Infinity);
    outputStore.setFreezeOutput(payload.output.freezeOutput);
  }

  if (payload.input) {
    inputStore.setZoom(payload.input.zoom);
    inputStore.setAnchorMode(payload.input.anchorMode);
    inputStore.setDeadzone(payload.input.deadzone);
    inputStore.setInputCurve(payload.input.inputCurve);
    inputStore.setSmoothing(payload.input.smoothing);
    inputStore.setMomentumZoom(payload.input.momentumZoom);
    inputStore.setInvert(payload.input.invertX, payload.input.invertY);
  }

  if (payload.modeOverrides) {
    for (const modeId of Object.keys(payload.modeOverrides)) {
      const map = payload.modeOverrides[modeId] ?? {};
      modeStore.clearAllOverrides(modeId);
      for (const [name, ov] of Object.entries(map)) {
        modeStore.setOverride(modeId, name, ov);
      }
    }
  }

  if (payload.weights) {
    const w = base64ToF32(payload.weights);
    if (w && mlStore.iml && w.length > 0) {
      try { mlStore.setWeights(w); } catch { /* ignore size mismatch */ }
    }
  }

  return true;
}

/** Save preset to sessionStore (named blob in localStorage). */
export function saveNamedPreset(name: string, withWeights: boolean = false): void {
  const payload = captureSessionPreset(withWeights);
  sessionStore.savePreset(name, payload);
}

/** Load a named preset by id from sessionStore. */
export function loadNamedPreset(id: string): boolean {
  const preset = sessionStore.state.presets.find((p) => p.id === id);
  if (!preset) return false;
  return restoreSessionPreset(preset.payload as SessionPresetPayload);
}

// ---------------------------------------------------------------------------
// URL sharing
// ---------------------------------------------------------------------------

/** Build a query-string fragment from current state (without weights). */
export function buildShareUrl(): string {
  const payload = captureSessionPreset(false);
  const json = JSON.stringify(payload);
  const enc = encode(json);
  return `?session=${enc}`;
}

/** Parse `window.location.search` and apply a session if present. */
export function applyUrlParams(search: string = window.location.search): boolean {
  const sp = new URLSearchParams(search);
  // Compact ?boldness=...&memory=... form.
  const cb = sp.get('boldness');
  const cm = sp.get('memory');
  const cp = sp.get('precision');
  let applied = false;
  if (cb !== null || cm !== null || cp !== null) {
    if (cb !== null) controlStore.setAxis('boldness', clamp01(parseFloat(cb)));
    if (cm !== null) controlStore.setAxis('memory', clamp01(parseFloat(cm)));
    if (cp !== null) controlStore.setAxis('precision', clamp01(parseFloat(cp)));
    applied = true;
  }
  const sess = sp.get('session');
  if (sess) {
    const json = decode(sess);
    if (json) {
      try {
        const payload = JSON.parse(json) as SessionPresetPayload;
        applied = restoreSessionPreset(payload) || applied;
      } catch {
        // Ignore malformed
      }
    }
  }
  return applied;
}

function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
