// eoc-compressor.dsp — Stereo feed-forward compressor for MEMLNaut EOC chain
//
// 7 params: threshold, ratio, attack, release, knee, makeup, mix
//
// Compile:
//   faust -lang wasm -cn eoc_compressor -e eoc-compressor.dsp -o eoc-compressor.wasm -json

import("stdfaust.lib");

threshold = hslider("threshold[unit:dB]", -24.0, -60.0,   0.0,  0.1);
ratio     = hslider("ratio",                4.0,   1.0,  20.0,  0.1);
attack    = hslider("attack[unit:ms]",     10.0,   0.1, 200.0,  0.1);
release   = hslider("release[unit:ms]",   100.0,  10.0, 2000.0, 1.0);
knee      = hslider("knee[unit:dB]",        6.0,   0.0,  24.0,  0.1);
makeup    = hslider("makeup[unit:dB]",      0.0,   0.0,  24.0,  0.1);
mix       = hslider("mix",                  1.0,   0.0,   1.0,  0.001);

// Convert ms to seconds for Faust
attackSec  = attack  / 1000.0;
releaseSec = release / 1000.0;

// Soft-knee threshold adjustment (shift threshold down by half the knee)
threshKnee = threshold - knee / 2.0;

// Makeup gain as linear multiplier
makeupLin = ba.db2linear(makeup);

// Compressor on a single channel with makeup applied
compCh(x) = co.compressor_mono(ratio, threshKnee, attackSec, releaseSec, x) * makeupLin;

// Parallel compression (dry/wet blend)
parallelComp(x) = (1.0 - mix) * x + mix * compCh(x);

process = parallelComp, parallelComp;
