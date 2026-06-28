// firmware/MEMLNaut-NISPS.ino — Thin entry point.
//
// The heavy lifting now lives under:
//   - nisps/...                  — platform-agnostic ML, DSP, engines, modes
//   - firmware/glue/...          — hardware bindings (audio driver, MIDI,
//                                  peripherals, input/output routers)
//
// This file does only:
//   1. Pick a mode at compile time (`MEMLNAUT_MODE_TYPE`).
//   2. Instantiate it (in `AUDIO_MEM` so it lives in SRAM).
//   3. setup() / loop() on core 0:
//        - boot board
//        - bind peripherals → mode.set_input
//        - bind MIDI in → mode.note_on/update_bpm/...
//        - run mode.tick_control() at ML cadence (5ms)
//   4. setup1() / loop1() on core 1:
//        - register the audio bridge so AudioDriver streams into mode.process
//        - pump engine events / drain MIDI out at sub-ms cadence

// ---- Hardware ----
#include "src/memllib/PicoDefs.hpp"
#include "src/memllib/audio/AudioDriver.hpp"
#include "src/memllib/hardware/memlnaut/MEMLNaut.hpp"
#include "src/memllib/interface/MIDIInOut.hpp"
#include "src/memllib/utils/perf.hpp"
#include "hardware/structs/bus_ctrl.h"

// ---- Glue ----
#include "glue/audio_driver.hpp"
#include "glue/input_router.hpp"
#include "glue/midi_io.hpp"
#include "glue/mode_select.hpp"
#include "glue/output_router.hpp"

// ---- Mode selection ----
// Build script rewrites which line is uncommented.
// #define MEMLNAUT_MODE_TYPE MEMLNautModeSoundAnalysisMIDI
// #define MEMLNAUT_MODE_TYPE MEMLNautModeXIASRI
// #define MEMLNAUT_MODE_TYPE MEMLNautModeVerbFX
// #define MEMLNAUT_MODE_TYPE MEMLNautModeBreakOr
// #define MEMLNAUT_MODE_TYPE MEMLNautModeElysiamorfs
// #define MEMLNAUT_MODE_TYPE MEMLNautModeChannelStrip
#define MEMLNAUT_MODE_TYPE MEMLNautModePAFSynth
// #define MEMLNAUT_MODE_TYPE MEMLNautModeMEMLCelium
// ---- External-synth MIDI-CC variants (control an external hardware synth) ----
// #define MEMLNAUT_MODE_TYPE MEMLNautModeExtSynthSub37
// #define MEMLNAUT_MODE_TYPE MEMLNautModeExtSynthSubPhatty
// #define MEMLNAUT_MODE_TYPE MEMLNautModeExtSynthPro12
// #define MEMLNAUT_MODE_TYPE MEMLNautModeExtSynthAnalogKeys
// #define MEMLNAUT_MODE_TYPE MEMLNautModeExtSynthHydrasynth
// #define MEMLNAUT_MODE_TYPE MEMLNautModeExtSynthJD800
// #define MEMLNAUT_MODE_TYPE MEMLNautModeSelfTest

// NISPS_SELFTEST == 1 iff the selected variant is the guided hardware self-test
// (see glue/mode_select.hpp). Must be computed AFTER the mode #define above so
// MEMLNAUT_MODE_TYPE is in scope for the token paste.
#define NISPS_SELFTEST NISPS_ST_CAT(MEMLNAUT_MODE_TYPE)

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
    nisps_firmware::wire_inputs(g_mode);

    WRITE_VOLATILE(g_iface_ready, true);
    Serial.println("Bound peripherals to mode.");

    WRITE_VOLATILE(g_core0_ready, true);
    while (!READ_VOLATILE(g_core1_ready)) {
        MEMORY_BARRIER();
        delay(1);
    }

    MEMLNaut::Instance()->addSystemInfoView();
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
            constexpr float audioHeadroomMul = 1.0f / (1000000.f * 48.0f / kSampleRate);
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
    AudioDriver::Setup();

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
