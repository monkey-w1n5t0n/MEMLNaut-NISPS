#include "plugin.hpp"
#include <nisps/nisps.hpp>
#include <thread>
#include <atomic>
#include <mutex>
#include <condition_variable>
#include <functional>

static constexpr int NUM_ML_INPUTS = 2;
static constexpr int NUM_ML_OUTPUTS = 12;
static constexpr int MAX_ML_INPUTS = 8;

// ── Background job types ──────────────────────────────────────────────
enum class JobType { Train, Perturb };
struct Job {
    JobType type;
    float noiseLevel;
    float spread;
};

// ── MEMLNaut Module ───────────────────────────────────────────────────
struct MEMLNaut : Module {
    enum ParamId {
        PARAM_SPREAD,
        PARAM_RATE,
        PARAM_RAND,
        PARAM_THUMBS_UP,
        PARAM_THUMBS_DOWN,
        PARAM_LEARN,
        PARAM_CLEAR,
        PARAM_ATTEN_1, // 12 attenuverters
        PARAM_ATTEN_LAST = PARAM_ATTEN_1 + NUM_ML_OUTPUTS - 1,
        PARAMS_LEN
    };
    enum InputId {
        INPUT_X,
        INPUT_Y,
        // IN 3–8 reserved for configurable inputs (future)
        INPUT_SPREAD_CV,
        INPUT_LEARN_GATE,
        INPUT_TRIG_POS,
        INPUT_TRIG_NEG,
        INPUTS_LEN
    };
    enum OutputId {
        OUTPUT_1, OUTPUT_2, OUTPUT_3, OUTPUT_4,
        OUTPUT_5, OUTPUT_6, OUTPUT_7, OUTPUT_8,
        OUTPUT_9, OUTPUT_10, OUTPUT_11, OUTPUT_12,
        OUTPUT_MEAN,
        OUTPUT_STD,
        OUTPUT_DELTA,
        OUTPUT_NOVELTY,
        OUTPUT_CONFIDENCE,
        OUTPUTS_LEN
    };
    enum LightId {
        LIGHT_LEARN,
        LIGHT_TRAINING,
        LIGHT_OUT_1, // 12 output LEDs
        LIGHT_OUT_LAST = LIGHT_OUT_1 + NUM_ML_OUTPUTS - 1,
        LIGHTS_LEN
    };

    // ── ML Engine ─────────────────────────────────────────────────────
    nisps::IML<float> iml{NUM_ML_INPUTS, NUM_ML_OUTPUTS, {16, 24, 16}};

    // ── State ─────────────────────────────────────────────────────────
    float noiseLevel = 0.1f;
    float cachedOutputs[NUM_ML_OUTPUTS] = {};
    float prevOutputs[NUM_ML_OUTPUTS] = {};
    float slewOutputs[NUM_ML_OUTPUTS] = {};
    float crossfadeProgress = 1.f; // 1 = no crossfade active
    float slewMs = 10.f;
    int sampleCounter = 0;
    bool outputRangeUnipolar[NUM_ML_OUTPUTS] = {}; // true = 0-10V, false = ±5V
    bool inputRangeUnipolar[MAX_ML_INPUTS] = {};   // true = 0-10V, false = ±5V
    float clearHoldTime = 0.f;

    // ── Triggers ──────────────────────────────────────────────────────
    dsp::BooleanTrigger randTrigger;
    dsp::BooleanTrigger thumbsUpTrigger;
    dsp::BooleanTrigger thumbsDownTrigger;
    dsp::SchmittTrigger trigPosTrigger;
    dsp::SchmittTrigger trigNegTrigger;

    // ── Background thread ─────────────────────────────────────────────
    std::thread workerThread;
    std::mutex jobMutex;
    std::condition_variable jobCv;
    std::atomic<bool> shouldStop{false};
    std::atomic<bool> swapReady{false};
    std::atomic<bool> isTraining{false};
    Job currentJob{};
    bool hasJob = false;
    // Pending examples buffer (for rapid feedback queueing)
    std::vector<float> pendingInputs;
    std::vector<float> pendingOutputs;
    bool hasPending = false;

