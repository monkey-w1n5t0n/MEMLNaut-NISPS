/**
 * modular-param-meta.js — hand-curated metadata table for the Modular engine
 * (currently targeting modular-subtractive.dsp; the shared MM_ADSR / MM_LFO /
 * MM_Matrix structure applies to all three modular engines).
 *
 * Purpose: lets the modular engine participate in the normalised [0,1] preset
 * model. Presets store `{min,max}` in [0,1] units; this table supplies the
 * unit, raw DSP range (from the Faust JSON), a hand-curated "safe" range that
 * we expose to the MLP, and a human-friendly group/name.
 *
 * Label format: matches `_walkEntries[i].label` produced by modular-engine.js
 * — i.e. `GROUP/SUFFIX`, slash-separated, e.g. `3_Filter/00_cutoff`,
 *   `MM_ADSR/00_adsr01_attack`, `MM_Matrix/s00_d00_pitch`.
 *
 * Schema:
 *   unit:         'hz' | 's' | 'semitones' | 'db' | 'ratio' | 'norm'
 *   rawMin,rawMax: absolute DSP range from Faust JSON
 *   safeMin,safeMax: hand-curated safe sub-range (what the MLP actually sees)
 *   defaultCurve: [0,1], 0.5 = linear, <0.5 bias low, >0.5 bias high
 *   humanName:    display label
 *   group:        UI group, e.g. 'Oscillator 1', 'Filter', 'ADSR 1', 'LFO 1',
 *                 'Matrix', 'Master', 'Mixer'
 *
 * Matrix cell entries (480 of them, sNN_dNN) share a single profile; callers
 * that need per-cell semantic grouping (which ADSR/LFO drives which
 * destination) should derive it from the label (see `parseMatrixLabel`). This
 * is deliberate — per-cell human names would explode the table, and meml-gqiv
 * will formalise matrix cell metadata further.
 */

// ---------------------------------------------------------------------------
// Destination table — from faust/MODULAR_DESTINATIONS.md (subtractive engine)
// Index d00..d09 with {name, unit, semanticHint}. Used to label matrix cells
// and decide a sensible per-dest curve if the caller wants that later.
// ---------------------------------------------------------------------------

/** Per-engine destination name maps (currently only subtractive is wired). */
const MATRIX_DESTS_SUBTRACTIVE = [
  'pitch', 'osc2_detune', 'osc3_detune', 'osc_mix_bal', 'noise_level',
  'cutoff', 'resonance', 'filter_env_amt', 'amp', 'pan',
];

/**
 * Parse a matrix label into its (source, destination, destName) parts.
 * @param {string} label  e.g. 'MM_Matrix/s00_d05_cutoff'
 * @returns {null | {src:number, dst:number, destName:string}}
 */
export function parseMatrixLabel(label) {
  const m = /^MM_Matrix\/s(\d+)_d(\d+)_(.+)$/.exec(label || '');
  if (!m) return null;
  return { src: +m[1], dst: +m[2], destName: m[3] };
}

// ---------------------------------------------------------------------------
// Table construction helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Build a single entry. */
function entry(unit, rawMin, rawMax, safeMin, safeMax, curve, humanName, group) {
  return {
    unit,
    rawMin, rawMax,
    safeMin: clamp(safeMin, rawMin, rawMax),
    safeMax: clamp(safeMax, rawMin, rawMax),
    defaultCurve: curve,
    humanName,
    group,
  };
}

// ---------------------------------------------------------------------------
// Static (non-matrix) params — oscillators, mixer, filter, master
// ---------------------------------------------------------------------------

