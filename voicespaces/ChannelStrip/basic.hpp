#ifndef __VOICE_SPACE_CHSTRIP_BASIC_HPP__
#define __VOICE_SPACE_CHSTRIP_BASIC_HPP__

#define VOICE_SPACE_CHSTRIP_BASIC_BODY \
    preGain=0.5f + (params[0] * 4.f); \
    inLowPassCutoff = 1000.f + (params[7] *  19000.f); \
    inHighPassCutoff = 10.f + (params[8] * params[8] * params[8] * 1990.f); \
    compThreshold = params[10] * -30.f; \
    compRatio = 1.0f + (params[11] * 11.f); \
    compAttack = 0.08f + (params[12] * 50.f); \
    compRelease = 50.0f + (params[13] * 1050.f); \
    postGain=0.5f + (params[23] * 4.f); \
    peak0Freq = 60.f + (params[1] * params[1] * 2940.f); \
    peak0Q = 0.6f + (params[5]*4.4f); \
    peak0Gain = -18.f + (params[6]*36.f);\
    peak1Freq = 300.f + (params[4] * params[4] * 7700.f); \
    peak1Q = 0.6f + (params[5]*4.4f); \
    peak1Gain = -18.f + (params[6]*36.f);\
    lowShelfFreq = 20.f + (params[14] * params[14] * 980.f); \
    lowShelfQ = 0.6f + (params[15]*4.4f); \
    lowShelfGain = -18.f + (params[16]*36.f);\
    highShelfFreq = 1000.f + (params[17] * params[17] * 9000.f); \
    highShelfQ = 0.6f + (params[18]*4.4f); \
    highShelfGain = -18.f + (params[19]*36.f);\

#define VOICE_SPACE_CHSTRIP_MALE_VOX_BODY \
    preGain=0.5f + (params[0] * 4.f); \
    inLowPassCutoff = 1000.f + (params[7] *  19000.f); \
    inHighPassCutoff = 10.f + (params[8] * params[8] * params[8] * 1990.f); \
    compThreshold = params[10] * -30.f; \
    compRatio = 2.0f + (params[11] * 6.f); \
    compAttack = 0.08f + (params[12] * 50.f); \
    compRelease = 50.0f + (params[13] * 500.f); \
    postGain=0.5f + (params[23] * 4.f); \
    \
    lowShelfFreq = 60.f + (params[14] * params[14] * 240.f); \
    lowShelfQ = 0.6f + (params[15]*4.4f); \
    lowShelfGain = -18.f + (params[16]*36.f);\
    \
    peak0Freq = 60.f + (params[1] * params[1] * 440.f); \
    peak0Q = 0.6f + (params[5]*4.4f); \
    peak0Gain = -18.f + (params[6]*36.f);\
    \
    peak1Freq = 300.f + (params[4] * params[4] * 7700.f); \
    peak1Q = 0.6f + (params[5]*4.4f); \
    peak1Gain = -18.f + (params[6]*36.f);\
    \
    highShelfFreq = 1000.f + (params[17] * params[17] * 7000.f); \
    highShelfQ = 0.6f + (params[18]*4.4f); \
    highShelfGain = -18.f + (params[19]*36.f);\

 

#define VOICE_SPACE_CHSTRIP_FEMALE_VOX_BODY \
    preGain=0.5f + (params[0] * 4.f); \
    inLowPassCutoff = 1000.f + (params[7] *  19000.f); \
    inHighPassCutoff = 10.f + (params[8] * params[8] * params[8] * 1990.f); \
    compThreshold = params[10] * -30.f; \
    compRatio = 2.0f + (params[11] * 6.f); \
    compAttack = 0.08f + (params[12] * 50.f); \
    compRelease = 50.0f + (params[13] * 500.f); \
    postGain=0.5f + (params[23] * 4.f); \
    \
    lowShelfFreq = 120.f + (params[14] * params[14] * 180.f); \
    lowShelfQ = 0.6f + (params[15]*4.4f); \
    lowShelfGain = -18.f + (params[16]*36.f);\
    \
    peak0Freq = 120.f + (params[1] * params[1] * 380.f); \
    peak0Q = 0.6f + (params[5]*4.4f); \
    peak0Gain = -18.f + (params[6]*36.f);\
    \
    peak1Freq = 300.f + (params[4] * params[4] * 9700.f); \
    peak1Q = 0.6f + (params[5]*4.4f); \
    peak1Gain = -18.f + (params[6]*36.f);\
    \
    highShelfFreq = 1000.f + (params[17] * params[17] * 9000.f); \
    highShelfQ = 0.6f + (params[18]*4.4f); \
    highShelfGain = -18.f + (params[19]*36.f);\

#endif 