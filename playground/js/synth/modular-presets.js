/**
 * modular-presets.js — Phase E presets for the Modular engine.
 *
 * Each preset is a curated snapshot shaped like `ModularEngine.getState()`
 * output. `applyPreset(engine, preset)` first calls `engine.resetToDefaults()`
 * to re-establish the Phase B baseline, then `engine.setState(preset.state)`
 * to layer the preset's non-default values on top. Presets therefore only
 * need to include the labels they actively change.
 *
 * Source ordering reminder (mirrors modular-engine.js comments):
 *   Matrix source 0..15  = ADSR slots 1..16
 *   Matrix source 16..47 = LFO slots 1..32
 *
 * Destinations (d00..d09) are sub-engine-specific; see
 * faust/MODULAR_DESTINATIONS.md.  Across all three sub-engines:
 *   d00 = pitch, d08 = amp, d09 = pan.
 */

// Helper factories for building per-source label sets without macro soup.
// Only include labels that differ from the Phase B default patch.

const pad2 = (n) => String(n).padStart(2, '0');

/** `MM_ADSR/NN_adsrNN_<field>` label builder (NN zero-padded). */
function adsrLabel(slot1, field) {
  // slot1 = 1-based slot number
  const nn = pad2(slot1 - 1);
  const mm = pad2(slot1);
  return `MM_ADSR/${nn}_adsr${mm}_${field}`;
}

/** `MM_LFO/NN_lfoNN_<field>` label builder. */
function lfoLabel(slot1, field) {
  const nn = pad2(slot1 - 1);
  const mm = pad2(slot1);
  return `MM_LFO/${nn}_lfo${mm}_${field}`;
}

/**
 * Matrix cell label: source `s` (0..47), destination `d` (0..9), name.
 */
function mxLabel(s, d, name) {
  return `MM_Matrix/s${pad2(s)}_d${pad2(d)}_${name}`;
}

// -----------------------------------------------------------------------------
// Presets
// -----------------------------------------------------------------------------

/** 1. Default — Phase B out-of-the-box patch (empty diff). */
const DEFAULT_PRESET = {
  version: 1,
  subEngine: 'subtractive',
  adsrCount: 4,
  lfoCount:  8,
  exposedEngineParams: [],
  dsp: {},
};

/** 2. Slow pad — long ADSR, subtle LFOs, filter open-ish. Subtractive. */
const SLOW_PAD_PRESET = {
  version: 1,
  subEngine: 'subtractive',
  adsrCount: 4,
  lfoCount:  8,
  exposedEngineParams: [],
  dsp: {
    // ADSR 1 — long amp envelope
    [adsrLabel(1, 'enable')]:  1.0,
    [adsrLabel(1, 'attack')]:  2.0,
    [adsrLabel(1, 'decay')]:   1.0,
    [adsrLabel(1, 'sustain')]: 0.9,
    [adsrLabel(1, 'release')]: 4.0,

    // LFO 1 — slow sine → cutoff
    [lfoLabel(1, 'enable')]: 1.0,
    [lfoLabel(1, 'rate')]:   0.3,
    [lfoLabel(1, 'morph')]:  0.0,

    // LFO 2 — slow sine → pitch (subtle detune)
    [lfoLabel(2, 'enable')]: 1.0,
    [lfoLabel(2, 'rate')]:   0.5,
    [lfoLabel(2, 'morph')]:  0.0,

    // Matrix routes
    [mxLabel(0,  8, 'amp')]:    1.0,  // ADSR1 → amp (reinforce default)
    [mxLabel(16, 5, 'cutoff')]: 0.4,  // LFO1 → cutoff
    [mxLabel(17, 0, 'pitch')]:  0.05, // LFO2 → pitch

    // Engine sound
    '3_Filter/00_cutoff':              1000,
    '3_Filter/01_resonance':           0.2,
    '1_Oscillators/02_osc1_level':     0.7,
    '1_Oscillators/06_osc2_level':     0.4,
  },
};

