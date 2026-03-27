#include "plugin.hpp"
#include <nisps/nisps.hpp>

static constexpr int NUM_ML_INPUTS = 2;
static constexpr int NUM_ML_OUTPUTS = 12;

struct MEMLNaut : Module {
    enum ParamId {
        PARAM_SPREAD,
        PARAM_RAND,
        PARAMS_LEN
    };
    enum InputId {
        INPUT_X,
        INPUT_Y,
        INPUTS_LEN
    };
    enum OutputId {
        OUTPUT_1, OUTPUT_2, OUTPUT_3, OUTPUT_4,
        OUTPUT_5, OUTPUT_6, OUTPUT_7, OUTPUT_8,
        OUTPUT_9, OUTPUT_10, OUTPUT_11, OUTPUT_12,
        OUTPUTS_LEN
    };
    enum LightId {
        LIGHTS_LEN
    };

    nisps::IML<float> iml{NUM_ML_INPUTS, NUM_ML_OUTPUTS, {16, 24, 16}};
    dsp::BooleanTrigger randTrigger;

    MEMLNaut() {
        config(PARAMS_LEN, INPUTS_LEN, OUTPUTS_LEN, LIGHTS_LEN);
        configParam(PARAM_SPREAD, 0.f, 1.f, 0.6f, "Spread", "%", 0.f, 100.f);
        configButton(PARAM_RAND, "Randomize weights");
        configInput(INPUT_X, "X");
        configInput(INPUT_Y, "Y");
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            configOutput(OUTPUT_1 + i, string::f("Out %d", i + 1));
        }

        // Initial randomization with default spread
        iml.set_mode(nisps::IML<float>::Mode::Training);
        iml.randomise_weights(0.6f);
        iml.set_mode(nisps::IML<float>::Mode::Inference);
    }

    void process(const ProcessArgs& args) override {
        // Handle RAND button
        if (randTrigger.process(params[PARAM_RAND].getValue() > 0.f)) {
            float spread = params[PARAM_SPREAD].getValue();
            iml.set_mode(nisps::IML<float>::Mode::Training);
            iml.randomise_weights(spread);
            iml.set_mode(nisps::IML<float>::Mode::Inference);
        }

        // Read inputs, normalize 0-10V → [0,1], clamp
        float x = clamp(inputs[INPUT_X].getVoltage() / 10.f, 0.f, 1.f);
        float y = clamp(inputs[INPUT_Y].getVoltage() / 10.f, 0.f, 1.f);

        iml.set_input(0, x);
        iml.set_input(1, y);
        iml.process();

        // Write outputs: sigmoid [0,1] → 0-10V
        const float* outs = iml.get_outputs();
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            outputs[OUTPUT_1 + i].setVoltage(outs[i] * 10.f);
        }
    }
};

struct MEMLNautWidget : ModuleWidget {
    MEMLNautWidget(MEMLNaut* module) {
        setModule(module);
        setPanel(createPanel(asset::plugin(pluginInstance, "res/MEMLNaut.svg")));

        // Knobs
        addParam(createParamCentered<RoundBlackKnob>(mm2px(Vec(12.0, 20.0)), module, MEMLNaut::PARAM_SPREAD));
        addParam(createParamCentered<VCVButton>(mm2px(Vec(28.0, 20.0)), module, MEMLNaut::PARAM_RAND));

        // Inputs (left side)
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(8.0, 38.0)), module, MEMLNaut::INPUT_X));
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(8.0, 50.0)), module, MEMLNaut::INPUT_Y));

        // Outputs (2 columns of 6, below inputs)
        for (int i = 0; i < 6; i++) {
            addOutput(createOutputCentered<PJ301MPort>(mm2px(Vec(12.0, 62.0 + i * 10.0)), module, MEMLNaut::OUTPUT_1 + i));
            addOutput(createOutputCentered<PJ301MPort>(mm2px(Vec(28.0, 62.0 + i * 10.0)), module, MEMLNaut::OUTPUT_1 + 6 + i));
        }
    }
};

Model* modelMEMLNaut = createModel<MEMLNaut, MEMLNautWidget>("MEMLNaut");
