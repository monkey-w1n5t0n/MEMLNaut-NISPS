#!/usr/bin/env python3
"""
gen-modular-dsp.py — Emit modular-*.dsp files for the Faust "Modular" mode.

The modulation matrix has 48 sources × 10 destinations and every amount must be
a unique hslider (Faust slider labels are compile-time string literals). Hand-
writing 480+ sliders is impractical, so this script produces a fully expanded
.dsp file with one hslider per (source, destination) cell plus an explicit
48-term weighted-sum expression for each destination.

The generator emits three engines in one run:

    modular-subtractive.dsp   Minimoog-style 3-osc + moog filter voice
    modular-additive.dsp      64-partial additive voice (spectral descriptors)
    modular-fm.dsp            4-operator FM voice with full cross-mod matrix

Each engine has its own 48×10 modulation matrix and its own set of sound
parameters. All modulation (envelopes, LFOs) comes from the shared
mod-pool.lib — the engines themselves contain ZERO internal envs/LFOs.

Run:
    python3 gen-modular-dsp.py

Re-running this script is reproducible: same inputs produce byte-identical
output. Please DO NOT hand-edit the generated .dsp files — edit this
generator and re-run it instead.
"""

import os

N_SRC = 48

# ---------------------------------------------------------------------------
# Engine definitions. One dict per engine; each has:
#   name            file stem ("modular-<name>.dsp")
#   title           header comment title
#   description     short audio-path description
#   destinations    list of (idx, short_name, doc)  — exactly 10 entries
#   sound_params    Faust source for engine sound params (hsliders/buttons)
#   signal_flow     Faust source for derived signals + process line
# ---------------------------------------------------------------------------


# Common hidden-controls block (identical for all engines)
HIDDEN_BLOCK = """\
// ---------------------------------------------------------------------------
// Hidden controls
// ---------------------------------------------------------------------------
freq = hslider("0_Hidden/freq[hidden:1][unit:Hz]", 220, 20, 4000, 0.01);
gate = button("0_Hidden/gate[hidden:1]");
vel  = hslider("0_Hidden/_vel[hidden:1]", 0.7, 0.0, 1.0, 0.001) : si.smoo;
"""


# ---------------------------------------------------------------------------
# Engine 1 — Subtractive (Minimoog-style)
# ---------------------------------------------------------------------------

SUBTRACTIVE_DESTS = [
    (0, "pitch",          "semitones, applied to all osc frequencies"),
    (1, "osc2_detune",    "cents offset added to osc2 detune knob"),
    (2, "osc3_detune",    "cents offset added to osc3 detune knob"),
    (3, "osc_mix_bal",    "-1..+1 crossfades osc1<->osc3"),
    (4, "noise_level",    "added to noise level knob"),
    (5, "cutoff",         "+/-5 octaves of filter cutoff modulation"),
    (6, "resonance",      "added to res knob"),
    (7, "filter_env_amt", "second independent +/-5 octave cutoff mod channel"),
    (8, "amp",            "added to amp knob (route an ADSR here for a VCA env)"),
    (9, "pan",            "added to pan knob"),
]

