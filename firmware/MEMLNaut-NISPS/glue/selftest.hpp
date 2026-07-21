// firmware/glue/selftest.hpp — Guided hardware self-test rig.
//
// A standalone bring-up / soldering-verification firmware. It turns the WHOLE
// device into a test rig: NO audio engine, NO ML. The TFT screen walks the
// operator step-by-step through exercising every control; each step
// AUTO-ADVANCES the moment the firmware detects the expected input. Pressing
// the rotary-encoder switch SKIPS the current step (records SKIPPED) so a dead
// / unsoldered control never traps the sequence.
//
// At the end, two OPTIONAL steps:
//   * Headphone test — an L / R / BOTH sine sweep with channel ID, confirmed
//     by ear (A1 = PASS, B1 = FAIL).
//   * MIDI loopback — patch MIDI OUT -> IN with a DIN cable; the rig sends a
//     note on TX and verifies it arrives on RX within a timeout.
//
// This logic is INHERENTLY hardware-coupled (it draws to the TFT and reads raw
// pins), so it lives firmware-side here in glue/, NOT under platform-agnostic
// nisps/. It is selected at build time via the `SelfTest` variant (see
// mode_select.hpp + the NISPS_SELFTEST fork in MEMLNaut-NISPS.ino).
//
// Threading: core 0 owns the step state machine (driven from MEMLNaut's
// loopCallback, ~5 ms) and the display. core 1 owns the audio sweep block
// callback and the MIDI loopback poll. They communicate through a handful of
// single-writer volatile scalars + memory barriers.

#pragma once

// Arduino's Common.h leaks min/max/abs/sq/round as macros; nisps headers use
// some of these as identifiers. Undef locally (mirrors mode_select.hpp).
#ifdef sq
#  undef sq
#endif
#ifdef min
#  undef min
#endif
#ifdef max
#  undef max
#endif
#ifdef abs
#  undef abs
#endif
#ifdef round
#  undef round
#endif

#include <memory>
#include <cmath>
#include <cstdio>
#include <functional>

#include "../src/memllib/PicoDefs.hpp"
#include "../src/memllib/utils/perf.hpp"
#include "../src/memllib/audio/AudioDriver.hpp"
#include "../src/memllib/interface/MIDIInOut.hpp"
#include "../src/memllib/hardware/memlnaut/MEMLNaut.hpp"
#include "../src/memllib/hardware/memlnaut/Pins.hpp"
#include "../src/memllib/hardware/memlnaut/display/View.hpp"
#include "../src/nisps/dsp/osc.hpp"

// Inter-core boot-handshake flags. Defined in the .ino (shared by both the
// normal-mode and self-test build paths); declared here so this header is
// order-independent.
extern volatile bool g_serial_ready;
extern volatile bool g_iface_ready;
extern volatile bool g_core0_ready;
extern volatile bool g_core1_ready;

