/**
 * Powerful Synth Engine — curated parameter map (126 continuous parameters).
 *
 * Ported mechanically from the old playground `js/synth/param-map.js`. `id` is
 * the engine's hardware parameter id (the id written to the ring buffer);
 * `defaultValue` is the engine's normalised (0..1) default.
 *
 * safeMin/safeMax: when the tame level is > 0 the output range is interpolated
 * from [0,1] toward [safeMin,safeMax], preventing volume spikes, silence,
 * feedback runaway and effect build-up.
 */

export interface SynthParamEntry {
  /** Hardware parameter id (ring-buffer message id). */
  id: number;
  /** Stable machine name, e.g. 'Env_A_Att'. */
  name: string;
  /** Short display label. */
  label: string;
  /** Normalised (0..1) default. */
  defaultValue: number;
  bipolar: boolean;
  safeMin?: number;
  safeMax?: number;
}

export const SYNTH_PARAM_MAP: readonly SynthParamEntry[] = [
  // --- Envelope A (7) ---
  { id:   0, name: 'Env_A_Att',               label: 'EnvA Att',         defaultValue: 0,      bipolar: false },
  { id:   2, name: 'Env_A_Dec_1',             label: 'EnvA Dec1',        defaultValue: 0.59,   bipolar: false },
  { id:   4, name: 'Env_A_BP',                label: 'EnvA BP',          defaultValue: 0.5,    bipolar: false },
  { id:   6, name: 'Env_A_Dec_2',             label: 'EnvA Dec2',        defaultValue: 0.79,   bipolar: false, safeMax: 0.85 },
  { id:   8, name: 'Env_A_Sus',               label: 'EnvA Sus',         defaultValue: 0,      bipolar: false },
  { id:  10, name: 'Env_A_Rel',               label: 'EnvA Rel',         defaultValue: 0.53,   bipolar: false, safeMax: 0.7 },
  { id:  12, name: 'Env_A_Gain',              label: 'EnvA Gain',        defaultValue: 0,      bipolar: true,  safeMin: 0.2, safeMax: 0.8 },

  // --- Envelope B (7) ---
  { id:  19, name: 'Env_B_Att',               label: 'EnvB Att',         defaultValue: 0,      bipolar: false },
  { id:  21, name: 'Env_B_Dec_1',             label: 'EnvB Dec1',        defaultValue: 0.59,   bipolar: false },
  { id:  23, name: 'Env_B_BP',                label: 'EnvB BP',          defaultValue: 0.5,    bipolar: false },
  { id:  25, name: 'Env_B_Dec_2',             label: 'EnvB Dec2',        defaultValue: 0.79,   bipolar: false, safeMax: 0.85 },
  { id:  27, name: 'Env_B_Sus',               label: 'EnvB Sus',         defaultValue: 0,      bipolar: false },
  { id:  29, name: 'Env_B_Rel',               label: 'EnvB Rel',         defaultValue: 0.53,   bipolar: false, safeMax: 0.7 },
  { id:  31, name: 'Env_B_Gain',              label: 'EnvB Gain',        defaultValue: 0,      bipolar: true,  safeMin: 0.2, safeMax: 0.8 },

  // --- Envelope C (6) ---
  { id:  38, name: 'Env_C_Att',               label: 'EnvC Att',         defaultValue: 0,      bipolar: false },
  { id:  40, name: 'Env_C_Dec_1',             label: 'EnvC Dec1',        defaultValue: 0.59,   bipolar: false },
  { id:  42, name: 'Env_C_BP',                label: 'EnvC BP',          defaultValue: 0.5,    bipolar: true },
  { id:  44, name: 'Env_C_Dec_2',             label: 'EnvC Dec2',        defaultValue: 0.79,   bipolar: false, safeMax: 0.85 },
  { id:  46, name: 'Env_C_Rel',               label: 'EnvC Rel',         defaultValue: 0.53,   bipolar: false, safeMax: 0.7 },
  { id: 297, name: 'Env_C_Sus',               label: 'EnvC Sus',         defaultValue: 0,      bipolar: true },

  // --- Oscillator A (5) ---
  { id:  57, name: 'Osc_A_Fluct',             label: 'OscA Fluct',       defaultValue: 0,      bipolar: false, safeMax: 0.7 },
  { id:  60, name: 'Osc_A_PM_Self',           label: 'OscA PM-Self',     defaultValue: 0,      bipolar: true,  safeMin: 0.2, safeMax: 0.8 },
  { id:  64, name: 'Osc_A_PM_B',              label: 'OscA PM-B',        defaultValue: 0,      bipolar: true,  safeMin: 0.15, safeMax: 0.85 },
  { id:  68, name: 'Osc_A_PM_FB',             label: 'OscA PM-FB',       defaultValue: 0,      bipolar: true,  safeMin: 0.25, safeMax: 0.75 },
  { id: 301, name: 'Osc_A_Phase',             label: 'OscA Phase',       defaultValue: 0,      bipolar: true },

  // --- Oscillator B (5) ---
  { id:  87, name: 'Osc_B_Fluct',             label: 'OscB Fluct',       defaultValue: 0,      bipolar: false, safeMax: 0.7 },
  { id:  90, name: 'Osc_B_PM_Self',           label: 'OscB PM-Self',     defaultValue: 0,      bipolar: true,  safeMin: 0.2, safeMax: 0.8 },
  { id:  94, name: 'Osc_B_PM_A',              label: 'OscB PM-A',        defaultValue: 0,      bipolar: true,  safeMin: 0.15, safeMax: 0.85 },
  { id:  98, name: 'Osc_B_PM_FB',             label: 'OscB PM-FB',       defaultValue: 0,      bipolar: true,  safeMin: 0.25, safeMax: 0.75 },
  { id: 302, name: 'Osc_B_Phase',             label: 'OscB Phase',       defaultValue: 0,      bipolar: true },

  // --- Shaper A (6) ---
  { id:  71, name: 'Shp_A_Drive',             label: 'ShpA Drive',       defaultValue: 0.2,    bipolar: false, safeMax: 0.6 },
  { id:  74, name: 'Shp_A_Fold',              label: 'ShpA Fold',        defaultValue: 0.5,    bipolar: false },
  { id:  75, name: 'Shp_A_Asym',              label: 'ShpA Asym',        defaultValue: 0,      bipolar: false },
  { id:  76, name: 'Shp_A_Mix',               label: 'ShpA Mix',         defaultValue: 0,      bipolar: true },
  { id:  78, name: 'Shp_A_FB_Mix',            label: 'ShpA FB Mix',      defaultValue: 0,      bipolar: false, safeMax: 0.7 },
  { id:  81, name: 'Shp_A_Ring_Mod',          label: 'ShpA Ring',        defaultValue: 0,      bipolar: false },

  // --- Shaper B (6) ---
  { id: 101, name: 'Shp_B_Drive',             label: 'ShpB Drive',       defaultValue: 0.2,    bipolar: false, safeMax: 0.6 },
  { id: 104, name: 'Shp_B_Fold',              label: 'ShpB Fold',        defaultValue: 0.5,    bipolar: false },
  { id: 105, name: 'Shp_B_Asym',              label: 'ShpB Asym',        defaultValue: 0,      bipolar: false },
  { id: 106, name: 'Shp_B_Mix',               label: 'ShpB Mix',         defaultValue: 0,      bipolar: true },
  { id: 108, name: 'Shp_B_FB_Mix',            label: 'ShpB FB Mix',      defaultValue: 0,      bipolar: false, safeMax: 0.7 },
  { id: 111, name: 'Shp_B_Ring_Mod',          label: 'ShpB Ring',        defaultValue: 0,      bipolar: false },

  // --- Comb Filter (8) ---
  { id: 113, name: 'Comb_Flt_In_A_B',         label: 'Comb In A/B',      defaultValue: 0,      bipolar: false },
  { id: 115, name: 'Comb_Flt_Pitch',          label: 'Comb Pitch',       defaultValue: 0.5,    bipolar: false },
  { id: 119, name: 'Comb_Flt_Decay',          label: 'Comb Decay',       defaultValue: 0,      bipolar: true,  safeMin: 0.2, safeMax: 0.8 },
  { id: 123, name: 'Comb_Flt_AP_Tune',        label: 'Comb AP Tune',     defaultValue: 1,      bipolar: false },
  { id: 127, name: 'Comb_Flt_AP_Res',         label: 'Comb AP Res',      defaultValue: 0.5,    bipolar: false, safeMax: 0.8 },
  { id: 129, name: 'Comb_Flt_LP_Tune',        label: 'Comb LP Tune',     defaultValue: 1,      bipolar: false },
  { id: 133, name: 'Comb_Flt_PM',             label: 'Comb PM',          defaultValue: 0,      bipolar: true,  safeMin: 0.2, safeMax: 0.8 },
  { id: 135, name: 'Comb_Flt_PM_A_B',         label: 'Comb PM A/B',      defaultValue: 0,      bipolar: false },

  // --- State Variable Filter (9) ---
  { id: 136, name: 'SV_Flt_In_A_B',           label: 'SVF In A/B',       defaultValue: 0,      bipolar: false },
  { id: 138, name: 'SV_Flt_Comb_Mix',         label: 'SVF CombMix',      defaultValue: 0,      bipolar: true },
  { id: 140, name: 'SV_Flt_Cut',              label: 'SVF Cutoff',       defaultValue: 0.5,    bipolar: false },
  { id: 144, name: 'SV_Flt_Res',              label: 'SVF Reso',         defaultValue: 0.5,    bipolar: false, safeMax: 0.8 },
  { id: 148, name: 'SV_Flt_Spread',           label: 'SVF Spread',       defaultValue: 0.2,    bipolar: true },
  { id: 150, name: 'SV_Flt_LBH',              label: 'SVF L/B/H',        defaultValue: 0,      bipolar: false },
  { id: 152, name: 'SV_Flt_Par',              label: 'SVF Par',          defaultValue: 0,      bipolar: true },
  { id: 153, name: 'SV_Flt_FM',               label: 'SVF FM',           defaultValue: 0,      bipolar: true,  safeMin: 0.15, safeMax: 0.85 },
  { id: 155, name: 'SV_Flt_FM_A_B',           label: 'SVF FM A/B',       defaultValue: 0,      bipolar: false },

  // --- Gap Filter (6) ---
  { id: 201, name: 'Gap_Flt_Center',          label: 'Gap Center',       defaultValue: 0.5,    bipolar: false },
  { id: 203, name: 'Gap_Flt_Stereo',          label: 'Gap Stereo',       defaultValue: 0,      bipolar: true },
  { id: 204, name: 'Gap_Flt_Gap',             label: 'Gap Width',        defaultValue: 0.125,  bipolar: false },
  { id: 206, name: 'Gap_Flt_Res',             label: 'Gap Res',          defaultValue: 0.5,    bipolar: false, safeMax: 0.8 },
  { id: 207, name: 'Gap_Flt_Bal',             label: 'Gap Bal',          defaultValue: 0,      bipolar: true },
  { id: 209, name: 'Gap_Flt_Mix',             label: 'Gap Mix',          defaultValue: 0,      bipolar: true },

  // --- Feedback Mixer (9) ---
  { id: 156, name: 'FB_Mix_Comb',             label: 'FB Comb',          defaultValue: 0,      bipolar: true,  safeMin: 0.25, safeMax: 0.75 },
  { id: 158, name: 'FB_Mix_SVF',              label: 'FB SVF',           defaultValue: 0,      bipolar: true,  safeMin: 0.25, safeMax: 0.75 },
  { id: 160, name: 'FB_Mix_FX',               label: 'FB FX',            defaultValue: 0,      bipolar: true,  safeMin: 0.25, safeMax: 0.75 },
  { id: 162, name: 'FB_Mix_Rvb',              label: 'FB Reverb',        defaultValue: 0.5,    bipolar: false, safeMax: 0.75 },
  { id: 164, name: 'FB_Mix_Drive',            label: 'FB Drive',         defaultValue: 0.286,  bipolar: false, safeMax: 0.4 },
  { id: 166, name: 'FB_Mix_Fold',             label: 'FB Fold',          defaultValue: 0.5,    bipolar: false },
  { id: 167, name: 'FB_Mix_Asym',             label: 'FB Asym',          defaultValue: 0,      bipolar: false },
  { id: 299, name: 'FB_Mix_Lvl',              label: 'FB Level',         defaultValue: 0.38,   bipolar: false, safeMax: 0.55 },
  { id: 346, name: 'FB_Mix_Osc',              label: 'FB Osc',           defaultValue: 0,      bipolar: true,  safeMin: 0.25, safeMax: 0.75 },

  // --- Output Mixer (14) ---
  { id: 169, name: 'Out_Mix_A_Lvl',           label: 'Out A Lvl',        defaultValue: 0.75,   bipolar: true,  safeMin: 0.15, safeMax: 0.85 },
  { id: 171, name: 'Out_Mix_A_Pan',           label: 'Out A Pan',        defaultValue: 0,      bipolar: true },
  { id: 172, name: 'Out_Mix_B_Lvl',           label: 'Out B Lvl',        defaultValue: 0,      bipolar: true,  safeMin: 0.15, safeMax: 0.85 },
  { id: 174, name: 'Out_Mix_B_Pan',           label: 'Out B Pan',        defaultValue: 0,      bipolar: true },
  { id: 175, name: 'Out_Mix_Comb_Lvl',        label: 'Out Comb Lvl',     defaultValue: 0,      bipolar: true,  safeMin: 0.15, safeMax: 0.85 },
  { id: 177, name: 'Out_Mix_Comb_Pan',        label: 'Out Comb Pan',     defaultValue: 0,      bipolar: true },
  { id: 178, name: 'Out_Mix_SVF_Lvl',         label: 'Out SVF Lvl',      defaultValue: 0,      bipolar: true,  safeMin: 0.15, safeMax: 0.85 },
  { id: 180, name: 'Out_Mix_SVF_Pan',         label: 'Out SVF Pan',      defaultValue: 0,      bipolar: true },
  { id: 181, name: 'Out_Mix_Drive',            label: 'Out Drive',        defaultValue: 0,      bipolar: false, safeMax: 0.5 },
  { id: 183, name: 'Out_Mix_Fold',             label: 'Out Fold',         defaultValue: 0.5,    bipolar: false, safeMax: 0.75 },
  { id: 184, name: 'Out_Mix_Asym',             label: 'Out Asym',         defaultValue: 0,      bipolar: false },
  { id: 185, name: 'Out_Mix_Lvl',              label: 'Out Level',        defaultValue: 0.38,   bipolar: false, safeMin: 0.15, safeMax: 0.75 },
  { id: 187, name: 'Out_Mix_Key_Pan',          label: 'Out KeyPan',       defaultValue: 0,      bipolar: false },
  { id: 362, name: 'Out_Mix_To_FX',            label: 'Out ToFX',         defaultValue: 0,      bipolar: false, safeMax: 0.8 },

  // --- Cabinet (8) ---
  { id: 188, name: 'Cabinet_Drive',            label: 'Cab Drive',        defaultValue: 0.4,    bipolar: false, safeMax: 0.6 },
  { id: 190, name: 'Cabinet_Fold',             label: 'Cab Fold',         defaultValue: 0.25,   bipolar: false },
  { id: 191, name: 'Cabinet_Asym',             label: 'Cab Asym',         defaultValue: 0.25,   bipolar: false },
  { id: 192, name: 'Cabinet_Tilt',             label: 'Cab Tilt',         defaultValue: 0.5,    bipolar: true },
  { id: 194, name: 'Cabinet_Hi_Cut',           label: 'Cab HiCut',        defaultValue: 0.625,  bipolar: false },
  { id: 196, name: 'Cabinet_Lo_Cut',           label: 'Cab LoCut',        defaultValue: 0.125,  bipolar: false },
  { id: 197, name: 'Cabinet_Cab_Lvl',          label: 'Cab Level',        defaultValue: 0.72,   bipolar: false, safeMax: 0.85 },
  { id: 199, name: 'Cabinet_Mix',              label: 'Cab Mix',          defaultValue: 0,      bipolar: false },

  // --- Flanger (13) ---
  { id: 211, name: 'Flanger_Time_Mod',         label: 'Flng TimeMod',     defaultValue: 0,      bipolar: true },
  { id: 213, name: 'Flanger_Phase',            label: 'Flng Phase',       defaultValue: 0.5,    bipolar: false },
  { id: 214, name: 'Flanger_Rate',             label: 'Flng Rate',        defaultValue: 0.317,  bipolar: false },
  { id: 216, name: 'Flanger_Time',             label: 'Flng Time',        defaultValue: 0.317,  bipolar: false },
  { id: 218, name: 'Flanger_Stereo',           label: 'Flng Stereo',      defaultValue: 0,      bipolar: true },
  { id: 219, name: 'Flanger_Feedback',         label: 'Flng FB',          defaultValue: 0,      bipolar: true,  safeMin: 0.15, safeMax: 0.85 },
  { id: 221, name: 'Flanger_Cross_FB',         label: 'Flng XFB',         defaultValue: 0.5,    bipolar: true,  safeMin: 0.2, safeMax: 0.8 },
  { id: 222, name: 'Flanger_Hi_Cut',           label: 'Flng HiCut',       defaultValue: 0.75,   bipolar: false },
  { id: 223, name: 'Flanger_Mix',              label: 'Flng Mix',         defaultValue: 0,      bipolar: true },
  { id: 307, name: 'Flanger_Envelope',         label: 'Flng Env',         defaultValue: 0,      bipolar: false },
  { id: 308, name: 'Flanger_AP_Mod',           label: 'Flng AP Mod',      defaultValue: 0,      bipolar: true },
  { id: 310, name: 'Flanger_AP_Tune',          label: 'Flng AP Tune',     defaultValue: 1,      bipolar: false },
  { id: 389, name: 'Flanger_Tremolo',          label: 'Flng Trem',        defaultValue: 0,      bipolar: false },

  // --- Echo (7) ---
  { id: 225, name: 'Echo_Time',                label: 'Echo Time',        defaultValue: 0.433,  bipolar: false },
  { id: 227, name: 'Echo_Stereo',              label: 'Echo Stereo',      defaultValue: 0,      bipolar: true },
  { id: 229, name: 'Echo_Feedback',            label: 'Echo FB',          defaultValue: 0.5,    bipolar: false, safeMax: 0.75 },
  { id: 231, name: 'Echo_Cross_FB',            label: 'Echo XFB',         defaultValue: 0.5,    bipolar: false, safeMax: 0.7 },
  { id: 232, name: 'Echo_Hi_Cut',              label: 'Echo HiCut',       defaultValue: 0.75,   bipolar: false },
  { id: 233, name: 'Echo_Mix',                 label: 'Echo Mix',         defaultValue: 0,      bipolar: false, safeMax: 0.7 },
  { id: 342, name: 'Echo_Send',                label: 'Echo Send',        defaultValue: 1,      bipolar: false },

  // --- Reverb (6) ---
  { id: 235, name: 'Reverb_Size',              label: 'Verb Size',        defaultValue: 0.33,   bipolar: false, safeMax: 0.7 },
  { id: 237, name: 'Reverb_Pre_Dly',           label: 'Verb PreDly',      defaultValue: 0.33,   bipolar: false },
  { id: 238, name: 'Reverb_Color',             label: 'Verb Color',       defaultValue: 0.5,    bipolar: false },
  { id: 240, name: 'Reverb_Chorus',            label: 'Verb Chorus',      defaultValue: 0.25,   bipolar: false },
  { id: 241, name: 'Reverb_Mix',               label: 'Verb Mix',         defaultValue: 0,      bipolar: false, safeMax: 0.7 },
  { id: 344, name: 'Reverb_Send',              label: 'Verb Send',        defaultValue: 1,      bipolar: false, safeMax: 0.85 },

  // --- Unison (3) ---
  { id: 250, name: 'Unison_Detune',            label: 'Uni Detune',       defaultValue: 0.004,  bipolar: false, safeMax: 0.5 },
  { id: 252, name: 'Unison_Phase',             label: 'Uni Phase',        defaultValue: 0,      bipolar: false },
  { id: 253, name: 'Unison_Pan',               label: 'Uni Pan',          defaultValue: 0,      bipolar: false },

  // --- Mono (1) ---
  { id: 367, name: 'Mono_Grp_Glide',           label: 'Mono Glide',       defaultValue: 0,      bipolar: false },
];