SUBTRACTIVE_PARAMS = """\
// ---------------------------------------------------------------------------
// Group 1 — Oscillators
// ---------------------------------------------------------------------------
osc1_wave  = hslider("1_Oscillators/00_osc1_wave[tooltip:0=saw,0.5=tri,1=square]", 0.0, 0.0, 1.0, 0.001);
osc1_range = hslider("1_Oscillators/01_osc1_range[unit:oct]", 0.0, -2.0, 2.0, 0.01);
osc1_level = hslider("1_Oscillators/02_osc1_level", 0.8, 0.0, 1.0, 0.001);

osc2_wave   = hslider("1_Oscillators/03_osc2_wave[tooltip:0=saw,0.5=tri,1=square]", 0.0, 0.0, 1.0, 0.001);
osc2_range  = hslider("1_Oscillators/04_osc2_range[unit:oct]", 0.0, -2.0, 2.0, 0.01);
osc2_detune = hslider("1_Oscillators/05_osc2_detune[unit:ct]", 0.0, -50.0, 50.0, 0.1);
osc2_level  = hslider("1_Oscillators/06_osc2_level", 0.6, 0.0, 1.0, 0.001);

osc3_wave     = hslider("1_Oscillators/07_osc3_wave[tooltip:0=saw,0.5=tri,1=square]", 0.5, 0.0, 1.0, 0.001);
osc3_range    = hslider("1_Oscillators/08_osc3_range[unit:oct]", -1.0, -2.0, 2.0, 0.01);
osc3_detune   = hslider("1_Oscillators/09_osc3_detune[unit:ct]", 0.0, -50.0, 50.0, 0.1);
osc3_level    = hslider("1_Oscillators/10_osc3_level", 0.4, 0.0, 1.0, 0.001);
osc3_kb_track = hslider("1_Oscillators/11_osc3_kb_track[tooltip:1=tracks keyboard,0=LFO]", 1.0, 0.0, 1.0, 1.0);

// ---------------------------------------------------------------------------
// Group 2 — Mixer
// ---------------------------------------------------------------------------
noise_type  = hslider("2_Mixer/00_noise_type[tooltip:0=white,1=pink]", 0.0, 0.0, 1.0, 1.0);
noise_level = hslider("2_Mixer/01_noise_level", 0.0, 0.0, 1.0, 0.001);
mixer_drive = hslider("2_Mixer/02_mixer_drive[tooltip:Pre-filter overdrive]", 1.0, 0.5, 4.0, 0.001);

// ---------------------------------------------------------------------------
// Group 3 — Filter
// ---------------------------------------------------------------------------
cutoff      = hslider("3_Filter/00_cutoff[scale:log][unit:Hz]", 1200.0, 20.0, 20000.0, 0.1);
resonance   = hslider("3_Filter/01_resonance", 0.3, 0.0, 1.0, 0.001);
filter_kb   = hslider("3_Filter/02_filter_kb_track", 0.5, 0.0, 1.0, 0.001);

// ---------------------------------------------------------------------------
// Group 4 — Master
// ---------------------------------------------------------------------------
master_level = hslider("4_Master/00_master_level", 0.7, 0.0, 1.0, 0.001);
master_glide = hslider("4_Master/01_master_glide[unit:s][scale:log]", 0.0, 0.0, 2.0, 0.001);
master_tune  = hslider("4_Master/02_master_tune[unit:ct]", 0.0, -50.0, 50.0, 0.1);
master_pan   = hslider("4_Master/03_master_pan", 0.0, -1.0, 1.0, 0.001);
"""

