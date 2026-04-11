# Modular engines — modulation destination table

Each of the three `modular-*` Faust engines exposes a 48-source × 10-destination
modulation matrix. All engines import `mod-pool.lib` (16 ADSRs + 32 LFOs = 48
sources) and bind those sources to engine-specific destinations via the
`MM_Matrix/sNN_dNN_<destname>` slider labels.

The destination index (`dNN`) is consistent per engine but NOT consistent across
engines — `d08` happens to be `amp` for all three because the generator places
the master amplitude destination in the same slot for every engine, which makes
it easy for Phase B to wire up a default ADSR1→amp patch regardless of the
active engine.

| Engine      | d00   | d01         | d02         | d03            | d04        | d05              | d06             | d07            | d08 | d09 |
|-------------|-------|-------------|-------------|----------------|------------|------------------|-----------------|----------------|-----|-----|
| subtractive | pitch | osc2_detune | osc3_detune | osc_mix_bal    | noise_level| cutoff           | resonance       | filter_env_amt | amp | pan |
| additive    | pitch | bright      | tilt        | inharmonicity  | odd_even   | formant_ctr      | formant_depth   | noise_mix      | amp | pan |
| fm          | pitch | op1_level   | op2_level   | op3_level      | op4_level  | cross_mod_global | feedback_global | global_ratio   | amp | pan |

## Conventions

- **Source index** (`sNN`): 00..15 = ADSR slots 1..16, 16..47 = LFO slots 1..32.
- **Amount range**: each matrix slider is `[-1.0, +1.0]`, default 0 (no route).
- **`amp` destination** (d08): always the master amplitude destination for the
  engine. Without any source routed here, the voice is either silent
  (subtractive — the mod_amp signal multiplies into the VCA) or produces a
  sustained tone at the engine's natural level (additive and fm — still gated
  through mod_amp; without a route the amp signal is 0). **Route ADSR1 → d08
  for a standard VCA envelope in all three engines.**
- **`pitch` destination** (d00): always semitones, ±12 per mod unit.
- **`pan` destination** (d09): added to the master pan knob, clamped to [-1,1].

## Notes

- `additive.bright` is a progressive high-partial boost/cut (replaces the old
  brightness envelope in the non-modular `additive.dsp`). At mod=0, it is
  unity; at mod=+1 it boosts top partials, at -1 it cuts them.
- `additive.formant_ctr` shifts BOTH formant centre frequencies by the same
  amount (up to ±8 harmonics) so you can "move" the vocal shape with an LFO or
  envelope.
- `fm.cross_mod_global` and `fm.feedback_global` are `(1 + mod)` multipliers
  applied to the respective matrix cells BEFORE the feedback loop is closed,
  so a mod of +1 doubles FM depth and -1 zeroes it out.
- `fm.global_ratio` is an ADDITIVE offset on all four operator ratios (±8),
  clamped to ≥0.01. This can behave like a pitch-bend when animated slowly.
