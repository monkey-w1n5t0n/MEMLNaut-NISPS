// FM synth presets for NISPS playground
// Each preset defines which params are active (ML-controlled) and which are
// muted at safe defaults. Param IDs match faustParamAddress() output from
// fm-matrix.json (e.g. 'operators_op_1_op1_ratio', 'matrix_m21').
//
// 3 tiers of progressive complexity across 5 presets.

export const FM_PRESETS = [
  // ======================================================================
  // TIER 1 — Beginner (~12-15 active params)
  // ======================================================================
  {
    id: 'fm-1',
    name: '1.1',
    tier: 1,
    description: 'Simple FM — Op1/Op2 ratio+level, m21 mod index, op1 ADSR, master level',
    active: [
      'operators_op_1_op1_ratio',
      'operators_op_1_op1_level',
      'operators_op_2_op2_ratio',
      'operators_op_2_op2_level',
      'matrix_m21',
      'operators_op_1_op1_attack',
      'operators_op_1_op1_decay',
      'operators_op_1_op1_sustain',
      'operators_op_1_op1_release',
      'master_level',
      'master_stereo_spread',
      'master_waveform_blend',
    ],
    overrides: {
      'operators_op_1_op1_ratio':  { min: 0.15, max: 0.65, curve: 0.5 },
      'operators_op_2_op2_ratio':  { min: 0.15, max: 0.65, curve: 0.5 },
      'matrix_m21':                { min: 0.0, max: 0.5, curve: 0.4 },
      'operators_op_1_op1_attack': { min: 0.0, max: 0.6, curve: 0.35 },
      'operators_op_1_op1_decay':  { min: 0.05, max: 0.5, curve: 0.4 },
      'operators_op_1_op1_sustain': { min: 0.2, max: 0.9, curve: 0.55 },
      'operators_op_1_op1_release': { min: 0.1, max: 0.6, curve: 0.45 },
      'master_level':              { min: 0.3, max: 0.85, curve: 0.5 },
      'master_waveform_blend':     { min: 0.0, max: 0.5, curve: 0.4 },
    },
    mutedOverrides: {},
    groupCurves: {},
  },

  {
    id: 'fm-2',
    name: '1.2',
    tier: 1,
    description: 'Bell Tones — Op1-3 ratios+levels, m21+m31 indices, op1 ADSR, fb1, level',
    active: [
      'operators_op_1_op1_ratio',
      'operators_op_1_op1_level',
      'operators_op_2_op2_ratio',
      'operators_op_2_op2_level',
      'operators_op_3_op3_ratio',
      'operators_op_3_op3_level',
      'matrix_m21',
      'matrix_m31',
      'feedback_fb1',
      'operators_op_1_op1_attack',
      'operators_op_1_op1_decay',
      'operators_op_1_op1_sustain',
      'operators_op_1_op1_release',
      'master_level',
    ],
    overrides: {
      'operators_op_1_op1_ratio':  { min: 0.15, max: 0.55, curve: 0.5 },
      'operators_op_2_op2_ratio':  { min: 0.2, max: 0.7, curve: 0.55 },
      'operators_op_3_op3_ratio':  { min: 0.2, max: 0.7, curve: 0.55 },
      'matrix_m21':                { min: 0.0, max: 0.4, curve: 0.35 },
      'matrix_m31':                { min: 0.0, max: 0.35, curve: 0.3 },
      'feedback_fb1':              { min: 0.0, max: 0.4, curve: 0.3 },
      'operators_op_1_op1_attack': { min: 0.0, max: 0.5, curve: 0.3 },
      'operators_op_1_op1_decay':  { min: 0.1, max: 0.6, curve: 0.45 },
      'operators_op_1_op1_sustain': { min: 0.1, max: 0.7, curve: 0.45 },
      'operators_op_1_op1_release': { min: 0.15, max: 0.7, curve: 0.5 },
      'master_level':              { min: 0.3, max: 0.8, curve: 0.5 },
    },
    mutedOverrides: {},
    groupCurves: {},
  },

  // ======================================================================
  // TIER 2 — Intermediate (~25-30 active params)
  // ======================================================================
  {
    id: 'fm-3',
    name: '2.1',
    tier: 2,
    description: 'Matrix Explorer — all 4 op ratios+levels, 6 cross-mod indices, all 4 ADSRs, LFO, level',
    active: [
      // All 4 operator ratios + levels
      'operators_op_1_op1_ratio',
      'operators_op_1_op1_level',
      'operators_op_2_op2_ratio',
      'operators_op_2_op2_level',
      'operators_op_3_op3_ratio',
      'operators_op_3_op3_level',
      'operators_op_4_op4_ratio',
      'operators_op_4_op4_level',
      // 6 cross-modulation indices (half the matrix)
      'matrix_m21',
      'matrix_m31',
      'matrix_m41',
      'matrix_m32',
      'matrix_m42',
      'matrix_m43',
      // All 4 operator ADSRs (op1 only for now — full for intermediate)
      'operators_op_1_op1_attack',
      'operators_op_1_op1_decay',
      'operators_op_1_op1_sustain',
      'operators_op_1_op1_release',
      'operators_op_2_op2_attack',
      'operators_op_2_op2_decay',
      'operators_op_2_op2_sustain',
      'operators_op_2_op2_release',
      // LFO
      'global_lfo_rate',
      'global_lfo_depth',
      'global_lfo_waveform',
      // Master
      'master_level',
      'master_stereo_spread',
    ],
    overrides: {
      'matrix_m21':           { min: 0.0, max: 0.5, curve: 0.4 },
      'matrix_m31':           { min: 0.0, max: 0.45, curve: 0.35 },
      'matrix_m41':           { min: 0.0, max: 0.4, curve: 0.35 },
      'matrix_m32':           { min: 0.0, max: 0.4, curve: 0.35 },
      'matrix_m42':           { min: 0.0, max: 0.35, curve: 0.3 },
      'matrix_m43':           { min: 0.0, max: 0.35, curve: 0.3 },
      'global_lfo_depth':     { min: 0.0, max: 0.6, curve: 0.35 },
    },
    mutedOverrides: {},
    groupCurves: {},
  },

  {
    id: 'fm-4',
    name: '2.2',
    tier: 2,
    description: 'Feedback Machine — all op params, all 4 feedbacks, 4 key matrix indices, waveform blend, saturation, level',
    active: [
      // All 4 operator ratios + levels
      'operators_op_1_op1_ratio',
      'operators_op_1_op1_level',
      'operators_op_2_op2_ratio',
      'operators_op_2_op2_level',
      'operators_op_3_op3_ratio',
      'operators_op_3_op3_level',
      'operators_op_4_op4_ratio',
      'operators_op_4_op4_level',
      // All 4 feedbacks
      'feedback_fb1',
      'feedback_fb2',
      'feedback_fb3',
      'feedback_fb4',
      // 4 key cross-mod indices
      'matrix_m21',
      'matrix_m31',
      'matrix_m12',
      'matrix_m34',
      // Op1 + Op2 ADSR
      'operators_op_1_op1_attack',
      'operators_op_1_op1_decay',
      'operators_op_1_op1_sustain',
      'operators_op_1_op1_release',
      'operators_op_2_op2_attack',
      'operators_op_2_op2_decay',
      'operators_op_2_op2_sustain',
      'operators_op_2_op2_release',
      // Waveform, saturation, master
      'master_waveform_blend',
      'master_output_saturation',
      'master_level',
      'master_stereo_spread',
    ],
    overrides: {
      'feedback_fb1':             { min: 0.0, max: 0.6, curve: 0.35 },
      'feedback_fb2':             { min: 0.0, max: 0.6, curve: 0.35 },
      'feedback_fb3':             { min: 0.0, max: 0.5, curve: 0.3 },
      'feedback_fb4':             { min: 0.0, max: 0.5, curve: 0.3 },
      'master_output_saturation': { min: 0.0, max: 0.5, curve: 0.35 },
      'matrix_m21':               { min: 0.0, max: 0.5, curve: 0.4 },
      'matrix_m31':               { min: 0.0, max: 0.45, curve: 0.35 },
      'matrix_m12':               { min: 0.0, max: 0.4, curve: 0.35 },
      'matrix_m34':               { min: 0.0, max: 0.4, curve: 0.35 },
    },
    mutedOverrides: {},
    groupCurves: {},
  },

  // ======================================================================
  // TIER 3 — Advanced (all 55 params)
  // ======================================================================
  {
    id: 'fm-5',
    name: '3.1',
    tier: 3,
    description: 'Full Matrix — all 55 params active, no restrictions',
    active: null, // null = all params active
    overrides: {},
    mutedOverrides: {},
    groupCurves: {},
  },
];

export const FM_PRESET_TIERS = [
  { tier: 1, label: 'Beginner' },
  { tier: 2, label: 'Intermediate' },
  { tier: 3, label: 'Advanced' },
];
