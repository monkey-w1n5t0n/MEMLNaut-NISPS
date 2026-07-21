// firmware/glue/codec_config.hpp — Pure, host-testable translation of a
// mode's `nisps::DriverConfig` into what the SGTL5000 codec can actually be
// asked for.
//
// Deliberately Arduino-free and memllib-free so `tests/cpp/` can exercise it
// on the host: this is the only part of the mic/line wiring that has logic in
// it, and it is the part that can panic the device if it gets the sample rate
// wrong. `glue/audio_driver.hpp` does the remaining (field-for-field) copy
// into `AudioDriver::codec_config_t`.
//
// Codec limits are read off the vendored driver, not invented:
//   - `AudioControlSGTL5000::lineInLevel` (control_sgtl5000.cpp) clamps to 15;
//     the register is 4 bits per channel.
//   - `AudioControlSGTL5000::micGain` saturates at preamp step 3 (+40 dB) plus
//     input_gain 15, i.e. 40 + ceil(15 * 3 / 2) = 63 dB. Above that the codec
//     setting is identical, so we clamp to the point of saturation.
//   - `AudioDriver::Setup` already truncates output volume above 0.99; it does
//     NOT guard against a negative, which would run through
//     `AudioControlSGTL5000::calcVol` — so clamp both ends here.
//   - `AudioDriver::GetSysClockSpeed` `panic()`s on any sample rate outside
//     {24000, 32000, 44100, 48000}. An engine asking for anything else must
//     NOT brick the boot, so we fall back to 48 kHz.

#pragma once

#include <cstdint>

#include "nisps/core/types.hpp"

namespace nisps_firmware {

inline constexpr std::uint8_t  kMaxLineLevel    = 15u;
inline constexpr std::uint8_t  kMaxMicGainDb    = 63u;
inline constexpr float         kMaxOutputVolume = 0.99f;
inline constexpr std::uint32_t kDefaultSampleRate = 48000u;

// The rates `AudioDriver::GetSysClockSpeed()` knows a system-clock for.
inline constexpr std::uint32_t kSupportedSampleRates[] = {
    24000u, 32000u, 44100u, 48000u,
};

// Fold a mode's requested config into the codec's representable range.
// Everything out of range is clamped, never wrapped or ignored.
inline constexpr nisps::DriverConfig clamp_driver_config(nisps::DriverConfig c) noexcept {
    if (c.line_level > kMaxLineLevel) c.line_level = kMaxLineLevel;
    if (c.mic_gain_db > kMaxMicGainDb) c.mic_gain_db = kMaxMicGainDb;
    if (c.output_volume < 0.f) c.output_volume = 0.f;
    else if (c.output_volume > kMaxOutputVolume) c.output_volume = kMaxOutputVolume;
    return c;
}

// Resolve the rate the driver should actually run at.
//   requested <= 0        ⇒ "don't care"      ⇒ 48 kHz
//   requested unsupported ⇒ would panic()     ⇒ 48 kHz
//   otherwise             ⇒ the requested rate
// Matched with a small tolerance so a float literal like 44100.f that does not
// round-trip exactly still resolves.
inline constexpr std::uint32_t select_sample_rate(float requested) noexcept {
    if (!(requested > 0.f)) return kDefaultSampleRate;  // also catches NaN
    for (const std::uint32_t rate : kSupportedSampleRates) {
        const float diff = requested - static_cast<float>(rate);
        if (diff > -0.5f && diff < 0.5f) return rate;
    }
    return kDefaultSampleRate;
}

}  // namespace nisps_firmware
