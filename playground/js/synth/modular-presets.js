/**
 * modular-presets.js — Modular-engine presets, unified schema (meml-2l83).
 *
 * SCHEMA MIGRATION: presets now conform to the unified preset schema
 * (see `playground/docs/unified-preset-schema.md` and `preset-types.js`).
 * Each preset carries:
 *   - id, name, description
 *   - engine: 'modular'
 *   - complexity: 1..5
 *   - meta: { subEngine, adsrCount, lfoCount }
 *   - params: { [faustLabel]: { bypassed, muted, fixedValue?, min, max, curve } }  // all in [0,1]
 *   - matrix: { [cellKey]: { muted, fixedValue?, min, max, curve } }               // cellKey = 'sNN_dNN'
 *   - groupCurves: { [groupName]: number }
 *
 * Omission rules (per unified-preset-schema.md):
 *   - Param omitted from `params`     -> defaults `{bypassed:false,muted:false,min:0,max:1,curve:0.5}`.
 *   - Matrix cell omitted from `matrix` -> treated as muted (raw=0, not in paramMeta).
 *
 * LEGACY SHIM: the current modular loader (`applyPreset` / `modular-ui.js`)
 * reads `preset.state` which mirrors `ModularEngine.getState()` output
 * ({ version, subEngine, adsrCount, lfoCount, exposedEngineParams, dsp }).
 * Until the unified preset loader lands (tracked downstream), each preset
 * also emits a `state` field built from the raw authoring snapshot.
 * TODO(meml-17mp): drop the `state` shim once the loader reads `params`/`matrix`
 * directly.
 *
 * Source ordering (matrix):
 *   s00..s15 = ADSR slots 1..16
 *   s16..s47 = LFO  slots 1..32
 * Destinations (d00..d09) are sub-engine-specific. See
 * `faust/MODULAR_DESTINATIONS.md`. Across all sub-engines: d00=pitch, d08=amp, d09=pan.
 */

import { rawToNorm, normToRaw as _normToRaw } from './modular-param-meta.js';

// ---------------------------------------------------------------------------
// Label + key builders
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');

/** `MM_ADSR/NN_adsrNN_<field>` — slot1 is 1-based. */
function adsrLabel(slot1, field) {
  return `MM_ADSR/${pad2(slot1 - 1)}_adsr${pad2(slot1)}_${field}`;
}

/** `MM_LFO/NN_lfoNN_<field>` — slot1 is 1-based. */
function lfoLabel(slot1, field) {
  return `MM_LFO/${pad2(slot1 - 1)}_lfo${pad2(slot1)}_${field}`;
}

/** Matrix raw-DSP label (used in legacy `state.dsp`). */
function mxLabel(s, d, name) {
  return `MM_Matrix/s${pad2(s)}_d${pad2(d)}_${name}`;
}

/** Matrix unified-schema cell key. */
function mxKey(s, d) {
  return `s${pad2(s)}_d${pad2(d)}`;
}

/** Subtractive destination name for d index. */
const SUBTRACTIVE_DESTS = [
  'pitch', 'osc2_detune', 'osc3_detune', 'osc_mix_bal', 'noise_level',
  'cutoff', 'resonance', 'filter_env_amt', 'amp', 'pan',
];

// Sub-engine-specific base_amp labels.
const BASE_AMP_SUB = '4_Master/04_base_amp';
const BASE_AMP_ADD = '3_Master/05_base_amp';
const BASE_AMP_FM  = '4_Master/06_base_amp';

// ---------------------------------------------------------------------------
// Existing presets — raw authoring (legacy getState() snapshot format)
// ---------------------------------------------------------------------------

const DEFAULT_STATE = {
  version: 1,
  subEngine: 'subtractive',
  adsrCount: 4,
  lfoCount:  8,
  exposedEngineParams: [],
  dsp: {},
};

const SLOW_PAD_STATE = {
  version: 1,
  subEngine: 'subtractive',
  adsrCount: 4,
  lfoCount:  8,
  exposedEngineParams: [],
  dsp: {
    [adsrLabel(1, 'enable')]:  1.0,
    [adsrLabel(1, 'attack')]:  2.0,
    [adsrLabel(1, 'decay')]:   1.0,
    [adsrLabel(1, 'sustain')]: 0.9,
    [adsrLabel(1, 'release')]: 4.0,

    [lfoLabel(1, 'enable')]: 1.0,
    [lfoLabel(1, 'rate')]:   0.3,
    [lfoLabel(1, 'morph')]:  0.0,

    [lfoLabel(2, 'enable')]: 1.0,
    [lfoLabel(2, 'rate')]:   0.5,
    [lfoLabel(2, 'morph')]:  0.0,

    [BASE_AMP_SUB]: 0.0,

    [mxLabel(0,  8, 'amp')]:    1.0,
    [mxLabel(16, 5, 'cutoff')]: 0.4,
    [mxLabel(17, 0, 'pitch')]:  0.05,

    '3_Filter/00_cutoff':          1000,
    '3_Filter/01_resonance':       0.2,
    '1_Oscillators/02_osc1_level': 0.7,
    '1_Oscillators/06_osc2_level': 0.4,
  },
};