namespace nisps_firmware {
namespace selftest {

// =====================================================================
// Step model
// =====================================================================

enum class StepResult : uint8_t { UNTESTED, PASS, SKIP, FAIL };

enum class Kind : uint8_t {
    INTRO,
    JOY_UP, JOY_DOWN, JOY_X, JOY_Z, JOY_SW,
    POT_X1, POT_Y1, POT_Z1, POT_GAIN, POT_ADC3,
    MOM_A1, MOM_A2, MOM_B1, MOM_B2,
    TOG_A1, TOG_A2, TOG_B1, TOG_B2,
    ENC_CW, ENC_CCW,
    LED,
    AUDIO_GATE, AUDIO,
    MIDI_GATE, MIDI,
    SUMMARY,
};

struct Step {
    Kind kind;
    const char* name;    // short label for the summary scorecard
    const char* l1;      // prompt line 1
    const char* l2;      // prompt line 2 ("" = none)
    const char* footer;  // load-bearing footer: what the encoder/buttons do now
};

// Order is the test order. SUMMARY must be last.
static const Step kSteps[] = {
    {Kind::INTRO,     "intro",   "SELF TEST",            "Exercise each control",  "encoder = skip / next"},
    {Kind::JOY_UP,    "Joy Y+",  "Push joystick UP (Y)", "then release",           "encoder = skip"},
    {Kind::JOY_DOWN,  "Joy Y-",  "Pull joystick DOWN (Y)", "",                     "encoder = skip"},
    {Kind::JOY_X,     "Joy X",   "Push joystick LEFT",   "then RIGHT (X)",         "encoder = skip"},
    {Kind::JOY_Z,     "Joy Z",   "Twist joystick (Z)",   "fully both ways",        "encoder = skip"},
    {Kind::JOY_SW,    "Joy SW",  "Press joystick DOWN",  "(the switch)",           "encoder = skip"},
    {Kind::POT_X1,    "RV_X1",   "Turn RV_X1 fully",     "one way then the other", "encoder = skip"},
    {Kind::POT_Y1,    "RV_Y1",   "Turn RV_Y1 fully",     "",                       "encoder = skip"},
    {Kind::POT_Z1,    "RV_Z1",   "Turn RV_Z1 fully",     "",                       "encoder = skip"},
    {Kind::POT_GAIN,  "RV_GAIN", "Turn RV_GAIN1 fully",  "",                       "encoder = skip"},
    {Kind::POT_ADC3,  "ADC3",    "Turn the 5th pot",     "(ADC3) fully",           "encoder = skip"},
    {Kind::MOM_A1,    "MOM_A1",  "Press + release",      "button A1",              "encoder = skip"},
    {Kind::MOM_A2,    "MOM_A2",  "Press + release",      "button A2",              "encoder = skip"},
    {Kind::MOM_B1,    "MOM_B1",  "Press + release",      "button B1",              "encoder = skip"},
    {Kind::MOM_B2,    "MOM_B2",  "Press + release",      "button B2",              "encoder = skip"},
    {Kind::TOG_A1,    "TOG_A1",  "Flip toggle A1",       "ON then OFF",            "encoder = skip"},
    {Kind::TOG_A2,    "TOG_A2",  "Flip toggle A2",       "ON then OFF",            "encoder = skip"},
    {Kind::TOG_B1,    "TOG_B1",  "Flip toggle B1",       "ON then OFF",            "encoder = skip"},
    {Kind::TOG_B2,    "TOG_B2",  "Flip toggle B2",       "ON then OFF",            "encoder = skip"},
    {Kind::ENC_CW,    "Enc CW",  "Turn encoder",         "CLOCKWISE 5 clicks",     "encoder turn = test"},
    {Kind::ENC_CCW,   "Enc CCW", "Turn encoder",         "COUNTER-CW 5 clicks",    "encoder turn = test"},
    {Kind::LED,       "LED",     "Status LED blinking?", "A1 = PASS   B1 = FAIL",  "A1 pass / B1 fail"},
    {Kind::AUDIO_GATE,"audio?",  "Headphone test?",      "A1 = run   B1 = skip",   "A1 run / B1 skip"},
    {Kind::AUDIO,     "Audio",   "Listen: L / R / BOTH", "",                       "A1 pass / B1 fail"},
    {Kind::MIDI_GATE, "midi?",   "MIDI loopback?",       "patch OUT->IN   A1/B1",  "A1 run / B1 skip"},
    {Kind::MIDI,      "MIDI",    "Testing MIDI loop...", "",                       "A1 retry / B1 skip"},
    {Kind::SUMMARY,   "summary", "DONE",                 "",                       "turn=scroll  press=restart"},
};
static constexpr int kNumSteps = static_cast<int>(sizeof(kSteps) / sizeof(kSteps[0]));
static constexpr int kSummaryIdx = kNumSteps - 1;

// =====================================================================
// Core 0 peripheral capture state
//
// Analog + momentary callbacks fire from MEMLNaut::loop() on core 0.
// Toggle / joystick-switch / rotary-turn callbacks fire from GPIO ISRs, so the
// fields they write are volatile.
// =====================================================================

struct State {
    // latest analog values [0, ~0.992]
    float joyX = 0.5f, joyY = 0.5f, joyZ = 0.5f;
    float potX1 = 0.f, potY1 = 0.f, potZ1 = 0.f, potGain = 0.f, potADC3 = 0.f;
    // per-step joystick rest baselines (snapshotted on step entry near centre)
    float restJoyX = 0.5f, restJoyY = 0.5f, restJoyZ = 0.5f;
    // per-step analog min/max (for pot travel + rail detection)
    float aMin = 1e9f, aMax = -1e9f;
    // momentary press-edge latches (set in core-0 callbacks, cleared on entry)
    bool momA1Pressed = false, momA2Pressed = false, momB1Pressed = false, momB2Pressed = false;
    // toggle saw-high / saw-low this step (ISR-written)
    volatile bool togA1Hi = false, togA1Lo = false, togA2Hi = false, togA2Lo = false;
    volatile bool togB1Hi = false, togB1Lo = false, togB2Hi = false, togB2Lo = false;
    volatile bool joySWChanged = false;
    // encoder click counters this step (ISR-written)
    volatile int encCW = 0, encCCW = 0;
};
static State APP_SRAM g_state;

// =====================================================================
// Cross-core audio + MIDI state
// =====================================================================

static constexpr float kSweepLoHz = 200.f;
static constexpr float kSweepHiHz = 4000.f;
// Per-sample log-sweep ratio @48 kHz: ~200 -> 4000 Hz over ~2 s, then wraps.
static constexpr float kSweepRate = 1.00003f;

enum class SweepPhase : uint32_t { OFF = 0, LEFT, RIGHT, BOTH };
volatile SweepPhase AUDIO_MEM g_st_phase = SweepPhase::OFF;  // core0 writes, core1 reads
volatile bool       AUDIO_MEM g_st_freq_reset = false;        // core0 one-shot -> core1 resets sweep
nisps::SineOsc      AUDIO_MEM g_st_osc;                        // core1 only
float               AUDIO_MEM g_st_freq = kSweepLoHz;          // core1 only

enum class MidiResult : uint32_t { PENDING = 0, PASS, FAIL };
volatile bool       APP_SRAM g_st_midi_run = false;            // core0 -> core1: run a loopback probe
volatile MidiResult APP_SRAM g_st_midi_result = MidiResult::PENDING;  // core1 -> core0
volatile bool       APP_SRAM g_st_midi_got = false;            // core1 internal (RX callback)
std::shared_ptr<MIDIInOut> APP_SRAM g_st_midi;

// Audio block callback (core 1, ISR context, must live in SRAM). Plain free
// function so its address fits AudioDriver's function-pointer setter. `static`
// (not `inline`) to avoid the documented `inline` + `__not_in_flash` comdat
// conflict; selftest.hpp is only ever included in the single .ino TU.
static void AUDIO_FUNC(selftest_audio_block_callback)(
    float in[][kBufferSize], float out[][kBufferSize], size_t n_channels, size_t n_frames) {
    (void)in;
    const SweepPhase ph = READ_VOLATILE(g_st_phase);
    if (READ_VOLATILE(g_st_freq_reset)) {
        g_st_freq = kSweepLoHz;
        WRITE_VOLATILE(g_st_freq_reset, false);
    }
    const bool wantL = (ph == SweepPhase::LEFT || ph == SweepPhase::BOTH);
    const bool wantR = (ph == SweepPhase::RIGHT || ph == SweepPhase::BOTH);
    float f = g_st_freq;
    for (size_t i = 0; i < n_frames; ++i) {
        const float s = (ph == SweepPhase::OFF) ? 0.f : g_st_osc.sine(f) * 0.8f;
        if (n_channels > 0) out[0][i] = wantL ? s : 0.f;
        if (n_channels > 1) out[1][i] = wantR ? s : 0.f;
        f *= kSweepRate;
        if (f > kSweepHiHz) f = kSweepLoHz;
    }
    g_st_freq = f;  // single-writer (core 1)
}

// =====================================================================
// The view + state-machine fields
// =====================================================================

class SelfTestView : public ViewBase {
   public:
    explicit SelfTestView(String name) : ViewBase(name) {}