/** Display labels, index-aligned with SYNTH_PARAM_MAP. */
export const SYNTH_PARAM_NAMES: readonly string[] = SYNTH_PARAM_MAP.map((p) => p.label);

/** Section (group) names in map order, with the number of params in each. */
export const SYNTH_SECTIONS: readonly { name: string; count: number }[] = [
  { name: 'Env A', count: 7 },
  { name: 'Env B', count: 7 },
  { name: 'Env C', count: 6 },
  { name: 'Osc A', count: 5 },
  { name: 'Osc B', count: 5 },
  { name: 'Shp A', count: 6 },
  { name: 'Shp B', count: 6 },
  { name: 'Comb', count: 8 },
  { name: 'SVF', count: 9 },
  { name: 'Gap', count: 6 },
  { name: 'FB Mix', count: 9 },
  { name: 'Out Mix', count: 14 },
  { name: 'Cabinet', count: 8 },
  { name: 'Flanger', count: 13 },
  { name: 'Echo', count: 7 },
  { name: 'Reverb', count: 6 },
  { name: 'Unison', count: 3 },
  { name: 'Mono', count: 1 },
];

/** Section name for each entry of SYNTH_PARAM_MAP (same order/length). */
export const SYNTH_PARAM_SECTION: readonly string[] = SYNTH_SECTIONS.flatMap((s) =>
  Array.from({ length: s.count }, () => s.name),
);

