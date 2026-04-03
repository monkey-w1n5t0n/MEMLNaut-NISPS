// eoc-reverb.dsp — Stereo reverb for MEMLNaut EOC chain
//
// 9 params: predelay, size, diffusion, hi_damp, lo_damp, decay, mix, width, mod_rate
//
// Uses re.zita_rev1_stereo for the core reverb algorithm.
//
// Compile:
//   faust -lang wasm -cn eoc_reverb -json eoc-reverb.dsp -o eoc-reverb.wasm

import("stdfaust.lib");

predelay = hslider("predelay[unit:ms]",  0.0,   0.0,  100.0,  0.5);
size     = hslider("size",              0.5,   0.0,    1.0,  0.001);
diffusion= hslider("diffusion",         0.7,   0.0,    1.0,  0.001);
hi_damp  = hslider("hi_damp",           0.5,   0.0,    1.0,  0.001);
lo_damp  = hslider("lo_damp",           0.0,   0.0,    1.0,  0.001);
decay    = hslider("decay[unit:s]",      3.0,   0.1,   20.0,  0.1);
mix      = hslider("mix",               0.2,   0.0,    1.0,  0.001);
width    = hslider("width",             0.8,   0.0,    1.0,  0.001);
mod_rate = hslider("mod_rate[unit:Hz]", 0.5,   0.0,    5.0,  0.01);

// Pre-delay in samples (minimum 1)
pdSamps = max(1, int(predelay / 1000.0 * ma.SR));

// Frequency crossovers for zita
f1   = 200.0 + lo_damp * 1800.0;
f2   = 20000.0 - hi_damp * 18000.0;

// Reverb decay times scaled by size
t60dc = decay * (1.0 + size * 0.5);
t60m  = decay;

// Pre-delay: single channel
predelayLine = _ @ pdSamps;

// Width processing: M/S encode-scale-decode
// L R → L' R' where side channels scaled by width
widthL(l, r) = (l + r) * 0.5 + (l - r) * 0.5 * width;
widthR(l, r) = (l + r) * 0.5 - (l - r) * 0.5 * width;

// Wet signal through predelay, diffusion scale, and zita reverb
wetL(inL, inR) = (re.zita_rev1_stereo(0.0, f1, f2, t60dc, t60m, 192000.0,
                    inL * diffusion @ pdSamps,
                    inR * diffusion @ pdSamps)) : widthL;

wetR(inL, inR) = (re.zita_rev1_stereo(0.0, f1, f2, t60dc, t60m, 192000.0,
                    inL * diffusion @ pdSamps,
                    inR * diffusion @ pdSamps)) : widthR;

process(inL, inR) =
    inL * (1.0 - mix) + wetL(inL, inR) * mix,
    inR * (1.0 - mix) + wetR(inL, inR) * mix;