SUBTRACTIVE_FLOW = """\
// ---------------------------------------------------------------------------
// Derived signals
// ---------------------------------------------------------------------------

cent2ratio(c) = pow(2.0, c / 1200.0);
oct2ratio(o)  = pow(2.0, o);
semi2ratio(s) = pow(2.0, s / 12.0);

// Portamento
glide_tau   = 0.0001 + master_glide * 1.0;
freq_glided = freq : si.smooth(ba.tau2pole(glide_tau));

// Base (glide + master fine tune)
base_freq = freq_glided * cent2ratio(master_tune);

// ---------------------------------------------------------------------------
// Per-oscillator wavetable (saw → tri → square crossfade)
// 0.0 → saw, 0.5 → triangle, 1.0 → square. Output in [-1,+1].
// ---------------------------------------------------------------------------
osc_wave(shape, f) =
    ba.if(shape < 0.5,
          (1.0 - shape*2.0) * os.lf_saw(f) + (shape*2.0) * os.lf_triangle(f),
          (1.0 - (shape-0.5)*2.0) * os.lf_triangle(f) + ((shape-0.5)*2.0) * os.lf_squarewave(f));

// ---------------------------------------------------------------------------
// Oscillator frequencies (pitch modulation: 1 unit = 12 semitones)
// ---------------------------------------------------------------------------
pitch_ratio = semi2ratio(mod_pitch(gate) * 12.0);

osc1_freq = base_freq * oct2ratio(osc1_range) * pitch_ratio;
osc2_freq = base_freq * oct2ratio(osc2_range) * pitch_ratio
          * cent2ratio(osc2_detune + mod_osc2_detune(gate) * 50.0);
osc3_freq_tracked   = base_freq * oct2ratio(osc3_range) * pitch_ratio
                    * cent2ratio(osc3_detune + mod_osc3_detune(gate) * 50.0);
// When kb_track=0, osc3 becomes a free-running sub/LFO source at ~55 Hz * oct
osc3_freq_untracked = 55.0 * oct2ratio(osc3_range)
                    * cent2ratio(osc3_detune + mod_osc3_detune(gate) * 50.0);
osc3_freq = osc3_kb_track * osc3_freq_tracked + (1.0 - osc3_kb_track) * osc3_freq_untracked;

// ---------------------------------------------------------------------------
// Oscillators
// ---------------------------------------------------------------------------
o1 = osc_wave(osc1_wave, osc1_freq);
o2 = osc_wave(osc2_wave, osc2_freq);
o3 = osc_wave(osc3_wave, osc3_freq);

// Osc mix balance: -1 = all osc1, +1 = all osc3, 0 = both equal. osc2 unaffected.
mix_bal = max(-1.0, min(1.0, mod_osc_mix_bal(gate)));
mix_t   = (mix_bal + 1.0) * 0.5;   // 0..1
w_o1    = 1.0 - mix_t;
w_o3    = mix_t;

// ---------------------------------------------------------------------------
// Noise: white (noise_type<0.5) / pink (else)
// ---------------------------------------------------------------------------
white_noise = no.noise;
pink_noise  = no.pink_noise;
noise_raw   = ba.if(noise_type < 0.5, white_noise, pink_noise);
noise_lvl   = max(0.0, min(1.0, noise_level + mod_noise_level(gate)));

// ---------------------------------------------------------------------------
// Mixer sum
// ---------------------------------------------------------------------------
mix_sum =
    o1 * osc1_level * w_o1
  + o2 * osc2_level
  + o3 * osc3_level * w_o3
  + noise_raw * noise_lvl;

mix_driven = ma.tanh(mix_sum * mixer_drive);

// ---------------------------------------------------------------------------
// Filter — Moog ladder. Cutoff is modulated in octaves (±5 oct per mod unit).
// ---------------------------------------------------------------------------
cutoff_mod_oct = (mod_cutoff(gate) + mod_filter_env_amt(gate)) * 5.0;
kb_scale       = pow(freq_glided / 440.0, filter_kb);  // 1.0 at A4 when kb=1
eff_cutoff_raw = cutoff * kb_scale * oct2ratio(cutoff_mod_oct);
eff_cutoff     = max(20.0, min(18000.0, eff_cutoff_raw));
eff_res        = max(0.0, min(0.99, resonance + mod_resonance(gate)));

filtered = mix_driven : ve.moog_vcf(eff_res, eff_cutoff);

// ---------------------------------------------------------------------------
// Amp and pan
// ---------------------------------------------------------------------------
// Velocity gain: blend 1.0 (no velocity) -> vel. Referenced here so Faust
// keeps the _vel hidden param alive in the JSON descriptor.
vel_gain = (1.0 - 0.3) + 0.3 * vel;  // 30% velocity sensitivity, fixed
amp_val = max(0.0, min(1.0, mod_amp(gate))) * master_level * vel_gain;
pan_val = max(-1.0, min(1.0, master_pan + mod_pan(gate)));

// equal-power pan
pan_l = cos((pan_val + 1.0) * 0.25 * ma.PI);
pan_r = sin((pan_val + 1.0) * 0.25 * ma.PI);

signal = filtered * amp_val;
signal_L = signal * pan_l;
signal_R = signal * pan_r;

process = signal_L, signal_R;
"""


# ---------------------------------------------------------------------------
# Engine 2 — Additive (64-partial spectral descriptors)
# ---------------------------------------------------------------------------

ADDITIVE_DESTS = [
    (0, "pitch",         "semitones, applied to the fundamental frequency"),
    (1, "bright",        "high-partial group amplitude boost/cut (replaces bright env)"),
    (2, "tilt",           "added to spectral_tilt knob"),
    (3, "inharmonicity",  "added to inharmonicity knob"),
    (4, "odd_even",       "added to odd/even balance knob"),
    (5, "formant_ctr",    "shifts both formant centre frequencies (harmonic index)"),
    (6, "formant_depth",  "added to formant_depth knob"),
    (7, "noise_mix",      "added to noise_floor knob (clamped 0..1)"),
    (8, "amp",            "master amplitude dest (route an ADSR here for a VCA env)"),
    (9, "pan",            "stereo balance"),
]

