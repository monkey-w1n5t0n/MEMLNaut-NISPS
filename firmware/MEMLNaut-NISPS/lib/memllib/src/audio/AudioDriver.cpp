#include "AudioDriver.hpp"
#include <Arduino.h>
#include "Wire.h"

#include "control_sgtl5000.h"
#include "../synth/maximilian.h"
#include "hardware/dma.h"
#include "hardware/clocks.h"
#include "../PicoDefs.hpp"

#include "../utils/perf.hpp"



#define TEST_TONES    0
#define PASSTHROUGH   0


extern "C" {
    size_t kSampleRate = 48000;
    float kSampleRateRcpr = 1.0f / 48000.0f;
}

PERF_DECLARE(AUDIOLOOP);

AUDIO_MEM uint32_t AUDIOLOOP_MEAN=0;

int sampleRate = (int)kSampleRate;
constexpr int bitsPerSample = 32;

constexpr float amplitude = 1 << (bitsPerSample - 2); // amplitude of square wave = 1/2 of maximum
constexpr float neg_amplitude = -amplitude; // amplitude of square wave = 1/2 of maximum
constexpr float one_over_amplitude = 1.f / amplitude;

static int32_t AUDIO_MEM sample = amplitude; // current sample value

static AUDIO_MEM AudioControlSGTL5000 codecCtl;

audiocallback_fptr_t AUDIO_MEM audio_callback_ = nullptr;
audiocallback_block_fptr_t AUDIO_MEM audio_callback_block_ = nullptr;

//define AUDIO_BUFFER_MEM externally
static AUDIO_BUFFER_MEM float input_buffer[kNChannels][kBufferSize];
static AUDIO_BUFFER_MEM float output_buffer[kNChannels][kBufferSize];

static __attribute__((aligned(8))) AUDIO_MEM pio_i2s i2s;

volatile bool AUDIO_MEM dsp_overload;

float master_volume_ = 0;

#if TEST_TONES
maxiOsc osc, osc2;

float f1=20, f2=2000;
#endif  // TEST_TONES

inline float __attribute__((always_inline)) _scale_down(float x) {
    // Convert from int32 range to [-1.0, 1.0]
    return x * (1.0f / (float)(1LL << 31));  // Divide by 2^31 for proper scaling
}

inline float __attribute__((always_inline)) _scale_and_saturate(float x) {
    // Convert from [-1.0, 1.0] back to int32 range with saturation
    const float scaled = x * (float)(1LL << 31);
    if (scaled > INT32_MAX) return INT32_MAX;
    if (scaled < INT32_MIN) return INT32_MIN;
    return scaled;
}

#if TEST_TONES
static inline __attribute__((always_inline)) void AUDIO_FUNC(process_test_tones)(
    int32_t* output, size_t i) {
    output[i*2] = osc.sinewave(f1) * sample;
    output[(i*2) + 1] = osc2.sinewave(f2) * sample;
    f1 *= 1.00001;
    f2 *= 1.00001;
    if (f1 > 15000) {
        f1 = 20.0;
    }
    if (f2 > 15000) {
        f2 = 20.0;
    }
}
#endif

#if PASSTHROUGH
static inline __attribute__((always_inline)) void AUDIO_FUNC(process_passthrough)(
        const int32_t* input, int32_t* output, size_t i) {
    output[i*2] = input[i*2];
    output[(i*2) + 1] = input[(i*2) + 1];
}
#endif

static inline __attribute__((always_inline)) void AUDIO_FUNC(process_normal)(
        const int32_t* input, int32_t* output, size_t i,
        const size_t indexL, const size_t indexR) {
    stereosample_t y {
        _scale_down(static_cast<float>(input[indexL])),
        _scale_down(static_cast<float>(input[indexR]))
    };

    y = audio_callback_(y);  // y should now be in [-1.0, 1.0] range

    output[indexL] = static_cast<int32_t>(_scale_and_saturate(y.L * master_volume_));
    output[indexR] = static_cast<int32_t>(_scale_and_saturate(y.R * master_volume_));
}

static void AUDIO_FUNC(process_audio)(const int32_t* input, int32_t* output, size_t num_frames) {
    PERF_BEGIN(AUDIOLOOP);

    if (audio_callback_block_ != nullptr) {

        // Convert from interleaved int32_t to deinterleaved float.
        // Channels are swapped here to correct a hardware layout issue: the physical
        // L/R input sockets map to the opposite codec ADC channels. Swapping at this
        // lowest level means every mode sees x.L/x.R matching the labelled sockets.
        for (size_t i = 0; i < num_frames; i++) {
            const size_t indexL = i << 1;
            const size_t indexR = indexL + 1;
            input_buffer[0][i] = _scale_down(static_cast<float>(input[indexR]));
            input_buffer[1][i] = _scale_down(static_cast<float>(input[indexL]));
        }
        // Serial.println(input_buffer[0][0]);
        // Serial.println(input[0]);
        // Call block callback
        audio_callback_block_(input_buffer, output_buffer, kNChannels, num_frames);

        // Convert from deinterleaved float to interleaved int32_t
        for (size_t i = 0; i < num_frames; i++) {
            const size_t indexL = i << 1;
            const size_t indexR = indexL + 1;
            // TODO find way to perform only one for loop
            output[indexL] = static_cast<int32_t>(_scale_and_saturate(output_buffer[0][i] * master_volume_));
            output[indexR] = static_cast<int32_t>(_scale_and_saturate(output_buffer[1][i] * master_volume_));
        }

    } else {
        for (size_t i = 0; i < num_frames; i++) {
            const size_t indexL = i << 1;
            const size_t indexR = indexL + 1;

    #if TEST_TONES
            process_test_tones(output, i);
    #else
        #if PASSTHROUGH
            process_passthrough(input, output, i);
        #else
            process_normal(input, output, i, indexL, indexR);
        #endif
    #endif
        }
    }

    PERF_END(AUDIOLOOP);
    AUDIOLOOP_MEAN = PERF_GET_MEAN(AUDIOLOOP);
}

