#ifndef MEML_MEMLNAUT_NISPS_VOICESPACES_VOICESPACES_HPP
#define MEML_MEMLNAUT_NISPS_VOICESPACES_VOICESPACES_HPP

#pragma once
#include <functional>
#include <array>

template<size_t NPARAMS>
using VoiceSpaceFn = std::function<void(const std::array<float, NPARAMS>&)>;

template<size_t NPARAMS>
struct VoiceSpace {
    char name[16]="default";
    VoiceSpaceFn<NPARAMS> mappingFunction = nullptr;
};

#endif // MEML_MEMLNAUT_NISPS_VOICESPACES_VOICESPACES_HPP