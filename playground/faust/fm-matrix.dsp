// fm-matrix.dsp — Full 56-parameter 4-operator FM synthesizer with continuous routing matrix
//
// Design: 4 operators with fully continuous N×N cross-modulation matrix.
// No fixed algorithm slots — the algorithm emerges from modulation index values.
// When all routing matrix indices are near 0: additive synthesis.
// As indices grow: increasingly complex FM timbres emerge.
//
// Parameter ordering (56 total, maps to MLP output indices 0–55):
//   0–23:  Operator Core × 4 (ratio, level, attack, decay, sustain, release)
//   24–35: Cross-Modulation Matrix (12 directed pairs)
//   36–39: Self-Feedback × 4
//   40–47: Global Modulation (LFO, pitch env, velocity)
//   48–55: Master (level, vel sens, glide, fine tune, waveform blend, stereo spread,
//           output saturation, output HP)
//
// Hidden params (not in the 56-param NISPS list):
//   freq  — set by noteOn (Hz)
//   gate  — set by noteOn/noteOff (0/1)
//   _vel  — set by noteOn (velocity 0–1)
//
// FM implementation: each operator phase-modulates others via a 1-sample delayed
// feedback bus. The 4 operator outputs are collected into a 4-channel bus and
// looped via ~. This is the standard Faust FM pattern.
//
// Build:
//   nix-shell -p faust --run \
//     "faust -lang wasm -cn fm_matrix fm-matrix.dsp -o fm-matrix.wasm"

import("stdfaust.lib");

// ---------------------------------------------------------------------------
// Hidden control params (driven by noteOn/noteOff, not NISPS)
// ---------------------------------------------------------------------------

freq = hslider("Master/freq[hidden:1][unit:Hz]", 220, 20, 4000, 0.01);
gate = button("Master/gate[hidden:1]");
vel  = hslider("Master/_vel[hidden:1]", 0.7, 0.0, 1.0, 0.001) : si.smoo;

// ---------------------------------------------------------------------------
// Group 1 — Operator Core × 4  (params 0–23)
// ---------------------------------------------------------------------------

op1_ratio   = hslider("Operators/Op 1/op1_ratio",   1.0, 0.125, 16.0, 0.001) : si.smoo;
op1_level   = hslider("Operators/Op 1/op1_level",   0.8, 0.0,   1.0,  0.001) : si.smoo;
op1_attack  = hslider("Operators/Op 1/op1_attack",  0.01, 0.001, 5.0, 0.001);
op1_decay   = hslider("Operators/Op 1/op1_decay",   0.3, 0.001, 10.0, 0.001);
op1_sustain = hslider("Operators/Op 1/op1_sustain", 0.7, 0.0,   1.0,  0.001);
op1_release = hslider("Operators/Op 1/op1_release", 0.5, 0.01,  10.0, 0.001);

op2_ratio   = hslider("Operators/Op 2/op2_ratio",   2.0, 0.125, 16.0, 0.001) : si.smoo;
op2_level   = hslider("Operators/Op 2/op2_level",   0.6, 0.0,   1.0,  0.001) : si.smoo;
op2_attack  = hslider("Operators/Op 2/op2_attack",  0.01, 0.001, 5.0, 0.001);
op2_decay   = hslider("Operators/Op 2/op2_decay",   0.3, 0.001, 10.0, 0.001);
op2_sustain = hslider("Operators/Op 2/op2_sustain", 0.7, 0.0,   1.0,  0.001);
op2_release = hslider("Operators/Op 2/op2_release", 0.5, 0.01,  10.0, 0.001);

op3_ratio   = hslider("Operators/Op 3/op3_ratio",   3.0, 0.125, 16.0, 0.001) : si.smoo;
op3_level   = hslider("Operators/Op 3/op3_level",   0.4, 0.0,   1.0,  0.001) : si.smoo;
op3_attack  = hslider("Operators/Op 3/op3_attack",  0.01, 0.001, 5.0, 0.001);
op3_decay   = hslider("Operators/Op 3/op3_decay",   0.3, 0.001, 10.0, 0.001);
op3_sustain = hslider("Operators/Op 3/op3_sustain", 0.7, 0.0,   1.0,  0.001);
op3_release = hslider("Operators/Op 3/op3_release", 0.5, 0.01,  10.0, 0.001);