const BY_NAME = new Map<string, SynthParamEntry>(SYNTH_PARAM_MAP.map((p) => [p.name, p]));

export function findSynthParam(name: string): SynthParamEntry | undefined {
  return BY_NAME.get(name);
}

// --- Tame: constrain outputs to safe ranges ---------------------------------
// tameLevel 0 = no constraint (full 0..1), 1 = maximum ([safeMin, safeMax]).

/** Effective [min,max] for a param at a tame level (a-app.js groupOverrides seeding). */
export function tameRange(
  entry: Pick<SynthParamEntry, 'safeMin' | 'safeMax'>,
  tameLevel: number,
): { min: number; max: number } {
  const safeMin = entry.safeMin ?? 0;
  const safeMax = entry.safeMax ?? 1;
  return { min: safeMin * tameLevel, max: 1 - (1 - safeMax) * tameLevel };
}

/** Constrain a raw 0..1 value toward the param's safe range (old `applyTame`). */
export function applyTame(
  rawValue: number,
  entry: Pick<SynthParamEntry, 'safeMin' | 'safeMax'>,
  tameLevel: number,
): number {
  if (tameLevel <= 0) return rawValue;
  const lo = entry.safeMin;
  const hi = entry.safeMax;
  if (lo === undefined && hi === undefined) return rawValue;
  const effectiveMin = lo !== undefined ? lo * tameLevel : 0;
  const effectiveMax = hi !== undefined ? 1 - (1 - hi) * tameLevel : 1;
  return effectiveMin + rawValue * (effectiveMax - effectiveMin);
}

/**
 * Power curve on [0,1]. 0.5 = linear, 0 = logarithmic-ish (exponent 0.25),
 * 1 = exponential-ish (exponent 4): exponent = 2^(4*(curve-0.5)).
 */
export function applyCurve(value: number, curveFactor: number): number {
  if (curveFactor === 0.5) return value;
  const exponent = Math.pow(2, 4 * (curveFactor - 0.5));
  return Math.pow(Math.max(0, Math.min(1, value)), exponent);
}

/** Curve then scale into [min,max] (old `applyGroupOverride`). */
export function applyGroupOverride(rawValue: number, curve: number, min: number, max: number): number {
  return min + applyCurve(rawValue, curve) * (max - min);
}
