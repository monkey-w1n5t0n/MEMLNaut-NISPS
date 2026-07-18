#include "plugin.hpp"
#include "osc_server.hpp"
#include "iml.hpp"
#include "palette.hpp"
#include "LedRing.hpp"
#include <osdialog.h>
#include <thread>
#include <atomic>
#include <mutex>
#include <condition_variable>
#include <functional>
#include <fstream>
#include <cmath>

// ── I/O contract (SPEC BUILD DELTAS 2026-06-28): 8 inputs × 16 outputs ──
static constexpr int NUM_ML_INPUTS = 8;
static constexpr int NUM_ML_OUTPUTS = 16;
static constexpr int MAX_ML_INPUTS = 8;

// OSC: a fixed default UDP listen port + a per-instance offset so multiple
// module instances in one patch don't collide. The Deno bridge maps
// ws://localhost:8765 ↔ this UDP port.
static constexpr int OSC_DEFAULT_PORT = 7001;

// ── Background job types ──────────────────────────────────────────────
enum class JobType { Train, Perturb, Randomize, Clear };
struct Job {
    JobType type;
    float noiseLevel;
    float spread;
};

// ── Staged remote feedback op (from the OSC bridge) ───────────────────
enum class FeedbackOp { None, Up, Down, Rand, Clear };
struct StagedFeedback {
    FeedbackOp op = FeedbackOp::None;
    float spread = 0.6f;
    bool hasInput = false;
    bool hasOutput = false;
    float input[MAX_ML_INPUTS] = {};
    float output[NUM_ML_OUTPUTS] = {};
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
        PARAM_ATTEN_1, // 16 attenuverters (kept in the model for range scaling)
        PARAM_ATTEN_LAST = PARAM_ATTEN_1 + NUM_ML_OUTPUTS - 1,
        PARAMS_LEN
    };
    enum InputId {
        INPUT_1, // 8 model-input CV jacks
        INPUT_LAST = INPUT_1 + NUM_ML_INPUTS - 1,
        INPUT_SPREAD_CV,
        INPUT_LEARN_GATE,
        INPUT_TRIG_POS,
        INPUT_TRIG_NEG,
        INPUTS_LEN
    };
    enum OutputId {
        OUTPUT_1, // 16 inference-output CV jacks
        OUTPUT_LAST = OUTPUT_1 + NUM_ML_OUTPUTS - 1,
        OUTPUTS_LEN
    };
    enum LightId {
        LIGHT_LEARN,
        LIGHT_TRAINING,
        LIGHTS_LEN
    };

    // ── ML Engine (double-buffered) ─────────────────────────────────
    // THREADING INVARIANT: only the audio thread touches `iml`; the worker
    // thread operates exclusively on `imlShadow`. Hand-off is through atomic-
    // flagged staging buffers (see startOsc + workerLoop).
    nisps::IML<float> iml{NUM_ML_INPUTS, NUM_ML_OUTPUTS, {16, 24, 16}};
    nisps::IML<float> imlShadow{NUM_ML_INPUTS, NUM_ML_OUTPUTS, {16, 24, 16}};

    // Worker → Audio: staged weights ready for swap (core-exact flat layout)
    nisps::IML<float>::Weights pendingWeights;
    std::atomic<bool> weightsPending{false};

    // Audio → Worker: staged weight snapshot for the worker to start from
    nisps::IML<float>::Weights stagedWeightsForWorker;
    std::vector<std::vector<float>> stagedFeatures;
    std::vector<std::vector<float>> stagedLabels;
    std::mutex stagingMutex;

    // ── State ─────────────────────────────────────────────────────────
    std::atomic<float> noiseLevel{0.1f};
    float cachedOutputs[NUM_ML_OUTPUTS] = {};
    float prevOutputs[NUM_ML_OUTPUTS] = {};
    float slewOutputs[NUM_ML_OUTPUTS] = {};
    float lastOutputsForDelta[NUM_ML_OUTPUTS] = {};
    float crossfadeProgress = 1.f;
    float slewMs = 10.f;
    int sampleCounter = 0;
    bool outputRangeUnipolar[NUM_ML_OUTPUTS] = {};
    bool inputRangeUnipolar[MAX_ML_INPUTS] = {};
    float clearHoldTime = 0.f;
    std::atomic<float> cachedNovelty{10.f};
    std::atomic<float> cachedConfidence{0.f};
    float lastInputs[MAX_ML_INPUTS] = {};

    // Derived outputs (Mean/Std/Delta/Novelty/Confidence) are OFF the main
    // panel per SPEC delta #6 — kept as a context-menu computation toggle for
    // future expander use. When disabled (default) they cost nothing.
    bool computeDerived = false;
    float derivedMean = 0.f, derivedStd = 0.f, derivedDelta = 0.f;

    // Bridged mode: when the browser streams /nisps/input, drive the model from
    // those values instead of the physical CV jacks until the bridge goes quiet.
    std::atomic<bool> bridgeDriveInputs{false};
    float bridgedInputs[MAX_ML_INPUTS] = {};
    std::mutex bridgedInputMutex;

    // OSC → Audio: staged JSON (state/weights) + staged feedback op
    std::string oscStagedJson;
    std::atomic<bool> oscJsonPending{false};
    StagedFeedback stagedFeedback;
    std::atomic<bool> feedbackPending{false};
    std::mutex feedbackMutex;

    // ── OSC bridge ────────────────────────────────────────────────────
    std::unique_ptr<memlnaut::OscServer> oscServer;
    bool oscEnabled = false;
    int oscPort = OSC_DEFAULT_PORT;
    int oscSendCounter = 0;
    static constexpr int OSC_SEND_INTERVAL_SAMPLES = 4410; // ~100ms at 44.1kHz
    std::atomic<bool> stateDirty{false}; // set after a weight swap → push /nisps/state

    void startOsc() {
        if (oscServer && oscServer->isRunning()) return;
        oscServer = std::make_unique<memlnaut::OscServer>();

        // Full state / weights JSON → stage for the audio thread to apply.
        oscServer->onState([this](const std::string& json) {
            if (!oscJsonPending.load()) { oscStagedJson = json; oscJsonPending.store(true); }
        });
        oscServer->onWeights([this](const std::string& json) {
            if (!oscJsonPending.load()) { oscStagedJson = json; oscJsonPending.store(true); }
        });

        // Live input vector from the browser → drive the model inputs.
        oscServer->onInput([this](const std::vector<float>& values) {
            {
                std::lock_guard<std::mutex> lock(bridgedInputMutex);
                for (int i = 0; i < NUM_ML_INPUTS && i < (int)values.size(); i++)
                    bridgedInputs[i] = clamp(values[i], 0.f, 1.f);
            }
            bridgeDriveInputs.store(true);
        });

        // Verdict op from the browser → stage for the audio thread, which routes
        // it through the SAME enqueueJob/add_example path the panel buttons use.
        oscServer->onFeedback([this](const std::string& json) {
            StagedFeedback fb = parseFeedback(json);
            if (fb.op == FeedbackOp::None) return;
            {
                std::lock_guard<std::mutex> lock(feedbackMutex);
                stagedFeedback = fb;
            }
            feedbackPending.store(true);
        });

        if (!oscServer->start(oscPort)) {
            oscServer.reset();
            oscEnabled = false;
        } else {
            oscEnabled = true;
        }
    }

    void stopOsc() {
        if (oscServer) { oscServer->stop(); oscServer.reset(); }
        oscEnabled = false;
        bridgeDriveInputs.store(false);
    }

    // Minimal JSON-ish parse of the feedback op (avoids pulling jansson into the
    // OSC recv thread). Reads "op", "spread", and optional "input"/"output".
    static StagedFeedback parseFeedback(const std::string& s) {
        StagedFeedback fb;
        auto findStr = [&](const char* key) -> std::string {
            std::string k = std::string("\"") + key + "\"";
            size_t p = s.find(k);
            if (p == std::string::npos) return "";
            p = s.find(':', p);
            if (p == std::string::npos) return "";
            size_t q = s.find('"', p);
            if (q == std::string::npos) return "";
            size_t r = s.find('"', q + 1);
            if (r == std::string::npos) return "";
            return s.substr(q + 1, r - q - 1);
        };
        auto findNum = [&](const char* key, float def) -> float {
            std::string k = std::string("\"") + key + "\"";
            size_t p = s.find(k);
            if (p == std::string::npos) return def;
            p = s.find(':', p);
            if (p == std::string::npos) return def;
            return (float)atof(s.c_str() + p + 1);
        };
        auto findArr = [&](const char* key, float* out, int maxN) -> int {
            std::string k = std::string("\"") + key + "\"";
            size_t p = s.find(k);
            if (p == std::string::npos) return 0;
            p = s.find('[', p);
            if (p == std::string::npos) return 0;
            size_t e = s.find(']', p);
            if (e == std::string::npos) return 0;
            int n = 0; size_t cur = p + 1;
            while (cur < e && n < maxN) {
                while (cur < e && (s[cur] == ' ' || s[cur] == ',')) cur++;
                if (cur >= e) break;
                out[n++] = (float)atof(s.c_str() + cur);
                size_t nx = s.find(',', cur);
                if (nx == std::string::npos || nx > e) break;
                cur = nx + 1;
            }
            return n;
        };

        std::string op = findStr("op");
        if (op == "up") fb.op = FeedbackOp::Up;
        else if (op == "down") fb.op = FeedbackOp::Down;
        else if (op == "rand") fb.op = FeedbackOp::Rand;
        else if (op == "clear") fb.op = FeedbackOp::Clear;
        else fb.op = FeedbackOp::None;
        fb.spread = clamp(findNum("spread", 0.6f), 0.f, 1.f);
        fb.hasInput = findArr("input", fb.input, MAX_ML_INPUTS) > 0;
        fb.hasOutput = findArr("output", fb.output, NUM_ML_OUTPUTS) > 0;
        return fb;
    }

    // Build a compact JSON state snapshot (for module → browser sync).
    std::string buildStateJson() {
        json_t* root = dataToJson();
        char* str = json_dumps(root, JSON_COMPACT);
        json_decref(root);
        std::string out = str ? str : "{}";
        free(str);
        return out;
    }

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
    std::atomic<bool> isTraining{false};
    Job currentJob{};
    Job pendingJob{};
    bool hasJob = false;
    bool hasPending = false;

    MEMLNaut() {
        config(PARAMS_LEN, INPUTS_LEN, OUTPUTS_LEN, LIGHTS_LEN);

        configParam(PARAM_SPREAD, 0.f, 1.f, 0.6f, "Spread", "%", 0.f, 100.f);
        configParam(PARAM_RATE, 0.f, 1.f, 0.5f, "Inference rate");

        configButton(PARAM_RAND, "Randomise weights");
        configButton(PARAM_THUMBS_UP, "Thumbs up (+)");
        configButton(PARAM_THUMBS_DOWN, "Thumbs down (−)");
        configSwitch(PARAM_LEARN, 0.f, 1.f, 0.f, "Learn enable", {"Off", "On"});
        configButton(PARAM_CLEAR, "Clear (long-press)");

        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            configParam(PARAM_ATTEN_1 + i, -1.f, 1.f, 1.f,
                        string::f("Out %d attenuverter", i + 1), "%", 0.f, 100.f);
        }

        for (int i = 0; i < NUM_ML_INPUTS; i++)
            configInput(INPUT_1 + i, string::f("In %d", i + 1));
        configInput(INPUT_SPREAD_CV, "Spread CV");
        configInput(INPUT_LEARN_GATE, "Learn gate");
        configInput(INPUT_TRIG_POS, "+ trigger");
        configInput(INPUT_TRIG_NEG, "− trigger");

        for (int i = 0; i < NUM_ML_OUTPUTS; i++)
            configOutput(OUTPUT_1 + i, string::f("Out %d", i + 1));

        for (int i = 0; i < NUM_ML_OUTPUTS; i++) outputRangeUnipolar[i] = true;
        for (int i = 0; i < MAX_ML_INPUTS; i++) inputRangeUnipolar[i] = true;

        // Per-instance OSC port offset (avoids collisions across instances).
        oscPort = OSC_DEFAULT_PORT + (int)(id % 64);

        iml.set_mode(nisps::IML<float>::Mode::Training);
        iml.randomise_weights(0.6f);
        iml.set_mode(nisps::IML<float>::Mode::Inference);

        workerThread = std::thread(&MEMLNaut::workerLoop, this);
    }

    ~MEMLNaut() {
        stopOsc();
        shouldStop.store(true);
        jobCv.notify_one();
        if (workerThread.joinable()) workerThread.join();
    }

    // Read by the LED-ring widget (per-output 0..1 value).
    float ringValue(int i) const {
        if (i < 0 || i >= NUM_ML_OUTPUTS) return 0.f;
        return slewOutputs[i];
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

            {
                std::lock_guard<std::mutex> lock(stagingMutex);
                imlShadow.set_weights(stagedWeightsForWorker);
                imlShadow.load_examples(stagedFeatures, stagedLabels);
            }

            if (job.type == JobType::Train) {
                imlShadow.set_mode(nisps::IML<float>::Mode::Training);
                imlShadow.set_mode(nisps::IML<float>::Mode::Inference); // triggers train_()
            } else if (job.type == JobType::Perturb) {
                imlShadow.move_weights(job.noiseLevel, job.spread);
            } else if (job.type == JobType::Randomize) {
                imlShadow.set_mode(nisps::IML<float>::Mode::Training);
                imlShadow.randomise_weights(job.spread);
                imlShadow.set_mode(nisps::IML<float>::Mode::Inference);
            } else if (job.type == JobType::Clear) {
                imlShadow.set_mode(nisps::IML<float>::Mode::Training);
                imlShadow.clear_dataset();
                imlShadow.randomise_weights(job.spread);
                imlShadow.set_mode(nisps::IML<float>::Mode::Inference);
                noiseLevel.store(0.1f);
            }

            while (weightsPending.load() && !shouldStop.load())
                std::this_thread::sleep_for(std::chrono::microseconds(100));
            if (shouldStop.load()) break;

            pendingWeights = imlShadow.get_weights();
            weightsPending.store(true);

            if (imlShadow.get_example_count() > 0) {
                float inputs[MAX_ML_INPUTS];
                for (int i = 0; i < NUM_ML_INPUTS; i++) inputs[i] = lastInputs[i];
                float dist = imlShadow.nearest_example_distance(inputs, NUM_ML_INPUTS);
                cachedNovelty.store(std::min(dist * 10.f, 10.f));
                cachedConfidence.store(std::max(0.f, 10.f - dist * 10.f));
            } else {
                cachedNovelty.store(10.f);
                cachedConfidence.store(0.f);
            }

            isTraining.store(false);

            {
                std::unique_lock<std::mutex> lock(jobMutex);
                if (hasPending) {
                    currentJob = pendingJob;
                    hasPending = false;
                    hasJob = true;
                }
            }
        }
    }

    void enqueueJob(JobType type, float noise = 0.f, float spread = 0.f) {
        std::unique_lock<std::mutex> lock(jobMutex);
        if (hasJob || isTraining.load()) {
            pendingJob = {type, noise, spread};
            hasPending = true;
        } else {
            currentJob = {type, noise, spread};
            hasJob = true;
            jobCv.notify_one();
        }
    }

    float getSpread() {
        float spread = params[PARAM_SPREAD].getValue();
        if (inputs[INPUT_SPREAD_CV].isConnected())
            spread += inputs[INPUT_SPREAD_CV].getVoltage() / 10.f;
        return clamp(spread, 0.f, 1.f);
    }

    bool isLearnEnabled() {
        bool toggle = params[PARAM_LEARN].getValue() > 0.5f;
        bool gate = inputs[INPUT_LEARN_GATE].isConnected() &&
                    inputs[INPUT_LEARN_GATE].getVoltage() > 1.f;
        return toggle || gate;
    }

    // Normalise a model-input CV jack to [0,1]. When the bridge is driving
    // inputs, that value wins.
    float modelInput(int idx) {
        if (bridgeDriveInputs.load()) {
            std::lock_guard<std::mutex> lock(bridgedInputMutex);
            return clamp(bridgedInputs[idx], 0.f, 1.f);
        }
        float v = inputs[INPUT_1 + idx].getVoltage();
        if (inputRangeUnipolar[idx]) return clamp(v / 10.f, 0.f, 1.f);
        return clamp((v + 5.f) / 10.f, 0.f, 1.f);
    }

    float outputToVoltage(float val01, int outIdx) {
        float atten = params[PARAM_ATTEN_1 + outIdx].getValue();
        if (outputRangeUnipolar[outIdx]) return val01 * 10.f * atten;
        return (val01 - 0.5f) * 10.f * atten;
    }

    // Stage the current iml state for the worker thread.
    void stageForWorker() {
        std::lock_guard<std::mutex> lock(stagingMutex);
        stagedWeightsForWorker = iml.get_weights();
        stagedFeatures = iml.get_example_features();
        stagedLabels = iml.get_example_labels();
    }

    // Add the current (input,output) pair as an example + enqueue training.
    void doThumbsUp(float spread) {
        const float* curOuts = iml.get_outputs();
        float curInputs[MAX_ML_INPUTS];
        for (int i = 0; i < NUM_ML_INPUTS; i++) curInputs[i] = modelInput(i);
        iml.set_mode(nisps::IML<float>::Mode::Training);
        iml.add_example(curInputs, NUM_ML_INPUTS, curOuts, NUM_ML_OUTPUTS);
        iml.set_mode(nisps::IML<float>::Mode::Inference);
        stageForWorker();
        enqueueJob(JobType::Train);
        noiseLevel.store(noiseLevel.load() * 0.97f);
        (void)spread;
    }

    void doThumbsDown(float spread) {
        float noiseCap = 0.3f * (1.f - spread) + 0.05f * spread;
        float nl = std::min(noiseLevel.load() * 1.5f, noiseCap);
        noiseLevel.store(nl);
        stageForWorker();
        enqueueJob(JobType::Perturb, nl, spread);
    }

    // ── Process ───────────────────────────────────────────────────────
    void process(const ProcessArgs& args) override {
        float spread = getSpread();
        bool learn = isLearnEnabled();

        lights[LIGHT_LEARN].setBrightness(learn ? 1.f : 0.f);
        lights[LIGHT_TRAINING].setBrightness(isTraining.load() ? 1.f : 0.f);

        // Apply staged OSC state/weights JSON.
        if (oscJsonPending.load()) {
            json_error_t error;
            json_t* root = json_loads(oscStagedJson.c_str(), 0, &error);
            if (root) { dataFromJson(root); json_decref(root); }
            oscJsonPending.store(false);
        }

        // Apply staged remote feedback (browser verdict over the bridge) — routes
        // through the same paths as the panel buttons.
        if (feedbackPending.load()) {
            StagedFeedback fb;
            { std::lock_guard<std::mutex> lock(feedbackMutex); fb = stagedFeedback; }
            feedbackPending.store(false);
            float fbSpread = fb.spread;
            if (fb.op == FeedbackOp::Up) {
                if (fb.hasInput && fb.hasOutput) {
                    iml.set_mode(nisps::IML<float>::Mode::Training);
                    iml.add_example(fb.input, NUM_ML_INPUTS, fb.output, NUM_ML_OUTPUTS);
                    iml.set_mode(nisps::IML<float>::Mode::Inference);
                    stageForWorker();
                    enqueueJob(JobType::Train);
                    noiseLevel.store(noiseLevel.load() * 0.97f);
                } else {
                    doThumbsUp(fbSpread);
                }
            } else if (fb.op == FeedbackOp::Down) {
                doThumbsDown(fbSpread);
            } else if (fb.op == FeedbackOp::Rand) {
                stageForWorker();
                enqueueJob(JobType::Randomize, 0.f, fbSpread);
            } else if (fb.op == FeedbackOp::Clear) {
                stageForWorker();
                enqueueJob(JobType::Clear, 0.f, fbSpread);
            }
        }

        // Apply new weights from the background thread.
        if (weightsPending.load()) {
            iml.set_weights(pendingWeights);
            weightsPending.store(false);
            auto newFeats = imlShadow.get_example_features();
            auto newLabels = imlShadow.get_example_labels();
            iml.load_examples(newFeats, newLabels);
            for (int i = 0; i < NUM_ML_OUTPUTS; i++) prevOutputs[i] = cachedOutputs[i];
            crossfadeProgress = 0.f;
            stateDirty.store(true); // push fresh /nisps/state to the browser
        }

        // RAND button → enqueue Randomize.
        if (randTrigger.process(params[PARAM_RAND].getValue() > 0.f)) {
            stageForWorker();
            enqueueJob(JobType::Randomize, 0.f, spread);
        }

        // CLEAR long-press (~1s) → enqueue Clear.
        if (params[PARAM_CLEAR].getValue() > 0.f) {
            clearHoldTime += args.sampleTime;
            if (clearHoldTime >= 1.f) {
                stageForWorker();
                enqueueJob(JobType::Clear, 0.f, spread);
                clearHoldTime = 0.f;
            }
        } else {
            clearHoldTime = 0.f;
        }

        // RL feedback from the panel (only when learning).
        if (learn) {
            bool thumbsUp = thumbsUpTrigger.process(params[PARAM_THUMBS_UP].getValue() > 0.f);
            bool trigPos = trigPosTrigger.process(inputs[INPUT_TRIG_POS].getVoltage());
            if (thumbsUp || trigPos) doThumbsUp(spread);

            bool thumbsDown = thumbsDownTrigger.process(params[PARAM_THUMBS_DOWN].getValue() > 0.f);
            bool trigNeg = trigNegTrigger.process(inputs[INPUT_TRIG_NEG].getVoltage());
            if (thumbsDown || trigNeg) doThumbsDown(spread);
        }

        // Inference-rate decimation: 256 samples (block rate) → 1 (audio rate).
        float rate = params[PARAM_RATE].getValue();
        int period = std::max(1, (int)(256.f * std::pow(1.f / 256.f, rate)));
        sampleCounter++;

        bool runInference = (sampleCounter >= period);
        if (runInference) {
            sampleCounter = 0;
            for (int i = 0; i < NUM_ML_INPUTS; i++) {
                float v = modelInput(i);
                lastInputs[i] = v;
                iml.set_input(i, v);
            }
            iml.process();
            const float* outs = iml.get_outputs();
            for (int i = 0; i < NUM_ML_OUTPUTS; i++) cachedOutputs[i] = outs[i];
        }

        // Crossfade after a weight swap.
        float effectiveOutputs[NUM_ML_OUTPUTS];
        if (crossfadeProgress < 1.f) {
            float slewSamples = std::max(1.f, slewMs * 0.001f * args.sampleRate);
            crossfadeProgress += 1.f / slewSamples;
            if (crossfadeProgress > 1.f) crossfadeProgress = 1.f;
            for (int i = 0; i < NUM_ML_OUTPUTS; i++)
                effectiveOutputs[i] = prevOutputs[i] + crossfadeProgress * (cachedOutputs[i] - prevOutputs[i]);
        } else {
            for (int i = 0; i < NUM_ML_OUTPUTS; i++) effectiveOutputs[i] = cachedOutputs[i];
        }

        // Interpolate between inference steps (slew).
        if (!runInference && period > 1) {
            float alpha = (float)sampleCounter / (float)period;
            for (int i = 0; i < NUM_ML_OUTPUTS; i++)
                slewOutputs[i] += alpha * (effectiveOutputs[i] - slewOutputs[i]);
        } else {
            for (int i = 0; i < NUM_ML_OUTPUTS; i++) slewOutputs[i] = effectiveOutputs[i];
        }

        // Write the 16 outputs (with attenuverters).
        for (int i = 0; i < NUM_ML_OUTPUTS; i++)
            outputs[OUTPUT_1 + i].setVoltage(outputToVoltage(slewOutputs[i], i));

        // Derived stats — computed only when the context-menu toggle is on.
        if (computeDerived) {
            float mean = 0.f;
            for (int i = 0; i < NUM_ML_OUTPUTS; i++) mean += slewOutputs[i];
            mean /= NUM_ML_OUTPUTS;
            float variance = 0.f, delta = 0.f;
            for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
                float d = slewOutputs[i] - mean; variance += d * d;
                float dd = slewOutputs[i] - lastOutputsForDelta[i];
                delta += dd * dd; lastOutputsForDelta[i] = slewOutputs[i];
            }
            derivedMean = mean;
            derivedStd = std::sqrt(variance / NUM_ML_OUTPUTS);
            derivedDelta = std::sqrt(delta);
        }

        // OSC send (throttled to ~100ms), plus an immediate state push when dirty.
        if (oscServer && oscServer->isRunning()) {
            if (stateDirty.exchange(false)) {
                oscServer->sendState(buildStateJson());
            }
            oscSendCounter++;
            if (oscSendCounter >= OSC_SEND_INTERVAL_SAMPLES) {
                oscSendCounter = 0;
                oscServer->sendOutputs(slewOutputs, NUM_ML_OUTPUTS);
                oscServer->sendInputs(lastInputs, NUM_ML_INPUTS);
            }
        }
    }

    // ── Serialization ─────────────────────────────────────────────────
    json_t* dataToJson() override {
        json_t* root = json_object();
        json_object_set_new(root, "version", json_integer(3));
        json_object_set_new(root, "inputCount", json_integer(NUM_ML_INPUTS));
        json_object_set_new(root, "outputCount", json_integer(NUM_ML_OUTPUTS));
        json_object_set_new(root, "noiseLevel", json_real(noiseLevel));
        json_object_set_new(root, "slewMs", json_real(slewMs));
        json_object_set_new(root, "computeDerived", json_boolean(computeDerived));
        json_object_set_new(root, "oscEnabled", json_boolean(oscEnabled));
        json_object_set_new(root, "oscPort", json_integer(oscPort));

        json_t* outRanges = json_array();
        for (int i = 0; i < NUM_ML_OUTPUTS; i++)
            json_array_append_new(outRanges, json_boolean(outputRangeUnipolar[i]));
        json_object_set_new(root, "outputRangeUnipolar", outRanges);

        json_t* inRanges = json_array();
        for (int i = 0; i < MAX_ML_INPUTS; i++)
            json_array_append_new(inRanges, json_boolean(inputRangeUnipolar[i]));
        json_object_set_new(root, "inputRangeUnipolar", inRanges);

        // Core-exact FLAT weight vector: [layer0_w … layer3_w][layer0_b … layer3_b].
        auto weights = iml.get_weights();
        json_t* jWeights = json_array();
        for (float w : weights) json_array_append_new(jWeights, json_real(w));
        json_object_set_new(root, "weights", jWeights);

        auto features = iml.get_example_features();
        auto labels = iml.get_example_labels();
        json_t* jExamples = json_object();
        json_t* jFeatures = json_array();
        for (auto& f : features) {
            json_t* jF = json_array();
            for (float v : f) json_array_append_new(jF, json_real(v));
            json_array_append_new(jFeatures, jF);
        }
        json_t* jLabels = json_array();
        for (auto& l : labels) {
            json_t* jL = json_array();
            for (float v : l) json_array_append_new(jL, json_real(v));
            json_array_append_new(jLabels, jL);
        }
        json_object_set_new(jExamples, "features", jFeatures);
        json_object_set_new(jExamples, "labels", jLabels);
        json_object_set_new(root, "examples", jExamples);

        // Core topology: explicit biases (no trailing bias node), so the layer
        // node counts are [n_in, 16, 24, 16, n_out].
        json_t* jConfig = json_object();
        json_t* jLayers = json_array();
        json_array_append_new(jLayers, json_integer(NUM_ML_INPUTS));
        for (int h : {16, 24, 16}) json_array_append_new(jLayers, json_integer(h));
        json_array_append_new(jLayers, json_integer(NUM_ML_OUTPUTS));
        json_object_set_new(jConfig, "layers", jLayers);
        json_object_set_new(root, "mlpConfig", jConfig);

        return root;
    }

    void dataFromJson(json_t* root) override {
        json_t* j;
        if ((j = json_object_get(root, "noiseLevel"))) noiseLevel = json_real_value(j);
        if ((j = json_object_get(root, "slewMs"))) slewMs = json_real_value(j);
        if ((j = json_object_get(root, "computeDerived"))) computeDerived = json_boolean_value(j);

        if ((j = json_object_get(root, "oscPort"))) oscPort = json_integer_value(j);
        if ((j = json_object_get(root, "oscEnabled"))) {
            if (json_boolean_value(j)) startOsc(); else stopOsc();
        }

        json_t* outRanges = json_object_get(root, "outputRangeUnipolar");
        if (outRanges)
            for (int i = 0; i < NUM_ML_OUTPUTS && i < (int)json_array_size(outRanges); i++)
                outputRangeUnipolar[i] = json_boolean_value(json_array_get(outRanges, i));

        json_t* inRanges = json_object_get(root, "inputRangeUnipolar");
        if (inRanges)
            for (int i = 0; i < MAX_ML_INPUTS && i < (int)json_array_size(inRanges); i++)
                inputRangeUnipolar[i] = json_boolean_value(json_array_get(inRanges, i));

        // Core-exact FLAT weight vector (patch version ≥ 3). Old 3D weight
        // blobs from the vendored model are a different shape and are ignored
        // by set_weights (size guard) — see iml.hpp header.
        json_t* jWeights = json_object_get(root, "weights");
        if (jWeights && json_is_array(jWeights)) {
            nisps::IML<float>::Weights weights;
            weights.reserve(json_array_size(jWeights));
            for (size_t wi = 0; wi < json_array_size(jWeights); wi++)
                weights.push_back(json_real_value(json_array_get(jWeights, wi)));
            iml.set_weights(weights);
        }

        json_t* jExamples = json_object_get(root, "examples");
        if (jExamples) {
            json_t* jFeatures = json_object_get(jExamples, "features");
            json_t* jLabels = json_object_get(jExamples, "labels");
            if (jFeatures && jLabels) {
                std::vector<std::vector<float>> features, labels;
                for (size_t i = 0; i < json_array_size(jFeatures); i++) {
                    json_t* jF = json_array_get(jFeatures, i);
                    std::vector<float> f;
                    for (size_t fi = 0; fi < json_array_size(jF); fi++)
                        f.push_back(json_real_value(json_array_get(jF, fi)));
                    features.push_back(f);
                }
                for (size_t i = 0; i < json_array_size(jLabels); i++) {
                    json_t* jL = json_array_get(jLabels, i);
                    std::vector<float> l;
                    for (size_t li = 0; li < json_array_size(jL); li++)
                        l.push_back(json_real_value(json_array_get(jL, li)));
                    labels.push_back(l);
                }
                iml.load_examples(features, labels);
            }
        }
    }
};