ADDITIVE_PARAMS = """\
// ---------------------------------------------------------------------------
// Group 1 — Spectral Shape (harmonic bank + descriptors)
// ---------------------------------------------------------------------------
h1_amp        = hslider("1_Spectral/00_h1_amp",        0.8,   0.0, 1.0, 0.001);
h2_amp        = hslider("1_Spectral/01_h2_amp",        0.5,   0.0, 1.0, 0.001);
h3_amp        = hslider("1_Spectral/02_h3_amp",        0.35,  0.0, 1.0, 0.001);
h4_amp        = hslider("1_Spectral/03_h4_amp",        0.25,  0.0, 1.0, 0.001);
h5_amp        = hslider("1_Spectral/04_h5_amp",        0.18,  0.0, 1.0, 0.001);
h6_amp        = hslider("1_Spectral/05_h6_amp",        0.12,  0.0, 1.0, 0.001);
h7_amp        = hslider("1_Spectral/06_h7_amp",        0.08,  0.0, 1.0, 0.001);
h8_amp        = hslider("1_Spectral/07_h8_amp",        0.06,  0.0, 1.0, 0.001);
h9_16_amp     = hslider("1_Spectral/08_h9_16_amp",     0.05,  0.0, 1.0, 0.001);
h17_32_amp    = hslider("1_Spectral/09_h17_32_amp",    0.025, 0.0, 1.0, 0.001);
h33_64_amp    = hslider("1_Spectral/10_h33_64_amp",    0.01,  0.0, 1.0, 0.001);
spectral_tilt = hslider("1_Spectral/11_spectral_tilt", 0.0,  -1.0, 1.0, 0.001);
inharmonicity = hslider("1_Spectral/12_inharmonicity", 0.0,   0.0, 0.15, 0.0001);
odd_even      = hslider("1_Spectral/13_odd_even",      0.5,   0.0, 1.0, 0.001);

// ---------------------------------------------------------------------------
// Group 2 — Formants & Noise
// ---------------------------------------------------------------------------
formant1_freq = hslider("2_Formants/00_formant1_freq[tooltip:Formant 1 harmonic idx]", 3.0, 1.0, 16.0, 0.01);
formant2_freq = hslider("2_Formants/01_formant2_freq[tooltip:Formant 2 harmonic idx]", 6.0, 1.0, 16.0, 0.01);
formant_depth = hslider("2_Formants/02_formant_depth", 0.0, 0.0, 1.0, 0.001);
noise_floor   = hslider("2_Formants/03_noise_floor",   0.0, 0.0, 0.2, 0.001);
noise_color   = hslider("2_Formants/04_noise_color",   0.5, 0.0, 1.0, 0.001);
sub_harmonic  = hslider("2_Formants/05_sub_harmonic",  0.0, 0.0, 1.0, 0.001);

// ---------------------------------------------------------------------------
// Group 3 — Master
// ---------------------------------------------------------------------------
level              = hslider("3_Master/00_level",              0.7,  0.0, 1.0, 0.001);
fine_tune          = hslider("3_Master/01_fine_tune[unit:ct]", 0.0, -50.0, 50.0, 0.1);
saturation         = hslider("3_Master/02_saturation",         0.0,  0.0, 1.0, 0.001);
stereo_phase_spread= hslider("3_Master/03_stereo_phase_spread",0.1,  0.0, 1.0, 0.001);
master_pan         = hslider("3_Master/04_master_pan",         0.0, -1.0, 1.0, 0.001);
"""