const PLUCKY_BASS_STATE = {
  version: 1,
  subEngine: 'subtractive',
  adsrCount: 4,
  lfoCount:  8,
  exposedEngineParams: [],
  dsp: {
    [adsrLabel(1, 'enable')]:  1.0,
    [adsrLabel(1, 'attack')]:  0.005,
    [adsrLabel(1, 'decay')]:   0.15,
    [adsrLabel(1, 'sustain')]: 0.0,
    [adsrLabel(1, 'release')]: 0.1,
    [adsrLabel(2, 'enable')]:  1.0,
    [adsrLabel(2, 'attack')]:  0.005,
    [adsrLabel(2, 'decay')]:   0.15,
    [adsrLabel(2, 'sustain')]: 0.0,
    [adsrLabel(2, 'release')]: 0.1,

    [BASE_AMP_SUB]: 0.0,

    [mxLabel(0, 8, 'amp')]:    1.0,
    [mxLabel(1, 5, 'cutoff')]: 0.8,

    '3_Filter/00_cutoff':          400,
    '3_Filter/01_resonance':       0.7,
    '1_Oscillators/02_osc1_level': 0.9,
  },
};

const CRYSTAL_STATE = {
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
    [lfoLabel(1, 'morph')]:  0.0,

    [lfoLabel(2, 'enable')]: 1.0,
    [lfoLabel(2, 'rate')]:   0.2,
    [lfoLabel(2, 'morph')]:  0.33,

    [BASE_AMP_ADD]: 0.0,

    [mxLabel(0,  8, 'amp')]:         0.8,
    [mxLabel(16, 1, 'bright')]:      0.3,
    [mxLabel(17, 5, 'formant_ctr')]: 0.4,
  },
};

const DX_BELL_STATE = {
  version: 1,
  subEngine: 'fm',
  adsrCount: 4,
  lfoCount:  8,
  exposedEngineParams: [],
  dsp: {
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

    [mxLabel(0, 1, 'op1_level')]: 1.0,
    [mxLabel(1, 2, 'op2_level')]: 1.0,
    [mxLabel(2, 3, 'op3_level')]: 1.0,
    [mxLabel(3, 4, 'op4_level')]: 1.0,
  },
};

const MORPHING_DRONE_STATE = {
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
    [lfoLabel(1, 'morph')]:  0.5,

    [lfoLabel(2, 'enable')]: 1.0,
    [lfoLabel(2, 'rate')]:   0.15,
    [lfoLabel(2, 'morph')]:  0.66,

    [BASE_AMP_ADD]: 0.0,

    [mxLabel(0,  8, 'amp')]:           1.0,
    [mxLabel(16, 3, 'inharmonicity')]: 0.3,
    [mxLabel(17, 4, 'odd_even')]:      0.3,
  },
};

// ---------------------------------------------------------------------------
// Raw-state -> unified { params, matrix } migration
// ---------------------------------------------------------------------------

/**
 * Port a legacy DSP snapshot to unified `params` + `matrix`. For each raw DSP
 * write in `state.dsp`, we emit a unified entry pinning the param to that
 * value via `fixedValue` (normalised via rawToNorm). These are `muted:true` so
 * the MLP still has an output node (allowing runtime unmute) but they're
 * held at the preset's authored value on load — which faithfully reproduces
 * the existing behaviour where the preset only writes the labels it cares
 * about and leaves everything else at DSP defaults.
 *
 * For matrix labels the logic is the same but routed into `matrix` keyed by
 * 'sNN_dNN'. Matrix cells not mentioned are omitted -> muted -> raw 0.
 *
 * This is intentionally conservative: it preserves the old preset sound.
 * The new curated presets (below) author directly in the unified schema with
 * meaningful [min,max,curve] ranges instead of pinning via fixedValue.
 */
function _migrateStateToUnified(state) {
  const params = {};
  const matrix = {};
  if (!state || !state.dsp) return { params, matrix };

  for (const [label, raw] of Object.entries(state.dsp)) {
    if (typeof raw !== 'number') continue;
    // Matrix label?
    const mm = /^MM_Matrix\/s(\d+)_d(\d+)_(.+)$/.exec(label);
    if (mm) {
      const key = `s${mm[1]}_d${mm[2]}`;
      const norm = rawToNorm(label, raw);
      // Pin cell: un-muted (live) with min==max==norm -> routing held at raw value
      // and still visible to MLP (per schema, use min==max for pinned routing).
      matrix[key] = { muted: false, fixedValue: norm, min: norm, max: norm, curve: 0.5 };
      continue;
    }
    // Regular param. Pin via muted=true + fixedValue.
    const norm = rawToNorm(label, raw);
    params[label] = {
      bypassed: false,
      muted: true,
      fixedValue: norm,
      min: 0,
      max: 1,
      curve: 0.5,
    };
  }
  return { params, matrix };
}

