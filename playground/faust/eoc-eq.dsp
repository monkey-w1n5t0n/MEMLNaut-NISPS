// eoc-eq.dsp — 4-band parametric EQ for MEMLNaut EOC chain
//
// Band 1: Low Shelf  (default 80 Hz, range 20–500)
// Band 2: Low-Mid bell (default 400 Hz, range 100–2000)
// Band 3: High-Mid bell (default 2500 Hz, range 500–8000)
// Band 4: High Shelf (default 8000 Hz, range 2000–20000)
//
// Compile:
//   faust -lang wasm -cn eoc_eq -e eoc-eq.dsp -o eoc-eq.wasm -json

import("stdfaust.lib");

// Band 1 — Low Shelf
freq1  = hslider("Band 1 (Low Shelf)/freq1[unit:Hz]",  80,    20,    500,   0.1);
gain1  = hslider("Band 1 (Low Shelf)/gain1[unit:dB]",   0,   -12,    12,    0.1);
q1     = hslider("Band 1 (Low Shelf)/q1",               1.0,   0.1,  10.0,  0.01);

// Band 2 — Low-Mid bell
freq2  = hslider("Band 2 (Low-Mid)/freq2[unit:Hz]",   400,   100,  2000,   1.0);
gain2  = hslider("Band 2 (Low-Mid)/gain2[unit:dB]",     0,   -12,    12,    0.1);
q2     = hslider("Band 2 (Low-Mid)/q2",                 1.0,   0.1,  10.0,  0.01);

// Band 3 — High-Mid bell
freq3  = hslider("Band 3 (High-Mid)/freq3[unit:Hz]", 2500,   500,  8000,   1.0);
gain3  = hslider("Band 3 (High-Mid)/gain3[unit:dB]",    0,   -12,    12,    0.1);
q3     = hslider("Band 3 (High-Mid)/q3",                1.0,   0.1,  10.0,  0.01);

// Band 4 — High Shelf
freq4  = hslider("Band 4 (High Shelf)/freq4[unit:Hz]", 8000, 2000, 20000,  10.0);
gain4  = hslider("Band 4 (High Shelf)/gain4[unit:dB]",    0,  -12,    12,    0.1);
q4     = hslider("Band 4 (High Shelf)/q4",               1.0,   0.1,  10.0,  0.01);

eqChain = fi.low_shelf(gain1, freq1) :
           fi.peak_eq(gain2, freq2, q2) :
           fi.peak_eq(gain3, freq3, q3) :
           fi.high_shelf(gain4, freq4);

process = eqChain, eqChain;