ADDITIVE_FLOW = """\
// ---------------------------------------------------------------------------
// Derived signals
// ---------------------------------------------------------------------------

N  = 64;
PI = ma.PI;

cent2ratio(c) = pow(2.0, c / 1200.0);
semi2ratio(s) = pow(2.0, s / 12.0);

// Pitch: modulation (semitones), no glide
fine_ratio  = cent2ratio(fine_tune);
pitch_ratio = semi2ratio(mod_pitch(gate) * 12.0);
base_freq   = freq * fine_ratio * pitch_ratio;

// ---------------------------------------------------------------------------
// Per-harmonic base amplitude from group sliders
// ---------------------------------------------------------------------------
group_amp(k) =
  ba.if(k == 1, h1_amp,
  ba.if(k == 2, h2_amp,
  ba.if(k == 3, h3_amp,
  ba.if(k == 4, h4_amp,
  ba.if(k == 5, h5_amp,
  ba.if(k == 6, h6_amp,
  ba.if(k == 7, h7_amp,
  ba.if(k == 8, h8_amp,
  ba.if(k <= 16, h9_16_amp,
  ba.if(k <= 32, h17_32_amp,
                 h33_64_amp))))))))));

// Spectral tilt (modulated) — amp *= k^tilt
eff_tilt = spectral_tilt + mod_tilt(gate);
tilt_factor(k) = pow(float(k), eff_tilt);

// Odd/even balance (modulated, clamped)
eff_odd_even  = max(0.0, min(1.0, odd_even + mod_odd_even(gate)));
odd_weight    = (1.0 - eff_odd_even) * 2.0;
even_weight   = eff_odd_even * 2.0;
odd_even_factor(k) = ba.if(k % 2 == 0, even_weight, odd_weight);

// Brightness destination: progressive boost/cut on upper partials.
// bright_blend(k): 0 at k=1, 1 at k=N. mod_bright is [-1,+1].
// factor(k) = 1 + bright_blend(k) * mod_bright. At mod=0 -> unity (neutral).
bright_blend(k)  = float(k - 1) / float(N - 1);
mb               = mod_bright(gate);
bright_factor(k) = 1.0 + bright_blend(k) * mb;

// Inharmonicity (modulated, clamped to keep partials monotonic)
eff_inharm       = max(0.0, min(0.2, inharmonicity + mod_inharmonicity(gate) * 0.15));

// Formant centres (modulated together — mod_formant_ctr shifts both by same amt)
eff_formant_shift = mod_formant_ctr(gate) * 8.0;     // ±8 harmonics
eff_f1            = max(1.0, min(32.0, formant1_freq + eff_formant_shift));
eff_f2            = max(1.0, min(32.0, formant2_freq + eff_formant_shift));
eff_formant_depth = max(0.0, min(1.0, formant_depth + mod_formant_depth(gate)));

// Formant shaping — two Gaussian bumps in harmonic-index space
sigma_sq = 1.5 * 1.5;
formant_bump(k, ctr) = exp(-0.5 * (float(k) - ctr) * (float(k) - ctr) / sigma_sq);
formant_factor(k) =
  1.0 + eff_formant_depth * (formant_bump(k, eff_f1) + formant_bump(k, eff_f2));

// Combined per-harmonic amplitude
harm_amp(k) =
  group_amp(k) * tilt_factor(k) * odd_even_factor(k) *
  bright_factor(k) * formant_factor(k);

// Inharmonic partial frequency: freq_k = k*f0*(1 + B*(k^2 - 1))
harm_freq(k) = base_freq * float(k)
               * (1.0 + eff_inharm * (float(k) * float(k) - 1.0));

// Stereo spread — R channel gets a small per-harmonic pitch offset
stereo_spread_freq(k) = stereo_phase_spread * float(k) * 0.01;

// ---------------------------------------------------------------------------
// Additive oscillator sums — L and R
// ---------------------------------------------------------------------------
additive_L = sum(k, N, harm_amp(k+1) * os.osc(harm_freq(k+1)));
additive_R = sum(k, N,
  harm_amp(k+1) * os.osc(harm_freq(k+1) * (1.0 + stereo_spread_freq(k+1))));

// Sub-harmonic (0.5× fundamental)
sub_osc = sub_harmonic * os.osc(base_freq * 0.5);

// ---------------------------------------------------------------------------
// Noise floor — coloured via one-pole LP
// ---------------------------------------------------------------------------
eff_noise = max(0.0, min(1.0, noise_floor + mod_noise_mix(gate)));
noise_lp_cutoff = 200.0 + (1.0 - noise_color) * 19800.0;
noise_signal    = no.noise : fi.lowpass(1, noise_lp_cutoff);
noise_out       = eff_noise * noise_signal;

// ---------------------------------------------------------------------------
// Soft-clip saturation — tanh waveshaper
// ---------------------------------------------------------------------------
drive       = 1.0 + saturation * 9.0;
softclip(x) = ma.tanh(x * drive) / drive;

// ---------------------------------------------------------------------------
// Velocity gain — keeps _vel alive in the JSON descriptor
// ---------------------------------------------------------------------------
vel_gain = (1.0 - 0.3) + 0.3 * vel;

// ---------------------------------------------------------------------------
// Amplitude and pan (both mod-driven)
// ---------------------------------------------------------------------------
amp_val = max(0.0, min(1.0, mod_amp(gate))) * level * vel_gain;
pan_val = max(-1.0, min(1.0, master_pan + mod_pan(gate)));

pan_l = cos((pan_val + 1.0) * 0.25 * ma.PI);
pan_r = sin((pan_val + 1.0) * 0.25 * ma.PI);

raw_L = (additive_L + sub_osc + noise_out) * amp_val;
raw_R = (additive_R + sub_osc + noise_out) * amp_val;

signal_L = softclip(raw_L) * pan_l;
signal_R = softclip(raw_R) * pan_r;

process = signal_L, signal_R;
"""


# ---------------------------------------------------------------------------
# Engine 3 — FM (4-operator with cross-mod matrix)
# ---------------------------------------------------------------------------

FM_DESTS = [
    (0, "pitch",            "semitones added to the base frequency"),
    (1, "op1_level",        "added to op1 level knob"),
    (2, "op2_level",        "added to op2 level knob"),
    (3, "op3_level",        "added to op3 level knob"),
    (4, "op4_level",        "added to op4 level knob"),
    (5, "cross_mod_global", "global FM depth multiplier on all 12 cross-mod cells"),
    (6, "feedback_global",  "global feedback multiplier on all 4 self-feedback cells"),
    (7, "global_ratio",     "additive scale factor on all 4 operator ratios"),
    (8, "amp",              "master amplitude dest (route an ADSR here for a VCA env)"),
    (9, "pan",              "stereo balance"),
]