op4_ratio   = hslider("Operators/Op 4/op4_ratio",   0.5, 0.125, 16.0, 0.001) : si.smoo;
op4_level   = hslider("Operators/Op 4/op4_level",   0.3, 0.0,   1.0,  0.001) : si.smoo;
op4_attack  = hslider("Operators/Op 4/op4_attack",  0.01, 0.001, 5.0, 0.001);
op4_decay   = hslider("Operators/Op 4/op4_decay",   0.3, 0.001, 10.0, 0.001);
op4_sustain = hslider("Operators/Op 4/op4_sustain", 0.7, 0.0,   1.0,  0.001);
op4_release = hslider("Operators/Op 4/op4_release", 0.5, 0.01,  10.0, 0.001);

// ---------------------------------------------------------------------------
// Group 2 — Cross-Modulation Matrix (params 24–35)
// mXY = op X modulates op Y (X's output is added to Y's phase)
// ---------------------------------------------------------------------------

m12 = hslider("Matrix/m12", 0.0, 0.0, 10.0, 0.001) : si.smoo;
m13 = hslider("Matrix/m13", 0.0, 0.0, 10.0, 0.001) : si.smoo;
m14 = hslider("Matrix/m14", 0.0, 0.0, 10.0, 0.001) : si.smoo;
m21 = hslider("Matrix/m21", 1.0, 0.0, 10.0, 0.001) : si.smoo;
m23 = hslider("Matrix/m23", 0.0, 0.0, 10.0, 0.001) : si.smoo;
m24 = hslider("Matrix/m24", 0.0, 0.0, 10.0, 0.001) : si.smoo;
m31 = hslider("Matrix/m31", 0.0, 0.0, 10.0, 0.001) : si.smoo;
m32 = hslider("Matrix/m32", 0.0, 0.0, 10.0, 0.001) : si.smoo;
m34 = hslider("Matrix/m34", 0.0, 0.0, 10.0, 0.001) : si.smoo;
m41 = hslider("Matrix/m41", 0.0, 0.0, 10.0, 0.001) : si.smoo;
m42 = hslider("Matrix/m42", 0.0, 0.0, 10.0, 0.001) : si.smoo;
m43 = hslider("Matrix/m43", 0.0, 0.0, 10.0, 0.001) : si.smoo;

// ---------------------------------------------------------------------------
// Group 3 — Self-Feedback × 4  (params 36–39)
// ---------------------------------------------------------------------------

fb1 = hslider("Feedback/fb1", 0.0, 0.0, 1.0, 0.001) : si.smoo;
fb2 = hslider("Feedback/fb2", 0.0, 0.0, 1.0, 0.001) : si.smoo;
fb3 = hslider("Feedback/fb3", 0.0, 0.0, 1.0, 0.001) : si.smoo;
fb4 = hslider("Feedback/fb4", 0.0, 0.0, 1.0, 0.001) : si.smoo;

// ---------------------------------------------------------------------------
// Group 4 — Global Modulation  (params 40–47)
// ---------------------------------------------------------------------------

lfo_rate         = hslider("Global/lfo_rate",         5.0,   0.01,  20.0,  0.001);
lfo_depth        = hslider("Global/lfo_depth",        0.0,   0.0,   1.0,   0.001) : si.smoo;
lfo_pitch        = hslider("Global/lfo_pitch",        0.5,   0.0,   1.0,   0.001) : si.smoo;
lfo_levels       = hslider("Global/lfo_levels",       0.5,   0.0,   1.0,   0.001) : si.smoo;
lfo_waveform     = hslider("Global/lfo_waveform",     0.0,   0.0,   1.0,   0.001);
pitch_env_amount = hslider("Global/pitch_env_amount", 0.0,   0.0,   1.0,   0.001) : si.smoo;
pitch_env_decay  = hslider("Global/pitch_env_decay",  0.1,   0.001, 2.0,   0.001);
vel_index_scale  = hslider("Global/vel_index_scale",  0.0,   0.0,   1.0,   0.001) : si.smoo;