/** 3. Plucky bass — fast amp + filter envelopes, low cutoff, high res. */
const PLUCKY_BASS_PRESET = {
  version: 1,
  subEngine: 'subtractive',
  adsrCount: 4,
  lfoCount:  8,
  exposedEngineParams: [],
  dsp: {
    // ADSR 1 — amp
    [adsrLabel(1, 'enable')]:  1.0,
    [adsrLabel(1, 'attack')]:  0.005,
    [adsrLabel(1, 'decay')]:   0.15,
    [adsrLabel(1, 'sustain')]: 0.0,
    [adsrLabel(1, 'release')]: 0.1,
    // ADSR 2 — filter
    [adsrLabel(2, 'enable')]:  1.0,
    [adsrLabel(2, 'attack')]:  0.005,
    [adsrLabel(2, 'decay')]:   0.15,
    [adsrLabel(2, 'sustain')]: 0.0,
    [adsrLabel(2, 'release')]: 0.1,

    [mxLabel(0, 8, 'amp')]:    1.0, // ADSR1 → amp
    [mxLabel(1, 5, 'cutoff')]: 0.8, // ADSR2 → cutoff

    '3_Filter/00_cutoff':           400,
    '3_Filter/01_resonance':        0.7,
    '1_Oscillators/02_osc1_level':  0.9,
  },
};

/** 4. Crystal — additive, tremolo + slow formant sweep. */
const CRYSTAL_PRESET = {
  version: 1,
  subEngine: 'additive',
  adsrCount: 4,
  lfoCount:  8,
  exposedEngineParams: [],
  dsp: {
    [adsrLabel(1, 'enable')]:  1.0,
    [adsrLabel(1, 'attack')]:  0.02,
    [adsrLabel(1, 'decay')]:   0.4,
    [adsrLabel(1, 'sustain')]: 0.8,
    [adsrLabel(1, 'release')]: 1.2,

    [lfoLabel(1, 'enable')]: 1.0,
    [lfoLabel(1, 'rate')]:   4.0,
    [lfoLabel(1, 'morph')]:  0.0,  // sine

    [lfoLabel(2, 'enable')]: 1.0,
    [lfoLabel(2, 'rate')]:   0.2,
    [lfoLabel(2, 'morph')]:  0.33, // tri

    [mxLabel(0,  8, 'amp')]:         0.8, // ADSR1 → amp
    [mxLabel(16, 1, 'bright')]:      0.3, // LFO1 → bright
    [mxLabel(17, 5, 'formant_ctr')]: 0.4, // LFO2 → formant_ctr
  },
};

/** 5. DX bell — 4 ADSRs with staggered decays driving FM operator levels. */
const DX_BELL_PRESET = {
  version: 1,
  subEngine: 'fm',
  adsrCount: 4,
  lfoCount:  8,
  exposedEngineParams: [],
  dsp: {
    // All four ADSRs: fast attack, varying decay, zero sustain, equal release
    [adsrLabel(1, 'enable')]:  1.0,
    [adsrLabel(1, 'attack')]:  0.005,
    [adsrLabel(1, 'decay')]:   0.3,
    [adsrLabel(1, 'sustain')]: 0.0,
    [adsrLabel(1, 'release')]: 0.5,

    [adsrLabel(2, 'enable')]:  1.0,
    [adsrLabel(2, 'attack')]:  0.005,
    [adsrLabel(2, 'decay')]:   0.6,
    [adsrLabel(2, 'sustain')]: 0.0,
    [adsrLabel(2, 'release')]: 0.5,

    [adsrLabel(3, 'enable')]:  1.0,
    [adsrLabel(3, 'attack')]:  0.005,
    [adsrLabel(3, 'decay')]:   1.2,
    [adsrLabel(3, 'sustain')]: 0.0,
    [adsrLabel(3, 'release')]: 0.5,

    [adsrLabel(4, 'enable')]:  1.0,
    [adsrLabel(4, 'attack')]:  0.005,
    [adsrLabel(4, 'decay')]:   2.0,
    [adsrLabel(4, 'sustain')]: 0.0,
    [adsrLabel(4, 'release')]: 0.5,

    // Matrix: each ADSR → the matching op level (d01..d04 in the fm sub-engine)
    [mxLabel(0, 1, 'op1_level')]: 1.0,
    [mxLabel(1, 2, 'op2_level')]: 1.0,
    [mxLabel(2, 3, 'op3_level')]: 1.0,
    [mxLabel(3, 4, 'op4_level')]: 1.0,
  },
};