static void __isr dma_i2s_in_handler(void) {
    /* We're double buffering using chained TCBs. By checking which buffer the
     * DMA is currently reading from, we can identify which buffer it has just
     * finished reading (the completion of which has triggered this interrupt).
     */
    if (*(int32_t**)dma_hw->ch[i2s.dma_ch_in_ctrl].read_addr == i2s.input_buffer) {
        // It is inputting to the second buffer so we can overwrite the first
        process_audio(i2s.input_buffer, i2s.output_buffer, AUDIO_BUFFER_FRAMES);
    } else {
        // It is currently inputting the first buffer, so we write to the second
        process_audio(&i2s.input_buffer[STEREO_BUFFER_SIZE], &i2s.output_buffer[STEREO_BUFFER_SIZE], AUDIO_BUFFER_FRAMES);
    }
    dma_hw->ints0 = 1u << i2s.dma_ch_in_data;  // clear the IRQ
}


void __isr AudioDriver::i2sOutputCallback() {


    // for(size_t i=0;  i < kBufferSize; i++) {

    //     stereosample_t y { 0 };
    //     y = audio_callback_(y);

    //     stereosample_t y_scaled {
    //         _scale_and_saturate(y.L),
    //         _scale_and_saturate(y.R),
    //     };
    //     i2s.write32(static_cast<int32_t>(y_scaled.L), static_cast<int32_t>(y_scaled.R));
    // }

    // Timing end
    // auto elapsed = micros() - ts;
    // static constexpr float quantumLength = 1.f/
    //         ((static_cast<float>(kBufferSize)/static_cast<float>(kSampleRate))
    //         * 1000000.f);
    // float dspload = elapsed * quantumLength;
    // // Report DSP overload if needed
    // static volatile bool dsp_overload = false;
    // if (dspload > 0.95 and !dsp_overload) {
    //     dsp_overload = true;
    // } else if (dspload < 0.9) {
    //     dsp_overload = false;
    // }
}

bool AudioDriver::Setup(const codec_config_t &config) {

    if (nullptr == audio_callback_) {
        audio_callback_ = &silence_;
    }
    DEBUG_PRINTF("AUDIO- Setup - Audio callback address: 0x%x\n", audio_callback_);

    dsp_overload = false;
    master_volume_ = 0;

    // Zero out float buffers
    for (size_t ch = 0; ch < kNChannels; ch++) {
        for (size_t i = 0; i < kBufferSize; i++) {
            input_buffer[ch][i] = 0;
            output_buffer[ch][i] = 0;
        }
    }

    maxiSettings::setup(kSampleRate, 2, kBufferSize);

    if (!Wire.setSDA(i2c_sgt5000Data) ||
            !Wire.setSCL(i2c_sgt5000Clk)) {
         DEBUG_PRINTLN("AUDIO- Failed to setup I2C with codec!");
    }

    // set_sys_clock_khz(132000*2, true);
    // set_sys_clock_khz(129600, true);
    DEBUG_PRINTF("System Clock: %lu\n", clock_get_hz(clk_sys));

    size_t sys_clk_hz = clock_get_hz(clk_sys);
    if (sys_clk_hz != AudioDriver::GetSysClockSpeed() * 1000) {
        DEBUG_PRINTLN("Error: audio driver: system clock must be set externally (see ::GetDesiredClockSpeed)");
        DEBUG_PRINTLN("After 'setup()) {', add: 'set_sys_clock_khz(AudioDriver::GetSysClockSpeed(), true);'");
    }

    i2s_config picoI2SConfig {
        kSampleRate, // 48000,
        256,
        bitsPerSample, // 32,
        i2s_pMCLK, // 10,
        i2s_pDIN,  // 6,
        i2s_pDOUT,  // 7,
        i2s_pBCLK, // 8,
        true
    };
    i2s_program_start_synched(pio0, &picoI2SConfig, dma_i2s_in_handler, &i2s);

    setDACVolume(3.0f);

    // init i2c
    codecCtl.enable();
     DEBUG_PRINTLN("AUDIO - Codec enabled");
     DEBUG_PRINTF("config.output_volume = %f\n", config.output_volume);
    codecCtl.volume(config.output_volume > 0.99 ? 0.99 : config.output_volume);
     DEBUG_PRINTF("config.mic_input = %d\n", config.mic_input);
    codecCtl.inputSelect(config.mic_input ? AUDIO_INPUT_MIC : AUDIO_INPUT_LINEIN);
     DEBUG_PRINTF("config.line_level = %d\n", config.line_level);
    codecCtl.lineInLevel(config.line_level);
     DEBUG_PRINTF("config.mic_gain_dB = %d\n", config.mic_gain_dB);
    if (config.mic_input) {
        codecCtl.micGain(config.mic_gain_dB);
    }
    codecCtl.lineOutLevel(20);

    return true;
}

bool AudioDriver::Setup() {
    codec_config_t config;
    config.mic_input = false;
    config.line_level = 3;
    config.mic_gain_dB = 0;
    config.output_volume = 0.8;

    return Setup(config);
}


stereosample_t AudioDriver::silence_(stereosample_t x) {
    x.L = 0;
    x.R = 0;

    return x;
}

//breaking change
void AudioDriver::setDACVolume(float n) {
    codecCtl.dacVolume(n);
}

void AudioDriver::SetSampleRate(size_t rate) {
    kSampleRate = rate;
    kSampleRateRcpr = 1.0f / (float)rate;
}
