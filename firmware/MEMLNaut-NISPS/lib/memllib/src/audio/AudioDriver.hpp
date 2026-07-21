#ifndef __AUDIO_DRIVER_HPP__
#define __AUDIO_DRIVER_HPP__

#include <Arduino.h>
#include <stddef.h>
#include "../PicoDefs.hpp"
#include "i2s_pio/i2s.h"

extern "C" {

const size_t kBufferSize = AUDIO_BUFFER_FRAMES;
extern size_t kSampleRate;
extern float kSampleRateRcpr;
const size_t kNChannels = 2;

struct stereosample_t {
    float L;
    float R;

    __force_inline stereosample_t operator+(const stereosample_t& other) const {
        return {L + other.L, R + other.R};
    }
    __force_inline stereosample_t& operator+=(const stereosample_t& other) {
        L += other.L;
        R += other.R;
        return *this;
    }
    __force_inline stereosample_t operator*(float scalar) const {
        return {L * scalar, R * scalar};
    }
    __force_inline stereosample_t& operator*=(float scalar) {
        L *= scalar;
        R *= scalar;
        return *this;
    }
    __force_inline stereosample_t operator-() const {
        return {-L, -R};
    }
    __force_inline stereosample_t operator-(const stereosample_t& other) const {
        return {L - other.L, R - other.R};
    }
    __force_inline stereosample_t& operator-=(const stereosample_t& other) {
        L -= other.L;
        R -= other.R;
        return *this;
    }
    __force_inline float operator[](size_t index) const {
        return index == 0 ? L : R;
    }
};

using audiocallback_fptr_t = stereosample_t (*)(stereosample_t);
using audiocallback_block_fptr_t = void (*)(float[][kBufferSize], float[][kBufferSize], size_t, size_t);

}


extern audiocallback_fptr_t audio_callback_;
extern audiocallback_block_fptr_t audio_callback_block_;

extern uint32_t AUDIOLOOP_MEAN;


enum PinConfig_i2c {
    i2c_sgt5000Data = 0,
    i2c_sgt5000Clk = 1,
    i2s_pDIN = 6,
    i2s_pDOUT = 7,
    i2s_pBCLK = 8,
    i2s_pWS = 9,
    i2s_pMCLK = 10,
};

extern volatile bool AUDIO_MEM dsp_overload;
extern float master_volume_;


class AudioDriver {
 public:
    typedef struct {
        bool mic_input;
        size_t line_level;
        size_t mic_gain_dB;
        float output_volume;
    } codec_config_t;
    static bool Setup();
    static bool Setup(const codec_config_t& config);
    static inline void SetCallback(audiocallback_fptr_t callback) {
        audio_callback_ = callback;
         DEBUG_PRINT("AUDIO_DRIVER - Callback address: ");
         DEBUG_PRINTF("%p\n", audio_callback_);
    }
    static inline void SetBlockCallback(audiocallback_block_fptr_t callback) {
        audio_callback_block_ = callback;
         DEBUG_PRINT("AUDIO_DRIVER - Block Callback address: ");
         DEBUG_PRINTF("%p\n", audio_callback_block_);
    }
    static inline void SetMasterVolume(float volume) {
        if (volume > 1.0f) {
            volume = 1.0f;
        } else if (volume < 0) {
            volume = 0;
        }
        master_volume_ = volume;
    }

    static void SetSampleRate(size_t rate);
    static inline size_t GetSampleRate() { return kSampleRate; }
    static size_t GetSysClockSpeed() {
		if (kSampleRate == 48000) {
	        return 132000 * 2;
		} else if (kSampleRate == 44100) {
			return 135475 * 2;
		} else if (kSampleRate == 32000) {
		    return 132000 * 2;
		} else if (kSampleRate == 24000) {
		    return 132000 * 2;
		} else {
			panic("Unsupported sample rate for SGTL5000");
		}
    } 

    AudioDriver() = delete;

    static void i2sOutputCallback(void);
    static stereosample_t silence_(stereosample_t);

private:
    static void setDACVolume(float n);
};

#endif  // __AUDIO_DRIVER_HPP__