FM_PARAMS = """\
// ---------------------------------------------------------------------------
// Group 1 — Operators (ratio & level per op)
// ---------------------------------------------------------------------------
op1_ratio = hslider("1_Operators/00_op1_ratio", 1.0, 0.125, 16.0, 0.001);
op1_level = hslider("1_Operators/01_op1_level", 0.8, 0.0,   1.0,  0.001);
op2_ratio = hslider("1_Operators/02_op2_ratio", 2.0, 0.125, 16.0, 0.001);
op2_level = hslider("1_Operators/03_op2_level", 0.6, 0.0,   1.0,  0.001);
op3_ratio = hslider("1_Operators/04_op3_ratio", 3.0, 0.125, 16.0, 0.001);
op3_level = hslider("1_Operators/05_op3_level", 0.4, 0.0,   1.0,  0.001);
op4_ratio = hslider("1_Operators/06_op4_ratio", 0.5, 0.125, 16.0, 0.001);
op4_level = hslider("1_Operators/07_op4_level", 0.3, 0.0,   1.0,  0.001);

// ---------------------------------------------------------------------------
// Group 2 — Cross-mod Matrix (mXY = op X modulates op Y)
// ---------------------------------------------------------------------------
m12 = hslider("2_CrossMod/00_m12", 0.0, 0.0, 10.0, 0.001);
m13 = hslider("2_CrossMod/01_m13", 0.0, 0.0, 10.0, 0.001);
m14 = hslider("2_CrossMod/02_m14", 0.0, 0.0, 10.0, 0.001);
m21 = hslider("2_CrossMod/03_m21", 1.0, 0.0, 10.0, 0.001);
m23 = hslider("2_CrossMod/04_m23", 0.0, 0.0, 10.0, 0.001);
m24 = hslider("2_CrossMod/05_m24", 0.0, 0.0, 10.0, 0.001);
m31 = hslider("2_CrossMod/06_m31", 0.0, 0.0, 10.0, 0.001);
m32 = hslider("2_CrossMod/07_m32", 0.0, 0.0, 10.0, 0.001);
m34 = hslider("2_CrossMod/08_m34", 0.0, 0.0, 10.0, 0.001);
m41 = hslider("2_CrossMod/09_m41", 0.0, 0.0, 10.0, 0.001);
m42 = hslider("2_CrossMod/10_m42", 0.0, 0.0, 10.0, 0.001);
m43 = hslider("2_CrossMod/11_m43", 0.0, 0.0, 10.0, 0.001);

// ---------------------------------------------------------------------------
// Group 3 — Self-feedback
// ---------------------------------------------------------------------------
fb1 = hslider("3_Feedback/00_fb1", 0.0, 0.0, 1.0, 0.001);
fb2 = hslider("3_Feedback/01_fb2", 0.0, 0.0, 1.0, 0.001);
fb3 = hslider("3_Feedback/02_fb3", 0.0, 0.0, 1.0, 0.001);
fb4 = hslider("3_Feedback/03_fb4", 0.0, 0.0, 1.0, 0.001);

// ---------------------------------------------------------------------------
// Group 4 — Master
// ---------------------------------------------------------------------------
master_level      = hslider("4_Master/00_master_level",      0.7,  0.0,  1.0,  0.001);
fine_tune         = hslider("4_Master/01_fine_tune[unit:ct]", 0.0, -50.0, 50.0, 0.1);
stereo_spread     = hslider("4_Master/02_stereo_spread",     0.1,  0.0,  1.0,  0.001);
output_saturation = hslider("4_Master/03_output_saturation", 0.0,  0.0,  1.0,  0.001);
output_hp         = hslider("4_Master/04_output_hp[unit:Hz]",20.0, 20.0, 200.0,0.1);
master_pan        = hslider("4_Master/05_master_pan",        0.0, -1.0,  1.0,  0.001);
"""

