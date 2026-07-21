// firmware/MEMLNaut-NISPS/src/main.cpp — Thin entry point.
//
// The heavy lifting lives under:
//   - nisps/...                  — platform-agnostic ML, DSP, engines, modes
//                                  (repo root; reached via -I, see platformio.ini)
//   - firmware/MEMLNaut-NISPS/glue/...   — hardware bindings (audio driver, MIDI,
//                                           peripherals, output router)
//   - firmware/MEMLNaut-NISPS/lib/memllib/ — vendored hardware-abstraction library
//                                            (PlatformIO private library; see
//                                            lib/memllib/VENDORED.md)
//
// This file does only:
//   1. Instantiate the mode selected at compile time by the active PlatformIO
//      env (`-DMEMLNAUT_MODE_TYPE=...`, or `-DNISPS_SELFTEST=1` for the
//      guided hardware self-test — see platformio.ini, one [env] per variant).
//   2. setup() / loop() on core 0:
//        - boot board (sample rate from the mode's driver config, then clock)
//        - bind peripherals → mode.set_input
//        - bind MIDI in → mode.note_on/update_bpm/...
//        - run mode.tick_control() at ML cadence (5ms)
//   3. setup1() / loop1() on core 1:
//        - register the audio bridge so AudioDriver streams into mode.process
//        - bring the codec up on the mode's driver config (mic vs line, gains)
//        - pump engine events / drain MIDI out at sub-ms cadence

// ---- Hardware ----
// main.cpp is a plain .cpp (PlatformIO builds src/ as-is; no .ino ->
// preprocessed-sketch step), so Arduino.h is no longer supplied implicitly.
#include <Arduino.h>
#include "PicoDefs.hpp"
#include "audio/AudioDriver.hpp"
#include "hardware/memlnaut/MEMLNaut.hpp"
#include "interface/MIDIInOut.hpp"
#include "utils/perf.hpp"
#include "hardware/structs/bus_ctrl.h"

// ---- Glue ----
#include "glue/audio_driver.hpp"
#include "glue/midi_io.hpp"
#include "glue/mode_select.hpp"
#include "glue/output_router.hpp"
#include "glue/peripherals.hpp"
#include "glue/settings_view.hpp"

// ---- Mode selection ----
// MEMLNAUT_MODE_TYPE and NISPS_SELFTEST are supplied by the active PlatformIO
// [env] (platformio.ini), one env per firmware variant — no in-source mode
// registry, no build-time file rewriting. NISPS_SELFTEST is left undefined
// (== 0 in the #if below) by every normal-mode env; only the `selftest` env
// defines it.
#ifndef NISPS_SELFTEST
#define NISPS_SELFTEST 0
#endif

#include <memory>

// Inter-core handshake flags + stack flag — shared by BOTH the normal-mode and
// self-test build paths, so they live outside the fork below.
volatile bool APP_SRAM g_core0_ready  = false;
volatile bool APP_SRAM g_core1_ready  = false;
volatile bool APP_SRAM g_serial_ready = false;
volatile bool APP_SRAM g_iface_ready  = false;

bool core1_separate_stack = true;

#if !NISPS_SELFTEST
// =====================================================================
// Normal-mode build path (an engine + ML mode runs the device).
// =====================================================================

using ActiveMode = MEMLNAUT_MODE_TYPE;

ActiveMode AUDIO_MEM g_mode;

// Definition of the audio bridge declared in glue/audio_driver.hpp.
// Lives in the audio SRAM section so the per-block callback dereferences it
// without paying flash latency.
volatile nisps_firmware::ActiveModeBridge AUDIO_MEM nisps_firmware::g_active_mode_bridge{};

// Global MIDI handle (shared across cores like the legacy entry point did).
std::shared_ptr<MIDIInOut> APP_SRAM g_midi;

// Audio block callback — placed in SRAM via __not_in_flash_func so the audio
// ISR avoids XIP latency. Forwards into the (header-inline) dispatch helper.
void AUDIO_FUNC(audio_block_callback)(
    float in[][kBufferSize],
    float out[][kBufferSize],
    size_t n_channels,
    size_t n_frames) {
    nisps_firmware::dispatch_audio_block(in, out, n_channels, n_frames);
}

static uint32_t get_rosc_entropy_seed(int bits) {
    uint32_t seed = 0;
    for (int i = 0; i < bits; ++i) {
        busy_wait_us_32(5);
        seed <<= 1;
        seed |= (rosc_hw->randombit & 1);
    }
    return seed;
}

// =====================================================================
// Core 0 — UI / hardware polling / ML inference
// =====================================================================

