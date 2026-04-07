// Additive synth presets for NISPS playground
// Each preset defines which params are active (ML-controlled) and which are
// muted at safe defaults. Param IDs match faustParamAddress() output from
// additive.json (e.g. '1_spectral_shape_00_h1_amp').
//
// 3 tiers of progressive complexity across 5 presets.

import type { SynthPreset, PresetTier } from './presets.js';

export const ADDITIVE_PRESETS: SynthPreset[] = [
  // ======================================================================
  // TIER 1 — Beginner (~12-15 active params)
  // ======================================================================
  {
    id: 'additive-1',
    name: '1.1',
    tier: 1,
    description: 'Spectral Basics — H1-H4 amplitudes, global ADSR, spectral tilt, level',
    active: [
      '1_spectral_shape_00_h1_amp',
      '1_spectral_shape_01_h2_amp',
      '1_spectral_shape_02_h3_amp',
      '1_spectral_shape_03_h4_amp',
      '1_spectral_shape_11_spectral_tilt',
      '2_temporal_00_attack',
      '2_temporal_01_decay',
      '2_temporal_02_sustain',
      '2_temporal_03_release',
      '5_master_00_level',
      '5_master_04_saturation',
      '3_phase_04_stereo_phase_spread',
    ],
    overrides: {
      '1_spectral_shape_00_h1_amp':         { min: 0.3, max: 1.0, curve: 0.55 },
      '1_spectral_shape_01_h2_amp':         { min: 0.0, max: 0.8, curve: 0.45 },
      '1_spectral_shape_02_h3_amp':         { min: 0.0, max: 0.7, curve: 0.4 },
      '1_spectral_shape_03_h4_amp':         { min: 0.0, max: 0.6, curve: 0.4 },
      '1_spectral_shape_11_spectral_tilt':  { min: 0.2, max: 0.8, curve: 0.5 },
      '2_temporal_00_attack':               { min: 0.0, max: 0.7, curve: 0.35 },
      '2_temporal_01_decay':                { min: 0.05, max: 0.6, curve: 0.4 },
      '2_temporal_02_sustain':              { min: 0.2, max: 0.9, curve: 0.55 },
      '2_temporal_03_release':              { min: 0.1, max: 0.7, curve: 0.45 },
      '5_master_00_level':                  { min: 0.3, max: 0.85, curve: 0.5 },
      '5_master_04_saturation':             { min: 0.0, max: 0.4, curve: 0.3 },
      '3_phase_04_stereo_phase_spread':     { min: 0.0, max: 0.5, curve: 0.4 },
    },
    mutedOverrides: {},
    groupCurves: {},
  },

  {
    id: 'additive-2',
    name: '1.2',
    tier: 1,
    description: 'Formant Play — H1-H4, formant shaping, ADSR, level',
    active: [
      '1_spectral_shape_00_h1_amp',
      '1_spectral_shape_01_h2_amp',
      '1_spectral_shape_02_h3_amp',
      '1_spectral_shape_03_h4_amp',
      '4_modulation_07_formant1_freq',
      '4_modulation_08_formant2_freq',
      '4_modulation_09_formant_depth',
      '2_temporal_00_attack',
      '2_temporal_01_decay',
      '2_temporal_02_sustain',
      '2_temporal_03_release',
      '5_master_00_level',
      '1_spectral_shape_11_spectral_tilt',
    ],
    overrides: {
      '1_spectral_shape_00_h1_amp':         { min: 0.3, max: 1.0, curve: 0.55 },
      '1_spectral_shape_01_h2_amp':         { min: 0.0, max: 0.8, curve: 0.45 },
      '1_spectral_shape_02_h3_amp':         { min: 0.0, max: 0.7, curve: 0.4 },
      '1_spectral_shape_03_h4_amp':         { min: 0.0, max: 0.6, curve: 0.4 },
      '4_modulation_07_formant1_freq':      { min: 0.05, max: 0.7, curve: 0.45 },
      '4_modulation_08_formant2_freq':      { min: 0.1, max: 0.8, curve: 0.5 },
      '4_modulation_09_formant_depth':      { min: 0.0, max: 0.8, curve: 0.4 },
      '2_temporal_00_attack':               { min: 0.0, max: 0.6, curve: 0.35 },
      '2_temporal_01_decay':                { min: 0.05, max: 0.5, curve: 0.4 },
      '2_temporal_02_sustain':              { min: 0.3, max: 0.9, curve: 0.55 },
      '2_temporal_03_release':              { min: 0.1, max: 0.65, curve: 0.45 },
      '5_master_00_level':                  { min: 0.3, max: 0.85, curve: 0.5 },
      '1_spectral_shape_11_spectral_tilt':  { min: 0.2, max: 0.8, curve: 0.5 },
    },
    mutedOverrides: {},
    groupCurves: {},
  },

  // ======================================================================
  // TIER 2 — Intermediate (~25-30 active params)
  // ======================================================================
  {
    id: 'additive-3',
    name: '2.1',
    tier: 2,
    description: 'Harmonic Sculptor — all H amps, spectral tilt, inharmonicity, ADSR, brightness envelope, vibrato, level',
    active: [
      // All individual harmonics + groups
      '1_spectral_shape_00_h1_amp',
      '1_spectral_shape_01_h2_amp',
      '1_spectral_shape_02_h3_amp',
      '1_spectral_shape_03_h4_amp',
      '1_spectral_shape_04_h5_amp',
      '1_spectral_shape_05_h6_amp',
      '1_spectral_shape_06_h7_amp',
      '1_spectral_shape_07_h8_amp',
      '1_spectral_shape_08_h9_16_amp',
      '1_spectral_shape_09_h17_32_amp',
      '1_spectral_shape_10_h33_64_amp',
      '1_spectral_shape_11_spectral_tilt',
      '1_spectral_shape_12_inharmonicity',
      // Amplitude ADSR
      '2_temporal_00_attack',
      '2_temporal_01_decay',
      '2_temporal_02_sustain',
      '2_temporal_03_release',
      // Brightness ADSR
      '2_temporal_04_brightness_attack',
      '2_temporal_05_brightness_decay',
      '2_temporal_06_brightness_sustain',
      '2_temporal_07_brightness_release',
      // Vibrato
      '4_modulation_00_vibrato_rate',
      '4_modulation_01_vibrato_depth',
      '4_modulation_02_vibrato_delay',
      // Master
      '5_master_00_level',
      '5_master_04_saturation',
    ],
    overrides: {
      '1_spectral_shape_12_inharmonicity': { min: 0.0, max: 0.5, curve: 0.3 },
      '4_modulation_01_vibrato_depth':     { min: 0.0, max: 0.6, curve: 0.35 },
      '5_master_04_saturation':            { min: 0.0, max: 0.5, curve: 0.35 },
    },
    mutedOverrides: {},
    groupCurves: {},
  },

  {
    id: 'additive-4',
    name: '2.2',
    tier: 2,
    description: 'Phase Explorer — H1-H8, phase randomisation, beating, stereo spread, noise floor, ADSR, formants, level',
    active: [
      // H1-H8
      '1_spectral_shape_00_h1_amp',
      '1_spectral_shape_01_h2_amp',
      '1_spectral_shape_02_h3_amp',
      '1_spectral_shape_03_h4_amp',
      '1_spectral_shape_04_h5_amp',
      '1_spectral_shape_05_h6_amp',
      '1_spectral_shape_06_h7_amp',
      '1_spectral_shape_07_h8_amp',
      // Phase controls
      '3_phase_00_phase_random',
      '3_phase_02_beating_depth',
      '3_phase_03_beating_rate',
      '3_phase_04_stereo_phase_spread',
      '3_phase_05_noise_floor',
      '3_phase_06_noise_color',
      // Amplitude ADSR
      '2_temporal_00_attack',
      '2_temporal_01_decay',
      '2_temporal_02_sustain',
      '2_temporal_03_release',
      // Formants
      '4_modulation_07_formant1_freq',
      '4_modulation_08_formant2_freq',
      '4_modulation_09_formant_depth',
      // Odd/even
      '1_spectral_shape_13_odd_even',
      // Master
      '5_master_00_level',
      '5_master_04_saturation',
      '3_phase_07_sub_harmonic',
    ],
    overrides: {
      '3_phase_05_noise_floor':   { min: 0.0, max: 0.6, curve: 0.3 },
      '3_phase_02_beating_depth': { min: 0.0, max: 0.6, curve: 0.3 },
      '5_master_04_saturation':   { min: 0.0, max: 0.5, curve: 0.35 },
    },
    mutedOverrides: {},
    groupCurves: {},
  },

  // ======================================================================
  // TIER 3 — Advanced (all 48 params)
  // ======================================================================
  {
    id: 'additive-5',
    name: '3.1',
    tier: 3,
    description: 'Full Spectrum — all 48 params active, no restrictions',
    active: null, // null = all params active
    overrides: {},
    mutedOverrides: {},
    groupCurves: {},
  },
];

export const ADDITIVE_PRESET_TIERS: PresetTier[] = [
  { tier: 1, label: 'Beginner' },
  { tier: 2, label: 'Intermediate' },
  { tier: 3, label: 'Advanced' },
];
