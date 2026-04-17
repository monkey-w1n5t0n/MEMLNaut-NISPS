# RP2350 Firmware Performance Patterns

Source: [.local/notes-from-chris.md](../.local/notes-from-chris.md) (guidance from Chris Kiefer, PhD advisor)

These rules apply to MEMLNaut-NISPS firmware and are the design brief for the `nisps-core/` rewrite (bd issue `meml-cwpk`). The theme is **fast memory management**: anything that reduces pressure on the RP2350's shared buses speeds the code up.

## Rule 1 — No dynamic heap allocation

Heap allocation (via `new`, `malloc`, `std::make_shared`, `std::make_unique`, STL containers that grow) is expensive on microcontrollers: fragmentation, unpredictable latency in audio callbacks, and extra pointer chasing over the shared bus. All buffers should be fixed-size, stack-allocated, or pre-sized at init and never resized in hot paths.

Bad:
```cpp
// allocates in the audio callback / after init
std::vector<float> output(n_outputs_);
mlp_->GetOutput(input, &output);
```

Good:
```cpp
// pre-sized once at init, reused forever
std::array<float, kMaxOutputs> output;
mlp_->GetOutput(input, output.data());
```

Also bad: `std::unordered_map` / `std::map` / `std::string` members on objects that live in hot paths — each operation is an allocation.

## Rule 2 — No flash-read float constants (literal value >255)

Float (and int) literals with magnitude greater than 255 don't fit into an ARM immediate field and get emitted as flash-resident constants. Every call reads them over the flash bus, which contends with code fetch and audio I/O. Name them as `static` SRAM variables instead.

Bad:
```cpp
ef_follower_.setRelease(100.0f);           // OK (≤255)
br_lpf1_.set(LOWPASS, 1000.0f, 0.707f, 0); // 1000.0f lives in flash
synth.setFreq(21837.32f);                  // literal read over flash every call
```

Good:
```cpp
static float kBrightnessCutoff = 1000.0f;  // stored in SRAM
br_lpf1_.set(LOWPASS, kBrightnessCutoff, 0.707f, 0);
```

## Rule 3 — Strict `.f` suffix on float literals

Literals without an `f` suffix are `double`. Mixing them into float expressions forces implicit promotion to `double` (slow software path on Cortex-M33 without double-precision FPU), then truncation back to `float`. Always write `0.5f`, never `0.5`.

Bad:
```cpp
reward = reward + (0.005 * rewardCom);          // double math then demotion
params[7] * 3.999999                            // same
synthMapping->RandomiseWeightsAndBiasesLin(-1.2f, 0.9f, 0, 0.5);  // trailing 0.5 is double
```

Good:
```cpp
reward = reward + (0.005f * rewardCom);
params[7] * 3.999999f
synthMapping->RandomiseWeightsAndBiasesLin(-1.2f, 0.9f, 0, 0.5f);
```

## Rule 4 — Small literals (≤255) OK inline

Values with magnitude ≤ 255 (with `.f` suffix for floats) are encoded directly into the ARM instruction stream as immediate operands. No flash read, no SRAM slot needed. These are fine to leave inline: `setAttack(10.0f)`, `if (x > 0.5f)`, `params * 4.4f`.

Rationale: *"be strict about using `.f` for floats… for numbers >255, small numbers go straight into machine code."*

## Audit findings — 2026-04-16

Representative violations across firmware and `nisps-core/`. Not exhaustive — these are the design-brief inputs for `meml-cwpk`.