    MEMLNaut() {
        config(PARAMS_LEN, INPUTS_LEN, OUTPUTS_LEN, LIGHTS_LEN);

        // Knobs
        configParam(PARAM_SPREAD, 0.f, 1.f, 0.6f, "Spread", "%", 0.f, 100.f);
        configParam(PARAM_RATE, 0.f, 1.f, 0.5f, "Inference rate");

        // Buttons
        configButton(PARAM_RAND, "Randomize weights");
        configButton(PARAM_THUMBS_UP, "Thumbs up (+)");
        configButton(PARAM_THUMBS_DOWN, "Thumbs down (−)");
        configSwitch(PARAM_LEARN, 0.f, 1.f, 0.f, "Learn enable", {"Off", "On"});
        configButton(PARAM_CLEAR, "Clear (long-press)");

        // Attenuverters
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            configParam(PARAM_ATTEN_1 + i, -1.f, 1.f, 1.f,
                        string::f("Out %d attenuverter", i + 1), "%", 0.f, 100.f);
        }

        // Inputs
        configInput(INPUT_X, "X");
        configInput(INPUT_Y, "Y");
        configInput(INPUT_SPREAD_CV, "Spread CV");
        configInput(INPUT_LEARN_GATE, "Learn gate");
        configInput(INPUT_TRIG_POS, "+ trigger");
        configInput(INPUT_TRIG_NEG, "− trigger");

