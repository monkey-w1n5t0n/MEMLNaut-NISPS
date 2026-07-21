# Schema authoring notes

This document captures provenance and judgement calls for each mode schema. Read alongside the firmware sources of truth.

## Conventions

- All `params` ranges are **normalised `[0,1]`**. The firmware voice spaces apply per-mode scaling (e.g. `peak0Freq = 200.f + (params[1] * params[1] * 1800.f)`); we expose the NN-output-space here, not the engine-state-space, because the same NN slot drives different engine values across voice spaces.
- `curve` is **descriptive, and verified**. It records what the engine already does; the curve is applied exactly once, inside the voice space. Nothing downstream re-applies it. `params[].curve` is the mode-wide DEFAULT; a voice space that deviates declares the delta in `voice_spaces[].curve_overrides` (name → curve), and only the delta. `codegen/tests/curve_drift_test.ts` cross-checks every (voice space × param) slot against `nisps/engines/*.hpp` source on every run — see below.

### What `square` / `sqrt` / `linear` mean, exactly

The drift check needs a total, decidable predicate, so:

- `square` — the engine multiplies **that slot by itself** (`p[n] * p[n]`, or via a `const float v = p[n]` alias, or memlcelium's `sq()` lambda).
- `sqrt` — the engine passes **that slot alone** through `std::sqrt`.
- `linear` — everything else.

"Everything else" deliberately swallows three shapes the `Curve` enum cannot express, and they are declared `linear` by definition rather than by oversight:

1. **Quantisation.** `muls[static_cast<int>(p[n] * 3.999999f) & 3]`, `idx_clamp(p[7] * 3.999999f, 5)` — the underlying response is linear, then stepped. Every `Neve 80` frequency and every sequencer ratio is this.
2. **Compound self-products.** paf_synth's Elderstar/Ipeleiades compute `factor = 1.f + (p[17] + p[27] * 0.6f)` and then use `factor * factor`. No single slot is squared; two slots are terms inside a squared sum. `linear`.
3. **Trigonometric combination.** paf_synth Magnetarch folds `p[0] + p[7] + p[8]` through `sin()`. `linear`.

Anything the extractor cannot place in one of these buckets is a **hard error**, not a silent `linear`. That is the whole point: a regex over `p[N] * p[N]` would have missed the alias form, the `sq()` lambda, loop-generated indices and `smooth_params_[N]` — all four are live in this codebase.

### Voice-space ordering is load-bearing

`voice_spaces[i]` **is** `VoiceSpace` ordinal `i` — `ModeBase::set_voice_space(idx)` casts the index straight to the enum. The drift check asserts the schema's names equal the engine's `kVoiceSpaceNames`, in order. Note that paf_synth's enum order (`Ellipticacacia`=QuadDetune, `Rowantares`=VS1, `Neemeda`=VS2, `Aquillow`=Perc, `Magnetarch`=Single1, `Elderstar`=QuadOct, `Ipeleiades`=QuadDist) is **not** the order of the `apply_*` functions in the source file.
- `output_size` matches the actual number of params consumed in `ProcessParams()`. Where the firmware's templated NPARAMS is larger than what's consumed, we follow consumption (see `elysiamorf`).

## Per-mode notes

### paf_synth (33 params, 7 voice spaces)
- Source of truth: `PAFSynthAudioApp.hpp` + `voicespaces/VoiceSpace*.hpp`.
- Voice space 1 (Rowantares) uses param indices 2,3,5,6,8,9,11,12,14,15,17,19,20,26,27,28,29,30,31,32 — 20 of 33 slots have a clear meaning. Other voice spaces use overlapping but not identical subsets. We named the meaningful slots after the dominant Rowantares mapping; unused-by-VS1 slots get generic `pXX` names. A future cleanup could canonicalise these names per-voice-space, but the schema is mode-wide so a single canonical name set is correct.
- The mode-wide `curve` default is **Rowantares** (`voice_spaces[1]`), matching the naming convention above — not `voice_spaces[0]`. All six other voice spaces carry `curve_overrides`. This reads oddly in the override tables (`Ellipticacacia.paf0_shift: square` means "QuadDetune squares slot 14, which VS1 calls paf0_shift and uses as a formant shift"); that is the pre-existing per-mode-naming wart above surfacing, not a bug in the table.

### channel_strip (24 params, 6 voice spaces)
- Source of truth: `ChannelStripAudioApp.hpp` + `voicespaces/ChannelStrip/basic.hpp`.
- All 6 voice spaces touch the same param indices (0,1,4,5,6,7,8,10,11,12,13,14..19,23). Indices 2,3,9,20,21,22 are NN-output slots with no engine effect — exposed as raw `pXX` for future voice-space designers.
- The mode-wide `curve` default is **WannabeNeve66** (`voice_spaces[0]`). Deviations: SSL 4K/9K additionally square `comp_ratio`; MaleVox/FemaleVox do not square `comp_release`; Neve 80 replaces every frequency/ratio with a stepped lookup, so only the two gains stay squared.

### xiasri (24 params, 0 voice spaces — direct mapping)
- Source of truth: `XIASRIAudioApp.hpp::Process()`.
- The current firmware bypasses voice spaces and reads `smoothParams[]` directly. We expose a synthetic "Direct" voice space name so consumers don't crash; the engine semantics are fixed by `Process()`. Indices 3, (and unused) align with code.
- Index 12 (`pitch_transp`) maps to `12.f + smoothParams[12]` semitones (a strange offset; flagged in `ALIGNMENT.md` candidate).

### verb_fx (47 params, 12 voice spaces)
- Source of truth: `modes/AudioApps/VerbFXAudioApp.hpp` + `voicespaces/VerbFX/*.hpp`.
- The "Default" voice space is fully exposed; other voice spaces remap the same 47 slots with different scalings.
- Hidden layers tweaked to `[10, 14, 18]` for the larger output size.
- The mode-wide `curve` default is **Default** (`voice_spaces[0]`), the only all-linear voice space. The other **eleven** all deviate — Soft/Chamber/Granular square the comb and allpass feedbacks and the filterbank resonances; Cathedral/Shimmer/Diffuse/Metallic `sqrt` them; Dark and Bright split the filterbank by index (`i < 4` one way, the rest the other); Granular is Soft with four late slots re-mapped. This is by far the biggest gap the 2026-07 audit's "declaration is lossy" finding was pointing at: the schema previously said "nothing is curved" for all twelve.
- Slot 44 (`delay_to_verb`) is read by no voice space at all. Left declared for layout stability; flagged here rather than in `ALIGNMENT.md` because it is one dead slot, not a strategic defect.

### memlcelium (56 params, 0 effective voice spaces)
- Source of truth: `modes/AudioApps/MEMLCeliumAudioApp.hpp::ProcessParams()`.
- Voice spaces are commented out in firmware; we expose a "Direct" placeholder.
- Param 0-13 = sequencer (2 RatioSeq tracks × 7), 14-55 = synth (matches `kFocusSeq`/`kFocusSyn` mask).
- Some env params are scaled with an `sq()` lambda over an **implicit** index counter that starts at `i = 14` and advances through `params[i++]` (`nisps/engines/memlcelium.hpp`). Slots 21, 22, 27, 29, 31, 50, 52, 54 come out squared. No index literal appears in the source, so this is exactly the case a `p[N] * p[N]` regex misses; the drift check models the counter instead.

### breakor (56 params, 0 voice spaces)
- Source of truth: `modes/AudioApps/BreakOrAudioApp.hpp` + `RatioSeqEngine::updateParams()`.
- 8 sequences × 7 ratio-seq params each. Track names (kick, snare, tom, etc.) are inferred from the General-MIDI-style note assignments in `Setup()`: `{36,37,38,39,40,42,43,45}` → kick, snare, low tom, mid tom, high tom, closed hat, open hat, ride. We named tracks by typical drum semantics; firmware doesn't enforce this naming.
- BPM and clock-mode are not ML-controlled (they're hardware-side knobs/MIDI clock).

### elysiamorf (40 params, 0 voice spaces)
- Source of truth: `modes/AudioApps/ElysiamorfAudioApp.hpp::ProcessParams()`.
- Firmware NPARAMS=56 by template default, but only 40 are consumed (5 per FM-seq × 8 seqs). `fbLevel` is hard-coded to 0; the historical `paramIdx++` for it was commented out, so the param layout is **5 wide per seq, not 6**. The remaining 16 NN outputs are unused and we don't expose them — the rewrite should template the engine to NPARAMS=40.

### sound_analysis_midi (8 params, 0 voice spaces)
- Source of truth: `modes/MEMLNautModeSoundAnalysisMIDI.hpp` + `XiasriAnalysis.hpp` + `ThruAudioApp.hpp`.
- Inputs are 6 audio analysis features (XiasriAnalysis) + 4 analog joystick channels = 10 inputs. The engine is Thru (passthrough); the 8 NN outputs become MIDI CCs sent on channel 1.
- This is the only mode where input channels include audio analysis features — the rewrite's mode concept treats these as just more abstract `[0,1]` channels, same as a joystick axis.

## Open questions for the orchestrator

1. **Hidden-layer architecture per mode**: I used `[10, 10, 14]` for ≤33-output modes and `[10, 14, 18]` for larger ones. The architecture doc shows `[10, 10, 14, 126]` for the playground default. Confirm whether per-mode hidden-layer tuning is actually warranted or whether all modes should share one architecture sized for the largest output.
2. **`engine_id` for sequencers**: BreakOr and Elysiamorf produce no audio (only MIDI/i2c). I gave them `engine_id` matching their `mode_id`; the AudioEngine concept may need a sentinel "no-op" engine in the rewrite. Flagged for stream 3 (engines).
3. **Voice space naming**: PAF voice spaces have planet/star names (Ellipticacacia, Rowantares, …); VerbFX uses descriptive names (Default, Resonant, …); ChannelStrip uses console emulations (WannabeNeve66, …). The schema preserves these as opaque strings — consumers must match them against the C++ lambda registry.
