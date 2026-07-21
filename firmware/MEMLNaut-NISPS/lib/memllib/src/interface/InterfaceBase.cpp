#include "InterfaceBase.hpp"
#include <Arduino.h>


InterfaceBase::InterfaceBase() :
    init_done_(false),
    n_inputs_(0),
    n_outputs_(0),
    midi_(nullptr)
{
}

InterfaceBase::~InterfaceBase()
{
}

void InterfaceBase::setup(size_t n_inputs, size_t n_outputs)
{
    queue_init(&queue_audioparam_, sizeof(float)*n_outputs, 1);
    n_inputs_ = n_inputs;
    n_outputs_ = n_outputs;
    init_done_ = true;
}

void InterfaceBase::SendParamsToQueue(const std::vector<float>& data) {
    if (!init_done_) {
        DEBUG_PRINTLN("InterfaceBase::SendParamsToQueue - Error: Interface not initialized");
        return;
    }
    if (data.size() != n_outputs_) {
        DEBUG_PRINTLN("InterfaceBase::SendParamsToQueue - Error: data size mismatch");
        DEBUG_PRINTF("Expected: %zu, Received: %zu\n", n_outputs_, data.size());
        return;
    }
    queue_try_add(&queue_audioparam_, data.data());
    if (paramOutputHook) {
        paramOutputHook(data);
    } else if (midi_) {
        midi_->SendParamsAsMIDICC(data);
    } else {
        DEBUG_PRINTLN("Warning: MIDI interface not set");
    }
}

bool InterfaceBase::ReceiveParamsFromQueue(float *data) {
    if (!init_done_) {
        DEBUG_PRINTLN("InterfaceBase::ReceiveParamsFromQueue - Error: Interface not initialized");
        return false;
    }
    // if (data.size() != n_outputs_) {
    //     data.resize(n_outputs_);
    // }
    return queue_try_remove(&queue_audioparam_, data);
}
