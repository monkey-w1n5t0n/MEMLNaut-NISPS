/**
 * faust-param-meta.ts — Faust JSON descriptor → playground paramMeta converter
 *
 * Faust's -json flag (or the JSON embedded in faust2wasm glue) emits a UI
 * descriptor tree.  This module parses that tree into the standard paramMeta
 * format used throughout the playground:
 *
 *   [{id, name, min, max, init, curve, group}]
 *
 * Usage:
 *   import { faustJsonToParamMeta } from './faust-param-meta.js';
 *   const resp = await fetch('faust/additive.json');
 *   const faustJson = await resp.json();
 *   const paramMeta = faustJsonToParamMeta(faustJson);
 *
 * The returned array is ready to pass to SynthEngine._paramMeta.
 */

import type { ParamMeta } from './engine-interface.js';

// ---------------------------------------------------------------------------
// Faust JSON descriptor shape
// ---------------------------------------------------------------------------

interface FaustMetaEntry {
  hidden?: string | number;
  [key: string]: string | number | undefined;
}

interface FaustUiItem {
  type: string;
  label?: string;
  address?: string;
  min?: number;
  max?: number;
  init?: number;
  step?: number;
  meta?: FaustMetaEntry[];
  items?: FaustUiItem[];
}

interface FaustJson {
  name?: string;
  ui?: FaustUiItem[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Faust address path (e.g. "/additive/freq") to a clean id string.
 * Strips the leading slash + top-level DSP name segment, replaces remaining
 * slashes and spaces with underscores, lower-cases.
 *
 * Examples:
 *   "/additive/freq"           → "freq"
 *   "/fm-matrix/Osc/ratio"    → "osc_ratio"
 *   "/MyDSP/Effects/wet mix"  → "effects_wet_mix"
 */
export function faustParamAddress(address: string): string {
  if (!address) return '';
  // Remove leading slash
  let s = address.replace(/^\//, '');
  // Drop the first path segment (top-level DSP class name)
  const slashIdx = s.indexOf('/');
  if (slashIdx !== -1) s = s.slice(slashIdx + 1);
  // Normalise: lowercase, spaces → underscores, slashes → underscores
  return s.toLowerCase().replace(/[\s/]+/g, '_');
}

/**
 * Types of Faust UI items that represent continuous parameters.
 * Buttons and checkboxes are intentionally excluded — they are not suitable
 * for ML-driven continuous control.
 */
const CONTINUOUS_TYPES = new Set(['hslider', 'vslider', 'nentry']);

interface CollectedItem {
  item: FaustUiItem;
  group: string;
}

/**
 * Recursively walk a Faust UI tree and collect leaf parameter items.
 *
 * The Faust UI tree looks like:
 * [
 *   {
 *     type: "vgroup",
 *     label: "Oscillator",
 *     items: [
 *       { type: "hslider", label: "freq", address: "/MyDSP/Oscillator/freq",
 *         min: 20, max: 4000, init: 220, step: 0.1, meta: [...] },
 *       ...
 *     ]
 *   },
 *   { type: "hslider", label: "amp", address: "/MyDSP/amp", ... }
 * ]
 */
export function parseFaustUiTree(
  items: FaustUiItem[],
  groupLabel = '',
  out: CollectedItem[] = [],
): CollectedItem[] {
  if (!Array.isArray(items)) return out;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    if (CONTINUOUS_TYPES.has(item.type)) {
      // Skip params marked [hidden:1] in Faust metadata — these are
      // control inputs (freq, vel) set by noteOn, not by NISPS.
      const isHidden =
        Array.isArray(item.meta) &&
        item.meta.some((m) => m.hidden === '1' || m.hidden === 1);
      if (isHidden) continue;
      // Leaf param — collect it, tagged with the nearest enclosing group
      out.push({ item, group: groupLabel });
    } else if (item.items) {
      // Container node (vgroup, hgroup, tgroup) — recurse, propagating label
      const childGroup = item.label || groupLabel;
      parseFaustUiTree(item.items, childGroup, out);
    }
    // Buttons, checkboxes, bargraphs — ignored (non-continuous)
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a Faust JSON descriptor to a paramMeta array.
 *
 * @param faustJson  Parsed JSON from `faust -json` or embedded in WASM glue.
 *                   Expected shape: { name, ui: [...], ...meta }
 *
 * Each element:
 *   id     — slug derived from the Faust address (unique within this engine)
 *   name   — human-readable label (the Faust hslider label, possibly with metadata stripped)
 *   min    — minimum value (raw Faust units)
 *   max    — maximum value (raw Faust units)
 *   init   — default value
 *   curve  — 0.5 (linear default; override per-engine if needed)
 *   group  — nearest enclosing group label (empty string for top-level params)
 */
export function faustJsonToParamMeta(faustJson: FaustJson): ParamMeta[] {
  if (!faustJson || !Array.isArray(faustJson.ui)) {
    console.warn('[faustJsonToParamMeta] Invalid or empty Faust JSON — no ui array found');
    return [];
  }

  const collected = parseFaustUiTree(faustJson.ui);

  return collected.map(({ item, group }) => {
    // Strip Faust metadata annotations from label: "freq[unit:Hz]" → "freq"
    const cleanLabel = (item.label ?? '').replace(/\[.*?\]/g, '').trim();

    return {
      id:    faustParamAddress(item.address ?? ''),
      name:  cleanLabel,
      min:   typeof item.min  === 'number' ? item.min  : 0,
      max:   typeof item.max  === 'number' ? item.max  : 1,
      init:  typeof item.init === 'number' ? item.init : 0,
      curve: 0.5,   // linear — override per-engine if needed
      group: group || '',
    };
  });
}

/**
 * Convenience: fetch a Faust JSON file by URL and return paramMeta.
 *
 * @param jsonUrl  URL of the .json descriptor (e.g. 'faust/additive.json')
 */
export async function loadFaustParamMeta(jsonUrl: string): Promise<ParamMeta[]> {
  const resp = await fetch(jsonUrl);
  if (!resp.ok) {
    throw new Error(`[faustJsonToParamMeta] Failed to fetch ${jsonUrl}: ${resp.status}`);
  }
  const json = (await resp.json()) as FaustJson;
  return faustJsonToParamMeta(json);
}
