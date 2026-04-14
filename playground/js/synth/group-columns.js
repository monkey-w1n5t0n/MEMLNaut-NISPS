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
  const table = engine === 'modular' ? MODULAR_GROUP_COLUMNS
              : engine === 'c15'     ? C15_GROUP_COLUMNS
              : null;
  if (table && table[groupName]) return table[groupName];
  return 'Sound';
}
