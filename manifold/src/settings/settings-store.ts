/**
 * Settings store — framework-neutral, persisted to localStorage, with a thin
 * React hook (`useSettings`) for the Settings drawer + any consumer.
 *
 * Operator-requested (dock restructure batch):
 *  - iconStyle: monochrome on/off + the UNFOCUSED icon colour. Focused/active
 *    icons are ALWAYS accent orange; this only governs the resting colour.
 *  - inputMap: the 2D input-surface shape. 'follow-mode' (default) uses the
 *    active mode's declared input (joystick → circular, else rectangular);
 *    'rectangular' / 'circular' are explicit global overrides.
 *  - xavierSpreadEnabled: compatibility feature flag for the old centred
 *    Xavier/spread randomisation regime. Off by default, so Manifold initial
 *    weights and re-rolls use the full uniform range.
 *
 * British spelling in copy. No React inside the store itself — the hook is a
 * separate, additive binding so a headless consumer (debug probe / test) can
 * read + mutate settings without a render tree.
 */
import { useSyncExternalStore } from 'react';

/** Resting (unfocused) icon colour choice. Focused is always --accent. */
export type UnfocusedIconColour = 'off-white' | 'white' | 'orange';

/** The 2D input-surface shape override. */
export type InputMapMode = 'follow-mode' | 'rectangular' | 'circular';

export interface Settings {
  /** Monochrome inline-SVG icons (true) vs the prior colour-emoji glyphs. */
  monochromeIcons: boolean;
  /** Resting colour for unfocused monochrome icons. */
  unfocusedIconColour: UnfocusedIconColour;
  /** Input-surface shape: follow the mode, or force rectangular / circular. */
  inputMap: InputMapMode;
  /**
   * Control corner radius in px (buttons, control rows, dock icons, panels).
   * Operator prefers crisp, low-rounding chrome; default 2. Applied by
   * overriding the `--r-1` / `--r-2` tokens on :root. Pills + the circular
   * verdict buttons are intentionally exempt (separate tokens).
   */
  cornerRadius: number;
  /**
   * Restore the legacy Xavier/spread randomisation regime and expose its
   * Learning-drawer control. Off means full-range uniform randomisation.
   */
  xavierSpreadEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  monochromeIcons: true,
  unfocusedIconColour: 'off-white',
  inputMap: 'follow-mode',
  cornerRadius: 2,
  xavierSpreadEnabled: false,
};

const STORAGE_KEY = 'mf-settings';

/** Apply settings that map onto global CSS custom properties (radius tokens).
 *  Guarded for non-DOM contexts (tests / SSR). */
export function applyRootVars(settings: Settings): void {
  if (typeof document === 'undefined') return;
  const r = Math.max(0, settings.cornerRadius);
  const root = document.documentElement.style;
  root.setProperty('--r-1', `${r}px`);
  root.setProperty('--r-2', `${Math.max(r, r + 2)}px`);
}

/** Resolve the unfocused icon colour choice to a concrete CSS colour. */
export function unfocusedIconCss(choice: UnfocusedIconColour): string {
  switch (choice) {
    case 'white':
      return '#ffffff';
    case 'orange':
      return 'var(--accent)';
    case 'off-white':
    default:
      return '#e8e8e8';
  }
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

class SettingsStore {
  private state: Settings = load();
  private listeners = new Set<() => void>();

  get(): Settings {
    return this.state;
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.state[key] === value) return;
    this.state = { ...this.state, [key]: value };
    this.persist();
    this.emit();
  }

  patch(patch: Partial<Settings>): void {
    this.state = { ...this.state, ...patch };
    this.persist();
    this.emit();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  }

  private emit(): void {
    applyRootVars(this.state);
    for (const l of this.listeners) l();
  }
}

/** The single shared instance (framework-neutral). */
export const settingsStore = new SettingsStore();
// Apply CSS-var-backed settings (corner radius) at module load.
applyRootVars(settingsStore.get());

/** React hook: re-renders on any settings change, returns store + setters. */
export function useSettings(): {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
} {
  const settings = useSyncExternalStore(
    settingsStore.subscribe,
    () => settingsStore.get(),
    () => settingsStore.get(),
  );
  return { settings, set: (key, value) => settingsStore.set(key, value) };
}

/**
 * Resolve the effective input-map shape given the active mode's declared input.
 * 'follow-mode' → 'circular' when the mode declares a joystick, else
 * 'rectangular'; explicit overrides win.
 */
export function resolveInputMap(
  inputMap: InputMapMode,
  modeInput: 'xy' | 'joystick' | 'audio_in',
): 'rectangular' | 'circular' {
  if (inputMap === 'rectangular') return 'rectangular';
  if (inputMap === 'circular') return 'circular';
  return modeInput === 'joystick' ? 'circular' : 'rectangular';
}
