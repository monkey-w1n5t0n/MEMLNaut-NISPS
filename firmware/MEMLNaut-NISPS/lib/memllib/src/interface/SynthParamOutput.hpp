#pragma once

#include "MIDIInOut.hpp"
#include <span>
#include <memory>

// Abstract base for synth-specific parameter output drivers.
// Subclass this to implement SysEx (or other) output for a specific synthesizer.
// Wire an instance into InterfaceBase::paramOutputHook in the mode's setupMIDI().
class SynthParamOutput {
public:
    virtual void sendParams(std::span<const float> params) = 0;
    virtual ~SynthParamOutput() = default;

protected:
    SynthParamOutput(std::shared_ptr<MIDIInOut> midi) : midi_(midi) {}
    std::shared_ptr<MIDIInOut> midi_;
};
