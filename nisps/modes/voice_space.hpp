// nisps/modes/voice_space.hpp — Voice-space binding helpers.
//
// In this codebase the *voice-space code* (the lambda that maps NN outputs
// to engine state fields) lives INSIDE each engine — see e.g.
// `PAFSynthEngine::apply_quad_detune` etc. Engines expose a
// `set_voice_space(EngineT::VoiceSpace)` method to switch which mapping is
// active; the next `set_params(span<float>)` call routes through the
// selected voice space.
//
// The mode layer therefore only needs to:
//   1. Tell the engine which voice space is active.
//   2. Surface the voice-space NAMES (for UI dropdowns / schema parity).
//
// `VoiceSpaceEntry` is a thin value used by `ParamSchema::voice_spaces` and
// for static introspection (e.g. matching schema names against
// `EngineT::kVoiceSpaceNames`). We keep it constexpr-friendly.

#pragma once

#include <array>
#include <cstddef>
#include <span>
#include <string_view>

namespace nisps {

struct VoiceSpaceEntry {
    std::string_view name;
    std::size_t      index;
};

// Build a constexpr list of {name, index} from the engine's static name table.
template <typename EngineT>
constexpr auto make_voice_space_entries() noexcept {
    constexpr std::size_t N = EngineT::kVoiceSpaceCount;
    std::array<VoiceSpaceEntry, N> entries{};
    for (std::size_t i = 0u; i < N; ++i) {
        entries[i] = VoiceSpaceEntry{EngineT::kVoiceSpaceNames[i], i};
    }
    return entries;
}

// Look up a voice-space index by name on an engine. Returns SIZE_MAX if not
// found. Modes use this to translate schema voice-space strings to the
// engine's enum index when loading a default.
template <typename EngineT>
constexpr std::size_t find_voice_space(std::string_view name) noexcept {
    for (std::size_t i = 0u; i < EngineT::kVoiceSpaceCount; ++i) {
        if (EngineT::kVoiceSpaceNames[i] == name) return i;
    }
    return static_cast<std::size_t>(-1);
}

}  // namespace nisps