const STATIC_META = {
  // Oscillator 1
  '1_Oscillators/00_osc1_wave':     entry('norm', 0, 1, 0, 1, 0.5, 'Osc 1 Wave', 'Oscillator 1'),
  '1_Oscillators/01_osc1_range':    entry('semitones', -2, 2, -2, 2, 0.5, 'Osc 1 Range', 'Oscillator 1'),
  '1_Oscillators/02_osc1_level':    entry('norm', 0, 1, 0, 1, 0.5, 'Osc 1 Level', 'Oscillator 1'),

  // Oscillator 2
  '1_Oscillators/03_osc2_wave':     entry('norm', 0, 1, 0, 1, 0.5, 'Osc 2 Wave', 'Oscillator 2'),
  '1_Oscillators/04_osc2_range':    entry('semitones', -2, 2, -2, 2, 0.5, 'Osc 2 Range', 'Oscillator 2'),
  '1_Oscillators/05_osc2_detune':   entry('semitones', -50, 50, -24, 24, 0.5, 'Osc 2 Detune', 'Oscillator 2'),
  '1_Oscillators/06_osc2_level':    entry('norm', 0, 1, 0, 1, 0.5, 'Osc 2 Level', 'Oscillator 2'),

  // Oscillator 3
  '1_Oscillators/07_osc3_wave':     entry('norm', 0, 1, 0, 1, 0.5, 'Osc 3 Wave', 'Oscillator 3'),
  '1_Oscillators/08_osc3_range':    entry('semitones', -2, 2, -2, 2, 0.5, 'Osc 3 Range', 'Oscillator 3'),
  '1_Oscillators/09_osc3_detune':   entry('semitones', -50, 50, -24, 24, 0.5, 'Osc 3 Detune', 'Oscillator 3'),
  '1_Oscillators/10_osc3_level':    entry('norm', 0, 1, 0, 1, 0.5, 'Osc 3 Level', 'Oscillator 3'),
  '1_Oscillators/11_osc3_kb_track': entry('norm', 0, 1, 0, 1, 0.5, 'Osc 3 KB Track', 'Oscillator 3'),

  // Mixer
  '2_Mixer/00_noise_type':          entry('norm', 0, 1, 0, 1, 0.5, 'Noise Type', 'Mixer'),
  '2_Mixer/01_noise_level':         entry('norm', 0, 1, 0, 0.5, 0.4, 'Noise Level', 'Mixer'),
  '2_Mixer/02_mixer_drive':         entry('ratio', 0.5, 4, 0.7, 2.0, 0.4, 'Mixer Drive', 'Mixer'),

  // Filter
  '3_Filter/00_cutoff':             entry('hz', 20, 20000, 60, 18000, 0.7, 'Filter Cutoff', 'Filter'),
  '3_Filter/01_resonance':          entry('norm', 0, 1, 0, 0.9, 0.5, 'Filter Resonance', 'Filter'),
  '3_Filter/02_filter_kb_track':    entry('norm', 0, 1, 0, 1, 0.5, 'Filter KB Track', 'Filter'),

  // Master
  '4_Master/00_master_level':       entry('norm', 0, 1, 0, 0.85, 0.5, 'Master Level', 'Master'),
  '4_Master/01_master_glide':       entry('s', 0, 2, 0, 1.0, 0.4, 'Master Glide', 'Master'),
  '4_Master/02_master_tune':        entry('semitones', -50, 50, -12, 12, 0.5, 'Master Tune', 'Master'),
  '4_Master/03_master_pan':         entry('norm', -1, 1, -1, 1, 0.5, 'Master Pan', 'Master'),
  '4_Master/04_base_amp':           entry('norm', 0, 1, 0, 1, 0.5, 'Base Amp', 'Master'),
};

// ---------------------------------------------------------------------------
// Auto-generated: ADSR 1..16, LFO 1..32, Matrix 48×10
// ---------------------------------------------------------------------------

function pad2(n) { return String(n).padStart(2, '0'); }

function buildADSREntries() {
  const out = {};
  for (let slot = 1; slot <= 16; slot++) {
    const nn = pad2(slot - 1);
    const mm = pad2(slot);
    const grp = `ADSR ${slot}`;
    const prefix = `MM_ADSR/${nn}_adsr${mm}_`;
    // attack: raw 0.001..5 s, safe 0.001..3, curve 0.3 (log-ish bias low)
    out[prefix + 'attack']  = entry('s', 0.001, 5, 0.001, 3.0, 0.3, `A${slot} Attack`, grp);
    // decay: raw 0.001..10 s
    out[prefix + 'decay']   = entry('s', 0.001, 10, 0.001, 5.0, 0.3, `A${slot} Decay`, grp);
    // sustain: 0..1 norm
    out[prefix + 'sustain'] = entry('norm', 0, 1, 0, 1, 0.5, `A${slot} Sustain`, grp);
    // release: raw 0.01..10 s
    out[prefix + 'release'] = entry('s', 0.01, 10, 0.01, 5.0, 0.3, `A${slot} Release`, grp);
    // enable: discrete 0/1 — treated as norm with very narrow safe range
    out[prefix + 'enable']  = entry('norm', 0, 1, 0, 1, 0.5, `A${slot} Enable`, grp);
  }
  return out;
}

