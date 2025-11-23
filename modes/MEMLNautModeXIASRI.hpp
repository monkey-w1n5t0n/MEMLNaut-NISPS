#pragma once

#include "../src/memllib/interface/MIDIInOut.hpp"
#include "../ChannelStripAudioApp.hpp"
#include "MEMLNautMode.hpp"
#include <memory>
#include <array>

class MEMLNautModeXIASRI {
public:
    constexpr static size_t kN_InputParams = XiasriAnalysis::kN_Params; // joystick x, y, rotate

    ChannelStripAudioApp<> audioAppXIASRI;
    std::array<String, ChannelStripAudioApp<>::nVoiceSpaces> voiceSpaceList;

    String getHelpTitle() {
        return "XIASRI Mode";
    }
    size_t getNParams() {
        return ChannelStripAudioApp<>::kN_Params;
    }

    void setVoiceSpace(size_t i) {
        audioAppXIASRI.setVoiceSpace(i);
    }

    std::span<String> getVoiceSpaceList() {
        return voiceSpaceList;
    }

    __force_inline stereosample_t process(stereosample_t x) {
        return audioAppXIASRI.Process(x);
    }

    void setupMIDI(std::shared_ptr<MIDIInOut> midi_interf) {
    }

    void addViews() {

    };

    void Setup(float sample_rate, std::shared_ptr<InterfaceBase> interface) {
        audioAppXIASRI.Setup(sample_rate, interface);
        voiceSpaceList = audioAppXIASRI.getVoiceSpaceNames();
    }

    __force_inline void loop() {
      audioAppXIASRI.loop();
    }

    size_t getNMIDICtrlOutputs() {
        return 0;
    }

    inline void processAnalysisParams(std::shared_ptr<InterfaceBase> interface) {}



};
