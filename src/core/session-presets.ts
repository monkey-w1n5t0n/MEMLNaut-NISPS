/**
 * Session Preset Manager — bundles control surface state + synth preset +
 * output pipeline config into a single loadable configuration.
 *
 * Ported from playground/js/ui/session-presets.js
 *
 * Presets are stored in localStorage under a dedicated key, separate from the
 * main app state.
 *
 * @module session-presets
 */

import type { ControlSurfaceState } from './control-surface';
import type { OutputPipelineConfigSerial } from './output-pipeline';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'nisps-session-presets';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The state captured by a session preset.
 * All fields are optional — a preset can capture only a subset of state.
 */
export interface SessionPresetState {
  /** Active control surface axes + overrides. */
  controlSurface?: ControlSurfaceState | null;
  /** Active synth preset ID (e.g. "beginner-1"). */
  synthPresetId?: string | null;
  /** Serializable output pipeline config. */
  outputPipeline?: Partial<OutputPipelineConfigSerial> | null;
}

/** A saved session preset with metadata. */
export interface SessionPreset extends SessionPresetState {
  name: string;
  timestamp: number;
}

/** Summary entry returned by list(). */
export interface SessionPresetSummary {
  name: string;
  timestamp: number;
}

// ─── URL encoding helpers ─────────────────────────────────────────────────────

/**
 * Encode compact session state into URL search params.
 * Only encodes the most important state for sharing:
 *   - `sp`  = synthPresetId
 *   - `cs`  = boldness,memory,precision (comma-separated, 2dp each)
 *   - `op`  = non-default output pipeline values (gc=, sm=, sl= key=value pairs)
 *   - `co`  = control surface offsets (up to 10, key:value pairs)
 */
export function encodeToURL(preset: SessionPresetState): string {
  const params = new URLSearchParams();

  // Synth preset
  if (preset.synthPresetId) {
    params.set('sp', preset.synthPresetId);
  }

  // Compound axes (3 values, comma-separated)
  const axes = preset.controlSurface?.axes;
  if (axes) {
    params.set('cs', [
      (axes.boldness  ?? 0.5).toFixed(2),
      (axes.memory    ?? 0.5).toFixed(2),
      (axes.precision ?? 0.3).toFixed(2),
    ].join(','));
  }

  // Output pipeline (only non-default values)
  const op = preset.outputPipeline;
  if (op) {
    const parts: string[] = [];
    if (op.globalCurve != null && op.globalCurve !== 1.0)
      parts.push(`gc=${op.globalCurve.toFixed(2)}`);
    if (op.smoothing != null && op.smoothing !== 0)
      parts.push(`sm=${op.smoothing.toFixed(2)}`);
    if (op.slewRate != null && op.slewRate !== 1.0)
      parts.push(`sl=${op.slewRate.toFixed(3)}`);
    if (parts.length > 0) params.set('op', parts.join(','));
  }

  // Control surface overrides (compact: name:value pairs, up to 10)
  const offsets = preset.controlSurface?.offsets;
  if (offsets) {
    const keys = Object.keys(offsets);
    if (keys.length > 0 && keys.length <= 10) {
      const pairs = keys.slice(0, 10).map(k => {
        const v = offsets[k];
        return `${k}:${typeof v === 'number' ? v.toFixed(3) : v}`;
      });
      params.set('co', pairs.join(','));
    }
  }

  return params.toString();
}

/**
 * Decode session state from URL search params.
 * Returns a partial preset object.
 */
export function decodeFromURL(urlParams: URLSearchParams): SessionPresetState {
  const preset: SessionPresetState = {};

  // Synth preset
  const sp = urlParams.get('sp');
  if (sp) preset.synthPresetId = sp;

  // Compound axes
  const cs = urlParams.get('cs');
  if (cs) {
    const parts = cs.split(',').map(Number);
    const [b, m, p] = parts;
    preset.controlSurface = {
      axes: {
        boldness:  isNaN(b) ? 0.5 : b,
        memory:    isNaN(m) ? 0.5 : m,
        precision: isNaN(p) ? 0.3 : p,
      },
      offsets: {},
    };
  }

  // Control surface overrides
  const co = urlParams.get('co');
  if (co && preset.controlSurface) {
    for (const pair of co.split(',')) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx > 0) {
        const key = pair.substring(0, colonIdx);
        const valStr = pair.substring(colonIdx + 1);
        const num = Number(valStr);
        preset.controlSurface.offsets[key] = isNaN(num) ? valStr : num;
      }
    }
  }

  // Output pipeline
  const op = urlParams.get('op');
  if (op) {
    const pipeline: Partial<OutputPipelineConfigSerial> = {};
    for (const part of op.split(',')) {
      const eqIdx = part.indexOf('=');
      if (eqIdx < 0) continue;
      const k = part.substring(0, eqIdx);
      const num = Number(part.substring(eqIdx + 1));
      if (!isNaN(num)) {
        if (k === 'gc') pipeline.globalCurve = num;
        else if (k === 'sm') pipeline.smoothing = num;
        else if (k === 'sl') pipeline.slewRate = num;
      }
    }
    preset.outputPipeline = pipeline;
  }

  return preset;
}

