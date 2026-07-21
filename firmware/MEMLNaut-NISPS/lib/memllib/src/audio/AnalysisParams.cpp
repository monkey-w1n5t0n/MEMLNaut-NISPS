#include "AnalysisParams.hpp"
#include "pico/mutex.h"
#include "CoreMutex.h"
#include "Arduino.h"
#include "../PicoDefs.hpp"

static mutex_t mutex_0to1_;
static std::vector<float> params_mem_;


void AnalysisParamsSetup(size_t n_params) {
    params_mem_.resize(n_params, -1.f);
    mutex_init(&mutex_0to1_);
};

void AUDIO_FUNC(AnalysisParamsWrite)(std::vector<float> &params) {
    {  // Acquire
        CoreMutex acquire_1to0(&mutex_0to1_);
        for (unsigned int n=0; n < params_mem_.size(); n++) {
            if (n >= params.size()) {
                 DEBUG_PRINTLN("PANIK! Too many params for AnalysisParams");
            }
            params_mem_[n] = params[n];
        }
    }  // Release
}

void AnalysisParamsRead(std::vector<float> &params) {
    {  // Acquire
        CoreMutex acquire_1to0(&mutex_0to1_);
        params = params_mem_;
    }  // Release
}