    void OnSetup() override {}

    void OnDraw() override {
        scr->fillRect(area.x, area.y, area.w, area.h, TFT_BLACK);
        TFT_eSprite line(scr);
        line.createSprite(area.w, kLineH);
        line.setTextFont(2);

        auto put = [&](const char* s, int row, uint16_t colour) {
            line.fillRect(0, 0, area.w, kLineH, TFT_BLACK);
            line.setTextColor(colour, TFT_BLACK);
            line.drawString(s, 0, 0);
            line.pushSprite(area.x + 8, area.y + row * kLineH);
        };

        if (kSteps[stepIdx_].kind == Kind::SUMMARY) {
            drawSummary(put);
            return;
        }

        const Step& st = kSteps[stepIdx_];
        char hdr[48];
        std::snprintf(hdr, sizeof hdr, "step %d / %d   %s", stepIdx_, kSummaryIdx, st.name);
        put(hdr, 0, TFT_WHITE);
        put(st.l1, 1, TFT_WHITE);
        if (st.l2 && st.l2[0]) put(st.l2, 2, TFT_WHITE);

        if (liveLabel_[0]) put(liveLabel_, 4, TFT_YELLOW);
        if (showBar_) {
            const int w = static_cast<int>(barVal_ * (area.w - 16));
            scr->drawRect(area.x + 8, area.y + 5 * kLineH, area.w - 16, 12, 0x7BEF);
            scr->fillRect(area.x + 8, area.y + 5 * kLineH, w < 0 ? 0 : w, 12, TFT_CYAN);
        }

        if (flash_) {
            put(flashFail_ ? "FAIL  X" : "PASS  OK", 6, flashFail_ ? TFT_RED : TFT_GREEN);
        } else if (results_[stepIdx_] == StepResult::SKIP) {
            put("SKIPPED", 6, 0x7BEF);
        }

        if (advisory_[0]) put(advisory_, 7, TFT_ORANGE);
        put(st.footer, 8, 0x7BEF);
    }

