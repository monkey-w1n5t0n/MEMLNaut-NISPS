#ifndef __INTERFACE_BASE_HPP__
#define __INTERFACE_BASE_HPP__

#include "pico/util/queue.h"
#include <vector>
#include <functional>
#include "MIDIInOut.hpp"
#include <memory>
#include <span>


class InterfaceBase
{
protected:
    InterfaceBase();

    // Member variables
    bool init_done_;
    size_t n_inputs_;
    size_t n_outputs_;
    queue_t queue_audioparam_;
    std::shared_ptr<MIDIInOut> midi_;

public:
    ~InterfaceBase();

    // Disable copy constructor and assignment operator
    InterfaceBase(const InterfaceBase&) = delete;
    InterfaceBase& operator=(const InterfaceBase&) = delete;

    // Disable move constructor and assignment operator
    InterfaceBase(InterfaceBase&&) = delete;
    InterfaceBase& operator=(InterfaceBase&&) = delete;

    // Virtual functions with default implementations
    virtual void setup(size_t n_inputs, size_t n_outputs);

    inline void SetMIDIInterface(std::shared_ptr<MIDIInOut> midi) {
        midi_ = midi;
    }

    // Optional transform applied to params before queuing and before storing as training action.
    // Set this to apply FocusManager::applyInPlace or similar.
    std::function<void(std::vector<float>&)> paramTransformHook;

    // Optional output hook — when set, replaces the default SendParamsAsMIDICC() call.
    // Use this to send SysEx or other non-CC output. If null, CC output is used as normal.
    std::function<void(std::span<const float>)> paramOutputHook;

    // Queue management
    void SendParamsToQueue(const std::vector<float>& data);

    //todo: this should be std::array and this class should be templated
    bool ReceiveParamsFromQueue(float *data);

    virtual void readAnalysisParameters(std::vector<float> params) {
        // Default implementation does nothing
    }
};

#endif// __INTERFACE_BASE_HPP__
