#pragma once

#include "../src/memllib/interface/MIDIInOut.hpp"
#include "../ChannelStripAudioApp.hpp"
#include "../src/memllib/examples/InterfaceRL.hpp"
#include "MEMLNautMode.hpp"
#include "../src/memllib/PicoDefs.hpp"
#include <memory>
#include <array>

class MEMLNautModeChannelStrip {
public:
    constexpr static size_t kN_InputParams = 3; // joystick x, y, rotate
    ChannelStripAudioApp<> audioAppChannelStrip;
    std::array<String, ChannelStripAudioApp<>::nVoiceSpaces> voiceSpaceList;
    InterfaceRL interface;
    std::shared_ptr<InterfaceRL> interfacePtr;

    void setupInterface() {
        interface.setup(kN_InputParams, ChannelStripAudioApp<>::kN_Params);
        interface.bindInterface(InterfaceRL::INPUT_MODES::JOYSTICK);
        interfacePtr = make_non_owning(interface);    
}

    String getHelpTitle() {
        return "Channel Strip Mode";
    }
    // size_t getNParams() {
    //     return ChannelStripAudioApp<>::kN_Params;
    // }

    // void setVoiceSpace(size_t i) {
    //     audioAppChannelStrip.setVoiceSpace(i);
    // }

    // std::span<String> getVoiceSpaceList() {
    //     return voiceSpaceList;
    // }

    __force_inline stereosample_t process(stereosample_t x) {
        return audioAppChannelStrip.Process(x);
    }

    void setupMIDI(std::shared_ptr<MIDIInOut> midi_interf) {
    }

    void addViews() {
        std::shared_ptr<VoiceSpaceSelectView> voiceSpaceSelectView;
        voiceSpaceSelectView = std::make_shared<VoiceSpaceSelectView>("Voice Spaces");

        MEMLNaut::Instance()->disp->InsertViewAfter(interface.rlStatsView, voiceSpaceSelectView);
        voiceSpaceSelectView->setOptions(voiceSpaceList);  //set by core 1 on startup
        voiceSpaceSelectView->setNewVoiceCallback(
            [this](size_t idx) {
                audioAppChannelStrip.setVoiceSpace(idx);
            });

    };

    void setupAudio(float sample_rate) {
        audioAppChannelStrip.Setup(sample_rate, interfacePtr);
        voiceSpaceList = audioAppChannelStrip.getVoiceSpaceNames();
    }

    __force_inline void loop() {
      audioAppChannelStrip.loop();
    }

    size_t getNMIDICtrlOutputs() {
        return 0;
    }

    inline void processAnalysisParams() {}

};