| File:line | Rule | Example | Notes |
|-----------|------|---------|-------|
| `nisps-core/include/nisps/*` | STRUCTURAL | `std::vector<T>` / `std::unordered_map` / `std::string` throughout | nisps-core extraction inherits legacy STL-heavy patterns — full structural rewrite required. See `meml-cwpk`. |
| `src/memlp/MLP.h:467,477-484` | 1 (heap) | `std::vector<T> m_fwd_buf_a;` etc. as MLP members | pre-allocated at init but still heap-backed; migrating to fixed-size buffers needs a compile-time max-arch |
| `src/memlp/Node.h:548,553-554` | 1 (heap) | `std::vector<T> m_weights;` as Node member | one per node — multiplies allocations by layer width |
| `src/memlp/Dataset.hpp:180` | 1 (heap) | `std::vector<size_t> timestamps_;` | grows with examples, resized per `add()` |
| `src/memlp/ReplayMemory.hpp:125,142` | 1 (heap) | `std::vector<trainingItem> samp;` | replay memory grows unbounded; bound it with a ring buffer |
| `src/memlp/Utils.h:318`, `src/memlp/Loss.h:193` | 1 (heap) | `std::unordered_map<>` for fn registries | hash-map lookup on init — replace with linear scan over fixed array |
| `src/memllib/examples/IMLInterface.cpp:252,254` | 1 (heap) | `std::make_unique<Dataset>()`, `std::make_unique<MLP<float>>(...)` | MLP heap-allocated; big flat-buffer MLP would embed directly |
| `src/memllib/examples/InterfaceRL.cpp:313,333` | 1 (heap) | `std::make_shared<MLP<float>>(...)`, `std::make_unique<OrnsteinUhlenbeckNoise>(...)` in loop | one OU-noise per output on the heap — stack-allocate an array |
| `src/memllib/hardware/memlnaut/MEMLNaut.hpp:88` | 1 (heap) | `instance = new MEMLNaut(old_display);` | singleton via bare `new` — static storage would do |
| `src/memllib/hardware/memlnaut/display/GraphView.hpp:26,29,32` | 1 (heap) | `sprite = new TFT_eSprite(scr);` ×3 | display-side; low priority but part of the pattern |
| `IMLInterface.hpp:151-152,155-156,209` | 1 (heap) | `std::vector<float> input_state_;` etc. as members; `std::vector<float> output(n_outputs_);` in hot path | second one allocates per inference call |
| `modes/MEMLNautModeXIASRI.hpp:73` | 1 (heap) | `std::vector<float> mlist_params(...)` in per-frame handler | fixed-size std::array fits here |
| `modes/MEMLNautModeSoundAnalysisMIDI.hpp:78` | 1 (heap) | same pattern | same fix |
| `XiasriAnalysis.cpp:24,27-29,40-42,44` | 2 (flash const) | `setRelease(100.0f)` OK, but `set(..., 1000.0f, ...)`, `set(..., 4000.0f, ...)` are flash reads per ReinitFilters() | already mitigated via `#define` macros for COMMONHPFFREQ/ZXFREQ — extend to the others |
| `PAFSynthAudioApp.hpp:230` | 2 (flash const) | `return 440.0f * exp2f((note - 69) / 12.0f);` | `440.0f` reads from flash on every note-on |
| `ChannelStripAudioApp.hpp:158-159` | 2 (flash const) | `arEnvHigh.setup(10, 0, 1.f, 10.f, maxiSettings::sampleRate);` | `maxiSettings::sampleRate` (48000.f) + literals |
| `voicespaces/ChannelStrip/basic.hpp:145,147,154,157,162,167,172` | 2 (flash const) | `constexpr float loPassFrequencies[] = {190, 1200, 3900, 5600, 9200};` etc. | table constants — `constexpr` helps placement but individual reads still over flash bus |
| `src/memllib/synth/maxiPAF.hpp:58-60` | 3 (no `.f`) | `constexpr float PAFA1 = 4 * (3.14159265/2);` | `3.14159265` is double — forces double math at constexpr eval and in any non-const context |
| `src/memllib/synth/maxiPAF.hpp:66` | 3 (no `.f`) | `constexpr float HALFSINELIM = (0.997 * TABRANGE);` | same |
| `src/memllib/examples/InterfaceRL.cpp:322` | 3 (no `.f`) | `RandomiseWeightsAndBiasesLin(-1.2f, 0.9f, 0, 0.5);` | trailing `0.5` is `double` |
| `src/memllib/examples/InterfaceRL.cpp:562` | 3 (no `.f`) | `reward = reward + (0.005 * rewardCom);` | `double` promotion every iteration in RL loop |
| `src/memllib/examples/InterfaceRL.cpp:564,608` | 3 (no `.f`) | `if (reward > -0.01)`, `... * 0.3 * avgRewardNeg` | same |
| `voicespaces/ChannelStrip/basic.hpp:146-173` | 3 (no `.f`) | `params[7] * 3.999999` etc. (multiple sites) | `double` multiply in every VoiceSpace expansion |
| `ChannelStripAudioApp.hpp:161` | 3 (no `.f`) | `lookAheadDelay.setup(maxiSettings::sampleRate * 0.1);` | `0.1` is double |
| `ChannelStripAudioApp.hpp:221,321,333-335` | 3 (no `.f`) | `env.setup(500,500,0.8,1000,...)`, `float sineShapeGain=0.1;`, `float detune1 = 1.0;` | mixed `.f` / no-`.f` in the same init block |

**Legend.** Rule 4 (small-literal inline) is not an audit target — it's the *allowed* pattern. STRUCTURAL rows cover systemic issues where enumerating every site is noise; the whole unit is the fix.