function buildLFOEntries() {
  const out = {};
  for (let slot = 1; slot <= 32; slot++) {
    const nn = pad2(slot - 1);
    const mm = pad2(slot);
    const grp = `LFO ${slot}`;
    const prefix = `MM_LFO/${nn}_lfo${mm}_`;
    out[prefix + 'rate']    = entry('hz', 0.01, 20, 0.05, 15, 0.4, `L${slot} Rate`, grp);
    out[prefix + 'morph']   = entry('norm', 0, 1, 0, 1, 0.5, `L${slot} Shape`, grp);
    out[prefix + 'enable']  = entry('norm', 0, 1, 0, 1, 0.5, `L${slot} Enable`, grp);
  }
  return out;
}

function buildMatrixEntries() {
  const out = {};
  for (let s = 0; s < 48; s++) {
    const srcIsADSR = s < 16;
    const srcLabel = srcIsADSR
      ? `A${s + 1}`
      : `L${s - 15}`;
    for (let d = 0; d < 10; d++) {
      const destName = MATRIX_DESTS_SUBTRACTIVE[d];
      const label = `MM_Matrix/s${pad2(s)}_d${pad2(d)}_${destName}`;
      // Amount is bipolar [-1,+1], default 0. Narrow safe range a touch to
      // avoid full-throw modulations dominating the sound on first contact.
      out[label] = entry(
        'norm', -1, 1, -0.9, 0.9, 0.5,
        `${srcLabel} → ${destName}`,
        'Matrix',
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public table
// ---------------------------------------------------------------------------

export const MODULAR_PARAM_META = {
  ...STATIC_META,
  ...buildADSREntries(),
  ...buildLFOEntries(),
  ...buildMatrixEntries(),
};

/** Fallback profile for unknown labels. */
const FALLBACK_META = entry('norm', 0, 1, 0, 1, 0.5, '(unknown)', 'Unknown');

/**
 * Get metadata for a label. Returns a safe fallback (linear [0,1] norm) for
 * unknown labels so callers never crash on a stale preset.
 *
 * @param {string} label
 * @returns {typeof FALLBACK_META}
 */
export function getMeta(label) {
  return MODULAR_PARAM_META[label] || FALLBACK_META;
}

/**
 * Apply a symmetric power-curve warp. curve=0.5 → linear, <0.5 → bias low,
 * >0.5 → bias high. Maps [0,1] → [0,1].
 */
function applyCurve(t, curve) {
  if (curve === 0.5) return t;
  // Convert 0..1 curve to exponent: 0.5→1, 0→~4 (bias low), 1→~0.25 (bias high)
  const exp = Math.pow(4, 1 - 2 * curve);
  return Math.pow(clamp(t, 0, 1), exp);
}

function invertCurve(y, curve) {
  if (curve === 0.5) return y;
  const exp = Math.pow(4, 1 - 2 * curve);
  return Math.pow(clamp(y, 0, 1), 1 / exp);
}

/**
 * Convert a normalised [0,1] value to a raw DSP value using the label's safe
 * range and default curve. Unknown labels pass through as plain [0,1].
 *
 * @param {string} label
 * @param {number} normValue  in [0,1]
 * @returns {number}          raw DSP value
 */
export function normToRaw(label, normValue) {
  const m = getMeta(label);
  const t = applyCurve(clamp(normValue, 0, 1), m.defaultCurve);
  return m.safeMin + t * (m.safeMax - m.safeMin);
}

/**
 * Convert a raw DSP value back to normalised [0,1] using the safe range and
 * curve. Values outside [safeMin,safeMax] clamp.
 *
 * @param {string} label
 * @param {number} rawValue
 * @returns {number}  in [0,1]
 */
export function rawToNorm(label, rawValue) {
  const m = getMeta(label);
  if (m.safeMax === m.safeMin) return 0;
  const t = clamp((rawValue - m.safeMin) / (m.safeMax - m.safeMin), 0, 1);
  return invertCurve(t, m.defaultCurve);
}

/** Total number of entries (handy for sanity checks). */
export const MODULAR_PARAM_COUNT = Object.keys(MODULAR_PARAM_META).length;