// ---------------------------------------------------------------------------
// 7 NEW curated presets — authored directly in the unified schema
// ---------------------------------------------------------------------------

// Helper: build a params block by listing [label, min, max, curve] tuples.
function P(rows) {
  const out = {};
  for (const [label, min, max, curve] of rows) {
    out[label] = { bypassed: false, muted: false, min, max, curve: curve ?? 0.5 };
  }
  return out;
}

function M(rows) {
  const out = {};
  for (const [s, d, min, max, curve] of rows) {
    out[mxKey(s, d)] = { muted: false, min, max, curve: curve ?? 0.5 };
  }
  return out;
}

/** 1. Wide Timbre — complexity 1. Audible static voice; ML shapes tone. */
const WIDE_TIMBRE = {
  id: 'modular-wide-timbre',
  name: 'Wide Timbre',
  description: 'Static base voice. ML shapes tone via osc shape, filter, and levels.',
  engine: 'modular',
  complexity: 1,
  meta: { subEngine: 'subtractive', adsrCount: 4, lfoCount: 8 },
  params: P([
    ['1_Oscillators/00_osc1_wave',  0.0, 1.0, 0.5],
    ['1_Oscillators/02_osc1_level', 0.3, 0.9, 0.5],
    ['1_Oscillators/03_osc2_wave',  0.0, 1.0, 0.5],
    ['1_Oscillators/06_osc2_level', 0.0, 0.6, 0.4],
    ['3_Filter/00_cutoff',          0.2, 0.95, 0.7],
    ['3_Filter/01_resonance',       0.0, 0.6, 0.4],
    ['4_Master/00_master_level',    0.4, 0.85, 0.5],
    // Keep voice audible — base_amp high, no envelope gating required.
  ]),
  // base_amp pinned high so the voice is audible with no matrix routing.
  // (Added via a muted fixedValue entry — visible to MLP for later unmute.)
  // Stitched in after P() below.
  matrix: {},
  groupCurves: {},
};
WIDE_TIMBRE.params[BASE_AMP_SUB] = {
  bypassed: false, muted: true, fixedValue: 1.0, min: 0, max: 1, curve: 0.5,
};

/** 2. Blank Slate — complexity 1. 4 params only. */
const BLANK_SLATE = {
  id: 'modular-blank-slate',
  name: 'Blank Slate',
  description: 'Minimal 4-param starting point. Filter, master, osc 1 level & shape.',
  engine: 'modular',
  complexity: 1,
  meta: { subEngine: 'subtractive', adsrCount: 4, lfoCount: 8 },
  params: P([
    ['3_Filter/00_cutoff',          0.1, 1.0, 0.7],
    ['4_Master/00_master_level',    0.3, 0.85, 0.5],
    ['1_Oscillators/02_osc1_level', 0.2, 0.9, 0.5],
    ['1_Oscillators/00_osc1_wave',  0.0, 1.0, 0.5],
  ]),
  matrix: {},
  groupCurves: {},
};
BLANK_SLATE.params[BASE_AMP_SUB] = {
  bypassed: false, muted: true, fixedValue: 1.0, min: 0, max: 1, curve: 0.5,
};

/** 3. Filter Study — complexity 2. Filter + res + master + ADSR1->cutoff. */
const FILTER_STUDY = {
  id: 'modular-filter-study',
  name: 'Filter Study',
  description: 'Cutoff, resonance, master. ADSR1 sweeps the filter.',
  engine: 'modular',
  complexity: 2,
  meta: { subEngine: 'subtractive', adsrCount: 4, lfoCount: 8 },
  params: P([
    ['3_Filter/00_cutoff',          0.1, 1.0, 0.7],
    ['3_Filter/01_resonance',       0.0, 0.8, 0.5],
    ['4_Master/00_master_level',    0.4, 0.85, 0.5],
    ['1_Oscillators/02_osc1_level', 0.3, 0.9, 0.5],
    [adsrLabel(1, 'attack'),        0.0, 0.4, 0.3],
    [adsrLabel(1, 'decay'),         0.1, 0.6, 0.4],
    [adsrLabel(1, 'sustain'),       0.2, 0.9, 0.5],
    [adsrLabel(1, 'release'),       0.1, 0.6, 0.4],
  ]),
  matrix: M([
    // s00 = ADSR 1; d05 = cutoff (subtractive)
    [0, 5, 0.5, 1.0, 0.6],
  ]),
  groupCurves: {},
};
FILTER_STUDY.params[BASE_AMP_SUB] = {
  bypassed: false, muted: true, fixedValue: 1.0, min: 0, max: 1, curve: 0.5,
};