    void drawSummary(const std::function<void(const char*, int, uint16_t)>& put) {
        int passes = 0, testable = 0;
        for (int i = 1; i < kSummaryIdx; ++i) {
            if (kSteps[i].kind == Kind::AUDIO_GATE || kSteps[i].kind == Kind::MIDI_GATE) continue;
            ++testable;
            if (results_[i] == StepResult::PASS) ++passes;
        }
        char hdr[48];
        std::snprintf(hdr, sizeof hdr, "DONE  %d / %d PASS", passes, testable);
        put(hdr, 0, TFT_WHITE);

        // Scrollable scorecard window (rows 1..7 -> 7 visible items).
        constexpr int kVisible = 7;
        int row = 1;
        for (int i = 1 + scrollOff_; i < kSummaryIdx && row <= kVisible; ++i) {
            if (kSteps[i].kind == Kind::AUDIO_GATE || kSteps[i].kind == Kind::MIDI_GATE) continue;
            const char* r = "----";
            uint16_t c = 0x7BEF;
            switch (results_[i]) {
                case StepResult::PASS:     r = "PASS"; c = TFT_GREEN;  break;
                case StepResult::FAIL:     r = "FAIL"; c = TFT_RED;    break;
                case StepResult::SKIP:     r = "skip"; c = TFT_ORANGE; break;
                case StepResult::UNTESTED: r = "----"; c = 0x7BEF;     break;
            }
            char ln[48];
            std::snprintf(ln, sizeof ln, "%-9s %s", kSteps[i].name, r);
            put(ln, row++, c);
        }
        put("RE_SW: ok if skips worked", 8, 0x7BEF);
    }

    static constexpr int kLineH = 20;

    int stepIdx_ = 0;
    StepResult results_[kNumSteps] = {};
    char liveLabel_[48] = {0};
    bool showBar_ = false;
    float barVal_ = 0.f;
    bool flash_ = false, flashFail_ = false;
    uint32_t passFlashUntil_ = 0;
    char advisory_[28] = {0};
    int scrollOff_ = 0;