// ─── SessionPresetManager ─────────────────────────────────────────────────────

export class SessionPresetManager {
  private _presets: Record<string, SessionPreset>;

  constructor() {
    this._presets = this._loadFromStorage();
  }

  // ── CRUD operations ────────────────────────────────────────────────────────

  /**
   * Capture a snapshot of the provided state into a preset object (without saving).
   *
   * @param name  - User-facing name for this preset.
   * @param state - Current state to capture.
   */
  capture(name: string, state: SessionPresetState): SessionPreset {
    return {
      name,
      controlSurface:  state.controlSurface  ?? null,
      synthPresetId:   state.synthPresetId   ?? null,
      outputPipeline:  state.outputPipeline  ?? null,
      timestamp: Date.now(),
    };
  }

  /**
   * Save current state as a named session preset to localStorage.
   * Overwrites any existing preset with the same name.
   *
   * @returns The captured preset.
   */
  save(name: string, state: SessionPresetState): SessionPreset {
    const preset = this.capture(name, state);
    this._presets[name] = preset;
    this._saveToStorage();
    return preset;
  }

  /**
   * Load a named session preset.
   *
   * @returns The preset, or null if not found.
   */
  load(name: string): SessionPreset | null {
    return this._presets[name] ?? null;
  }

  /**
   * List all saved session presets, sorted newest-first.
   */
  list(): SessionPresetSummary[] {
    return Object.values(this._presets)
      .map(p => ({ name: p.name, timestamp: p.timestamp }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Delete a named session preset.
   *
   * @returns true if the preset existed and was deleted.
   */
  delete(name: string): boolean {
    if (name in this._presets) {
      delete this._presets[name];
      this._saveToStorage();
      return true;
    }
    return false;
  }

  // ── URL encoding ───────────────────────────────────────────────────────────

  /**
   * Encode a preset into URL search params for sharing.
   *
   * @returns URL search string (without leading `?`).
   */
  toURL(preset: SessionPresetState): string {
    return encodeToURL(preset);
  }

  /**
   * Decode a preset from URL search params.
   */
  fromURL(urlParams: URLSearchParams): SessionPresetState {
    return decodeFromURL(urlParams);
  }

  // ── JSON export / import ───────────────────────────────────────────────────

  /**
   * Export all saved presets as a JSON string.
   */
  exportJSON(): string {
    return JSON.stringify(Object.values(this._presets), null, 2);
  }

  /**
   * Import presets from a JSON string.
   * Imported presets are merged into the existing set (imported names win on conflict).
   *
   * @throws {Error} if the JSON is invalid or the structure is unrecognised.
   */
  importJSON(json: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('[SessionPresets] Invalid JSON');
    }

    if (!Array.isArray(parsed)) {
      throw new Error('[SessionPresets] Expected an array of presets');
    }

    for (const item of parsed) {
      if (
        typeof item === 'object' && item !== null &&
        typeof (item as Record<string, unknown>).name === 'string' &&
        typeof (item as Record<string, unknown>).timestamp === 'number'
      ) {
        const p = item as SessionPreset;
        this._presets[p.name] = p;
      }
    }
    this._saveToStorage();
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _loadFromStorage(): Record<string, SessionPreset> {
    try {
      if (typeof localStorage === 'undefined') return {};
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, SessionPreset>;
    } catch (e) {
      console.warn('[SessionPresets] Failed to load:', e);
      return {};
    }
  }

  private _saveToStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._presets));
    } catch (e) {
      console.warn('[SessionPresets] Failed to save:', e);
    }
  }
}

/**
 * Singleton factory — call once per app, share the returned instance.
 */
export function createSessionPresetManager(): SessionPresetManager {
  return new SessionPresetManager();
}