        // Outputs
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            configOutput(OUTPUT_1 + i, string::f("Out %d", i + 1));
        }
        configOutput(OUTPUT_MEAN, "Mean");
        configOutput(OUTPUT_STD, "Std deviation");
        configOutput(OUTPUT_DELTA, "Delta (rate of change)");
        configOutput(OUTPUT_NOVELTY, "Novelty");
        configOutput(OUTPUT_CONFIDENCE, "Confidence");

        // Init ranges to unipolar
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) outputRangeUnipolar[i] = true;
        for (int i = 0; i < MAX_ML_INPUTS; i++) inputRangeUnipolar[i] = true;

        // Randomize with default spread
        iml.set_mode(nisps::IML<float>::Mode::Training);
        iml.randomise_weights(0.6f);
        iml.set_mode(nisps::IML<float>::Mode::Inference);

        // Start worker thread
        workerThread = std::thread(&MEMLNaut::workerLoop, this);
    }

    ~MEMLNaut() {
        shouldStop.store(true);
        jobCv.notify_one();
        if (workerThread.joinable()) {
            workerThread.join();
        }
    }

    // ── Background worker ─────────────────────────────────────────────
    void workerLoop() {
        while (!shouldStop.load()) {
            Job job;
            {
                std::unique_lock<std::mutex> lock(jobMutex);
                jobCv.wait(lock, [&] { return hasJob || shouldStop.load(); });
                if (shouldStop.load()) break;
                job = currentJob;
                hasJob = false;
            }

            isTraining.store(true);

            // NOTE: Full double-buffering requires IML weight get/set API
            // (filed for follow-up). For now, training and perturbation
            // operate directly on iml. The audio thread reads outputs
            // (which are a cached copy), so this is safe for outputs
            // but not for concurrent inference. The RATE decimation
            // means inference doesn't run every sample, reducing
            // collision probability. Proper double-buffering is Phase 3
            // follow-up work.

            if (job.type == JobType::Train) {
                iml.set_mode(nisps::IML<float>::Mode::Training);
                iml.set_mode(nisps::IML<float>::Mode::Inference);
            } else {
                iml.move_weights(job.noiseLevel, job.spread);
            }

            swapReady.store(true);
            isTraining.store(false);

            // Check for pending work
            {
                std::unique_lock<std::mutex> lock(jobMutex);
                if (hasPending) {
                    hasPending = false;
                    hasJob = true;
                    // Pending becomes current job (already set)
                }
            }
        }
    }

    void enqueueJob(JobType type, float noise = 0.f, float spread = 0.f) {
        std::unique_lock<std::mutex> lock(jobMutex);
        if (hasJob || isTraining.load()) {
            // Queue as pending (max depth 1, latest wins)
            hasPending = true;
            currentJob = {type, noise, spread};
        } else {
            currentJob = {type, noise, spread};
            hasJob = true;
            jobCv.notify_one();
        }
    }

    // ── Helper: read spread with CV modulation ────────────────────────
    float getSpread() {
        float spread = params[PARAM_SPREAD].getValue();
        if (inputs[INPUT_SPREAD_CV].isConnected()) {
            spread += inputs[INPUT_SPREAD_CV].getVoltage() / 10.f;
        }
        return clamp(spread, 0.f, 1.f);
    }

    // ── Helper: is learning enabled ───────────────────────────────────
    bool isLearnEnabled() {
        bool toggle = params[PARAM_LEARN].getValue() > 0.5f;
        bool gate = inputs[INPUT_LEARN_GATE].isConnected() &&
                    inputs[INPUT_LEARN_GATE].getVoltage() > 1.f;
        return toggle || gate;
    }

    // ── Helper: normalize input CV ────────────────────────────────────
    float normalizeInput(int inputId, int rangeIdx) {
        float v = inputs[inputId].getVoltage();
        if (inputRangeUnipolar[rangeIdx]) {
            return clamp(v / 10.f, 0.f, 1.f);
        } else {
            return clamp((v + 5.f) / 10.f, 0.f, 1.f);
        }
    }

    // ── Helper: scale output to CV ────────────────────────────────────
    float outputToVoltage(float val01, int outIdx) {
        float atten = params[PARAM_ATTEN_1 + outIdx].getValue();
        if (outputRangeUnipolar[outIdx]) {
            return val01 * 10.f * atten;
        } else {
            return (val01 - 0.5f) * 10.f * atten;
        }
    }

    // ── Process ───────────────────────────────────────────────────────
    void process(const ProcessArgs& args) override {
        float spread = getSpread();
        bool learn = isLearnEnabled();

        // ── Learn LED ─────────────────────────────────────────────────
        lights[LIGHT_LEARN].setBrightness(learn ? 1.f : 0.f);
        lights[LIGHT_TRAINING].setBrightness(isTraining.load() ? 1.f : 0.f);

        // ── Handle weight change notification from background thread ──
        if (swapReady.load()) {
            swapReady.store(false);
            // Start crossfade: save current outputs as "old"
            for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
                prevOutputs[i] = cachedOutputs[i];
            }
            crossfadeProgress = 0.f;
        }

        // ── Handle RAND button ────────────────────────────────────────
        if (randTrigger.process(params[PARAM_RAND].getValue() > 0.f)) {
            iml.set_mode(nisps::IML<float>::Mode::Training);
            iml.randomise_weights(spread);
            iml.set_mode(nisps::IML<float>::Mode::Inference);
        }

        // ── Handle CLEAR button (long-press ~1s) ─────────────────────
        if (params[PARAM_CLEAR].getValue() > 0.f) {
            clearHoldTime += args.sampleTime;
            if (clearHoldTime >= 1.f) {
                iml.set_mode(nisps::IML<float>::Mode::Training);
                iml.clear_dataset();
                iml.randomise_weights(spread);
                iml.set_mode(nisps::IML<float>::Mode::Inference);
                noiseLevel = 0.1f;
                clearHoldTime = 0.f;
            }
        } else {
            clearHoldTime = 0.f;
        }

        // ── Handle RL feedback (only when learning) ───────────────────
        if (learn) {
            bool thumbsUp = thumbsUpTrigger.process(
                params[PARAM_THUMBS_UP].getValue() > 0.f);
            bool trigPos = trigPosTrigger.process(
                inputs[INPUT_TRIG_POS].getVoltage());
            if (thumbsUp || trigPos) {
                // Capture current input → output as training example
                const float* curOuts = iml.get_outputs();
                float curInputs[2] = {
                    normalizeInput(INPUT_X, 0),
                    normalizeInput(INPUT_Y, 1)
                };
                iml.set_mode(nisps::IML<float>::Mode::Training);
                iml.add_example(curInputs, 2, curOuts, NUM_ML_OUTPUTS);
                iml.set_mode(nisps::IML<float>::Mode::Inference);
                // Enqueue training
                enqueueJob(JobType::Train);
                // Decay noise
                noiseLevel *= 0.97f;
            }

            bool thumbsDown = thumbsDownTrigger.process(
                params[PARAM_THUMBS_DOWN].getValue() > 0.f);
            bool trigNeg = trigNegTrigger.process(
                inputs[INPUT_TRIG_NEG].getVoltage());
            if (thumbsDown || trigNeg) {
                float noiseCap = 0.3f * (1.f - spread) + 0.05f * spread;
                noiseLevel = std::min(noiseLevel * 1.5f, noiseCap);
                // Perturb directly (simple for now — enqueue for full thread safety later)
                iml.move_weights(noiseLevel, spread);
            }
        }

        // ── Inference rate decimation ─────────────────────────────────
        float rate = params[PARAM_RATE].getValue();
        // Map 0→1 to period: 256 samples (block rate) → 1 sample (audio rate)
        // Exponential mapping for perceptual linearity
        int period = std::max(1, (int)(256.f * std::pow(1.f / 256.f, rate)));
        sampleCounter++;

        bool runInference = (sampleCounter >= period);
        if (runInference) {
            sampleCounter = 0;

            // Read and normalize inputs
            float x = normalizeInput(INPUT_X, 0);
            float y = normalizeInput(INPUT_Y, 1);

            iml.set_input(0, x);
            iml.set_input(1, y);
            iml.process();

            const float* outs = iml.get_outputs();
            for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
                cachedOutputs[i] = outs[i];
            }
        }

        // ── Crossfade after weight swap ───────────────────────────────
        float effectiveOutputs[NUM_ML_OUTPUTS];
        if (crossfadeProgress < 1.f) {
            float slewSamples = std::max(1.f, slewMs * 0.001f * args.sampleRate);
            crossfadeProgress += 1.f / slewSamples;
            if (crossfadeProgress > 1.f) crossfadeProgress = 1.f;
            for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
                effectiveOutputs[i] = prevOutputs[i] + crossfadeProgress * (cachedOutputs[i] - prevOutputs[i]);
            }
        } else {
            for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
                effectiveOutputs[i] = cachedOutputs[i];
            }
        }

        // ── Interpolate between inference steps (slew) ────────────────
        if (!runInference && period > 1) {
            float alpha = (float)sampleCounter / (float)period;
            for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
                slewOutputs[i] += alpha * (effectiveOutputs[i] - slewOutputs[i]);
            }
        } else {
            for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
                slewOutputs[i] = effectiveOutputs[i];
            }
        }

        // ── Write raw outputs with attenuverters ──────────────────────
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            outputs[OUTPUT_1 + i].setVoltage(outputToVoltage(slewOutputs[i], i));
            lights[LIGHT_OUT_1 + i].setBrightness(slewOutputs[i]);
        }

        // ── Derived outputs ───────────────────────────────────────────
        // Mean
        float mean = 0.f;
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) mean += slewOutputs[i];
        mean /= NUM_ML_OUTPUTS;
        outputs[OUTPUT_MEAN].setVoltage(mean * 10.f);

        // STD
        float variance = 0.f;
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            float d = slewOutputs[i] - mean;
            variance += d * d;
        }
        float stddev = std::sqrt(variance / NUM_ML_OUTPUTS);
        outputs[OUTPUT_STD].setVoltage(stddev * 10.f);

        // Delta (L2 norm of change)
        static float lastOutputs[NUM_ML_OUTPUTS] = {};
        float delta = 0.f;
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            float d = slewOutputs[i] - lastOutputs[i];
            delta += d * d;
            lastOutputs[i] = slewOutputs[i];
        }
        outputs[OUTPUT_DELTA].setVoltage(std::sqrt(delta) * 10.f);

        // Novelty + Confidence (placeholder — computed on training thread in Phase 7)
        outputs[OUTPUT_NOVELTY].setVoltage(10.f);    // default: everything is novel
        outputs[OUTPUT_CONFIDENCE].setVoltage(0.f);   // default: no confidence
    }

    // ── Serialization ─────────────────────────────────────────────────
    json_t* dataToJson() override {
        json_t* root = json_object();
        json_object_set_new(root, "noiseLevel", json_real(noiseLevel));
        json_object_set_new(root, "slewMs", json_real(slewMs));

        // Output ranges
        json_t* outRanges = json_array();
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            json_array_append_new(outRanges, json_boolean(outputRangeUnipolar[i]));
        }
        json_object_set_new(root, "outputRangeUnipolar", outRanges);

        // Input ranges
        json_t* inRanges = json_array();
        for (int i = 0; i < MAX_ML_INPUTS; i++) {
            json_array_append_new(inRanges, json_boolean(inputRangeUnipolar[i]));
        }
        json_object_set_new(root, "inputRangeUnipolar", inRanges);

        return root;
    }

    void dataFromJson(json_t* root) override {
        json_t* j;
        if ((j = json_object_get(root, "noiseLevel")))
            noiseLevel = json_real_value(j);
        if ((j = json_object_get(root, "slewMs")))
            slewMs = json_real_value(j);

        json_t* outRanges = json_object_get(root, "outputRangeUnipolar");
        if (outRanges) {
            for (int i = 0; i < NUM_ML_OUTPUTS && i < (int)json_array_size(outRanges); i++) {
                outputRangeUnipolar[i] = json_boolean_value(json_array_get(outRanges, i));
            }
        }

        json_t* inRanges = json_object_get(root, "inputRangeUnipolar");
        if (inRanges) {
            for (int i = 0; i < MAX_ML_INPUTS && i < (int)json_array_size(inRanges); i++) {
                inputRangeUnipolar[i] = json_boolean_value(json_array_get(inRanges, i));
            }
        }
    }
};