/** 4. Rhythmic Motion — complexity 2. LFOs -> cutoff + amp. */
const RHYTHMIC_MOTION = {
  id: 'modular-rhythmic-motion',
  name: 'Rhythmic Motion',
  description: 'LFOs drive cutoff and amplitude — rhythmic timbral motion.',
  engine: 'modular',
  complexity: 2,
  meta: { subEngine: 'subtractive', adsrCount: 4, lfoCount: 8 },
  params: P([
    ['3_Filter/00_cutoff',          0.2, 0.9, 0.6],
    ['3_Filter/01_resonance',       0.0, 0.7, 0.4],
    ['1_Oscillators/02_osc1_level', 0.4, 0.9, 0.5],
    [lfoLabel(1, 'rate'),           0.2, 0.8, 0.5],
    [lfoLabel(1, 'morph'),          0.0, 1.0, 0.5],
    [lfoLabel(2, 'rate'),           0.1, 0.7, 0.5],
    [lfoLabel(2, 'morph'),          0.0, 1.0, 0.5],
  ]),
  matrix: M([
    // s16 = LFO 1, s17 = LFO 2
    [16, 5, 0.4, 0.9, 0.5], // LFO1 -> cutoff
    [16, 8, 0.4, 0.8, 0.5], // LFO1 -> amp (tremolo)
    [17, 5, 0.3, 0.7, 0.5], // LFO2 -> cutoff (cross-motion)
  ]),
  groupCurves: {},
};
RHYTHMIC_MOTION.params[BASE_AMP_SUB] = {
  bypassed: false, muted: true, fixedValue: 0.6, min: 0, max: 1, curve: 0.5,
};
RHYTHMIC_MOTION.params[lfoLabel(1, 'enable')] = {
  bypassed: false, muted: true, fixedValue: 1.0, min: 0, max: 1, curve: 0.5,
};
RHYTHMIC_MOTION.params[lfoLabel(2, 'enable')] = {
  bypassed: false, muted: true, fixedValue: 1.0, min: 0, max: 1, curve: 0.5,
};

/** 5. Envelope Sculptor — complexity 3. ADSR1&2 ADSR fields + ADSR->amp/cutoff. */
const ENV_SCULPTOR = {
  id: 'modular-env-sculptor',
  name: 'Envelope Sculptor',
  description: 'Shape ADSR 1 & 2. ADSR1 drives amp, ADSR2 drives filter.',
  engine: 'modular',
  complexity: 3,
  meta: { subEngine: 'subtractive', adsrCount: 4, lfoCount: 8 },
  params: P([
    [adsrLabel(1, 'attack'),   0.0, 0.5, 0.3],
    [adsrLabel(1, 'decay'),    0.0, 0.6, 0.3],
    [adsrLabel(1, 'sustain'),  0.0, 1.0, 0.5],
    [adsrLabel(1, 'release'),  0.0, 0.7, 0.3],
    [adsrLabel(2, 'attack'),   0.0, 0.5, 0.3],
    [adsrLabel(2, 'decay'),    0.0, 0.6, 0.3],
    [adsrLabel(2, 'sustain'),  0.0, 1.0, 0.5],
    [adsrLabel(2, 'release'),  0.0, 0.7, 0.3],
    ['3_Filter/00_cutoff',     0.1, 0.7, 0.5],
    ['3_Filter/01_resonance',  0.0, 0.6, 0.4],
    ['1_Oscillators/02_osc1_level', 0.4, 0.9, 0.5],
  ]),
  matrix: M([
    [0, 8, 0.6, 1.0, 0.6], // ADSR1 -> amp
    [1, 5, 0.4, 0.9, 0.5], // ADSR2 -> cutoff
  ]),
  groupCurves: {},
};
// Classic gated voice: base_amp 0, amp comes from ADSR1.
ENV_SCULPTOR.params[BASE_AMP_SUB] = {
  bypassed: false, muted: true, fixedValue: 0.0, min: 0, max: 1, curve: 0.5,
};
ENV_SCULPTOR.params[adsrLabel(1, 'enable')] = {
  bypassed: false, muted: true, fixedValue: 1.0, min: 0, max: 1, curve: 0.5,
};
ENV_SCULPTOR.params[adsrLabel(2, 'enable')] = {
  bypassed: false, muted: true, fixedValue: 1.0, min: 0, max: 1, curve: 0.5,
};

