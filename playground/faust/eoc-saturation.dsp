// eoc-saturation.dsp — Stereo saturation effect for the EOC rack.
//
// Parameters (4):
//   drive     [0.0, 0-1]   0=clean, 1=full drive
//   character [0.0, 0-1]   0=soft-clip/tanh, 0.5=tape/asymmetric, 1=hard-clip
//   tone      [0.5, 0-1]   post-saturation tone: 0=dark (LP), 1=bright (HP blend)
//   mix       [1.0, 0-1]   dry/wet for parallel saturation

import("stdfaust.lib");

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

drive     = hslider("drive",     0.0, 0, 1, 0.001);
character = hslider("character", 0.0, 0, 1, 0.001);
tone      = hslider("tone",      0.5, 0, 1, 0.001);
mix       = hslider("mix",       1.0, 0, 1, 0.001);

// ---------------------------------------------------------------------------
// Saturation shapes
// ---------------------------------------------------------------------------

driveGain = 1.0 + drive * 15.0;   // 1x to 16x gain before clipping

// Soft clip: tanh
softClip(x) = ma.tanh(x);

// Tape: asymmetric waveshaper — slightly harder clipping on positive peaks
// Blends tanh with a gentle second-harmonic bias
tapeClip(x) = softClip(x * 1.2) * 0.55 + softClip(x) * 0.45 + x * x * 0.04 * (1.0 - softClip(abs(x)));

// Hard clip: simple saturate
hardClip(x) = max(-1.0, min(1.0, x));

// Character crossfade between the three shapes:
//   c=0.0  → soft (tanh)
//   c=0.5  → tape (asymmetric)
//   c=1.0  → hard clip
saturate(c, x) =
    softClip(x) * (max(0.0, 1.0 - c * 2.0)) +
    tapeClip(x) * (1.0 - abs(c - 0.5) * 2.0) +
    hardClip(x) * max(0.0, (c - 0.5) * 2.0);

// Apply drive, saturate, and normalise output level
processChannel(x) = saturate(character, x * driveGain) / max(0.001, sqrt(driveGain));

// ---------------------------------------------------------------------------
// Tone control: LP/HP blend via one-pole filters
//
// tone=0.0  → dark (400Hz LP)
// tone=0.5  → flat (passthrough)
// tone=1.0  → bright (8kHz HP blend)
// ---------------------------------------------------------------------------

toneFreqLP = 400.0 + tone * 19600.0;   // 400Hz to 20kHz (fully open at tone=1)
toneFreqHP = 200.0 + tone * 7800.0;    // 200Hz to 8kHz

applyTone(x) = fi.lowpass(1, toneFreqLP, x);

// ---------------------------------------------------------------------------
// Main process: stereo saturation with parallel dry/wet mix
// ---------------------------------------------------------------------------

process(inL, inR) = outL, outR
with {
    wetL = applyTone(processChannel(inL));
    wetR = applyTone(processChannel(inR));
    outL = inL * (1.0 - mix) + wetL * mix;
    outR = inR * (1.0 - mix) + wetR * mix;
};