// ---------------------------------------------------------------------------
// Group 5 — Master  (params 48–55)
// ---------------------------------------------------------------------------

master_level       = hslider("Master/level",              0.7,  0.0,   1.0,   0.001) : si.smoo;
vel_sens           = hslider("Master/vel_sens",           0.5,  0.0,   1.0,   0.001);
pitch_glide        = hslider("Master/pitch_glide",        0.0,  0.0,   10.0,  0.001);
fine_tune          = hslider("Master/fine_tune[unit:cents]", 0.0, -50.0, 50.0, 0.01);
waveform_blend     = hslider("Master/waveform_blend",     0.0,  0.0,   1.0,   0.001) : si.smoo;
stereo_spread      = hslider("Master/stereo_spread",      0.1,  0.0,   1.0,   0.001) : si.smoo;
output_saturation  = hslider("Master/output_saturation",  0.0,  0.0,   1.0,   0.001) : si.smoo;
output_hp          = hslider("Master/output_hp[unit:Hz]", 20.0, 20.0, 200.0,  0.1);

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

// Cents → frequency ratio
cent2ratio(c) = pow(2.0, c / 1200.0);

// Base frequency with fine-tune
base_freq = freq * cent2ratio(fine_tune);

// Velocity gain: blend between 1.0 (no velocity) and actual velocity
vel_gain = (1.0 - vel_sens) + vel_sens * vel;

// Velocity-scaled FM index multiplier
// vel_index_scale=0: velocity doesn't affect FM indices
// vel_index_scale=1: FM indices are fully scaled by velocity
vel_idx_mult = (1.0 - vel_index_scale) + vel_index_scale * vel;

// LFO: 4 waveforms crossfaded
// Segments: [0,0.333)=sine→tri, [0.333,0.667)=tri→saw, [0.667,1]=saw→square
lfo_sig =
  ba.if(lfo_waveform < 0.333,
    (1.0 - lfo_waveform*3.0) * os.osc(lfo_rate)      + lfo_waveform*3.0      * os.triangle(lfo_rate),
    ba.if(lfo_waveform < 0.667,
      (1.0 - (lfo_waveform-0.333)*3.0) * os.triangle(lfo_rate) + (lfo_waveform-0.333)*3.0 * os.sawtooth(lfo_rate),
      (1.0 - (lfo_waveform-0.667)*3.0) * os.sawtooth(lfo_rate) + (lfo_waveform-0.667)*3.0 * os.square(lfo_rate)));

// Pitch envelope: fast attack, configurable decay, triggered by gate
pitch_env = en.ar(0.001, pitch_env_decay, gate);

// Modulated frequency: fine-tune + LFO pitch + pitch envelope
// LFO pitch: ±0.0833 semitones per unit depth (subtle vibrato)
// Pitch env: up to +1 octave (ratio +1.0 = +octave)
lfo_pitch_offset = lfo_sig * lfo_depth * lfo_pitch * 0.0083;   // ~0.1 semitone max
pitch_env_offset = pitch_env * pitch_env_amount;                 // 0..1 oct
mod_freq = base_freq * pow(2.0, lfo_pitch_offset + pitch_env_offset);

// LFO level modulation (tremolo): 1.0 when depth=0, dips to (1-0.5*depth*lfo_levels) at trough
lfo_level_factor = 1.0 - lfo_depth * lfo_levels * 0.5 * (1.0 - lfo_sig) * 0.5;

// Per-operator oscillator: blend sine (0) → triangle (1)
op_osc(f) = (1.0 - waveform_blend) * os.osc(f) + waveform_blend * os.triangle(f);