// ── NanoVG Bar Graph Display ──────────────────────────────────────────
struct MEMLNautDisplay : LedDisplay {
    MEMLNaut* module = nullptr;

    void drawLayer(const DrawArgs& args, int layer) override {
        if (layer != 1 || !module) return;

        nvgSave(args.vg);

        float w = box.size.x;
        float h = box.size.y;
        float barW = (w - 4.f) / NUM_ML_OUTPUTS;
        float margin = 2.f;

        // Background
        nvgBeginPath(args.vg);
        nvgRect(args.vg, 0, 0, w, h);
        nvgFillColor(args.vg, nvgRGB(0x10, 0x10, 0x18));
        nvgFill(args.vg);

        // Output bars
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            float val = module->slewOutputs[i];
            float barH = val * (h - 16.f);

            // Color: hue based on output index
            float hue = (float)i / NUM_ML_OUTPUTS;
            NVGcolor color = nvgHSLA(hue, 0.7f, 0.5f, 200);

            nvgBeginPath(args.vg);
            nvgRect(args.vg, margin + i * barW, h - 8.f - barH, barW - 1.f, barH);
            nvgFillColor(args.vg, color);
            nvgFill(args.vg);
        }

        // Status text
        nvgFontSize(args.vg, 8.f);
        nvgFillColor(args.vg, nvgRGB(0xa0, 0xa0, 0xa0));
        nvgTextAlign(args.vg, NVG_ALIGN_LEFT | NVG_ALIGN_TOP);

