// additive.dsp — placeholder additive oscillator bank
// 4 harmonics with configurable frequency and amplitude.
// This is a pipeline-proving stub; the full 48-param additive engine
// is implemented in meml-pj4.
import("stdfaust.lib");

freq = hslider("freq[unit:Hz]", 220, 20, 4000, 0.1);
amp  = hslider("amp", 0.5, 0, 1, 0.001);

process = sum(i, 4, amp * (1.0/(i+1)) * os.osc(freq * (i+1))) <: _,_;
