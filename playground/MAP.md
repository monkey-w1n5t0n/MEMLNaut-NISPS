# Playground module map

Quick index of the non-obvious modules under `playground/js/`. Keep entries to
one line each — pointer not explainer.

## Synth

- `js/synth/param-map.js` — C15 engine: 126 curated params (from 287), used by
  the immersive app's synth mode.
- `js/synth/faust-param-meta.js` — generic Faust JSON → paramMeta converter
  (used by additive / fm / eoc engines).
- `js/synth/modular-param-meta.js` — hand-curated metadata for the Modular
  engine (subtractive): unit, rawMin/Max, safeMin/Max, curve, group, humanName
  for 679 labels (23 sound params + 16×5 ADSR + 32×3 LFO + 48×10 Matrix).
  Exports `MODULAR_PARAM_META`, `getMeta`, `normToRaw`, `rawToNorm`,
  `parseMatrixLabel`. Lets presets use [0,1] normalised bounds against the
  modular engine.
- `js/synth/modular-engine.js` — owns `_walkEntries` and `paramMeta` for the
  active modular sub-engine; matrix source ordering 0..15 = ADSR, 16..47 = LFO.
- `js/synth/modular-presets.js` — Phase E modular preset snapshots.
- `faust/MODULAR_DESTINATIONS.md` — canonical per-engine matrix destination
  table (sNN × dNN semantics).