        char buf[64];
        snprintf(buf, sizeof(buf), "N:%.3f", module->noiseLevel);
        nvgText(args.vg, 2.f, 1.f, buf, nullptr);

        if (module->isTraining.load()) {
            nvgFillColor(args.vg, nvgRGB(0xff, 0xa0, 0x00));
            nvgText(args.vg, w - 24.f, 1.f, "TRAIN", nullptr);
        }

        nvgRestore(args.vg);
    }
};

// ── Widget ────────────────────────────────────────────────────────────
struct MEMLNautWidget : ModuleWidget {
    MEMLNautWidget(MEMLNaut* module) {
        setModule(module);
        setPanel(createPanel(asset::plugin(pluginInstance, "res/MEMLNaut.svg")));

        float col1 = 8.f;   // left column
        float col2 = 20.f;  // center-left
        float col3 = 32.f;  // center-right
        // float col4 = 44.f;  // right column (for wide panel)
        float y = 14.f;

        // ── Display ───────────────────────────────────────────────────
        MEMLNautDisplay* display = createWidget<MEMLNautDisplay>(mm2px(Vec(2.f, y)));
        display->box.size = mm2px(Vec(36.f, 18.f));
        display->module = module;
        addChild(display);
        y += 22.f;

        // ── SPREAD + RATE knobs ───────────────────────────────────────
        addParam(createParamCentered<RoundBlackKnob>(mm2px(Vec(col1, y)), module, MEMLNaut::PARAM_SPREAD));
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(col2, y)), module, MEMLNaut::INPUT_SPREAD_CV));
        addParam(createParamCentered<RoundBlackKnob>(mm2px(Vec(col3, y)), module, MEMLNaut::PARAM_RATE));
        y += 10.f;

        // ── Buttons row: + − LEARN RAND CLEAR ────────────────────────
        addParam(createParamCentered<VCVButton>(mm2px(Vec(col1 - 2.f, y)), module, MEMLNaut::PARAM_THUMBS_UP));
        addParam(createParamCentered<VCVButton>(mm2px(Vec(col1 + 6.f, y)), module, MEMLNaut::PARAM_THUMBS_DOWN));
        addParam(createParamCentered<CKSS>(mm2px(Vec(col2 + 2.f, y)), module, MEMLNaut::PARAM_LEARN));
        addChild(createLightCentered<SmallLight<GreenLight>>(mm2px(Vec(col2 + 2.f, y - 4.f)), module, MEMLNaut::LIGHT_LEARN));
        addParam(createParamCentered<VCVButton>(mm2px(Vec(col3, y)), module, MEMLNaut::PARAM_RAND));
        addParam(createParamCentered<VCVButton>(mm2px(Vec(col3 + 8.f, y)), module, MEMLNaut::PARAM_CLEAR));
        addChild(createLightCentered<SmallLight<YellowLight>>(mm2px(Vec(col3 + 8.f, y - 4.f)), module, MEMLNaut::LIGHT_TRAINING));
        y += 10.f;

        // ── Trigger / gate inputs ─────────────────────────────────────
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(col1, y)), module, MEMLNaut::INPUT_X));
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(col2, y)), module, MEMLNaut::INPUT_Y));
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(col3, y)), module, MEMLNaut::INPUT_LEARN_GATE));
        y += 8.f;
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(col1, y)), module, MEMLNaut::INPUT_TRIG_POS));
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(col2, y)), module, MEMLNaut::INPUT_TRIG_NEG));
        y += 10.f;

        // ── Outputs: 3 columns of 4, with attenuverter + LED + jack ──
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            int col = i % 3;
            int row = i / 3;
            float ox = 6.f + col * 13.f;
            float oy = y + row * 9.f;

            addParam(createParamCentered<Trimpot>(mm2px(Vec(ox, oy)), module, MEMLNaut::PARAM_ATTEN_1 + i));
            addChild(createLightCentered<SmallLight<WhiteLight>>(mm2px(Vec(ox + 4.5f, oy)), module, MEMLNaut::LIGHT_OUT_1 + i));
            addOutput(createOutputCentered<PJ301MPort>(mm2px(Vec(ox + 9.f, oy)), module, MEMLNaut::OUTPUT_1 + i));
        }
        y += 4 * 9.f + 2.f;

        // ── Derived outputs ───────────────────────────────────────────
        float dox = 4.f;
        addOutput(createOutputCentered<PJ301MPort>(mm2px(Vec(dox, y)), module, MEMLNaut::OUTPUT_MEAN));
        addOutput(createOutputCentered<PJ301MPort>(mm2px(Vec(dox + 8.f, y)), module, MEMLNaut::OUTPUT_STD));
        addOutput(createOutputCentered<PJ301MPort>(mm2px(Vec(dox + 16.f, y)), module, MEMLNaut::OUTPUT_DELTA));
        addOutput(createOutputCentered<PJ301MPort>(mm2px(Vec(dox + 24.f, y)), module, MEMLNaut::OUTPUT_NOVELTY));
        addOutput(createOutputCentered<PJ301MPort>(mm2px(Vec(dox + 32.f, y)), module, MEMLNaut::OUTPUT_CONFIDENCE));
    }

    void appendContextMenu(Menu* menu) override {
        MEMLNaut* module = dynamic_cast<MEMLNaut*>(this->module);
        if (!module) return;

        menu->addChild(new MenuSeparator);
        menu->addChild(createMenuLabel("Output ranges"));

        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            menu->addChild(createCheckMenuItem(
                string::f("Out %d: Bipolar (±5V)", i + 1), "",
                [=]() { return !module->outputRangeUnipolar[i]; },
                [=]() { module->outputRangeUnipolar[i] = !module->outputRangeUnipolar[i]; }
            ));
        }

        menu->addChild(new MenuSeparator);
        menu->addChild(createMenuLabel("Input ranges"));

        std::string inputNames[] = {"X", "Y"};
        for (int i = 0; i < NUM_ML_INPUTS; i++) {
            menu->addChild(createCheckMenuItem(
                string::f("Input %s: Bipolar (±5V)", inputNames[i].c_str()), "",
                [=]() { return !module->inputRangeUnipolar[i]; },
                [=]() { module->inputRangeUnipolar[i] = !module->inputRangeUnipolar[i]; }
            ));
        }

        menu->addChild(new MenuSeparator);
        menu->addChild(createMenuLabel("Slew"));

        menu->addChild(createSubmenuItem("Output slew", string::f("%.0f ms", module->slewMs), [=](Menu* childMenu) {
            for (float ms : {0.f, 5.f, 10.f, 20.f, 50.f, 100.f}) {
                childMenu->addChild(createCheckMenuItem(
                    string::f("%.0f ms", ms), "",
                    [=]() { return module->slewMs == ms; },
                    [=]() { module->slewMs = ms; }
                ));
            }
        }));
    }
};

Model* modelMEMLNaut = createModel<MEMLNaut, MEMLNautWidget>("MEMLNaut");
