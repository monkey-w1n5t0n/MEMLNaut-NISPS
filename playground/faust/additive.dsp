// additive.dsp — Full 48-parameter additive synthesiser for MEMLNaut NISPS playground
//
// 64 harmonic sine banks with spectral-descriptor parametrisation.
// All 48 params are designed for continuous ML exploration via NISPS.
//
// Parameter order matches NISPS output indices 0–47:
//   Group 1 — Spectral Shape (0–13):  harmonic bank + tilt + inharmonicity + odd/even
//   Group 2 — Temporal       (14–23): global ADSR + brightness ADSR + spectral flux
//   Group 3 — Phase          (24–31): phase randomisation, beating, stereo, noise, sub
//   Group 4 — Modulation     (32–41): vibrato, tremolo, drift, formants
//   Group 5 — Master         (42–47): level, velocity, glide, saturation, fine-tune
//
// Groups are prefixed "1_", "2_" etc., and each parameter is prefixed "00_",
// "01_" etc., so that Faust's alphabetical JSON ordering matches the spec.
// The faustJsonToParamMeta parser strips numeric prefixes and "[...]" metadata
// from labels to produce clean names.
//
// Hidden controls (not in paramMeta — worklet drives them directly):
//   freq  — fundamental frequency Hz (noteOn)
//   gate  — gate signal 0/1          (noteOn/noteOff)
//
// Build:
//   faust -lang wasm -cn additive -e additive.dsp -o additive.wasm
//   faust -json additive.dsp -o /dev/null  (produces additive.dsp.json)
//
import("stdfaust.lib");

// ---------------------------------------------------------------------------
// Hidden controls
// ---------------------------------------------------------------------------
freq = hslider("0_Hidden/freq[hidden:1][unit:Hz]", 220, 20, 4000, 0.01);
gate = button("0_Hidden/gate[hidden:1]");

// ---------------------------------------------------------------------------
// Group 1 — Spectral Shape (params 0–13)
// ---------------------------------------------------------------------------
h1_amp        = hslider("1_Spectral Shape/00_h1_amp[tooltip:H1 amplitude]",        0.8,   0,    1,     0.001);
h2_amp        = hslider("1_Spectral Shape/01_h2_amp[tooltip:H2 amplitude]",        0.5,   0,    1,     0.001);
h3_amp        = hslider("1_Spectral Shape/02_h3_amp[tooltip:H3 amplitude]",        0.35,  0,    1,     0.001);
h4_amp        = hslider("1_Spectral Shape/03_h4_amp[tooltip:H4 amplitude]",        0.25,  0,    1,     0.001);
h5_amp        = hslider("1_Spectral Shape/04_h5_amp[tooltip:H5 amplitude]",        0.18,  0,    1,     0.001);
h6_amp        = hslider("1_Spectral Shape/05_h6_amp[tooltip:H6 amplitude]",        0.12,  0,    1,     0.001);
h7_amp        = hslider("1_Spectral Shape/06_h7_amp[tooltip:H7 amplitude]",        0.08,  0,    1,     0.001);
h8_amp        = hslider("1_Spectral Shape/07_h8_amp[tooltip:H8 amplitude]",        0.06,  0,    1,     0.001);
h9_16_amp     = hslider("1_Spectral Shape/08_h9_16_amp[tooltip:H9-16 group amp]",  0.05,  0,    1,     0.001);
h17_32_amp    = hslider("1_Spectral Shape/09_h17_32_amp[tooltip:H17-32 group amp]",0.025, 0,    1,     0.001);
h33_64_amp    = hslider("1_Spectral Shape/10_h33_64_amp[tooltip:H33-64 group amp]",0.01,  0,    1,     0.001);
spectral_tilt = hslider("1_Spectral Shape/11_spectral_tilt[tooltip:Global tilt]",  0,    -1,    1,     0.001);
inharmonicity = hslider("1_Spectral Shape/12_inharmonicity[tooltip:Inharmonicity]", 0,    0,    0.15,  0.0001);
odd_even      = hslider("1_Spectral Shape/13_odd_even[tooltip:Odd/even balance]",  0.5,   0,    1,     0.001);

