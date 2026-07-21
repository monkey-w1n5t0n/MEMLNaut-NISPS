#ifndef MEMLLIB_SYNTH_VOICESPACE_HPP
#define MEMLLIB_SYNTH_VOICESPACE_HPP


#include <span>

namespace VoiceSpaces {
    using Fn = void(*)(std::span<float>);
    using VoiceSpaceList = std::span<Fn>;

    struct VoiceSpace {
        char name[16]="default";
        Fn mappingFunction = nullptr;
    };

};

#endif // MEMLLIB_SYNTH_VOICESPACE_HPP