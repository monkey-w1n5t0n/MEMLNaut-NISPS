/**
 * group-columns.js — classify synth groups into Patch Editor modal columns.
 *
 * The Patch Editor modal (meml-n3uh) renders group cards in three columns:
 *   - 'Sound'      — oscillators, mixers, filters, shapers, output/cabinet,
 *                    and FX that live in the main audio signal path.
 *   - 'Modulation' — modulation sources (envelopes, LFOs).
 *   - 'Routing'    — modulation routing (matrix, FB mixer when genuinely
 *                    a routing-only stage).
 *
 * The matrix on the modular engine is a single UI card ("Open Patch Bay")
 * rendered by the modal in the Routing column — see meml-usd6. The matrix
 * itself (all 480 cells) is one logical group here: 'Matrix'.
 *
 * Unknown groups fall back to 'Sound' as a conservative default so new
 * groups at least show up visibly rather than being silently hidden.
 */

/** @typedef {'Sound' | 'Modulation' | 'Routing'} Column */

// ---------------------------------------------------------------------------
// Modular engine group classification
// Groups come from modular-param-meta.js STATIC_META + generated ADSR/LFO/Matrix.
// ---------------------------------------------------------------------------

/** @type {Record<string, Column>} */
export const MODULAR_GROUP_COLUMNS = {
  // Sound: signal-path voice construction
  'Oscillator 1': 'Sound',
  'Oscillator 2': 'Sound',
  'Oscillator 3': 'Sound',
  'Mixer':        'Sound',
  'Filter':       'Sound',
  'Master':       'Sound',

  // Modulation: ADSR 1..16 and LFO 1..32 filled in below
  // Routing: matrix is a single card
  'Matrix': 'Routing',
};

for (let i = 1; i <= 16; i++) MODULAR_GROUP_COLUMNS[`ADSR ${i}`] = 'Modulation';
for (let i = 1; i <= 32; i++) MODULAR_GROUP_COLUMNS[`LFO ${i}`]  = 'Modulation';

// ---------------------------------------------------------------------------
// C15 engine group classification
// Group names match the SECTION comments in param-map.js, with the short
// labels the group-drawer UI uses.
//
// Reasoning:
//  - Envelopes (A/B/C) — pure modulation sources -> Modulation.
//  - Oscillators (A/B) — primary tone generators -> Sound.
//  - Shapers (A/B)     — waveshaping / distortion on the signal path -> Sound.
//  - Comb / SVF / Gap  — filters on the signal path -> Sound.
//  - Feedback Mixer    — routes feedback taps from comb/SVF/FX/reverb/osc
//                        BACK into oscillators. This is genuinely a routing
//                        matrix (source-to-destination choices), so -> Routing.
//  - Output Mixer      — channel sums with level/pan/drive/fold per source.
//                        Although it has some routing character (per-source
//                        levels), it's primarily a sound-shaping sum stage
//                        with drive/fold/asym. -> Sound. (Users expect to
//                        tweak Out A/B/Comb/SVF levels alongside tone.)
//  - Cabinet           — post output tone shaping (drive/fold/tilt/EQ) -> Sound.
//  - Flanger/Echo/Reverb — time-domain FX -> Sound.
//  - Unison            — voice-stacking detune/phase/pan; affects timbre
//                        directly -> Sound.
//  - Mono              — glide time. Ambiguous (performance control) but
//                        sits alongside pitch behavior in Sound.
// ---------------------------------------------------------------------------

/** @type {Record<string, Column>} */
export const C15_GROUP_COLUMNS = {
  // Modulation sources
  'Envelope A':              'Modulation',
  'Envelope B':              'Modulation',
  'Envelope C':              'Modulation',

  // Sound: signal path
  'Oscillator A':            'Sound',
  'Oscillator B':            'Sound',
  'Shaper A':                'Sound',
  'Shaper B':                'Sound',
  'Comb Filter':             'Sound',
  'State Variable Filter':   'Sound',
  'Gap Filter':              'Sound',
  'Output Mixer':            'Sound',
  'Cabinet':                 'Sound',
  'Flanger':                 'Sound',
  'Echo':                    'Sound',
  'Reverb':                  'Sound',
  'Unison':                  'Sound',
  'Mono':                    'Sound',

  // Routing: source/destination feedback matrix
  'Feedback Mixer':          'Routing',
};

// ---------------------------------------------------------------------------
// Additive engine group classification
// Faust additive.json exposes a single top-level 'additive' group, so the
// nonC15Sections machinery currently emits one section. If/when future
// DSP splits the UI tree, add entries here. The name-regex fallback in
// getColumn() also catches common patterns (ADSR/Env/LFO → Modulation).
// ---------------------------------------------------------------------------

/** @type {Record<string, Column>} */
export const ADDITIVE_GROUP_COLUMNS = {
  'additive':        'Sound',
  'Spectral Shape':  'Sound',
  'Partials':        'Sound',
  'Oscillator':      'Sound',
  'Filter':          'Sound',
  'Output':          'Sound',
  'Master':          'Sound',
  'Phase':           'Sound',
  'Temporal':        'Modulation',
  'ADSR':            'Modulation',
  'Envelope':        'Modulation',
  'LFO':             'Modulation',
  'Modulation':      'Modulation',
  'Matrix':          'Routing',
};

// ---------------------------------------------------------------------------
// FM engine group classification
// fm-matrix.json exposes a single top-level 'fm-matrix' group. Included
// names cover plausible Faust subgroup labels if the DSP is split later.
// ---------------------------------------------------------------------------

/** @type {Record<string, Column>} */
export const FM_GROUP_COLUMNS = {
  'fm-matrix':       'Sound',
  'Operators':       'Sound',
  'Operator':        'Sound',
  'Carrier':         'Sound',
  'Modulator':       'Sound',
  'Output':          'Sound',
  'Master':          'Sound',
  'Filter':          'Sound',
  'ADSR':            'Modulation',
  'Envelope':        'Modulation',
  'LFO':             'Modulation',
  'Modulation':      'Modulation',
  'Matrix':          'Routing',
  'Routing':         'Routing',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the Patch Editor modal column for a given (engine, groupName) pair.
 * Unknown groups default to 'Sound' so nothing disappears from the UI.
 *
 * @param {string} engine     e.g. 'modular', 'c15'
 * @param {string} groupName  group label as produced by paramMeta / param-map
 * @returns {Column}
 */
export function getColumn(engine, groupName) {
  const table = engine === 'modular'  ? MODULAR_GROUP_COLUMNS
              : engine === 'c15'      ? C15_GROUP_COLUMNS
              : engine === 'additive' ? ADDITIVE_GROUP_COLUMNS
              : engine === 'fm'       ? FM_GROUP_COLUMNS
              : null;
  if (table && table[groupName]) return table[groupName];
  // Name-regex fallback for unknown groups — covers new subgroups that
  // appear in Faust UI without needing a code change.
  if (typeof groupName === 'string' && groupName.length > 0) {
    if (/^(ADSR|LFO|Env|Envelope|Modulation|Temporal)\b/i.test(groupName)) return 'Modulation';
    if (/^(Matrix|Routing|FB\s*Mix)/i.test(groupName)) return 'Routing';
  }
  return 'Sound';
}