/** 6. Morphing drone — additive, very slow amp, slow spectral LFOs. */
const MORPHING_DRONE_PRESET = {
  version: 1,
  subEngine: 'additive',
  adsrCount: 4,
  lfoCount:  8,
  exposedEngineParams: [],
  dsp: {
    [adsrLabel(1, 'enable')]:  1.0,
    [adsrLabel(1, 'attack')]:  5.0,
    [adsrLabel(1, 'decay')]:   1.0,
    [adsrLabel(1, 'sustain')]: 1.0,
    [adsrLabel(1, 'release')]: 6.0,

    [lfoLabel(1, 'enable')]: 1.0,
    [lfoLabel(1, 'rate')]:   0.1,
    [lfoLabel(1, 'morph')]:  0.5,  // between tri and saw

    [lfoLabel(2, 'enable')]: 1.0,
    [lfoLabel(2, 'rate')]:   0.15,
    [lfoLabel(2, 'morph')]:  0.66,

    [mxLabel(0,  8, 'amp')]:           1.0, // ADSR1 → amp
    [mxLabel(16, 3, 'inharmonicity')]: 0.3, // LFO1 → inharmonicity
    [mxLabel(17, 4, 'odd_even')]:      0.3, // LFO2 → odd_even
  },
};

export const MODULAR_PRESETS = [
  {
    id:          'modular-default',
    name:        'Default',
    description: 'Phase B out-of-the-box patch.',
    state:       DEFAULT_PRESET,
  },
  {
    id:          'modular-slow-pad',
    name:        'Slow pad',
    description: 'Long ADSR, slow LFO cutoff sweep, subtle pitch drift.',
    state:       SLOW_PAD_PRESET,
  },
  {
    id:          'modular-plucky-bass',
    name:        'Plucky bass',
    description: 'Fast amp + filter envelopes, resonant lowpass.',
    state:       PLUCKY_BASS_PRESET,
  },
  {
    id:          'modular-crystal',
    name:        'Crystal',
    description: 'Additive tremolo with slow formant sweep.',
    state:       CRYSTAL_PRESET,
  },
  {
    id:          'modular-dx-bell',
    name:        'DX bell',
    description: 'Four staggered ADSRs driving FM operator levels.',
    state:       DX_BELL_PRESET,
  },
  {
    id:          'modular-morphing-drone',
    name:        'Morphing drone',
    description: 'Additive drone with LFO-driven spectral morphing.',
    state:       MORPHING_DRONE_PRESET,
  },
];

/**
 * Apply a preset to a ModularEngine instance. Resets to defaults first so
 * each preset is independent of whatever state preceded it.
 *
 * @param {import('./modular-engine.js').ModularEngine} engine
 * @param {{state: object}} preset
 */
export async function applyPreset(engine, preset) {
  if (!engine || !preset || !preset.state) return;
  // Baseline first — this clears user mutations and re-seeds the
  // default amp env / matrix / filter values.
  if (typeof engine.resetToDefaults === 'function') {
    engine.resetToDefaults();
  }
  // Layer the preset's non-default values.
  await engine.setState({ version: 1, ...preset.state });
}

/** Look up a preset by id. */
export function findPreset(id) {
  return MODULAR_PRESETS.find(p => p.id === id) ?? null;
}