FM_FLOW = """\
// ---------------------------------------------------------------------------
// Derived signals
// ---------------------------------------------------------------------------

cent2ratio(c) = pow(2.0, c / 1200.0);
semi2ratio(s) = pow(2.0, s / 12.0);

// Base frequency: fine tune + pitch mod (semitones, ±12)
base_freq = freq * cent2ratio(fine_tune) * semi2ratio(mod_pitch(gate) * 12.0);

// Velocity gain — keeps _vel alive
vel_gain = (1.0 - 0.3) + 0.3 * vel;

// ---------------------------------------------------------------------------
// Effective per-operator ratios and levels (mod applied)
// global_ratio mod is an additive ratio offset (±8)
// ---------------------------------------------------------------------------
ratio_offset = mod_global_ratio(gate) * 8.0;
r1 = max(0.01, op1_ratio + ratio_offset);
r2 = max(0.01, op2_ratio + ratio_offset);
r3 = max(0.01, op3_ratio + ratio_offset);
r4 = max(0.01, op4_ratio + ratio_offset);

lev1 = max(0.0, min(1.0, op1_level + mod_op1_level(gate)));
lev2 = max(0.0, min(1.0, op2_level + mod_op2_level(gate)));
lev3 = max(0.0, min(1.0, op3_level + mod_op3_level(gate)));
lev4 = max(0.0, min(1.0, op4_level + mod_op4_level(gate)));

// ---------------------------------------------------------------------------
// Global multipliers for cross-mod and feedback.
// (1 + mod) in [0, 2] roughly; clamp to stay sane.
// ---------------------------------------------------------------------------
cross_mul = max(0.0, 1.0 + mod_cross_mod_global(gate));
fb_mul    = max(0.0, 1.0 + mod_feedback_global(gate));

m12e = m12 * cross_mul;  m13e = m13 * cross_mul;  m14e = m14 * cross_mul;
m21e = m21 * cross_mul;  m23e = m23 * cross_mul;  m24e = m24 * cross_mul;
m31e = m31 * cross_mul;  m32e = m32 * cross_mul;  m34e = m34 * cross_mul;
m41e = m41 * cross_mul;  m42e = m42 * cross_mul;  m43e = m43 * cross_mul;

fb1e = fb1 * fb_mul;
fb2e = fb2 * fb_mul;
fb3e = fb3 * fb_mul;
fb4e = fb4 * fb_mul;

// ---------------------------------------------------------------------------
// 4-operator FM bus — feedback loop via ~ on a 4-channel bus
// ---------------------------------------------------------------------------
fmbus(d1,d2,d3,d4) =
  op1_out, op2_out, op3_out, op4_out
with {
  f1 = base_freq * r1;
  f2 = base_freq * r2;
  f3 = base_freq * r3;
  f4 = base_freq * r4;

  op1_out = lev1 *
    os.osc(f1 + (m21e*d2 + m31e*d3 + m41e*d4 + fb1e*d1) * f1);

  op2_out = lev2 *
    os.osc(f2 + (m12e*d1 + m32e*d3 + m42e*d4 + fb2e*d2) * f2);

  op3_out = lev3 *
    os.osc(f3 + (m13e*d1 + m23e*d2 + m43e*d4 + fb3e*d3) * f3);

  op4_out = lev4 *
    os.osc(f4 + (m14e*d1 + m24e*d2 + m34e*d3 + fb4e*d4) * f4);
};

// Route 4-channel bus through feedback loop, sum all ops
fm_out = (fmbus ~ (si.bus(4))) : (_, _, _, _) :> _;

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------
soft_clip(x) = x / max(0.001, 1.0 + output_saturation * abs(x));
hp_out(x)    = fi.highpass(1, output_hp, x);

// Master amplitude destination (route an ADSR here for VCA)
amp_val = max(0.0, min(1.0, mod_amp(gate))) * master_level * vel_gain * 0.25;

// Pan
pan_val = max(-1.0, min(1.0, master_pan + mod_pan(gate)));
pan_l   = cos((pan_val + 1.0) * 0.25 * ma.PI);
pan_r   = sin((pan_val + 1.0) * 0.25 * ma.PI);

// Stereo spread via slight detuning (apply after main FM sum)
spread_cents = stereo_spread * 5.0;
spread_l     = cent2ratio(spread_cents);
spread_r     = cent2ratio(0.0 - spread_cents);

mono_post = fm_out * amp_val : soft_clip : hp_out;

signal_L = mono_post * spread_l * pan_l;
signal_R = mono_post * spread_r * pan_r;

process = signal_L, signal_R;
"""


ENGINES = [
    {
        "name": "subtractive",
        "title": "Minimoog-style subtractive voice",
        "description": "3 oscillators + noise → mixer → moog ladder filter → amp/pan.",
        "destinations": SUBTRACTIVE_DESTS,
        "sound_params": SUBTRACTIVE_PARAMS,
        "signal_flow": SUBTRACTIVE_FLOW,
    },
    {
        "name": "additive",
        "title": "64-partial additive voice",
        "description": "64 harmonic sines with spectral descriptors (tilt, odd/even, formants).",
        "destinations": ADDITIVE_DESTS,
        "sound_params": ADDITIVE_PARAMS,
        "signal_flow": ADDITIVE_FLOW,
    },
    {
        "name": "fm",
        "title": "4-operator FM voice",
        "description": "4 ops with 12-cell cross-mod matrix and per-op feedback.",
        "destinations": FM_DESTS,
        "sound_params": FM_PARAMS,
        "signal_flow": FM_FLOW,
    },
]