/** 6. Routing Sketch — complexity 3. Emphasis on cross-routing. */
const ROUTING_SKETCH = {
  id: 'modular-routing-sketch',
  name: 'Routing Sketch',
  description: 'Dense cross-routing between ADSRs and LFOs. Few direct params.',
  engine: 'modular',
  complexity: 3,
  meta: { subEngine: 'subtractive', adsrCount: 4, lfoCount: 8 },
  params: P([
    ['3_Filter/00_cutoff',          0.2, 0.9, 0.6],
    ['1_Oscillators/02_osc1_level', 0.4, 0.9, 0.5],
  ]),
  matrix: M([
    [0,  8, 0.5, 1.0, 0.6],  // ADSR1 -> amp
    [1,  5, 0.3, 0.8, 0.5],  // ADSR2 -> cutoff
    [2,  6, 0.2, 0.7, 0.5],  // ADSR3 -> resonance
    [16, 0, 0.4, 0.6, 0.5],  // LFO1  -> pitch (subtle vibrato)
    [16, 5, 0.3, 0.7, 0.5],  // LFO1  -> cutoff
    [17, 9, 0.2, 0.8, 0.5],  // LFO2  -> pan
    [18, 3, 0.3, 0.7, 0.5],  // LFO3  -> osc mix bal
    [19, 4, 0.2, 0.6, 0.5],  // LFO4  -> noise level
  ]),
  groupCurves: {},
};
ROUTING_SKETCH.params[BASE_AMP_SUB] = {
  bypassed: false, muted: true, fixedValue: 0.0, min: 0, max: 1, curve: 0.5,
};
for (const s of [1, 2]) {
  ROUTING_SKETCH.params[adsrLabel(s, 'enable')] = {
    bypassed: false, muted: true, fixedValue: 1.0, min: 0, max: 1, curve: 0.5,
  };
}
for (const s of [1, 2, 3, 4]) {
  ROUTING_SKETCH.params[lfoLabel(s, 'enable')] = {
    bypassed: false, muted: true, fixedValue: 1.0, min: 0, max: 1, curve: 0.5,
  };
}

/** 7. Full Modular — complexity 5. Everything exposed; wide matrix. */
const FULL_MODULAR = (() => {
  const params = P([
    // Full oscillator section
    ['1_Oscillators/00_osc1_wave',     0.0, 1.0, 0.5],
    ['1_Oscillators/01_osc1_range',    0.0, 1.0, 0.5],
    ['1_Oscillators/02_osc1_level',    0.0, 1.0, 0.5],
    ['1_Oscillators/03_osc2_wave',     0.0, 1.0, 0.5],
    ['1_Oscillators/04_osc2_range',    0.0, 1.0, 0.5],
    ['1_Oscillators/05_osc2_detune',   0.3, 0.7, 0.5],
    ['1_Oscillators/06_osc2_level',    0.0, 1.0, 0.5],
    ['1_Oscillators/07_osc3_wave',     0.0, 1.0, 0.5],
    ['1_Oscillators/08_osc3_range',    0.0, 1.0, 0.5],
    ['1_Oscillators/09_osc3_detune',   0.3, 0.7, 0.5],
    ['1_Oscillators/10_osc3_level',    0.0, 1.0, 0.5],
    // Mixer
    ['2_Mixer/01_noise_level',         0.0, 0.7, 0.4],
    ['2_Mixer/02_mixer_drive',         0.2, 0.9, 0.5],
    // Filter
    ['3_Filter/00_cutoff',             0.1, 1.0, 0.7],
    ['3_Filter/01_resonance',          0.0, 0.9, 0.5],
    // Master
    ['4_Master/00_master_level',       0.4, 0.85, 0.5],
    ['4_Master/02_master_tune',        0.4, 0.6, 0.5],
    ['4_Master/03_master_pan',         0.0, 1.0, 0.5],
  ]);
  // ADSR 1..4 full fields
  for (let slot = 1; slot <= 4; slot++) {
    for (const [f, min, max, curve] of [
      ['attack',  0.0, 0.6, 0.3],
      ['decay',   0.0, 0.6, 0.3],
      ['sustain', 0.0, 1.0, 0.5],
      ['release', 0.0, 0.7, 0.3],
    ]) {
      params[adsrLabel(slot, f)] = { bypassed: false, muted: false, min, max, curve };
    }
    params[adsrLabel(slot, 'enable')] = {
      bypassed: false, muted: true, fixedValue: 1.0, min: 0, max: 1, curve: 0.5,
    };
  }
  // LFO 1..8 rate/morph
  for (let slot = 1; slot <= 8; slot++) {
    params[lfoLabel(slot, 'rate')]  = { bypassed: false, muted: false, min: 0.1, max: 0.8, curve: 0.5 };
    params[lfoLabel(slot, 'morph')] = { bypassed: false, muted: false, min: 0.0, max: 1.0, curve: 0.5 };
    params[lfoLabel(slot, 'enable')] = {
      bypassed: false, muted: true, fixedValue: 1.0, min: 0, max: 1, curve: 0.5,
    };
  }
  params[BASE_AMP_SUB] = {
    bypassed: false, muted: true, fixedValue: 0.0, min: 0, max: 1, curve: 0.5,
  };

  // Matrix: ~50 cells — every ADSR to a handful of sound destinations,
  // every LFO to pitch/cutoff/amp/pan.
  const matrix = {};
  const addCell = (s, d, min = 0.3, max = 0.8, curve = 0.5) => {
    matrix[mxKey(s, d)] = { muted: false, min, max, curve };
  };
  // ADSRs 1..4 -> {amp, cutoff, resonance, pitch}
  for (let s = 0; s < 4; s++) {
    addCell(s, 8, 0.5, 1.0, 0.6); // amp
    addCell(s, 5, 0.3, 0.9, 0.5); // cutoff
    addCell(s, 6, 0.2, 0.7, 0.5); // resonance
    addCell(s, 0, 0.45, 0.55, 0.5); // pitch subtle
  }
  // LFOs 1..8 -> {pitch, cutoff, amp, pan}
  for (let s = 16; s < 24; s++) {
    addCell(s, 0, 0.45, 0.55, 0.5); // pitch (subtle vibrato)
    addCell(s, 5, 0.3, 0.7, 0.5);   // cutoff
    addCell(s, 8, 0.3, 0.7, 0.5);   // amp (tremolo)
    addCell(s, 9, 0.2, 0.8, 0.5);   // pan
  }
  // A few cross-routing extras
  addCell(4, 3, 0.3, 0.7, 0.5);  // ADSR5 -> osc_mix_bal (if adsrCount=16)
  addCell(5, 4, 0.2, 0.6, 0.5);  // ADSR6 -> noise_level

  return {
    id: 'modular-full',
    name: 'Full Modular',
    description: 'Full brain. Every major section exposed with dense matrix coverage.',
    engine: 'modular',
    complexity: 5,
    meta: { subEngine: 'subtractive', adsrCount: 16, lfoCount: 32 },
    params,
    matrix,
    groupCurves: {},
  };
})();

