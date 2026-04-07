/**
 * Session Store — persistence, state restoration, and URL parameter parsing.
 *
 * Responsibilities:
 *   - Parse URL parameters on creation (?spread, ?tame, ?preset)
 *   - Save/load app state to/from localStorage
 *   - Auto-save on a configurable interval
 *   - Detect vanilla (pre-SolidJS) app data for migration detection
 *
 * Design notes:
 *   - Does NOT import ml-store — uses a minimal MLStore interface to avoid
 *     circular dependencies.
 *   - No SolidJS reactivity needed here — pure imperative logic.
 *   - Version field guards against deserializing incompatible state shapes.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'nisps-a-immersive';
export const CURRENT_VERSION = 1;
const DEFAULT_AUTO_SAVE_MS = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Shape of the data written to localStorage.
 * `version` is used to detect vanilla app data (missing version field)
 * and to guard against incompatible future state shapes.
 */
export interface PersistedState {
  weights: number[];
  inputState: number[];
  outputState: number[];
  exampleCount: number;
  lossHistory: number[];
  outputMode: string;
  spreadLevel: number;
  noiseLevel: number;
  presetId: string | null;
  /** Control surface axis positions, present when implemented */
  controlSurface?: { boldness: number; memory: number; precision: number };
  /** Schema version. Missing = vanilla app data. */
  version: number;
}

/**
 * Parsed URL parameters. Set once at construction time; immutable thereafter.
 */
export interface UrlParams {
  /** Initial spread level [0, 1]. Default: 0.6 */
  spread: number;
  /** Synth output range constraint factor [0, 1]. Default: 1 */
  tame: number;
  /** Preset id to auto-load on first visit. Null if not specified. */
  preset: string | null;
}

/**
 * Minimal MLStore surface the session store needs.
 * Defined here to avoid importing ml-store and creating circular deps.
 */
export interface MinimalMLStore {
  getWeights(): number[];
  getExampleCount(): number;
  getLoss(): number | null;
  getLossHistory(): number[];
  readonly state: {
    outputMode: string;
    spreadLevel: number;
  };
  readonly noiseLevel: () => number;
  readonly outputs: () => Float32Array;
}

/** Full SessionStore interface exposed to callers. */
export interface SessionStore {
  /** Parsed URL params — read-only, set at init time. */
  readonly urlParams: Readonly<UrlParams>;

  /**
   * Serialize current ML state to localStorage.
   * The `presetId` field is optional — pass null if no synth preset is active.
   */
  save(mlStore: MinimalMLStore, presetId?: string | null): void;

  /**
   * Load and parse persisted state from localStorage.
   * Returns null if nothing is stored, JSON is invalid, or the data is
   * from an unrecognised version.
   */
  load(): PersistedState | null;

  /** Remove the saved state from localStorage. */
  clear(): void;

  /**
   * Start the auto-save interval. Call on component mount.
   * Returns a cleanup function — call it on unmount or when you want to stop.
   *
   * @param mlStore - ML store to read state from.
   * @param presetId - Reactive accessor for the current synth preset id (or null).
   * @param intervalMs - Save interval in milliseconds. Default: 10 000.
   */
  startAutoSave(
    mlStore: MinimalMLStore,
    presetId?: (() => string | null) | string | null,
    intervalMs?: number,
  ): () => void;

  /**
   * Return true if localStorage contains data written by the vanilla (non-SolidJS)
   * app — i.e. data under the same key but with no `version` field.
   */
  hasVanillaAppData(): boolean;
}

// ─── URL parameter parsing ────────────────────────────────────────────────────

/**
 * Parse a single numeric URL parameter, clamping to [min, max].
 * Returns `defaultValue` when the parameter is absent or not finite.
 */
function parseNumericParam(
  params: URLSearchParams,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const raw = params.get(name);
  if (raw === null) return defaultValue;
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return defaultValue;
  return Math.max(min, Math.min(max, value));
}

function parseUrlParams(): UrlParams {
  // Guard for non-browser environments (e.g. SSR / tests without jsdom)
  if (typeof window === 'undefined' || typeof URLSearchParams === 'undefined') {
    return { spread: 0.6, tame: 1, preset: null };
  }

  const params = new URLSearchParams(window.location.search);

  const spread = parseNumericParam(params, 'spread', 0.6, 0, 1);
  const tame = parseNumericParam(params, 'tame', 1, 0, 1);

  const presetRaw = params.get('preset');
  const preset = presetRaw && presetRaw.trim().length > 0 ? presetRaw.trim() : null;

  return { spread, tame, preset };
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable (private browsing quota exceeded, etc.)
    return null;
  }
}

