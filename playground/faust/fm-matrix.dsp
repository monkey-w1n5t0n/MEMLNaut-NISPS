// fm-matrix.dsp — placeholder 2-op FM synthesizer
// Carrier modulated by a single operator.
// This is a pipeline-proving stub; the full 56-param FM matrix engine
// is implemented in meml-wgg.
import("stdfaust.lib");

freq  = hslider("freq[unit:Hz]", 220, 20, 4000, 0.1);
ratio = hslider("ratio", 2.0, 0.125, 16.0, 0.001);
index = hslider("index", 1.0, 0.0, 10.0, 0.001);
amp   = hslider("amp", 0.5, 0, 1, 0.001);

mod     = amp * os.osc(freq * ratio);
process = amp * os.osc(freq + index * mod * freq) <: _,_;