// Per-operator ADSR envelopes
env1 = en.adsr(op1_attack, op1_decay, op1_sustain, op1_release, gate);
env2 = en.adsr(op2_attack, op2_decay, op2_sustain, op2_release, gate);
env3 = en.adsr(op3_attack, op3_decay, op3_sustain, op3_release, gate);
env4 = en.adsr(op4_attack, op4_decay, op4_sustain, op4_release, gate);

// ---------------------------------------------------------------------------
// 4-Operator FM Routing
//
// Implementation strategy: build a recursive 4-channel bus using ~
// The bus carries (op1_out, op2_out, op3_out, op4_out) with 1-sample delay.
// Each frame, we compute new outputs from delayed previous outputs.
//
// fmbus: (d1,d2,d3,d4) → (op1_out,op2_out,op3_out,op4_out)
// where dN are the 1-sample-delayed previous outputs (via ~)
//
// FM phase deviation: deviation_hz = index * modulator_out * carrier_freq
// This is the standard "frequency modulation" formula where modulator_out ∈ [-1,1]
// ---------------------------------------------------------------------------

fmbus(d1,d2,d3,d4) =
  op1_out, op2_out, op3_out, op4_out
with {
  // Effective indices scaled by velocity
  m12e = m12 * vel_idx_mult;  m13e = m13 * vel_idx_mult;  m14e = m14 * vel_idx_mult;
  m21e = m21 * vel_idx_mult;  m23e = m23 * vel_idx_mult;  m24e = m24 * vel_idx_mult;
  m31e = m31 * vel_idx_mult;  m32e = m32 * vel_idx_mult;  m34e = m34 * vel_idx_mult;
  m41e = m41 * vel_idx_mult;  m42e = m42 * vel_idx_mult;  m43e = m43 * vel_idx_mult;
  fb1e = fb1 * vel_idx_mult;  fb2e = fb2 * vel_idx_mult;
  fb3e = fb3 * vel_idx_mult;  fb4e = fb4 * vel_idx_mult;

  f1 = mod_freq * op1_ratio;
  f2 = mod_freq * op2_ratio;
  f3 = mod_freq * op3_ratio;
  f4 = mod_freq * op4_ratio;

  op1_out = env1 * op1_level * lfo_level_factor * vel_gain *
    op_osc(f1 + (m21e*d2 + m31e*d3 + m41e*d4 + fb1e*d1) * f1);

  op2_out = env2 * op2_level * lfo_level_factor * vel_gain *
    op_osc(f2 + (m12e*d1 + m32e*d3 + m42e*d4 + fb2e*d2) * f2);

  op3_out = env3 * op3_level * lfo_level_factor * vel_gain *
    op_osc(f3 + (m13e*d1 + m23e*d2 + m43e*d4 + fb3e*d3) * f3);

  op4_out = env4 * op4_level * lfo_level_factor * vel_gain *
    op_osc(f4 + (m14e*d1 + m24e*d2 + m34e*d3 + fb4e*d4) * f4);
};

// Route 4-channel bus through feedback loop (introduces mandatory 1-sample delay)
// Output of fmbus is (op1,op2,op3,op4); sum all for audio out
fm_out = (fmbus ~ (si.bus(4))) : (_, _, _, _) :> _;

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

// Soft clip: tanh approximation (drive controlled by output_saturation)
// At 0: linear passthrough. At 1: clips at ±~0.6
soft_clip(x) = x / max(0.001, 1.0 + output_saturation * abs(x));

// Stereo spread via slight pitch detuning L vs R
spread_cents = stereo_spread * 5.0;   // ±5 cents max

// HP filter removes DC offset from heavy feedback FM
hp_out(x) = fi.highpass(1, output_hp, x);

// ---------------------------------------------------------------------------
// process: mono FM sum → scale → soft-clip → HP → stereo spread
// ---------------------------------------------------------------------------

process =
  fm_out
  : *(master_level * 0.25)       // 4 ops summing: scale to safe range
  : soft_clip
  : hp_out
  <: *(cent2ratio(spread_cents)), *(cent2ratio(0.0 - spread_cents));
