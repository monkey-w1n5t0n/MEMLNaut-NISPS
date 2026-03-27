#include "plugin.hpp"
#include <nisps/nisps.hpp>

struct MEMLNaut : Module {
    enum ParamId {
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

    MEMLNaut() {
        config(PARAMS_LEN, INPUTS_LEN, OUTPUTS_LEN, LIGHTS_LEN);
        configInput(INPUT_X, "X");
        configInput(INPUT_Y, "Y");
        for (int i = 0; i < 12; i++) {
            configOutput(OUTPUT_1 + i, string::f("Out %d", i + 1));
        }

        // Verify nisps-core headers integrate correctly
        // (actual IML instance will be added in Phase 2)
        static_assert(sizeof(nisps::IML<float>) > 0, "nisps::IML must be a complete type");
    }

    void process(const ProcessArgs& args) override {
        // Empty — Phase 2 will wire up IML inference
    }
};

struct MEMLNautWidget : ModuleWidget {
    MEMLNautWidget(MEMLNaut* module) {
        setModule(module);
        setPanel(createPanel(asset::plugin(pluginInstance, "res/MEMLNaut.svg")));

        // Inputs (left side)
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(8.0, 20.0)), module, MEMLNaut::INPUT_X));
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(8.0, 32.0)), module, MEMLNaut::INPUT_Y));

        // Outputs (right side, 2 columns of 6)
        for (int i = 0; i < 6; i++) {
            addOutput(createOutputCentered<PJ301MPort>(mm2px(Vec(20.0, 20.0 + i * 12.0)), module, MEMLNaut::OUTPUT_1 + i));
            addOutput(createOutputCentered<PJ301MPort>(mm2px(Vec(32.0, 20.0 + i * 12.0)), module, MEMLNaut::OUTPUT_1 + 6 + i));
        }
    }
};

Model* modelMEMLNaut = createModel<MEMLNaut, MEMLNautWidget>("MEMLNaut");