function writeRaw(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Quota exceeded or storage unavailable — fail silently.
    console.warn('[session-store] localStorage write failed (quota exceeded?)');
  }
}

function removeRaw(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/** Narrow-check that a value looks like a PersistedState with required fields. */
function isValidPersistedState(obj: unknown): obj is PersistedState {
  if (typeof obj !== 'object' || obj === null) return false;
  const s = obj as Record<string, unknown>;

  return (
    typeof s.version === 'number' &&
    Array.isArray(s.weights) &&
    Array.isArray(s.inputState) &&
    Array.isArray(s.outputState) &&
    typeof s.exampleCount === 'number' &&
    Array.isArray(s.lossHistory) &&
    typeof s.outputMode === 'string' &&
    typeof s.spreadLevel === 'number' &&
    typeof s.noiseLevel === 'number' &&
    (s.presetId === null || typeof s.presetId === 'string')
  );
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a session store.
 *
 * URL parameters are parsed eagerly at construction time. The returned store
 * object is plain (no SolidJS reactivity) — it is safe to create outside a
 * reactive root.
 *
 * @example
 * const session = createSessionStore();
 * const { spread, tame, preset } = session.urlParams;
 *
 * // On mount:
 * const stopAutoSave = session.startAutoSave(mlStore, () => synthStore.state.presetId);
 *
 * // On unmount:
 * stopAutoSave();
 */
export function createSessionStore(): SessionStore {
  const urlParams = parseUrlParams();

  const store: SessionStore = {
    urlParams,

    save(mlStore: MinimalMLStore, presetId: string | null = null): void {
      try {
        const outputs = mlStore.outputs();

        const data: PersistedState = {
          version: CURRENT_VERSION,
          weights: mlStore.getWeights(),
          // inputState / outputState are Float32Arrays on the IML side — slice
          // them into plain number arrays for JSON serialisation.
          inputState: Array.from(outputs.slice(0, 2)),   // proxy for raw inputs
          outputState: Array.from(outputs),
          exampleCount: mlStore.getExampleCount(),
          lossHistory: mlStore.getLossHistory(),
          outputMode: mlStore.state.outputMode,
          spreadLevel: mlStore.state.spreadLevel,
          noiseLevel: mlStore.noiseLevel(),
          presetId,
        };

        writeRaw(JSON.stringify(data));
      } catch (err) {
        console.error('[session-store] save() failed:', err);
      }
    },

    load(): PersistedState | null {
      const raw = readRaw();
      if (raw === null) return null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.warn('[session-store] load() — JSON parse error; discarding stored state');
        return null;
      }

      if (!isValidPersistedState(parsed)) {
        // Could be vanilla app data (no version field) or an unrecognised shape.
        console.warn('[session-store] load() — stored state failed validation; discarding');
        return null;
      }

      // Future: handle version migrations here (parsed.version < CURRENT_VERSION).
      if (parsed.version !== CURRENT_VERSION) {
        console.warn(
          `[session-store] load() — unknown version ${parsed.version}; expected ${CURRENT_VERSION}. Discarding.`
        );
        return null;
      }

      return parsed;
    },

    clear(): void {
      removeRaw();
    },

    startAutoSave(
      mlStore: MinimalMLStore,
      presetId: (() => string | null) | string | null = null,
      intervalMs: number = DEFAULT_AUTO_SAVE_MS,
    ): () => void {
      const id = setInterval(() => {
        const resolvedPresetId =
          typeof presetId === 'function' ? presetId() : (presetId ?? null);
        store.save(mlStore, resolvedPresetId);
      }, intervalMs);

      return () => clearInterval(id);
    },

    hasVanillaAppData(): boolean {
      const raw = readRaw();
      if (raw === null) return false;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return false;
      }

      if (typeof parsed !== 'object' || parsed === null) return false;

      // Vanilla app data uses the same key but has no `version` field.
      return !('version' in parsed);
    },
  };

  return store;
}