// ---------------------------------------------------------------------------
// Build unified preset objects
// ---------------------------------------------------------------------------

/**
 * Build a unified preset from a legacy raw entry ({id, name, description,
 * state}). Pins every DSP write as muted+fixedValue (and matrix cells as
 * min==max) so applying via the unified loader reproduces the same sound.
 */
function _fromLegacyRaw({ id, name, description, complexity, state }) {
  const { params, matrix } = _migrateStateToUnified(state);
  return {
    id,
    name,
    description,
    engine: 'modular',
    complexity,
    meta: {
      subEngine: state.subEngine,
      adsrCount: state.adsrCount,
      lfoCount:  state.lfoCount,
    },
    params,
    matrix,
    groupCurves: {},
    // Legacy shim — consumed by current applyPreset / modular-ui.js until
    // the unified loader lands. TODO(meml-17mp): drop.
    state,
  };
}

/**
 * Build the legacy `state` field for a unified-authored preset. Used only
 * so the current applyPreset() can still produce the intended sound via
 * engine.setState({...state}). For active params we write a representative
 * raw value (the normalised midpoint of min/max, or fixedValue if muted);
 * for matrix cells likewise.
 *
 * Until the unified loader lands, this is how the seven new presets get
 * applied to the engine. Once meml-17mp ships, the `state` shim can be
 * dropped and the loader will read `params`/`matrix` directly.
 */
function _synthesiseStateFromUnified(preset) {
  const dsp = {};
  // Params -> raw DSP writes.
  for (const [label, entry] of Object.entries(preset.params || {})) {
    if (entry.bypassed) continue;
    // Pick a target value in [0,1].
    const norm = entry.muted && entry.fixedValue != null
      ? entry.fixedValue
      : ((entry.min ?? 0) + (entry.max ?? 1)) / 2;
    // normToRaw requires importing that helper; use the rawToNorm inverse
    // indirectly by going through the meta table here would duplicate work.
    // Instead just import and call.
    dsp[label] = _normToRawSafe(label, norm);
  }
  // Matrix -> raw DSP writes.
  for (const [key, cell] of Object.entries(preset.matrix || {})) {
    if (cell.muted) continue;
    const m = /^s(\d+)_d(\d+)$/.exec(key);
    if (!m) continue;
    const s = +m[1];
    const d = +m[2];
    const destName = _matrixDestName(preset.meta?.subEngine, d);
    if (!destName) continue;
    const label = `MM_Matrix/s${pad2(s)}_d${pad2(d)}_${destName}`;
    const norm = cell.fixedValue != null
      ? cell.fixedValue
      : ((cell.min ?? 0) + (cell.max ?? 1)) / 2;
    dsp[label] = _normToRawSafe(label, norm);
  }
  return {
    version:   1,
    subEngine: preset.meta?.subEngine ?? 'subtractive',
    adsrCount: preset.meta?.adsrCount ?? 4,
    lfoCount:  preset.meta?.lfoCount  ?? 8,
    exposedEngineParams: [],
    dsp,
  };
}

function _normToRawSafe(label, norm) {
  try { return _normToRaw(label, norm); } catch (_) { return norm; }
}

