#pragma once

#include "../src/memllib/interface/MIDIInOut.hpp"
#include "../ChannelStripAudioApp.hpp"
#include "MEMLNautMode.hpp"
#include <memory>
#include <array>

class MEMLNautModeChannelStrip {
public:
    constexpr static size_t kN_InputParams = 3; // joystick x, y, rotate
    ChannelStripAudioApp<> audioAppChannelStrip;
    std::array<String, ChannelStripAudioApp<>::nVoiceSpaces> voiceSpaceList;

    String getHelpTitle() {
        return "Channel Strip Mode";
    }
    size_t getNParams() {
        return ChannelStripAudioApp<>::kN_Params;
    }

    void setVoiceSpace(size_t i) {
        audioAppChannelStrip.setVoiceSpace(i);
    }

    std::span<String> getVoiceSpaceList() {
        return voiceSpaceList;
    }

    __force_inline stereosample_t process(stereosample_t x) {
        return audioAppChannelStrip.Process(x);
    }

    void setupMIDI(std::shared_ptr<MIDIInOut> midi_interf) {
    }

    void addViews() {

    };

    void Setup(float sample_rate, std::shared_ptr<InterfaceBase> interface) {
        audioAppChannelStrip.Setup(sample_rate, interface);
        voiceSpaceList = audioAppChannelStrip.getVoiceSpaceNames();
    }

    __force_inline void loop() {
      audioAppChannelStrip.loop();
    }

    size_t getNMIDICtrlOutputs() {
        return 0;
    }
    
    inline void processAnalysisParams(std::shared_ptr<InterfaceBase> interface) {}

};
