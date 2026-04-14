# SPIKE — modular subtractive engine audibility with all matrix cells raw=0

Issue: meml-ik2l. Blocks M1 preset catalogue (meml-2l83, "Wide Timbre", "Blank Slate").

## Question

Do the `Wide Timbre` and `Blank Slate` modular presets — which deliberately leave
the MM_Matrix mixer fully zeroed — still produce an audible, clean tone from the
modular subtractive engine? Or does amp/gate require at least one always-routed
matrix cell?

## Method

Code inspection of the Faust source of record for the subtractive engine:
`playground/faust/modular-subtractive.dsp`. No Playwright run was needed — the
signal path is short and unambiguous.

## Signal path under "all MM_Matrix raw = 0"

With every `MM_Matrix/s*_d*_*` slider at `0.0`, every aggregator `mod_*(gate)`
(defined lines ~91–1095) is an arithmetic sum of `mp.srcN(gate) * 0` terms and
therefore evaluates to `0`.

Amp gate (`modular-subtractive.dsp:1190`):

```
amp_val = max(0.0, min(1.0, base_amp + max(0.0, mod_amp(gate))))
        * master_level * vel_gain;
```

With `mod_amp(gate) = 0` and the defaults on lines 83, 76, 39/1184:

- `base_amp` = 1.0 (default, `4_Master/04_base_amp`, line 83)
- `master_level` = 0.7 (default, `4_Master/00_master_level`, line 76)
- `vel_gain` = 0.7 + 0.3 * vel → 0.91 at default vel=0.7 (line 1184)

→ `amp_val ≈ 1.0 * 0.7 * 0.91 ≈ 0.637`. Non-zero, fully open.

Oscillator/mixer sum (`modular-subtractive.dsp:1160–1166`):

```
mix_sum = o1 * osc1_level * w_o1
        + o2 * osc2_level
        + o3 * osc3_level * w_o3
        + noise_raw * noise_lvl;
mix_driven = ma.tanh(mix_sum * mixer_drive);
```

Defaults (lines 46/51/56/63/64):

- `osc1_level` = 0.8, `osc2_level` = 0.6, `osc3_level` = 0.4
- `noise_level` = 0.0 (default off)
- `mix_bal` = 0 → `w_o1 = w_o3 = 0.5` (line 1144–1147)
- `mixer_drive` = 1.0

All three oscillators are audible out of the box. With matrix zero, mix is still
`0.8*0.5*o1 + 0.6*o2 + 0.4*0.5*o3` — a healthy saw-blend (all `osc*_wave`
defaults are saw 0.0, except osc3 which is triangle 0.5).

Filter (`modular-subtractive.dsp:1171–1177`):

- `mod_cutoff(gate) + mod_filter_env_amt(gate) = 0 + 0 = 0` → `cutoff_mod_oct = 0`
- `eff_cutoff = cutoff` = 1200 Hz (line 69 default), `eff_res` = 0.3 (line 70)
- `filtered = mix_driven : ve.moog_vcf(0.3, 1200)` — open, musical, non-silent.

Output (`modular-subtractive.dsp:1197–1201`):

```
signal   = filtered * amp_val;
signal_L = signal * pan_l;   signal_R = signal * pan_r;
process  = signal_L, signal_R;
```

Equal-power pan at `pan_val = 0` gives `pan_l = pan_r = cos(π/4) ≈ 0.707`.

## Answer

Audible. Clean. A ~220 Hz (default `freq`) saw/triangle blend through a 1200 Hz
Moog VCF at res 0.3, at roughly `0.637 * 0.707 ≈ 0.45` linear amplitude per
channel — a recognisable synth tone, not a click or DC pop.

The fix in commit `b290144` (base_amp default = 1.0) and `01c1346`
(positive-only `mod_amp` floor via `max(0.0, mod_amp(gate))`) is exactly what
makes this safe: negative amp modulation cannot pull the gate shut, and zero
modulation leaves `base_amp` fully open.

## Recommendation for meml-2l83

**Confirm the preset catalogue as designed — omitted matrix cells are safe for
the modular subtractive engine.** `Wide Timbre` and `Blank Slate` can ship with
no routed matrix cells and will produce a clean, continuously-gated tone driven
entirely by the static oscillator/filter knobs.

Preset authors should keep in mind:

- `base_amp` must be ≥ some audible floor (default 1.0 is fine). If a preset
  lowers `base_amp` to 0 without routing a positive ADSR/LFO → `d08_amp` cell,
  the voice will be silent. This is the documented "envelope-gated voice"
  pattern (see the inline comment at lines 1185–1189).
- At least one of `osc1_level`, `osc2_level`, `osc3_level`, `noise_level` must
  be > 0 for there to be any source signal — the defaults already satisfy this.
- `master_level` > 0 (default 0.7).
- `cutoff` default (1200 Hz) + `resonance` (0.3) pass plenty of signal. Presets
  that lower cutoff toward 20 Hz without routing a positive `d05_cutoff` cell
  would sound muffled/silent — a similar caveat, but out of scope for the
  raw=0 question.

## Caveats

- This finding applies to **`modular-subtractive.dsp`** only. The `modular-fm`
  and `modular-additive` engines have different default signal paths and should
  be audited separately before reusing the same preset pattern there.
- The analysis assumes the MIDI `gate` is ON. With `gate = 0`, some
  `mp.srcN(gate)` sources (ADSR stages) return 0, but that does not affect the
  raw=0 case because the matrix multiplies to 0 either way. `base_amp` is not
  gate-dependent, so a held note with gate high is always audible.
- No test was added. If a regression guard is wanted, a Playwright test that
  (a) selects the modular-subtractive engine, (b) sets every `MM_Matrix/*`
  param to 0 via `_setRawByLabel`, (c) triggers a note, and (d) checks an
  `AnalyserNode` RMS > threshold would pin this property. Filed as future work.

## References

- `playground/faust/modular-subtractive.dsp:37-83` — default values
- `playground/faust/modular-subtractive.dsp:997-1045` — `mod_amp` aggregator
- `playground/faust/modular-subtractive.dsp:1160-1166` — mixer sum
- `playground/faust/modular-subtractive.dsp:1171-1177` — filter
- `playground/faust/modular-subtractive.dsp:1184-1201` — amp / output / process
- Commits `01c1346`, `b290144` — the base_amp floor fixes that make this safe
