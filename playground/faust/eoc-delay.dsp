// eoc-delay.dsp — Stereo delay effect for the EOC rack.
//
// Parameters (7):
//   time      [250ms, 1-2000ms]   delay time (ms) when sync=0
//   feedback  [0.3,  0-0.95]      feedback amount
//   lp_cutoff [8000, 500-20000]   LP filter cutoff on feedback path (Hz)
//   ping_pong [0.0,  0-1]         0=normal stereo, 1=full ping-pong L<->R
//   spread    [0.5,  0-1]         stereo width of delay tails
//   sync      [0]                 nentry: 0=free, 1=half, 2=quarter, 3=eighth (120bpm)
//   mix       [0.3,  0-1]         dry/wet mix

import("stdfaust.lib");

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

time      = hslider("time[unit:ms]",      250, 1,   2000,  0.1);
feedback  = hslider("feedback",           0.3, 0,   0.95,  0.001);
lp_cutoff = hslider("lp_cutoff[unit:Hz]", 8000, 500, 20000, 1);
ping_pong = hslider("ping_pong",          0.0, 0,   1,     0.001);
spread    = hslider("spread",             0.5, 0,   1,     0.001);
sync      = nentry("sync",                0,   0,   3,     1);
mix       = hslider("mix",                0.3, 0,   1,     0.001);

// ---------------------------------------------------------------------------
// Derived delay time: free or tempo-synced at 120bpm
// ---------------------------------------------------------------------------

bpm = 120.0;
beat_ms = 60000.0 / bpm;

sync_time_ms =
    ba.if(sync < 0.5, time,
    ba.if(sync < 1.5, beat_ms * 2.0,
    ba.if(sync < 2.5, beat_ms,
                      beat_ms * 0.5)));

// Fixed max delay: 96000 samples (1s at 96kHz, covers all tempos for eighth notes at 30bpm+)
max_delay_samp = 96000;

// ---------------------------------------------------------------------------
// Stereo ping-pong delay.
// Uses f ~ (_, _) pattern for stereo feedback loop.
// de.delay used for variable delay (no LP on feedback path inside the loop —
// LP is applied to the whole wet signal for efficiency).
// ---------------------------------------------------------------------------

dSamp = int(sync_time_ms * float(ma.SR) / 1000.0);

delayCore(inL, inR, fbL, fbR) = wetL, wetR
with {
    pp  = ping_pong;
    fb  = feedback;
    mixL = inL + (fbL * (1.0 - pp) + fbR * pp) * fb;
    mixR = inR + (fbR * (1.0 - pp) + fbL * pp) * fb;
    wetL = de.delay(max_delay_samp, dSamp, mixL);
    wetR = de.delay(max_delay_samp, dSamp, mixR);
};

stereoDelay = (_, _) : delayCore ~ (_, _);

// ---------------------------------------------------------------------------
// Post-delay LP filter (tone shaping on the feedback tail)
// ---------------------------------------------------------------------------

delayLP(x) = fi.lowpass(1, lp_cutoff, x);

// ---------------------------------------------------------------------------
// Mid-side stereo spread
// ---------------------------------------------------------------------------

msSpread(inL, inR) = outL, outR
with {
    w    = spread;
    mid  = (inL + inR) * 0.5;
    side = (inL - inR) * 0.5;
    outL = mid + side * w * 2.0;
    outR = mid - side * w * 2.0;
};

// ---------------------------------------------------------------------------
// Main process: dry/wet mix
// ---------------------------------------------------------------------------

// Delay + LP + spread on two signals
delayAndProcess(inL, inR) = wideL, wideR
with {
    wetL0 = stereoDelay(inL, inR) : _,!;
    wetR0 = stereoDelay(inL, inR) : !,_;
    wetL1 = delayLP(wetL0);
    wetR1 = delayLP(wetR0);
    wideL = msSpread(wetL1, wetR1) : _,!;
    wideR = msSpread(wetL1, wetR1) : !,_;
};

process(inL, inR) = outL, outR
with {
    wideL = delayAndProcess(inL, inR) : _,!;
    wideR = delayAndProcess(inL, inR) : !,_;
    outL = inL * (1.0 - mix) + wideL * mix;
    outR = inR * (1.0 - mix) + wideR * mix;
};