# ---------------------------------------------------------------------------
# Shared matrix-emission helpers
# ---------------------------------------------------------------------------

def src_name(s):
    return f"s{s:02d}"


def dest_label(d, name):
    return f"d{d:02d}_{name}"


def amt_slider_line(s, d, name):
    label = f"MM_Matrix/{src_name(s)}_{dest_label(d, name)}"
    varname = f"amt_{src_name(s)}_{dest_label(d, name)}"
    return f'{varname} = hslider("{label}", 0.0, -1.0, 1.0, 0.001);'


def dest_expression(d, name):
    varname = f"mod_{name}"
    lines = [f"{varname}(gate) ="]
    for s in range(N_SRC):
        amt_var = f"amt_{src_name(s)}_{dest_label(d, name)}"
        src_call = f"mp.src{s:02d}(gate)"
        if s < N_SRC - 1:
            lines.append(f"    {src_call} * {amt_var} +")
        else:
            lines.append(f"    {src_call} * {amt_var};")
    return "\n".join(lines)


def gen_matrix_sliders(dests):
    blocks = []
    for (d, name, _doc) in dests:
        blocks.append(f"// Matrix column: destination {d} = {name}")
        for s in range(N_SRC):
            blocks.append(amt_slider_line(s, d, name))
        blocks.append("")
    return "\n".join(blocks)


def gen_dest_expressions(dests):
    blocks = []
    for (d, name, _doc) in dests:
        blocks.append(dest_expression(d, name))
        blocks.append("")
    return "\n".join(blocks)


def emit_engine(cfg, out_dir):
    name = cfg["name"]
    title = cfg["title"]
    description = cfg["description"]
    dests = cfg["destinations"]
    sound_params = cfg["sound_params"]
    signal_flow = cfg["signal_flow"]

    n_dest = len(dests)
    assert n_dest == 10, f"engine {name}: expected 10 destinations, got {n_dest}"

    # Header comment with per-engine destination docs
    dest_doc_lines = []
    for (d, dname, doc) in dests:
        dest_doc_lines.append(f"//     {d} {dname:<17} {doc}")
    dest_doc = "\n".join(dest_doc_lines)

    header = f"""\
// modular-{name}.dsp — {title} for the "Modular" mode.
//
// AUTO-GENERATED by gen-modular-dsp.py. DO NOT EDIT BY HAND.
// Regenerate with:
//     cd playground/faust && python3 gen-modular-dsp.py
//
// Audio path: {description}
// All envelopes and LFOs come from mod-pool.lib via a 48-source × {n_dest}-dest
// modulation matrix. No internal envs/LFOs.
//
// Modulation destinations ({n_dest}):
{dest_doc}
//
// Hidden controls (driven by noteOn/noteOff, not by the ML engine):
//     freq, gate, _vel
//
// Build:
//     cd playground/faust && ./build.sh
//
// ---------------------------------------------------------------------------

import("stdfaust.lib");
mp = library("mod-pool.lib");

{HIDDEN_BLOCK}
{sound_params}
// ---------------------------------------------------------------------------
// Modulation matrix — 48 sources × {n_dest} destinations.
// Each hslider is one "amount" entry in [-1, +1]. Zero = no connection.
// Group "MM_Matrix" so the paramMeta parser can recognise matrix params.
// ---------------------------------------------------------------------------
"""

    parts = [
        header,
        gen_matrix_sliders(dests),
        "// ---------------------------------------------------------------------------",
        "// Destination signals — one per modulation destination. Each is a 48-term",
        "// weighted sum of sources × amounts. The `gate` argument is threaded through",
        "// so that mp.src??(gate) can drive ADSR envelopes.",
        "// ---------------------------------------------------------------------------",
        "",
        gen_dest_expressions(dests),
        signal_flow,
    ]

    out_path = os.path.join(out_dir, f"modular-{name}.dsp")
    with open(out_path, "w") as f:
        f.write("\n".join(parts))

    n_matrix = N_SRC * n_dest
    print(f"Wrote {out_path}")
    print(f"  destinations:   {n_dest}")
    print(f"  matrix sliders: {n_matrix}")


def main():
    out_dir = os.path.dirname(os.path.abspath(__file__))
    for cfg in ENGINES:
        emit_engine(cfg, out_dir)


if __name__ == "__main__":
    main()