void setup() {
    // The active mode's engine picks the sample rate (0 ⇒ don't care ⇒ 48 kHz).
    // This has to happen before the system clock is derived from it below, and
    // therefore before core 1 clears the g_serial_ready handshake and reads
    // AudioDriver::GetSampleRate() in setup1().
    nisps_firmware::apply_mode_sample_rate(g_mode);
    set_sys_clock_khz(AudioDriver::GetSysClockSpeed(), true);
    bus_ctrl_hw->priority = BUSCTRL_BUS_PRIORITY_DMA_W_BITS
                          | BUSCTRL_BUS_PRIORITY_DMA_R_BITS
                          | BUSCTRL_BUS_PRIORITY_PROC1_BITS;

    const uint32_t seed = get_rosc_entropy_seed(32);
    srand(seed);
    g_mode.ml().seed(static_cast<uint64_t>(seed));
    g_mode.ml().draw_weights(g_mode.param_schema().default_spread);

    g_midi = std::make_shared<MIDIInOut>();

    Serial.begin(115200);
    Serial.println("Serial initialised.");
    WRITE_VOLATILE(g_serial_ready, true);

    MEMLNaut::Initialize();
    pinMode(33, OUTPUT);

    // Wire hardware → mode I/O channels.
    nisps_firmware::bind_peripherals(g_mode);

    WRITE_VOLATILE(g_iface_ready, true);
    Serial.println("Bound peripherals to mode.");

    WRITE_VOLATILE(g_core0_ready, true);
    while (!READ_VOLATILE(g_core1_ready)) {
        MEMORY_BARRIER();
        delay(1);
    }

    MEMLNaut::Instance()->addSystemInfoView();
    // Settings menu (e.g. Joystick: Dual/Single for the 4-input modes).
    nisps_firmware::wire_settings(g_mode);
    Serial.println("Finished initialising core 0.");
}

PERF_DECLARE(MLSTATS);

#define ML_INFERENCE_PERIOD_US 5000

void loop() {
    PERIODIC_RUN_US({
        PERF_BEGIN(MLSTATS);
        g_mode.tick_control();
        MEMLNaut::Instance()->loop();
        PERF_END(MLSTATS);
    }, ML_INFERENCE_PERIOD_US)

    PERIODIC_RUN_US({
        static size_t blip_counter = 0;
        if (blip_counter++ > 10) {
            blip_counter = 0;
            Serial.println(".");
            digitalWrite(33, HIGH);
            // `const`, not `constexpr`: memllib made kSampleRate a runtime
            // `extern size_t` so a mode can pick its own rate. This is a
            // once-per-second diagnostic print, so the divide is free.
            const float audioHeadroomMul = 1.0f / (1000000.f * 48.0f / kSampleRate);
            Serial.printf("ml: %d, aud: %d, q: %f\n",
                          PERF_GET_MEAN(MLSTATS),
                          AUDIOLOOP_MEAN,
                          AUDIOLOOP_MEAN * audioHeadroomMul);
        } else {
            digitalWrite(33, LOW);
        }
    }, 100000)
}

// =====================================================================
// Core 1 — real-time audio + MIDI I/O drain
// =====================================================================

void setup1() {
    while (!READ_VOLATILE(g_serial_ready)) { MEMORY_BARRIER(); delay(1); }
    while (!READ_VOLATILE(g_iface_ready))  { MEMORY_BARRIER(); delay(1); }

    if (g_midi) {
        g_midi->Setup(/*n_outputs=*/16);
        g_midi->SetMIDISendChannel(1);
        nisps_firmware::bind_midi_input(g_midi, g_mode);
    }

    g_mode.setup(static_cast<float>(AudioDriver::GetSampleRate()));

    nisps_firmware::register_audio_engine(g_mode, &audio_block_callback);
    // Codec setup follows the ACTIVE mode: mic vs line input, input gain step,
    // mic pre-amp gain, analog output volume (glue/audio_driver.hpp).
    nisps_firmware::setup_audio_driver(g_mode);

    WRITE_VOLATILE(g_core1_ready, true);
    while (!READ_VOLATILE(g_core0_ready)) { MEMORY_BARRIER(); delay(1); }
    Serial.println("Finished initialising core 1.");
}

void loop1() {
    PERIODIC_RUN_US({
        nisps_firmware::drain_outputs(g_midi, g_mode);
    }, 1000)

    PERIODIC_RUN_US({
        if (g_midi) g_midi->Poll();
    }, 1000)
}

#else
// =====================================================================
// SelfTest build path — guided hardware self-test rig (no engine / no ML).
// All four entry points delegate into glue/selftest.hpp.
// =====================================================================

#include "glue/selftest.hpp"

void setup()  { nisps_firmware::selftest::setup();  }
void loop()   { nisps_firmware::selftest::loop();   }
void setup1() { nisps_firmware::selftest::setup1(); }
void loop1()  { nisps_firmware::selftest::loop1();  }

#endif  // NISPS_SELFTEST
