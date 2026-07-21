#ifndef __AUDIO_APP_BASE_HPP__
#define __AUDIO_APP_BASE_HPP__

#include "AudioDriver.hpp"
#include "../interface/InterfaceBase.hpp"
#include <functional>
#include <memory>

template<size_t NPARAMS>
class AudioAppBase {
protected:
    float sample_rate_;
    std::shared_ptr<InterfaceBase> interface_;
    static std::function<stereosample_t(stereosample_t)> callback_;
    std::array<float, NPARAMS> paramsFromQueue;

public:
    virtual AudioDriver::codec_config_t GetDriverConfig() const {
        return {
            .mic_input = false,
            .line_level = 3,
            .mic_gain_dB = 0,
            .output_volume = 0.55f
        };
    }

    AudioAppBase() = default;
    virtual ~AudioAppBase() = default;


    virtual stereosample_t Process(const stereosample_t x) {
        return x;
    }

    static stereosample_t audioCallback(const stereosample_t x) {
        return callback_(x);
    }

    virtual void Setup(float sample_rate, std::shared_ptr<InterfaceBase> interface) {
        sample_rate_ = sample_rate;
        interface_ = interface;
        callback_ = [this](stereosample_t x) { return Process(x); };
        AudioDriver::SetCallback(audioCallback);
    }

    virtual void ProcessParams(const std::array<float, NPARAMS>& params) {
        // Default implementation does nothing
    }

    virtual void loop() {
        if (!interface_) {
            DEBUG_PRINTLN("AudioAppBase::loop - Error: Interface is null");
            return;  // Early return if interface is null
        }

        // std::vector<float> x;
        if (interface_->ReceiveParamsFromQueue(paramsFromQueue.data())) {
            ProcessParams(paramsFromQueue);
        }
    }
    
};

template<size_t NPARAMS>
std::function<stereosample_t(stereosample_t)> AudioAppBase<NPARAMS>::callback_ = nullptr;

#endif // __AUDIO_APP_BASE_HPP__