// ── NanoVG Bar Graph Display (16 bars) ────────────────────────────────
struct MEMLNautDisplay : LedDisplay {
    MEMLNaut* module = nullptr;

    void drawLayer(const DrawArgs& args, int layer) override {
        if (layer != 1 || !module) return;
        nvgSave(args.vg);

        float w = box.size.x;
        float h = box.size.y;
        float margin = 2.f;
        float barW = (w - 4.f) / NUM_ML_OUTPUTS;

        nvgBeginPath(args.vg);
        nvgRect(args.vg, 0, 0, w, h);
        nvgFillColor(args.vg, nvgRGB(0x0d, 0x0d, 0x0d)); // --bg
        nvgFill(args.vg);

        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            float val = module->slewOutputs[i];
            float barH = clamp(val, 0.f, 1.f) * (h - 16.f);
            NVGcolor color = memlnaut::palette::ring(i);
            nvgBeginPath(args.vg);
            nvgRect(args.vg, margin + i * barW, h - 8.f - barH, barW - 1.f, barH);
            nvgFillColor(args.vg, color);
            nvgFill(args.vg);
        }

        nvgFontSize(args.vg, 8.f);
        nvgFillColor(args.vg, nvgRGB(0x9a, 0x9a, 0x9a)); // --fg-mute
        nvgTextAlign(args.vg, NVG_ALIGN_LEFT | NVG_ALIGN_TOP);
        char buf[64];
        snprintf(buf, sizeof(buf), "N:%.3f  %d/%d", module->noiseLevel.load(),
                 (int)module->iml.get_example_count(), (int)module->iml.get_max_examples());
        nvgText(args.vg, 2.f, 1.f, buf, nullptr);

