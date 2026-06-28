/**
 * Named output presets (backends-spec §5). The per-backend output configuration
 * — the whole set of per-output specs (baseline + backend-specific) plus
 * backend-level settings — is saveable/restorable as NAMED presets, persisted
 * to localStorage and keyed PER BACKEND (a MIDI preset and an OSC preset live in
 * separate namespaces).
 *
 * A preset stores a slice of each output's MFParam (the editable output config)
 * + a free-form `settings` blob for backend-level fields (MIDI port/ccCount,
 * OSC bridge URL/sendRaw). Restoring applies the rows back to the live store.
 */
import type { MFParam } from '../console/model';
import type { BackendId } from '../dock/output-state';

/** The per-output config a preset captures (a slice of MFParam). */
export interface OutputPresetRow {
  name: string;
  status: MFParam['status'];
  muted?: boolean;
  armed?: boolean;
  min: number;
  max: number;
  curve: number;
  val: number;
  midi?: MFParam['midi'];
  osc?: MFParam['osc'];
  vcv?: MFParam['vcv'];
}

export interface OutputPreset {
  name: string;
  backend: BackendId;
  rows: OutputPresetRow[];
  /** Backend-level settings (MIDI: { outputId, ccCount }; OSC: { url, sendRaw }). */
  settings?: Record<string, unknown>;
  savedAt: number;
}

const KEY_PREFIX = 'manifold-output-presets';

function storageKey(backend: BackendId): string {
  return `${KEY_PREFIX}:${backend}`;
}

function read(backend: BackendId): OutputPreset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(backend));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutputPreset[]) : [];
  } catch {
    return [];
  }
}

function write(backend: BackendId, presets: OutputPreset[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(backend), JSON.stringify(presets));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

/** List preset names for a backend (most-recently-saved first). */
export function listPresets(backend: BackendId): OutputPreset[] {
  return read(backend).sort((a, b) => b.savedAt - a.savedAt);
}

/** Project the live params into preset rows. */
export function rowsFromParams(params: MFParam[]): OutputPresetRow[] {
  return params.map((p) => ({
    name: p.name,
    status: p.status,
    muted: p.muted,
    armed: p.armed,
    min: p.min,
    max: p.max,
    curve: p.curve,
    val: p.val,
    midi: p.midi,
    osc: p.osc,
    vcv: p.vcv,
  }));
}

/** Save (or overwrite by name) a preset for a backend. */
export function savePreset(
  backend: BackendId,
  name: string,
  params: MFParam[],
  settings?: Record<string, unknown>,
): OutputPreset {
  const trimmed = name.trim();
  const preset: OutputPreset = {
    name: trimmed,
    backend,
    rows: rowsFromParams(params),
    settings,
    savedAt: Date.now(),
  };
  const all = read(backend).filter((p) => p.name !== trimmed);
  all.push(preset);
  write(backend, all);
  return preset;
}

/** Look up a preset by name. */
export function getPreset(backend: BackendId, name: string): OutputPreset | null {
  return read(backend).find((p) => p.name === name) ?? null;
}

/** Delete a preset by name. */
export function deletePreset(backend: BackendId, name: string): void {
  write(
    backend,
    read(backend).filter((p) => p.name !== name),
  );
}

/** Rename a preset (no-op if the new name collides or the old is missing). */
export function renamePreset(backend: BackendId, from: string, to: string): boolean {
  const trimmed = to.trim();
  if (!trimmed) return false;
  const all = read(backend);
  if (all.some((p) => p.name === trimmed)) return false;
  const target = all.find((p) => p.name === from);
  if (!target) return false;
  target.name = trimmed;
  write(backend, all);
  return true;
}

/**
 * Apply a preset's rows back onto the live params, by INDEX (rows are
 * index-aligned with the output set). Returns a new MFParam[] (immutable update
 * for React state). Rows beyond the live param count are ignored; missing rows
 * leave that param untouched.
 */
export function applyPreset(params: MFParam[], preset: OutputPreset): MFParam[] {
  return params.map((p, i) => {
    const r = preset.rows[i];
    if (!r) return p;
    return {
      ...p,
      // name is preset-driven for MIDI/OSC where the user renames outputs;
      // keep the live name if the preset row didn't carry one.
      name: r.name ?? p.name,
      status: r.status ?? p.status,
      muted: r.muted ?? p.muted,
      armed: r.armed ?? p.armed,
      min: r.min ?? p.min,
      max: r.max ?? p.max,
      curve: r.curve ?? p.curve,
      val: r.val ?? p.val,
      midi: r.midi ?? p.midi,
      osc: r.osc ?? p.osc,
      vcv: r.vcv ?? p.vcv,
    };
  });
}