// Sub-engine destination names. Only subtractive is fully specified here;
// additive/fm fall back to a generic label so the state snapshot still
// contains the cell (the engine skips unknown labels silently).
const ADDITIVE_DESTS = [
  'pitch', 'bright', 'detune', 'inharmonicity', 'odd_even',
  'formant_ctr', 'formant_w', 'morph', 'amp', 'pan',
];
const FM_DESTS = [
  'pitch', 'op1_level', 'op2_level', 'op3_level', 'op4_level',
  'fm_index', 'fb', 'algo', 'amp', 'pan',
];
function _matrixDestName(subEngine, d) {
  const table =
    subEngine === 'additive' ? ADDITIVE_DESTS
    : subEngine === 'fm'      ? FM_DESTS
    : SUBTRACTIVE_DESTS;
  return table[d];
}

/**
 * Attach a legacy `state` field to each of the new unified-authored presets,
 * if missing. Ensures applyPreset() (which uses engine.setState) keeps working.
 */
function _fillStateShim(preset) {
  if (!preset.state) preset.state = _synthesiseStateFromUnified(preset);
  return preset;
}

// ---------------------------------------------------------------------------
// Legacy raw entries (existing presets) -> unified, with `state` shim kept
// ---------------------------------------------------------------------------

const _LEGACY_RAW = [
  { id: 'modular-default',        name: 'Default',        description: 'Out-of-the-box patch.',
    complexity: 1, state: DEFAULT_STATE },
  { id: 'modular-slow-pad',       name: 'Slow pad',       description: 'Long ADSR, slow LFO cutoff sweep, subtle pitch drift.',
    complexity: 2, state: SLOW_PAD_STATE },
  { id: 'modular-plucky-bass',    name: 'Plucky bass',    description: 'Fast amp + filter envelopes, resonant lowpass.',
    complexity: 2, state: PLUCKY_BASS_STATE },
  { id: 'modular-crystal',        name: 'Crystal',        description: 'Additive tremolo with slow formant sweep.',
    complexity: 3, state: CRYSTAL_STATE },
  { id: 'modular-dx-bell',        name: 'DX bell',        description: 'Four staggered ADSRs driving FM operator levels.',
    complexity: 3, state: DX_BELL_STATE },
  { id: 'modular-morphing-drone', name: 'Morphing drone', description: 'Additive drone with LFO-driven spectral morphing.',
    complexity: 3, state: MORPHING_DRONE_STATE },
];

const _LEGACY_UNIFIED = _LEGACY_RAW.map(_fromLegacyRaw);

const _NEW_UNIFIED = [
  WIDE_TIMBRE,
  BLANK_SLATE,
  FILTER_STUDY,
  RHYTHMIC_MOTION,
  ENV_SCULPTOR,
  ROUTING_SKETCH,
  FULL_MODULAR,
].map(_fillStateShim);

export const MODULAR_PRESETS = [..._LEGACY_UNIFIED, ..._NEW_UNIFIED];

// ---------------------------------------------------------------------------
// Loader + lookup (API-compatible with previous module)
// ---------------------------------------------------------------------------

/**
 * Apply a preset to a ModularEngine.
 *
 * Unified path (preferred, meml-17mp): reads `preset.params` and
 * `preset.matrix` directly, calling setParam / setMatrixCell /
 * setExposeEngineParam / setExposeMatrixCell as appropriate. Bypassed or
 * muted sound-engine params and muted matrix cells are un-exposed so the
 * MLP's output vector never tries to drive them; for sound params this
 * means they do not appear in `engine.paramMeta`. Bypass is treated as
 * a stronger mute (cell-is-muted AND un-exposed) to match the schema,
 * but in the modular engine the observable behaviour is the same as mute
 * today — downstream MLP rebuild filters happen via the
 * `setExpose*` calls that already fire `paramMeta:change`.
 *
 * Legacy path (fallback): when the preset has no `params` field but does
 * have a `state` snapshot (older unified-authored or hand-authored
 * presets), we defer to `engine.setState()` which restores raw DSP values,
 * sub-engine, and mod source counts.
 *
 * @param {import('./modular-engine.js').ModularEngine} engine
 * @param {object} preset
 */