        if (module->isTraining.load()) {
            nvgFillColor(args.vg, memlnaut::palette::accent());
            nvgText(args.vg, w - 28.f, 1.f, "TRAIN", nullptr);
        }
        if (module->bridgeDriveInputs.load()) {
            nvgFillColor(args.vg, memlnaut::palette::accent2());
            nvgText(args.vg, w - 60.f, 1.f, "BRIDGE", nullptr);
        }

        nvgRestore(args.vg);
    }
};

// ── Widget ────────────────────────────────────────────────────────────
struct MEMLNautWidget : ModuleWidget {
    MEMLNautWidget(MEMLNaut* module) {
        setModule(module);
        setPanel(createPanel(asset::plugin(pluginInstance, "res/MEMLNaut-wide.svg")));

        float y = 13.f;

        // Display.
        MEMLNautDisplay* display = createWidget<MEMLNautDisplay>(mm2px(Vec(4.f, y)));
        display->box.size = mm2px(Vec(58.f, 16.f));
        display->module = module;
        addChild(display);
        y += 20.f;

        // SPREAD + RATE + Spread CV.
        addParam(createParamCentered<RoundBlackKnob>(mm2px(Vec(10.f, y)), module, MEMLNaut::PARAM_SPREAD));
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(22.f, y)), module, MEMLNaut::INPUT_SPREAD_CV));
        addParam(createParamCentered<RoundBlackKnob>(mm2px(Vec(34.f, y)), module, MEMLNaut::PARAM_RATE));
        // Buttons: + − LEARN RAND CLEAR.
        addParam(createParamCentered<VCVButton>(mm2px(Vec(46.f, y)), module, MEMLNaut::PARAM_THUMBS_UP));
        addParam(createParamCentered<VCVButton>(mm2px(Vec(52.f, y)), module, MEMLNaut::PARAM_THUMBS_DOWN));
        addParam(createParamCentered<CKSS>(mm2px(Vec(58.f, y)), module, MEMLNaut::PARAM_LEARN));
        addChild(createLightCentered<SmallLight<GreenLight>>(mm2px(Vec(58.f, y - 5.f)), module, MEMLNaut::LIGHT_LEARN));
        y += 9.f;
        addParam(createParamCentered<VCVButton>(mm2px(Vec(46.f, y)), module, MEMLNaut::PARAM_RAND));
        addParam(createParamCentered<VCVButton>(mm2px(Vec(52.f, y)), module, MEMLNaut::PARAM_CLEAR));
        addChild(createLightCentered<SmallLight<YellowLight>>(mm2px(Vec(58.f, y)), module, MEMLNaut::LIGHT_TRAINING));

        // 8 input jacks (2 rows × 4).
        float iy = 27.f;
        for (int i = 0; i < NUM_ML_INPUTS; i++) {
            int col = i % 4;
            int row = i / 4;
            float ix = 8.f + col * 10.f;
            addInput(createInputCentered<PJ301MPort>(mm2px(Vec(ix, iy + row * 9.f)), module, MEMLNaut::INPUT_1 + i));
        }
        // Control inputs to the right of the input block.
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(50.f, iy)), module, MEMLNaut::INPUT_LEARN_GATE));
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(58.f, iy)), module, MEMLNaut::INPUT_TRIG_POS));
        addInput(createInputCentered<PJ301MPort>(mm2px(Vec(58.f, iy + 9.f)), module, MEMLNaut::INPUT_TRIG_NEG));

        // 16 output jacks (4 rows × 4), each encircled by an LED ring.
        float oyTop = 52.f;
        for (int i = 0; i < NUM_ML_OUTPUTS; i++) {
            int col = i % 4;
            int row = i / 4;
            float ox = 9.f + col * 16.f;
            float oy = oyTop + row * 16.f;

            // LED ring (behind the jack).
            auto* ring = new LedRingWidget<MEMLNaut>();
            ring->module = module;
            ring->outIdx = i;
            ring->ringColor = memlnaut::palette::ring(i);
            ring->box.pos = mm2px(Vec(ox, oy)).minus(ring->box.size.div(2.f));
            addChild(ring);

            addOutput(createOutputCentered<PJ301MPort>(mm2px(Vec(ox, oy)), module, MEMLNaut::OUTPUT_1 + i));
        }
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
        for (int i = 0; i < NUM_ML_INPUTS; i++) {
            menu->addChild(createCheckMenuItem(
                string::f("In %d: Bipolar (±5V)", i + 1), "",
                [=]() { return !module->inputRangeUnipolar[i]; },
                [=]() { module->inputRangeUnipolar[i] = !module->inputRangeUnipolar[i]; }
            ));
        }

        menu->addChild(new MenuSeparator);
        menu->addChild(createCheckMenuItem(
            "Compute derived stats (Mean/Std/Delta)", "",
            [=]() { return module->computeDerived; },
            [=]() { module->computeDerived = !module->computeDerived; }
        ));

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

        menu->addChild(new MenuSeparator);
        menu->addChild(createMenuLabel("Presets (.nisps)"));
        menu->addChild(createMenuItem("Save .nisps preset...", "", [=]() {
            osdialog_filters* filters = osdialog_filters_parse("NISPS preset:nisps");
            char* path = osdialog_file(OSDIALOG_SAVE, nullptr, "preset.nisps", filters);
            osdialog_filters_free(filters);
            if (!path) return;
            json_t* root = module->dataToJson();
            json_t* jParams = json_array();
            for (int i = 0; i < MEMLNaut::PARAMS_LEN; i++)
                json_array_append_new(jParams, json_real(module->params[i].getValue()));
            json_object_set_new(root, "params", jParams);
            char* jsonStr = json_dumps(root, JSON_INDENT(2));
            json_decref(root);
            std::ofstream file(path);
            if (file.is_open()) { file << jsonStr; file.close(); }
            free(jsonStr);
            free(path);
        }));
        menu->addChild(createMenuItem("Load .nisps preset...", "", [=]() {
            osdialog_filters* filters = osdialog_filters_parse("NISPS preset:nisps");
            char* path = osdialog_file(OSDIALOG_OPEN, nullptr, nullptr, filters);
            osdialog_filters_free(filters);
            if (!path) return;
            std::ifstream file(path);
            free(path);
            if (!file.is_open()) return;
            std::string content((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
            file.close();
            json_error_t error;
            json_t* root = json_loads(content.c_str(), 0, &error);
            if (!root) return;
            json_t* jVersion = json_object_get(root, "version");
            if (!jVersion || json_integer_value(jVersion) < 1) { json_decref(root); return; }
            module->dataFromJson(root);
            json_t* jParams = json_object_get(root, "params");
            if (jParams && json_is_array(jParams))
                for (size_t i = 0; i < json_array_size(jParams) && i < MEMLNaut::PARAMS_LEN; i++)
                    module->params[i].setValue(json_real_value(json_array_get(jParams, i)));
            json_decref(root);
        }));

        menu->addChild(new MenuSeparator);
        menu->addChild(createMenuLabel("Browser bridge (WS↔OSC)"));
        menu->addChild(createCheckMenuItem(
            string::f("Enable OSC server (port %d)", module->oscPort), "",
            [=]() { return module->oscEnabled; },
            [=]() { if (module->oscEnabled) module->stopOsc(); else module->startOsc(); }
        ));
        menu->addChild(createSubmenuItem("OSC listen port", string::f("%d", module->oscPort), [=](Menu* childMenu) {
            for (int port : {7001, 7002, 7003, 9000, 9001}) {
                childMenu->addChild(createCheckMenuItem(
                    string::f("%d", port), "",
                    [=]() { return module->oscPort == port; },
                    [=]() {
                        bool wasRunning = module->oscEnabled;
                        if (wasRunning) module->stopOsc();
                        module->oscPort = port;
                        if (wasRunning) module->startOsc();
                    }
                ));
            }
        }));
    }
};

Model* modelMEMLNaut = createModel<MEMLNaut, MEMLNautWidget>("MEMLNaut");