// ---------------------------------------------------------------------------
// Group 2 — Temporal (params 14–23)
// ---------------------------------------------------------------------------
attack             = hslider("2_Temporal/00_attack[scale:log][tooltip:Attack]",             0.01,  0.001, 5,   0.001);
decay              = hslider("2_Temporal/01_decay[tooltip:Decay]",                           0.3,   0.001, 10,  0.001);
sustain            = hslider("2_Temporal/02_sustain[tooltip:Sustain]",                       0.7,   0,     1,   0.001);
release            = hslider("2_Temporal/03_release[tooltip:Release]",                       0.5,   0.01,  10,  0.001);
brightness_attack  = hslider("2_Temporal/04_brightness_attack[scale:log][tooltip:Bright A]", 0.005, 0.001, 5,   0.001);
brightness_decay   = hslider("2_Temporal/05_brightness_decay[tooltip:Bright D]",             0.15,  0.001, 5,   0.001);
brightness_sustain = hslider("2_Temporal/06_brightness_sustain[tooltip:Bright S]",           0.4,   0,     1,   0.001);
brightness_release = hslider("2_Temporal/07_brightness_release[tooltip:Bright R]",           0.3,   0.01,  5,   0.001);
spectral_flux_rate = hslider("2_Temporal/08_spectral_flux_rate[tooltip:Flux rate]",          0.5,   0,     10,  0.01);
spectral_flux_depth= hslider("2_Temporal/09_spectral_flux_depth[tooltip:Flux depth]",        0.1,   0,     1,   0.001);

// ---------------------------------------------------------------------------
// Group 3 — Phase & Coherence (params 24–31)
// ---------------------------------------------------------------------------
phase_random       = hslider("3_Phase/00_phase_random[tooltip:Phase randomisation]",      0,   0,    1,    0.001);
phase_walk_rate    = hslider("3_Phase/01_phase_walk_rate[tooltip:Phase walk rate]",        0,   0,    5,    0.001);
beating_depth      = hslider("3_Phase/02_beating_depth[tooltip:Beating depth]",            0,   0,    0.02, 0.0001);
beating_rate       = hslider("3_Phase/03_beating_rate[tooltip:Beating rate]",              1,   0,    10,   0.01);
stereo_phase_spread= hslider("3_Phase/04_stereo_phase_spread[tooltip:Stereo spread]",      0.1, 0,    1,    0.001);
noise_floor        = hslider("3_Phase/05_noise_floor[tooltip:Noise floor]",                0,   0,    0.2,  0.001);
noise_color        = hslider("3_Phase/06_noise_color[tooltip:Noise colour]",               0.5, 0,    1,    0.001);
sub_harmonic       = hslider("3_Phase/07_sub_harmonic[tooltip:Sub-harmonic]",              0,   0,    1,    0.001);

// ---------------------------------------------------------------------------
// Group 4 — Modulation (params 32–41)
// ---------------------------------------------------------------------------
vibrato_rate  = hslider("4_Modulation/00_vibrato_rate[tooltip:Vibrato rate]",   5,   0,  10,   0.01);
vibrato_depth = hslider("4_Modulation/01_vibrato_depth[tooltip:Vibrato depth]", 0,   0,  0.05, 0.0001);
vibrato_delay = hslider("4_Modulation/02_vibrato_delay[tooltip:Vibrato delay]", 0.3, 0,  2,    0.001);
tremolo_rate  = hslider("4_Modulation/03_tremolo_rate[tooltip:Tremolo rate]",   4,   0,  20,   0.01);
tremolo_depth = hslider("4_Modulation/04_tremolo_depth[tooltip:Tremolo depth]", 0,   0,  1,    0.001);
drift_rate    = hslider("4_Modulation/05_drift_rate[tooltip:Drift rate]",       0,   0,  2,    0.001);
drift_depth   = hslider("4_Modulation/06_drift_depth[tooltip:Drift depth]",     0,   0,  0.3,  0.001);
formant1_freq = hslider("4_Modulation/07_formant1_freq[tooltip:Formant 1 freq]",3,   1,  16,   0.01);
formant2_freq = hslider("4_Modulation/08_formant2_freq[tooltip:Formant 2 freq]",6,   1,  16,   0.01);
formant_depth = hslider("4_Modulation/09_formant_depth[tooltip:Formant depth]", 0,   0,  1,    0.001);

