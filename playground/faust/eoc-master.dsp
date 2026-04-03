// eoc-master.dsp — Master bus effect for the EOC rack.
//
// Parameters (4):
//   gain            [1.0,  0-2]        output gain multiplier
//   width           [1.0,  0-2]        stereo width: 0=mono, 1=normal, 2=extra-wide
//   limiter_thresh  [-1.0, -12 to 0]   brick-wall limiter threshold (dB)
//   dc_block        [1]                nentry: 0=off, 1=on — DC blocking filter

import("stdfaust.lib");

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

gain           = hslider("gain",                  1.0,  0,    2,   0.001);
width          = hslider("width",                 1.0,  0,    2,   0.001);
limiter_thresh = hslider("limiter_thresh[unit:dB]", -1.0, -12, 0, 0.1);
dc_block_on    = nentry("dc_block",               1,    0,    1,   1);

// ---------------------------------------------------------------------------
// DC blocking filter (~10Hz one-pole HP)
// ---------------------------------------------------------------------------

dcBlock(on, x) = on * fi.highpass(1, 10.0, x) + (1.0 - on) * x;

// ---------------------------------------------------------------------------
// Stereo width via mid-side processing
//   width = 0: mono (side removed)
//   width = 1: original stereo
//   width = 2: enhanced stereo (doubled sides)
// ---------------------------------------------------------------------------

stereoWidth(inL, inR) = outL, outR
with {
    w    = width;
    mid  = (inL + inR) * 0.5;
    side = (inL - inR) * 0.5;
    outL = mid + side * w;
    outR = mid - side * w;
};

// ---------------------------------------------------------------------------
// Brick-wall limiter: peak-following gain reduction.
// Uses a leaky envelope follower with fast attack (~0.5ms) and slow release (~100ms).
// ---------------------------------------------------------------------------

threshLin = ba.db2linear(limiter_thresh);

// Leaky-peak envelope follower: exponential release ~100ms
// Takes a signal, outputs its peak envelope
releaseCoeff = exp(-1.0 / (float(ma.SR) * 0.100));

peakEnv = abs : (+ ~ *(releaseCoeff));

// Gain reduction: clamp to threshold
limiterGR(env) = threshLin / max(threshLin, env);

// Stereo limiter: linked L/R gain reduction from max of both peaks
limiter(inL, inR) = inL * gr, inR * gr
with {
    envL = peakEnv(inL);
    envR = peakEnv(inR);
    peakStereo = max(envL, envR);
    gr = limiterGR(peakStereo);
};

// ---------------------------------------------------------------------------
// Main process
// ---------------------------------------------------------------------------

process(inL, inR) = outL, outR
with {
    // 1. DC block
    dcL = dcBlock(dc_block_on, inL);
    dcR = dcBlock(dc_block_on, inR);
    // 2. Gain
    gL = dcL * gain;
    gR = dcR * gain;
    // 3. Stereo width
    wL = stereoWidth(gL, gR) : _,!;
    wR = stereoWidth(gL, gR) : !,_;
    // 4. Limiter
    outL = limiter(wL, wR) : _,!;
    outR = limiter(wL, wR) : !,_;
};