    // JOY_X/Y direction memory + audio-step bookkeeping
    bool joyUpPositive_ = false;
    SweepPhase audioStage_ = SweepPhase::LEFT;
    uint32_t audioStageDeadline_ = 0;
    uint32_t audioSafetyDeadline_ = 0;
    uint32_t ledToggleAt_ = 0;
};

static std::shared_ptr<SelfTestView> APP_SRAM g_view;

// =====================================================================
// State-machine helpers
// =====================================================================

inline void onStepEnter(int i);

inline void markResult(StepResult r, bool fail = false) {
    g_view->results_[g_view->stepIdx_] = r;
    if (r == StepResult::PASS || r == StepResult::FAIL) {
        g_view->flash_ = true;
        g_view->flashFail_ = fail;
        g_view->passFlashUntil_ = millis() + 400;
    }
    g_view->redraw();
}
inline void markPass() { markResult(StepResult::PASS, false); }
inline void markFail() { markResult(StepResult::FAIL, true); }

inline void advance() {
    if (g_view->stepIdx_ < kNumSteps - 1) onStepEnter(g_view->stepIdx_ + 1);
}

inline void setAdvisory(const char* s) {
    std::snprintf(g_view->advisory_, sizeof g_view->advisory_, "%s", s);
}

inline void onStepEnter(int i) {
    g_view->stepIdx_ = i;
    g_view->flash_ = false;
    g_view->flashFail_ = false;
    g_view->advisory_[0] = 0;
    g_view->liveLabel_[0] = 0;
    g_view->showBar_ = false;
    g_view->barVal_ = 0.f;
    g_view->scrollOff_ = 0;

    State& s = g_state;
    s.aMin = 1e9f;
    s.aMax = -1e9f;
    s.momA1Pressed = s.momA2Pressed = s.momB1Pressed = s.momB2Pressed = false;
    s.togA1Hi = s.togA1Lo = s.togA2Hi = s.togA2Lo = false;
    s.togB1Hi = s.togB1Lo = s.togB2Hi = s.togB2Lo = false;
    s.joySWChanged = false;
    s.encCW = 0;
    s.encCCW = 0;

    const Kind k = kSteps[i].kind;
    // Snapshot joystick rest baseline only if the axis is near centre; otherwise
    // prompt the operator (via the live label in tick) to release it.
    if (k == Kind::JOY_UP && std::fabs(s.joyY - 0.5f) < 0.15f) s.restJoyY = s.joyY;
    if (k == Kind::JOY_X && std::fabs(s.joyX - 0.5f) < 0.15f) s.restJoyX = s.joyX;
    if (k == Kind::JOY_Z && std::fabs(s.joyZ - 0.5f) < 0.15f) s.restJoyZ = s.joyZ;

    // Stuck-button advisories.
    if (k == Kind::MOM_A1 && MEMLNaut::Instance()->getMOMA1State()) setAdvisory("A1 stuck?");
    if (k == Kind::MOM_A2 && MEMLNaut::Instance()->getMOMA2State()) setAdvisory("A2 stuck?");
    if (k == Kind::MOM_B1 && MEMLNaut::Instance()->getMOMB1State()) setAdvisory("B1 stuck?");
    if (k == Kind::MOM_B2 && MEMLNaut::Instance()->getMOMB2State()) setAdvisory("B2 stuck?");

    if (k == Kind::LED) {
        g_view->ledToggleAt_ = millis();
    }
    if (k == Kind::AUDIO) {
        g_view->audioStage_ = SweepPhase::LEFT;
        g_view->audioStageDeadline_ = millis() + 1500;
        g_view->audioSafetyDeadline_ = millis() + 30000;
        WRITE_VOLATILE(g_st_freq_reset, true);
        WRITE_VOLATILE(g_st_phase, SweepPhase::LEFT);
        AudioDriver::SetMasterVolume(0.3f);
    }
    if (k == Kind::MIDI) {
        WRITE_VOLATILE(g_st_midi_result, MidiResult::PENDING);
        WRITE_VOLATILE(g_st_midi_run, true);
    }
    g_view->redraw();
}

// Convenience: set the live readout + track analog min/max for the bar.
inline void liveAnalog(const char* nm, float val) {
    State& s = g_state;
    if (val < s.aMin) s.aMin = val;
    if (val > s.aMax) s.aMax = val;
    g_view->showBar_ = true;
    g_view->barVal_ = val;
    std::snprintf(g_view->liveLabel_, sizeof g_view->liveLabel_,
                  "%s %.3f  [%.2f..%.2f]", nm, val, s.aMin, s.aMax);
}

inline bool potPass() {
    const State& s = g_state;
    return s.aMax > 0.90f || s.aMin < 0.10f || (s.aMax - s.aMin) > 0.70f;
}

// =====================================================================
// Per-tick state machine (core 0, ~5 ms via MEMLNaut loopCallback)
// =====================================================================

inline void tickStateMachine() {
    SelfTestView& v = *g_view;
    State& s = g_state;
    MEMLNaut* M = MEMLNaut::Instance();

    // Hold the green/red flash before advancing so fast passes are visible.
    if (v.flash_) {
        if (millis() > v.passFlashUntil_) {
            const bool wasFail = v.flashFail_;
            v.flash_ = false;
            if (!wasFail) advance();
        }
        v.redraw();
        return;
    }

    const Kind k = kSteps[v.stepIdx_].kind;
    switch (k) {
        case Kind::INTRO:
            std::snprintf(v.liveLabel_, sizeof v.liveLabel_, "press encoder to begin");
            break;

        case Kind::JOY_UP:
            liveAnalog("Y", s.joyY);
            if (s.joyY - s.restJoyY > 0.30f) { v.joyUpPositive_ = true; markPass(); }
            else if (s.restJoyY - s.joyY > 0.30f) { v.joyUpPositive_ = false; markPass(); }
            break;
        case Kind::JOY_DOWN:
            liveAnalog("Y", s.joyY);
            // Opposite direction to the UP step.
            if (v.joyUpPositive_ ? (s.restJoyY - s.joyY > 0.30f) : (s.joyY - s.restJoyY > 0.30f)) markPass();
            break;
        case Kind::JOY_X:
            liveAnalog("X", s.joyX);
            if ((s.aMax - s.restJoyX) > 0.30f && (s.restJoyX - s.aMin) > 0.30f) {
                // Off-axis bleed: if Y moved more than X, wiring may be swapped.
                if (std::fabs(s.joyY - 0.5f) > (s.aMax - s.aMin)) setAdvisory("X/Y swapped?");
                markPass();
            }
            break;
        case Kind::JOY_Z:
            liveAnalog("Z", s.joyZ);
            if ((s.aMax - s.aMin) > 0.25f) markPass();
            break;
        case Kind::JOY_SW:
            std::snprintf(v.liveLabel_, sizeof v.liveLabel_, "%s",
                          M->getMOMJOYSWState() ? "switch HELD" : "switch released");
            if (s.joySWChanged || M->getMOMJOYSWState()) markPass();
            break;

        case Kind::POT_X1:   liveAnalog("X1", s.potX1);     if (potPass()) markPass(); break;
        case Kind::POT_Y1:   liveAnalog("Y1", s.potY1);     if (potPass()) markPass(); break;
        case Kind::POT_Z1:   liveAnalog("Z1", s.potZ1);     if (potPass()) markPass(); break;
        case Kind::POT_GAIN: liveAnalog("GAIN", s.potGain); if (potPass()) markPass(); break;
        case Kind::POT_ADC3: liveAnalog("ADC3", s.potADC3); if (potPass()) markPass(); break;

        // Momentary: press-edge latch + live release detection.
        case Kind::MOM_A1:
            std::snprintf(v.liveLabel_, sizeof v.liveLabel_, "%s",
                          M->getMOMA1State() ? "held" : (s.momA1Pressed ? "released" : "waiting"));
            if (s.momA1Pressed && !M->getMOMA1State()) markPass();
            break;
        case Kind::MOM_A2:
            std::snprintf(v.liveLabel_, sizeof v.liveLabel_, "%s",
                          M->getMOMA2State() ? "held" : (s.momA2Pressed ? "released" : "waiting"));
            if (s.momA2Pressed && !M->getMOMA2State()) markPass();
            break;
        case Kind::MOM_B1:
            std::snprintf(v.liveLabel_, sizeof v.liveLabel_, "%s",
                          M->getMOMB1State() ? "held" : (s.momB1Pressed ? "released" : "waiting"));
            if (s.momB1Pressed && !M->getMOMB1State()) markPass();
            break;
        case Kind::MOM_B2:
            std::snprintf(v.liveLabel_, sizeof v.liveLabel_, "%s",
                          M->getMOMB2State() ? "held" : (s.momB2Pressed ? "released" : "waiting"));
            if (s.momB2Pressed && !M->getMOMB2State()) markPass();
            break;

        // Toggle: must observe both ON and OFF this step.
        case Kind::TOG_A1: if (s.togA1Hi && s.togA1Lo) markPass(); break;
        case Kind::TOG_A2: if (s.togA2Hi && s.togA2Lo) markPass(); break;
        case Kind::TOG_B1: if (s.togB1Hi && s.togB1Lo) markPass(); break;
        case Kind::TOG_B2: if (s.togB2Hi && s.togB2Lo) markPass(); break;

        case Kind::ENC_CW:
            std::snprintf(v.liveLabel_, sizeof v.liveLabel_, "CW %d / 5", s.encCW);
            if (s.encCCW >= 5 && s.encCW < 5) setAdvisory("encoder reversed?");
            if (s.encCW >= 5) markPass();
            break;
        case Kind::ENC_CCW:
            std::snprintf(v.liveLabel_, sizeof v.liveLabel_, "CCW %d / 5", s.encCCW);
            if (s.encCCW >= 5) markPass();
            break;

        case Kind::LED: {
            if (millis() - v.ledToggleAt_ > 250) {
                v.ledToggleAt_ = millis();
                digitalWrite(Pins::LED, !digitalRead(Pins::LED));
            }
            if (s.momA1Pressed) markPass();
            else if (s.momB1Pressed) markFail();
            break;
        }

        case Kind::AUDIO_GATE:
            if (s.momA1Pressed) { markResult(StepResult::PASS); onStepEnter(v.stepIdx_ + 1); }
            else if (s.momB1Pressed) { markResult(StepResult::SKIP); onStepEnter(v.stepIdx_ + 2); }  // skip AUDIO
            break;

        case Kind::AUDIO: {
            const char* lbl = v.audioStage_ == SweepPhase::LEFT ? "LEFT ear"
                            : v.audioStage_ == SweepPhase::RIGHT ? "RIGHT ear" : "BOTH";
            std::snprintf(v.liveLabel_, sizeof v.liveLabel_, "%s", lbl);
            if (millis() > v.audioStageDeadline_) {
                v.audioStage_ = v.audioStage_ == SweepPhase::LEFT  ? SweepPhase::RIGHT
                              : v.audioStage_ == SweepPhase::RIGHT ? SweepPhase::BOTH
                                                                   : SweepPhase::LEFT;
                WRITE_VOLATILE(g_st_phase, v.audioStage_);
                v.audioStageDeadline_ = millis() + 1500;
            }
            if (millis() > v.audioSafetyDeadline_) {  // fail-safe: silence after 30 s
                WRITE_VOLATILE(g_st_phase, SweepPhase::OFF);
                AudioDriver::SetMasterVolume(0.f);
            }
            if (s.momA1Pressed) {
                WRITE_VOLATILE(g_st_phase, SweepPhase::OFF);
                AudioDriver::SetMasterVolume(0.f);
                markPass();
            } else if (s.momB1Pressed) {
                WRITE_VOLATILE(g_st_phase, SweepPhase::OFF);
                AudioDriver::SetMasterVolume(0.f);
                markFail();
            }
            break;
        }

        case Kind::MIDI_GATE:
            if (s.momA1Pressed) { onStepEnter(v.stepIdx_ + 1); }
            else if (s.momB1Pressed) { markResult(StepResult::SKIP); onStepEnter(kSummaryIdx); }
            break;

        case Kind::MIDI: {
            const MidiResult r = READ_VOLATILE(g_st_midi_result);
            if (r == MidiResult::PASS) {
                markPass();
            } else if (r == MidiResult::FAIL) {
                v.results_[v.stepIdx_] = StepResult::FAIL;
                std::snprintf(v.liveLabel_, sizeof v.liveLabel_, "no MIDI - check cable");
                if (s.momA1Pressed) {                       // retry
                    s.momA1Pressed = false;
                    WRITE_VOLATILE(g_st_midi_result, MidiResult::PENDING);
                    WRITE_VOLATILE(g_st_midi_run, true);
                } else if (s.momB1Pressed) {
                    onStepEnter(kSummaryIdx);
                }
            } else {
                std::snprintf(v.liveLabel_, sizeof v.liveLabel_, "sending note...");
            }
            break;
        }

        case Kind::SUMMARY:
            break;  // rendered in OnDraw; navigation via encoder callbacks
    }
    v.redraw();
}

// Encoder PRESS: skip an input step, or restart from the summary.
inline void onEncoderPress() {
    SelfTestView& v = *g_view;
    const Kind k = kSteps[v.stepIdx_].kind;
    if (k == Kind::SUMMARY) {
        for (auto& r : v.results_) r = StepResult::UNTESTED;
        onStepEnter(0);
        return;
    }
    if (k == Kind::INTRO) { advance(); return; }
    if (k == Kind::AUDIO) {                         // press = jump to next sweep stage now
        v.audioStageDeadline_ = 0;
        return;
    }
    // For gate / output steps, A1/B1 are the decision; encoder skips the section.
    if (k == Kind::AUDIO_GATE) { markResult(StepResult::SKIP); onStepEnter(v.stepIdx_ + 2); return; }
    if (k == Kind::MIDI_GATE)  { markResult(StepResult::SKIP); onStepEnter(kSummaryIdx); return; }
    // Plain input step: record SKIP and advance.
    if (v.results_[v.stepIdx_] != StepResult::PASS && v.results_[v.stepIdx_] != StepResult::FAIL)
        v.results_[v.stepIdx_] = StepResult::SKIP;
    advance();
}

// Encoder TURN: drives the ENC test steps; scrolls the summary scorecard.
inline void onEncoderTurn(int delta) {
    if (delta > 0) g_state.encCW++;
    else if (delta < 0) g_state.encCCW++;
    if (kSteps[g_view->stepIdx_].kind == Kind::SUMMARY) {
        g_view->scrollOff_ += (delta > 0 ? 1 : -1);
        if (g_view->scrollOff_ < 0) g_view->scrollOff_ = 0;
        g_view->redraw();
    }
}

// =====================================================================
// Entry points (called from the .ino's SelfTest build path)
// =====================================================================

inline void setup() {
    Serial.begin(115200);
    Serial.println("SelfTest: core 0 boot");
    WRITE_VOLATILE(g_serial_ready, true);

    MEMLNaut::Initialize(false);
    pinMode(Pins::LED, OUTPUT);

    MEMLNaut* M = MEMLNaut::Instance();
    // Analog -> state (RV_GAIN1 callback overrides the default volume hijack).
    M->setJoyXCallback([](float v) { g_state.joyX = v; });
    M->setJoyYCallback([](float v) { g_state.joyY = v; });
    M->setJoyZCallback([](float v) { g_state.joyZ = v; });
    M->setRVX1Callback([](float v) { g_state.potX1 = v; });
    M->setRVY1Callback([](float v) { g_state.potY1 = v; });
    M->setRVZ1Callback([](float v) { g_state.potZ1 = v; });
    M->setRVGain1Callback([](float v) { g_state.potGain = v; });
    M->setADC3Callback([](float v) { g_state.potADC3 = v; });
    // Momentary press edges.
    M->setMomA1Callback([] { g_state.momA1Pressed = true; });
    M->setMomA2Callback([] { g_state.momA2Pressed = true; });
    M->setMomB1Callback([] { g_state.momB1Pressed = true; });
    M->setMomB2Callback([] { g_state.momB2Pressed = true; });
    // Toggles (ISR context — trivial stores only).
    M->setTogA1Callback([](bool on) { if (on) g_state.togA1Hi = true; else g_state.togA1Lo = true; });
    M->setTogA2Callback([](bool on) { if (on) g_state.togA2Hi = true; else g_state.togA2Lo = true; });
    M->setTogB1Callback([](bool on) { if (on) g_state.togB1Hi = true; else g_state.togB1Lo = true; });
    M->setTogB2Callback([](bool on) { if (on) g_state.togB2Hi = true; else g_state.togB2Lo = true; });
    M->setJoySWCallback([](bool) { g_state.joySWChanged = true; });
    // Encoder turn + press.
    M->setRotaryEncoderCallback([](int d) { onEncoderTurn(d); });
    M->setReSWCallback([] {
        static uint32_t last = 0;
        const uint32_t now = millis();
        if (now - last > 200) { last = now; onEncoderPress(); }
    });

    g_view = std::make_shared<SelfTestView>("Self Test");
    // AddView appends to the carousel and DisplayDriver::Setup() leaves
    // currentViewIndex_ at 0, so this — the selftest's only view — is already
    // the one on screen. (There is no NavigateToView in DisplayDriver; a call
    // to one used to sit here and had broken this variant's build.)
    M->disp->AddView(g_view);
    M->setLoopCallback([] { tickStateMachine(); });

    WRITE_VOLATILE(g_iface_ready, true);
    WRITE_VOLATILE(g_core0_ready, true);
    while (!READ_VOLATILE(g_core1_ready)) { MEMORY_BARRIER(); delay(1); }

    // NB: do NOT call addSystemInfoView() — it would add a second view and the
    // self-test view must stay the active one.
    onStepEnter(0);
    Serial.println("SelfTest: core 0 ready");
}

inline void loop() {
    PERIODIC_RUN_US({ MEMLNaut::Instance()->loop(); }, 5000)
}

inline void setup1() {
    while (!READ_VOLATILE(g_serial_ready)) { MEMORY_BARRIER(); delay(1); }
    while (!READ_VOLATILE(g_iface_ready)) { MEMORY_BARRIER(); delay(1); }

    g_st_osc.setup(static_cast<float>(AudioDriver::GetSampleRate()));
    AudioDriver::SetBlockCallback(&selftest_audio_block_callback);
    AudioDriver::Setup();
    AudioDriver::SetMasterVolume(0.f);  // silent until the audio step runs

    g_st_midi = std::make_shared<MIDIInOut>();
    g_st_midi->Setup(/*n_outputs=*/1, /*midi_through=*/false);
    g_st_midi->SetMIDISendChannel(1);
    g_st_midi->SetMIDINoteChannel(1);
    g_st_midi->SetNoteCallback([](bool on, uint8_t note, uint8_t vel) {
        if (on && note == 60 && vel == 100) WRITE_VOLATILE(g_st_midi_got, true);
    });

    WRITE_VOLATILE(g_core1_ready, true);
    while (!READ_VOLATILE(g_core0_ready)) { MEMORY_BARRIER(); delay(1); }
    Serial.println("SelfTest: core 1 ready");
}

inline void loop1() {
    // Non-blocking MIDI loopback probe + continuous RX drain.
    PERIODIC_RUN_US({
        static bool sent = false;
        static uint32_t deadline = 0;
        if (READ_VOLATILE(g_st_midi_run)) {
            if (!sent) {
                WRITE_VOLATILE(g_st_midi_got, false);
                g_st_midi->queueNoteOn(60, 100);
                g_st_midi->flushQueue();
                g_st_midi->queueNoteOff(60, 0);
                g_st_midi->flushQueue();
                sent = true;
                deadline = millis() + 250;
            }
            g_st_midi->Poll();
            if (READ_VOLATILE(g_st_midi_got)) {
                WRITE_VOLATILE(g_st_midi_result, MidiResult::PASS);
                WRITE_VOLATILE(g_st_midi_run, false);
                sent = false;
            } else if (millis() > deadline) {
                WRITE_VOLATILE(g_st_midi_result, MidiResult::FAIL);
                WRITE_VOLATILE(g_st_midi_run, false);
                sent = false;
            }
        } else {
            g_st_midi->Poll();  // keep RX drained when idle
        }
    }, 1000)
}

}  // namespace selftest
}  // namespace nisps_firmware