// ---------------------------------------------------------------------------
// Group 5 — Master (params 42–47)
// ---------------------------------------------------------------------------
level      = hslider("5_Master/00_level[tooltip:Output level]",       0.7,  0,   1,   0.001);
vel_sens   = hslider("5_Master/01_vel_sens[tooltip:Velocity sens]",   0.5,  0,   1,   0.001);
vel_bright = hslider("5_Master/02_vel_brightness[tooltip:Vel bright]",0.3,  0,   1,   0.001);
pitch_glide= hslider("5_Master/03_pitch_glide[tooltip:Portamento]",   0,    0,   10,  0.01);
saturation = hslider("5_Master/04_saturation[tooltip:Saturation]",    0,    0,   1,   0.001);
fine_tune  = hslider("5_Master/05_fine_tune[unit:ct][tooltip:Cents]", 0,   -50,  50,  0.1);

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------
N  = 64;
PI = ma.PI;

// ---------------------------------------------------------------------------
// Pitch — portamento + fine tune
// ---------------------------------------------------------------------------
glide_tau   = 0.0001 + pitch_glide * 0.2;
fine_ratio  = pow(2.0, fine_tune / 1200.0);
freq_smooth = freq * fine_ratio : si.smooth(ba.tau2pole(glide_tau));

// ---------------------------------------------------------------------------
// Vibrato LFO — delayed onset via slow-attack envelope
// ---------------------------------------------------------------------------
vibrato_env = en.adsr(vibrato_delay, 0.01, 1.0, 0.5, gate);
vibrato_lfo = os.osc(vibrato_rate) * vibrato_depth * vibrato_env;

// ---------------------------------------------------------------------------
// Tremolo LFO
// ---------------------------------------------------------------------------
tremolo_lfo = 1.0 - tremolo_depth * 0.5 * (1.0 + os.osc(tremolo_rate));

// ---------------------------------------------------------------------------
// Global amplitude ADSR
// ---------------------------------------------------------------------------
amp_env = en.adsr(attack, decay, sustain, release, gate);

// ---------------------------------------------------------------------------
// Brightness envelope — controls high harmonic amplitude over time
// ---------------------------------------------------------------------------
bright_env   = en.adsr(brightness_attack, brightness_decay,
                        brightness_sustain, brightness_release, gate);
bright_blend(k) = float(k - 1) / float(N - 1);
bright_factor(k) = 1.0 - bright_blend(k) + bright_blend(k) * bright_env;

// ---------------------------------------------------------------------------
// Spectral flux — slow LFO on upper harmonic amplitudes
// ---------------------------------------------------------------------------
flux_lfo = os.osc(spectral_flux_rate);
flux_factor(k) = ba.if(k > 8,
                   1.0 + spectral_flux_depth * flux_lfo * bright_blend(k),
                   1.0);

// ---------------------------------------------------------------------------
// Drift — slow random walk on per-partial amplitudes
// ---------------------------------------------------------------------------
drift_lfo(k) = no.noise * (float(k % 7 + 1) / 7.0)
               : fi.lowpass(1, max(0.1, drift_rate * 2.0))
               : *(drift_depth);
drift_factor(k) = 1.0 + drift_lfo(k);

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

// Spectral tilt: amp *= k^tilt (k=1 is always unity)
tilt_factor(k) = pow(float(k), spectral_tilt);

// Odd/even balance: ×2 so unity gain at odd_even=0.5
odd_weight  = (1.0 - odd_even) * 2.0;
even_weight = odd_even * 2.0;
odd_even_factor(k) = ba.if(k % 2 == 0, even_weight, odd_weight);

// Combined raw amplitude
harm_amp_raw(k) = group_amp(k) * tilt_factor(k) * odd_even_factor(k);

// ---------------------------------------------------------------------------
// Formant shaping — two Gaussian bumps in harmonic-index space
// ---------------------------------------------------------------------------
sigma_sq = 1.5 * 1.5;
formant_bump(k, ctr) = exp(-0.5 * (float(k) - ctr) * (float(k) - ctr) / sigma_sq);
formant_factor(k) =
  1.0 + formant_depth * (formant_bump(k, formant1_freq) + formant_bump(k, formant2_freq));

