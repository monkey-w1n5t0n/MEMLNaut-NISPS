#pragma once

#include "../src/memllib/interface/MIDIInOut.hpp"
#include "../ThruAudioApp.hpp"
#include "MEMLNautMode.hpp"
#include <memory>
#include <array>
#include "../XiasriAnalysis.hpp"
#include "../src/memllib/utils/sharedMem.hpp"
#include "../src/memllib/audio/AudioDriver.hpp"


class MEMLNautModeSoundAnalysisMIDI {
public:
    constexpr static size_t kN_InputParams = XiasriAnalysis::kN_Params; // joystick x, y, rotate
    XiasriAnalysis mlAnalysis{kSampleRate};
    SharedBuffer<float, XiasriAnalysis::kN_Params> machine_list_buffer;

    ThruAudioApp<> audioAppSoundAnalysisMIDI;
    std::array<String, ThruAudioApp<>::nVoiceSpaces> voiceSpaceList;
    std::shared_ptr<MIDIInOut> midi_interf;

    String getHelpTitle() {
        return "Sound Analysis MIDI Mode";
    }
    size_t getNParams() {
        return ThruAudioApp<>::kN_Params;
    }

    void setVoiceSpace(size_t i) {
        audioAppSoundAnalysisMIDI.setVoiceSpace(i);
    }

    std::span<String> getVoiceSpaceList() {
        return voiceSpaceList;
    }

    __force_inline stereosample_t process(stereosample_t x) {
        return audioAppSoundAnalysisMIDI.Process(x);
    }

    void setupMIDI(std::shared_ptr<MIDIInOut> new_midi_interf) {
        midi_interf = new_midi_interf;
    }

    void addViews() {
    };

    void Setup(float sample_rate, std::shared_ptr<InterfaceBase> interface) {
        audioAppSoundAnalysisMIDI.Setup(sample_rate, interface);
        voiceSpaceList = audioAppSoundAnalysisMIDI.getVoiceSpaceNames();
    }

    __force_inline void loop() {
        audioAppSoundAnalysisMIDI.loop();
    }

    inline void analyse(stereosample_t x) {
        union {
            XiasriAnalysis::parameters_t p;
            float v[XiasriAnalysis::kN_Params];
        } param_u;
        param_u.p = mlAnalysis.Process(x.L + x.R);
        // Write params into shared_buffer
        machine_list_buffer.writeNonBlocking(param_u.v, XiasriAnalysis::kN_Params);
    }

    size_t getNMIDICtrlOutputs() {
        return 8;
    }

    inline void processAnalysisParams(std::shared_ptr<InterfaceBase> interface) {
        // Read SharedBuffer
        std::vector<float> mlist_params(XiasriAnalysis::kN_Params, 0);
        machine_list_buffer.readNonBlocking(mlist_params);
        // Send parameters to RL interface
        interface->readAnalysisParameters(mlist_params);
    }

};