export async function applyPreset(engine, preset) {
  if (!engine || !preset) return;

  const hasUnifiedParams = preset.params && typeof preset.params === 'object'
    && !Array.isArray(preset.params);
  const hasUnifiedMatrix = preset.matrix && typeof preset.matrix === 'object'
    && !Array.isArray(preset.matrix);

  // Sub-engine swap + mod-source counts must happen first — they reshape
  // paramMeta and the label space that param/matrix writes target.
  const meta = preset.meta || {};
  if (typeof meta.subEngine === 'string' &&
      typeof engine.setSubEngine === 'function') {
    try { await engine.setSubEngine(meta.subEngine); }
    catch (err) { console.warn('[modular-presets] setSubEngine failed', err); }
  }
  if (typeof engine.setModSourceCount === 'function' &&
      (typeof meta.adsrCount === 'number' || typeof meta.lfoCount === 'number')) {
    const curAdsr = engine._adsrCount ?? 4;
    const curLfo  = engine._lfoCount  ?? 8;
    engine.setModSourceCount(
      typeof meta.adsrCount === 'number' ? meta.adsrCount : curAdsr,
      typeof meta.lfoCount  === 'number' ? meta.lfoCount  : curLfo,
    );
  }

  // Legacy fallback: no unified fields → use the state shim (restores raw
  // DSP + counts + sub-engine in one go).
  if (!hasUnifiedParams && !hasUnifiedMatrix) {
    const state = preset.state;
    if (!state) return;
    if (typeof engine.resetToDefaults === 'function') {
      engine.resetToDefaults();
    }
    await engine.setState({ version: 1, ...state });
    return;
  }

  if (typeof engine.resetToDefaults === 'function') {
    engine.resetToDefaults();
  }

  // --- Unified params (non-matrix labels) ---
  // Sound-engine params need explicit expose calls so they enter paramMeta.
  // Matrix labels in `params` are rare but we handle them by skipping (the
  // `matrix` object is the canonical home for matrix cells).
  if (hasUnifiedParams) {
    for (const [label, entry] of Object.entries(preset.params)) {
      if (!entry || typeof entry !== 'object') continue;

      // Matrix cells belong in preset.matrix. If they appear in params,
      // the matrix block below will override anyway; skip here.
      if (label.startsWith('MM_Matrix/')) continue;

      const bypassed = !!entry.bypassed;
      const muted    = !!entry.muted;

      // Sound-engine (non-mod-pool) params: expose <=> alive.
      // Mod-pool (MM_ADSR/, MM_LFO/) params are always in paramMeta and
      // can't be un-exposed; for those, expose calls are a no-op.
      const isModPool = label.startsWith('MM_ADSR/') || label.startsWith('MM_LFO/');
      if (!isModPool && typeof engine.setExposeEngineParam === 'function') {
        engine.setExposeEngineParam(label, !(bypassed || muted));
      }

      // Value to write:
      //   - bypassed/muted with fixedValue → pin to fixedValue
      //   - otherwise → fixedValue if present, else midpoint of [min,max]
      let norm;
      if ((bypassed || muted) && typeof entry.fixedValue === 'number') {
        norm = entry.fixedValue;
      } else if (typeof entry.fixedValue === 'number') {
        norm = entry.fixedValue;
      } else {
        const mn = typeof entry.min === 'number' ? entry.min : 0;
        const mx = typeof entry.max === 'number' ? entry.max : 1;
        norm = (mn + mx) / 2;
      }
      if (typeof engine.setParam === 'function') {
        engine.setParam(label, norm);
      }
    }
  }

  // --- Unified matrix cells ---
  // For matrix cells: expose iff not muted and not bypassed. Cells NOT
  // present in preset.matrix are explicitly un-exposed (schema omission
  // rule: absent matrix cells = muted/off).
  if (hasUnifiedMatrix &&
      typeof engine.setExposeMatrixCell === 'function' &&
      typeof engine.setMatrixCell === 'function') {
    const destNames = engine.destNames || engine._subCfg?.destNames || [];
    const nDest = destNames.length || 10;
    const nSrc  = 48;
    const seen  = new Set();
    for (const [key, cell] of Object.entries(preset.matrix)) {
      if (!cell || typeof cell !== 'object') continue;
      const m = /^s(\d+)_d(\d+)$/.exec(key);
      if (!m) continue;
      const s = +m[1];
      const d = +m[2];
      seen.add(`${s}|${d}`);

      const bypassed = !!cell.bypassed;
      const muted    = !!cell.muted;
      const live     = !(bypassed || muted);
      engine.setExposeMatrixCell(s, d, live);

      if (live) {
        const norm = typeof cell.fixedValue === 'number'
          ? cell.fixedValue
          : ((typeof cell.min === 'number' ? cell.min : 0) +
             (typeof cell.max === 'number' ? cell.max : 1)) / 2;
        engine.setMatrixCell(s, d, norm);
      } else {
        // Muted cell: raw 0 (norm01=0.5 under bipolar ±0.9 mapping)
        engine.setMatrixCell(s, d, 0.5);
      }
    }
    // Un-expose any cell the preset didn't mention.
    for (let s = 0; s < nSrc; s++) {
      for (let d = 0; d < nDest; d++) {
        if (seen.has(`${s}|${d}`)) continue;
        engine.setExposeMatrixCell(s, d, false);
        engine.setMatrixCell(s, d, 0.5);
      }
    }
  }
}

/** Look up a preset by id. */
export function findPreset(id) {
  return MODULAR_PRESETS.find(p => p.id === id) ?? null;
}