harm_amp(k) = harm_amp_raw(k) * formant_factor(k);

// ---------------------------------------------------------------------------
// Inharmonic partial frequency: freq_k = k*f0*(1 + B*(k^2 - 1))
// ---------------------------------------------------------------------------
harm_freq(k) = freq_smooth * float(k)
               * (1.0 + inharmonicity * (float(k) * float(k) - 1.0));

// ---------------------------------------------------------------------------
// Phase randomisation — adds per-harmonic noise to the oscillator frequency,
// gradually dephasing partials (phase_random=0: phase-locked, =1: random)
// ---------------------------------------------------------------------------
phase_rand_lfo(k) = no.noise * (float((k * 17 + 3) % 31 + 1) / 31.0)
                    : si.smooth(ba.tau2pole(0.05))
                    : *(phase_random * harm_freq(k) * 0.01);

// ---------------------------------------------------------------------------
// Phase random walk — slower independent drift per partial
// ---------------------------------------------------------------------------
phase_walk(k) = no.noise * (float(k % 7 + 1) / 7.0)
                : si.smooth(ba.tau2pole(0.1))
                : *(phase_walk_rate);

// ---------------------------------------------------------------------------
// Inter-partial beating — sinusoidal detuning stagger
// ---------------------------------------------------------------------------
beating_offset(k) = beating_depth
                    * os.osc(beating_rate * float(k % 3 + 1) * 0.7)
                    * harm_freq(k);

// ---------------------------------------------------------------------------
// Stereo spread — R channel gets a small per-harmonic pitch offset
// ---------------------------------------------------------------------------
stereo_spread_freq(k) = stereo_phase_spread * float(k) * 0.01;

// ---------------------------------------------------------------------------
// Additive oscillator sums — L and R
// ---------------------------------------------------------------------------
additive_L = sum(k, N,
  harm_amp(k+1) * bright_factor(k+1) * flux_factor(k+1) * drift_factor(k+1) *
  os.osc(  harm_freq(k+1) * (1.0 + vibrato_lfo)
         + beating_offset(k+1)
         + phase_rand_lfo(k+1)
         + phase_walk(k+1)
  )
);

additive_R = sum(k, N,
  harm_amp(k+1) * bright_factor(k+1) * flux_factor(k+1) * drift_factor(k+1) *
  os.osc(  harm_freq(k+1) * (1.0 + vibrato_lfo + stereo_spread_freq(k+1))
         + beating_offset(k+1)
         + phase_rand_lfo(k+1)
         + phase_walk(k+1)
  )
);

// ---------------------------------------------------------------------------
// Sub-harmonic (0.5× fundamental)
// ---------------------------------------------------------------------------
sub_osc = sub_harmonic * os.osc(freq_smooth * 0.5);

// ---------------------------------------------------------------------------
// Noise floor — coloured via one-pole LP (noise_color=0→white, =1→dark)
// ---------------------------------------------------------------------------
noise_lp_cutoff = 200.0 + (1.0 - noise_color) * 19800.0;
noise_signal    = no.noise : fi.lowpass(1, noise_lp_cutoff);
noise_out       = noise_floor * noise_signal;

// ---------------------------------------------------------------------------
// Soft-clip saturation — tanh waveshaper
// ---------------------------------------------------------------------------
drive       = 1.0 + saturation * 9.0;
softclip(x) = ma.tanh(x * drive) / drive;

// ---------------------------------------------------------------------------
// Output gain
// vel_bright modulates how much the brightness envelope boosts the overall
// level during note onset (couples velocity sensitivity to brightness).
// Here it acts as a subtle mid-term gain shaper via the bright_env signal.
// ---------------------------------------------------------------------------
vel_bright_boost = 1.0 + vel_bright * bright_env * 0.3;
out_gain = level * (1.0 - vel_sens * 0.3) * vel_bright_boost;

// ---------------------------------------------------------------------------
// Final assembly
// ---------------------------------------------------------------------------
signal_L = (additive_L + sub_osc + noise_out) * amp_env * tremolo_lfo * out_gain;
signal_R = (additive_R + sub_osc + noise_out) * amp_env * tremolo_lfo * out_gain;

process = softclip(signal_L), softclip(signal_R);
