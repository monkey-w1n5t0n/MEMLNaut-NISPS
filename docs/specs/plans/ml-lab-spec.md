---
kind: plan
status: active
---

# ML Lab — a sweep-and-score environment for mapping models

*Dated 2026-09-28. Operator request: "here are a ton of parameters that we can configure for the
MLP and the surrounding training algorithms; bench them all across tens or hundreds of scenarios,
then score them with different metrics and statistics." The lab is an **experimental
environment**. It is used to design, change, and evaluate models and configurations. A result can
later be ported to the firmware, stay browser-only, or stay in the lab. **The lab does not have to
match firmware or Manifold behaviour.** Code claims were read from the tree at `a6b8f87`.*

*Revised 2026-09-28 (operator: "make the lab a (hidden) part of manifold and use it to inform us
what defaults manifold should be shipping with"). There are now **two labs** with different
contracts (§1.5): the **native lab** (Phases 1–2, C++, may diverge) for core-level design, and the
**Manifold lab** (Phase 3, TypeScript, hidden `?lab=1` page + `bun run lab`), which must run what
Manifold ships, because its output is a recommendation about Manifold's defaults.*

**Reading order:** §1 (what exists) → §2 (nouns) → §3 (architecture and contracts) → §4 (phases).
§5 is the compute budget. The Open section lists what the operator must still decide.

## Source files

- `tests/cpp/ml_bench.cpp` — the scenario engine (61 scenarios, field and displacement metrics).
- `scripts/bench-ml.sh` — single-run driver (native and WASM).
- `nisps/ml/mlp.hpp`, `nisps/ml/training.hpp`, `nisps/ml/activations.hpp` — the model under test.
- `nisps/ml/feedback.hpp`, `nisps/ml/replay.hpp`, `nisps/ml/geo_push.hpp` — the feedback algorithms.
- `lab/ml/` (new) — sweep definitions and the sweep driver.
- `manifold/src/lab/` (new) — the Manifold lab: episodes, personas, goals, sweep statistics, the
  hidden page (`LabApp.tsx`) and its worker pool. `manifold/scripts/lab/` — the CLI runner.
- `manifold/src/console/boot-defaults.ts` (new) — the boot defaults the Manifold lab evaluates.

---

## 1. Frame

§1.1 **The question the lab answers is "how does parameter P change behaviour B?", not "which
config is best?"** A ranking is a by-product. The primary outputs are the Pareto front of trade-offs
and the sensitivity of each behaviour to each parameter.
**Why:** The operator's stated problem is understanding. A single winner hides the trade-off that
made it win, and it becomes invalid as soon as the weighting changes.

§1.2 **What already exists (do not rebuild it).** `tests/cpp/ml_bench.cpp` is a deterministic,
shape-agnostic behavioural benchmark. It has 61 scenarios: atomic probes A1–A14, journeys J1–J11,
edge cases E1–E13, a diagnostic D1, and upstream comparisons U1–U4. It measures the geometry of the
mapping (gain p50/p95, cliff index, dead fraction, range utilisation, rail fraction, effective
dimensionality). It also measures gesture response (displacement at the point, in rings, globally,
blast ratio, collateral damage at the stored positives, lurch, retention). It reports and never
asserts. Invariants live in `tests/cpp/test_ml_behaviour.cpp`.

§1.3 **Gaps at `a6b8f87`:**
1. Few parameters are exposed: shape, seed, max examples, `spread`, `geo_lr`, `geo_iters`. The
   training dose (`TrainConfig`), the activations (compile-time `kLayerActivation`), the optimiser
   (compile-time RMSProp constants), the feedback timing, the undo depth, and the replay capacity
   cannot be changed.
2. No sweep driver exists. `--sweep-shape` is a hard-coded list of 13 shapes with one seed each.
3. There is no multi-seed statistic. Random initialisation alone moves these metrics.
4. There is no goal-directed score. Every scenario describes behaviour. No scenario measures
   whether a user reaches what they want.
5. There is no scoring, Pareto, or sensitivity layer, and no visual layer.
6. `scripts/bench-ml.sh` calls `tests/cpp/ml_bench_report.mjs`, which does not exist. The script
   silently prints raw JSON only, and `--compare` does nothing.
7. The bench measures a different dislike than Manifold delivers. Manifold calls
   `advance_geometric()` every frame (`manifold/src/engine/wasm-iml.ts:991`), so one dislike keeps
   training for `geo_lifetime_ms` at `geo_update_hz`. The bench calls only `on_down()`, which is the
   immediate single step. `fb.geo_update_hz` and `fb.geo_lifetime_ms` therefore had no effect on
   any scenario.

§1.4 **Divergence from the products is allowed.** A lab model or a lab parameter can have no
equivalent in firmware or Manifold. Parity (`scripts/parity-check.sh`) is a product contract. It is
not a lab contract.
**Why:** The operator wants a design space that is larger than what currently ships. Porting is a
separate, deliberate step (§3.7).

§1.5 **The Manifold lab is the exception: it MUST match Manifold.** Its question is "which defaults
should Manifold ship?", so a knob is listed only if Manifold can run another value today, and every
simulated gesture goes through the product's own `EngineApi` + `FeedbackController` calls (§4.3.2).
A config that only the native lab can express is a native-lab experiment until it is ported.
**Why:** A recommendation measured on a model the product does not run is not a recommendation
about the product.

## 2. Ontology

§2.1 **Parameter** — a named, typed knob with a default and a description, for example
`train.lr` (float) or `act.hidden` (enum). The engine owns one registry of all parameters (§3.2).
Names are dotted, with a group prefix: `shape.*`, `init.*`, `train.*`, `act.*`, `optim.*`,
`fb.*`, `bench.*`.

§2.2 **Config** — one complete assignment of a value to every parameter, except the seed. A
config's identity (`config_id`) is a hash of its canonical parameter JSON.

§2.3 **Run** — one config × one seed × one scenario set, executed by one engine process. A run
emits one self-describing JSON report (§3.3).

§2.4 **Scenario** — a deterministic, scripted interaction (gestures, likes, dislikes, explore,
place, undo) plus the metrics it emits. Scenario ids are stable (`A4_negative_once_geometric`).

§2.5 **Metric** — one number emitted by one scenario (`field_cliff_index`). Metrics describe. They
are not good or bad by themselves.

§2.6 **Sweep** — a declarative definition (JSON) that expands to a list of configs × seeds × a
scenario subset. A sweep has a name and an output directory.

§2.7 **Quality** — a named, directed aggregate of metrics that states a design goal ("locality of
dislike", "retention", "expressive range"). A quality has a direction (higher-is-better or
lower-is-better). Qualities are where value judgements enter. Phase 4 defines them.

§2.8 **Musician** — a simulated user with a hidden goal and a policy that emits gestures. The
goal-directed scenarios use it (Phase 3).

## 3. Architecture and contracts

```
sweep.json ──▶ lab/ml/sweep.mjs ──(config × seed)──▶ nisps_ml_bench --set k=v … ──▶ run JSON
                  │  expands, schedules N jobs, resumes                                  │
                  └──────────────────────── aggregates ◀─────────────────────────────────┘
                                             │
                          configs.jsonl + rows.csv + summary.csv + manifest.json
                                             │
                      Phase 4: qualities, Pareto, sensitivity ──▶ dashboard artifact
```

§3.1 **One process runs one config and one seed.** The engine takes the config on the command
line and writes one report to stdout. Parallelism belongs to the driver, not the engine.
**Why:** It keeps the engine deterministic and simple (no threads, no shared state). It also makes
resume trivial: a run either has a valid report file or it does not.

§3.2 **The engine owns the parameter registry.** Each parameter has a name, a type, a default, and
a one-line description, in one table in `ml_bench.cpp`. `--set name=value` assigns any registered
parameter. `--list-params` prints the registry as JSON. An unknown name or an out-of-range value is
a usage error (exit 2), never a silent default. The old flags (`--shape`, `--spread`, `--geo-lr`,
`--geo-iters`, `--seed`, `--max-examples`) stay as aliases.
**Why:** If a separate list of parameters exists in the driver, it will drift from the engine. A
typo in a sweep key must fail loudly, or a sweep of 500 runs measures the default 500 times.

§3.3 **Every report is self-describing.** The report header echoes the resolved value of every
registered parameter, the scenario filter, and the target. The driver's manifest adds the git
commit, the dirty flag, the bench binary hash, and the date.
**Why:** A result without its full config cannot be compared or reproduced a month later.

§3.4 **Determinism is kept.** The same binary with the same config and seed gives a bit-identical
report. Every random draw comes from a seeded `nisps::Rng`.

§3.5 **Changes to `nisps/` for the lab must not change default behaviour.** When a lab parameter
needs a core hook (for example a runtime-selectable activation), the hook is a policy template
parameter whose default is the current behaviour. The existing golden vectors, parity check, and
ctest suite are the proof. Lab-only algorithms (a new activation, a new optimiser, a new model
type) live in lab code, not in `nisps/`.
**Why:** `nisps/` is shipped to the RP2350 and must stay allocation-free and free of virtual
dispatch. The lab may use the heap, virtual dispatch, and slow code.

§3.6 **Scenario-owned choices are not config.** A scenario that compares two designs (A4 runs
geometric *and* diffuse) keeps its explicit variants. Config sets the default for scenarios that do
not choose themselves. Example: `fb.avoid_style` applies to every scenario that enters the Avoid
mode without naming a style.

§3.7 **Promotion path.** A lab result goes to a product as a normal change. The change ports the
algorithm into `nisps/` under the full core constraints, regenerates schemas if needed, and updates
parity or documents a deliberate product divergence. The lab report that motivated it is cited in
the commit.

§3.8 **Output layout** (per sweep, under `nisps/build/ml-lab/<sweep-name>/` by default, which is
git-ignored):
- `runs/<config_id>-s<seed>.json` — raw engine report.
- `configs.jsonl` — one line per config: `{config_id, params}`.
- `rows.csv` — long format: `config_id,seed,scenario,metric,value`.
- `summary.csv` — per `config_id × scenario × metric`: `n, mean, sd, min, max`.
- `manifest.json` — sweep definition, git commit, dirty flag, binary hash, dates, failures.

**Why:** Long format lets you slice any metric by any parameter with no schema change. It loads
directly into pandas, DuckDB, a spreadsheet, or a browser dashboard. Configs are stored once, not
repeated on every row.

## 4. Phases

### Phase 1 — Parameterisation (the engine)

§4.1.1 Add the registry, `--set`, and `--list-params` (§3.2). The initial parameter set is below.
Items marked *core hook* need the §3.5 policy change.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `shape.n_in`, `shape.h1..h3`, `shape.n_out` | int | 2, 16,16,16, 8 | as `--shape` |
| `bench.seed` | int | 0x5EED | as `--seed`; the driver sets it |
| `bench.max_examples` | int | 128 | dataset ring capacity |
| `bench.press_hold_ms` | float | 0 | simulated time after each down press, fed to `advance_geometric` (gap 7); 0 = the pre-lab measurement |
| `bench.tick_ms` | float | 5 | `advance_geometric` step while holding |
| `init.spread` | float | 1.0 | 1 = Xavier, 0 = uniform |
| `train.lr` | float | 1.0 | no-arg `train()` dose (`ml_defaults.json`) |
| `train.max_iterations` | int | 1000 | |
| `train.min_error` | float | 0.001 | early stop |
| `act.hidden` | enum | `leaky_relu` | *core hook*; also `tanh`, `sigmoid`, `hard_sigmoid`, `linear`, `clamp01` |
| `act.output` | enum | `sigmoid` | *core hook*; also `hard_sigmoid`, `clamp01` |
| `optim.kind` | enum | `rmsprop` | *core hook*; also `sgd` (lab-only) |
| `optim.rms_decay` | float | 0.9 | *core hook* |
| `optim.rms_eps` | float | 1e-6 | *core hook* |
| `optim.grad_clip` | float | 10 | *core hook* |
| `optim.max_adj_lr` | float | 1.0 | *core hook* |
| `fb.geo_lr` | float | 0.001 | as `--geo-lr` |
| `fb.geo_iters` | int | 1 | as `--geo-iters`; used by A12 and A14 only |
| `fb.geo_update_hz` | float | 200 | has an effect only when `bench.press_hold_ms` > 0 |
| `fb.geo_lifetime_ms` | float | 2500 | has an effect only when `bench.press_hold_ms` > 0 |
| `fb.avoid_style` | enum | `geometric` | default for scenarios that do not choose (§3.6) |
| `fb.move_speed` | float | 0.1 | perturbation speed used by scenarios |
| `fb.undo_depth` | int | 4 | |
| `fb.replay_cap` | int | 64 | |

The replay and push constants (`kReplayDedupRadius`, `kCentroidK`, `kMaxDislikeMagnitude`,
`kGeometricPushScale`, `kNegLRBase`) are `constexpr` in core headers. They are deferred to a later
slice of Phase 1, which moves them into the feedback storage or a policy.

§4.1.2 **Core hook.** `MLPCore<Storage, Policy = DefaultMlpPolicy>`. The policy supplies the
per-layer activation, its derivative, and the optimiser step. `DefaultMlpPolicy` forwards to the
current constexpr `kLayerActivation<L>` and `rmsprop_step`, so the code generated for every
existing instantiation stays the same. The lab supplies `LabMlpPolicy`, which reads process-global
runtime settings (one config per process, §3.1).

§4.1.3 `--scenario` accepts a comma-separated list. It also accepts a prefix ending in `*`
(`J*`), so a sweep can target a family.

§4.1.4 Create the missing `tests/cpp/ml_bench_report.mjs`: a readable table, native versus WASM
difference, and `--compare` deltas.

**Done when:** a default run is bit-identical to `a6b8f87` except for the added header fields.
ctest, golden, and parity pass. Every registered parameter is echoed in the report.

**Status 2026-09-28: done except the deferred replay/push constants.** Full and smoke default
runs are byte-identical to `a6b8f87` in every scenario row. ctest, parity, and lint pass. The
firmware was not built for this change. The core change is a defaulted template parameter only.

§4.1.5 **First observation (smoke-sized, seed 0x5EED, A1).** At the shipped settings every
RMSProp step reaches the `optim.max_adj_lr = 1` cap. So `train.lr` values of 0.01, 0.1, and 1.0
give identical results, and `optim.kind=sgd` at lr 0.1 gives exactly the same result as `rmsprop`
with the cap at 0.1. The shipped optimiser therefore behaves as clipped SGD at lr 1. The dose knob
that has an effect is the cap, not `train.lr`. This must be confirmed at full size over several
seeds (`sweeps/train-dose.json`) before `ALIGNMENT.md` records it.

### Phase 2 — Sweep driver

§4.2.1 `lab/ml/sweep.mjs` (Node, no dependencies) and a thin `scripts/ml-sweep.sh` that builds
the engine first. A sweep definition:

```json
{
  "name": "train-dose",
  "description": "how the positive-path dose trades lurch against retention",
  "base":  { "shape.h1": 16 },
  "grid":  { "train.lr": [0.001, 0.01, 0.1, 1.0], "train.max_iterations": [1, 10, 100, 1000] },
  "sample": { "method": "lhs", "n": 32,
              "params": { "fb.geo_lr": { "log": [1e-4, 1e-1] },
                          "act.hidden": { "choice": ["leaky_relu", "tanh"] } } },
  "seeds": 5,
  "scenarios": ["A1_at_example", "U4_*", "J6_long_session"],
  "smoke": false
}
```

The configs are `base` merged with the cartesian product of `grid`, then with each `sample` point.
An absent `grid` or `sample` contributes one empty assignment. `seeds` is a count (seeds 1..n) or
an explicit list. Sample methods are `lhs` (Latin hypercube) and `random`. Both use a seeded PRNG,
so a sweep expands identically every time. Ranges are `{"range":[a,b]}`, `{"log":[a,b]}`,
`{"int":[a,b]}`, or `{"choice":[…]}`.

§4.2.2 The driver validates every key against `--list-params` before it starts a run. It runs
`--jobs N` processes (default: half the CPUs). It skips runs whose report already exists and
parses. It records failures in the manifest and does not stop on them. `--dry-run` prints the
expanded plan and the estimated cost. `--limit` caps the number of runs.

§4.2.3 After the runs, the driver writes the §3.8 aggregate files. `lab/ml/sweep.mjs aggregate
<dir>` rebuilds them from `runs/` alone.

§4.2.4 Seed-noise report: for each metric, the driver prints the median coefficient of variation
across seeds. **Why:** This tells you how many seeds a comparison needs before any parameter
effect can be trusted.

**Done when:** a small real sweep (2 × 2 grid, 2 seeds, 3 scenarios) runs, resumes after an
interruption without re-running finished runs, and yields `summary.csv`.

**Status 2026-09-28: done.** `sweeps/smoke-check.json` ran on the VPS at `--jobs 2`. A
`--limit 3` run followed by a full run ran only the remaining 5, and a third run ran 0. The engine
echo matched the requested overrides in every report. A resume refuses to mix runs from a
different engine binary unless `--fresh` is given.

### Phase 3 — Simulated musicians, in Manifold (the defaults lab)

**Status 2026-09-28: built.** Hidden page `?lab=1` (code-split; not linked from the UI), CLI
`cd manifold && bun run lab`, e2e `tests/e2e/lab.spec.ts`, unit tests `src/lab/lab.test.ts`.

§4.3.1 **Episode.** One persona with one hidden goal plays one config for a gesture budget
(`src/lab/episode.ts`). The engine boots exactly as a new session does: `createEngine` with the
training dose and spread, then ConsoleApp's boot reshape to the boot mode's net
(`paf_synth`: 2 → 10/10/14 → 33), then a `FeedbackController` in the configured feedback mode. The
lab scores the REAL net (`inferBatch`) after every gesture; while a scratchpad is live the real
net is set aside, so the last real value is carried.

§4.3.2 **Fidelity contract.** Each gesture is the call ConsoleApp's handler makes, cited inline:
like → `controller.like(pos, engine.getOutputs())` (the raw output); dislike (pointer-down) →
`controller.dislike(engine.routedOutput())`; push-away nudge pill → `engine.feedback.nudge(0.05)`;
push-away randomise pill → `engine.randomise(spread)`; explore-and-place → `enterExplore`,
`reroll`, `nudge`, `undo`, `place` + `placeCommit(x, y)`, `finalise`. Time between gestures runs
on a `VirtualClock` injected through the controller's new `scheduler` option, so the geometric
replay timer fires as it would over that wall-clock gap. The engine gets its WASM through a new
`loadModule` option and `persist: false`, so a simulated session never touches the user's saved
state. **Known gap:** the handlers are mirrored, not shared. Extracting ConsoleApp's gesture
handlers into a framework-neutral module both use would remove that drift risk.

§4.3.3 **Goals** (`src/lab/goals.ts`). Every goal has a **salience** vector: the listener attends
to 6 outputs and the rest weigh 0.05. All distances are salience-weighted RMS.
**Why:** Without salience, a random 33-D or 126-D target cannot be reached by any gesture sequence,
and every config scores 0.
- `place` — 3 target sounds at 3 spaced pad locations. Quality = share of targets whose real-net
  error is below the persona's `accept`.
- `taste` — 2 liked regions in output space (width 0.15). Quality = coverage (share of a 16×16
  pad grid with utility > 0.5) × (0.5 + 0.5 × variety), where variety is the normalised entropy
  of which liked region each covered cell is nearest.

§4.3.4 **Personas** (`src/lab/personas.ts`): `patient` (2.5 s between gestures, good ears,
80 gestures), `casual` (0.9 s, 50), `noisy` (σ = 0.07 on every judgement, 60). A persona sets the
gesture gap, judgement noise, thresholds, patience per target, and the stuck limit before a nudge
or randomise. Policies (one per goal × mode): push-away → go to a target, like it when right,
dislike otherwise, nudge or randomise when stuck; explore-and-place → coarse rerolls while far, fine
nudges when close, undo anything worse, place the best found, finalise, re-check.

§4.3.5 **Score** (provisional, until Phase 5 calibrates it): 0.5 × final quality + 0.5 × mean
quality over the session, so reaching the goal sooner scores higher. Reported in points (0–100).

§4.3.6 **Method** (`src/lab/sweep.ts`). One-at-a-time around shipped, once per feedback mode:
shipped, the other mode's base, and each knob's candidates alone. Mode-specific knobs vary only in
their mode. **Every config plays the same episodes** (seed × goal × persona). A config's effect is
the mean of paired per-episode differences against shipped, with a normal 95% interval. A change is
*credible* only when its whole interval clears zero. The recommendation takes the better mode if
credible, then each knob's best credible candidate within that mode. Because knobs were varied
alone, the combined proposal is a hypothesis: `Confirm combined recommendation` (page) or
`bun run lab -- --confirm k=v,...` (CLI) re-runs shipped against it before anyone ships it.

§4.3.7 **Knobs** (`src/lab/settings.ts`, each shipped value imported from its single source):
boot feedback mode, hidden widths, weight-draw spread, like learning rate and max iterations,
dislike learning rate, replay rate and lifetime (push-away only), and scratchpad nudge size
(explore-and-place only). Not yet knobs: OU explore intensity, input/output pipeline smoothing,
input arity (2 or 4), max examples (the C ABI ignores it), and `min_error` (EngineApi does not
expose it).

§4.3.8 **Cost.** An episode takes 15–300 ms in bun (the like-training dose dominates). The full
one-at-a-time sweep at 8 seeds is about 3,600 episodes, about 6 CPU-minutes.

§4.3.9 **Product defects found while building it** (fixed in the same change):
1. `FeedbackController` never put the C++ core into explore-and-place when it was constructed in
   that mode. The core boots in Avoid, and `setMode()` early-returns on an unchanged mode. Manifold
   worked only because it boots in push-away and switches later. Had the boot default been changed
   to explore-and-place, enter-explore and reroll would have silently done nothing. Pinned by
   `src/lab/lab.test.ts`.
2. `engine/wasm-worker.ts` installs its trainer `message` listener in **any** worker whose module
   graph imports the engine, and it answers a bare `{kind:'init'}`. The lab namespaces its protocol
   (`lab:*`). Any future worker that imports engine code will meet the same trap. **Not fixed.**

§4.3.10 **First findings (2026-09-28, uncommitted tree on top of `599bd90`).** One-at-a-time
sweep: 63 configs × 2 goals × 3 personas × 8 seeds = 3,024 episodes, 125 s on 3 jobs, 0 failures.
Confirm run: 16 held-out seeds (1001–1016), 192 episodes.

| Finding | Evidence (Δ in score points vs shipped, paired 95% CI) |
|---|---|
| Shipped push-away barely learns in simulation: it scores 5.2 / 100 | shipped score 0.052 |
| Explore & place, all else shipped, beats it | +10.8 ± 4.1, wins 64% |
| In push-away, the like dose (lr, iterations) has **no effect** | every lr/iteration row Δ = 0.0 ± ≤0.1 (the musician rarely likes) |
| In explore & place, `learningRate` 0.1 ≡ 1.0 exactly | the RMSProp cap (§4.1.5) reproduced in Manifold |
| Scratchpad nudge 0.05 → 0.2 helps (explore & place) | +8.3 ± 3.6 over the mode base |
| First hidden layer 10 → 16 helps (explore & place) | +7.6 ± 5.5 over the mode base |
| **Combined: explore & place + h1 = 16 + nudge 0.2 (held-out seeds)** | **+20.6 ± 4.1, wins 87%** (place +22.9, taste +18.3) |

**Not a shipping decision yet.** Threats to validity, in order of size:
1. **Policy bias.** The explore-and-place musician is a competent hill-climber (reroll far, nudge
   near, undo worse). The push-away musician only dislikes until a sound is acceptable and never
   likes partial improvements. A better push-away policy could close part of the mode gap. Add
   push-away strategies (like-when-better, move-and-retry) before trusting the mode comparison.
2. **Uncalibrated score** (Phase 5). The goals, salience model, and thresholds are proxies.
3. **Mirrored handlers** (§4.3.2). Drift between `episode.ts` and ConsoleApp would invalidate
   results without failing a test.

### Phase 4 — Qualities, scoring, and analysis

§4.4.1 `lab/ml/qualities.json` defines each quality as a weighted combination of
`scenario/metric` pairs, with a direction and a normalisation (rank or z-score across the sweep).

§4.4.2 Analysis outputs: the Pareto front over the chosen qualities, main-effect plots (quality
against each parameter, marginalised), interaction heat maps for parameter pairs, and a
permutation-importance or random-forest ranking of the parameters for each quality.

§4.4.3 A dashboard artifact (HTML) reads `summary.csv` and `configs.jsonl`. It shows parallel
coordinates, the Pareto front, and small multiples of the 2-D input→output field for selected
configs. The field images need the engine to emit a coarse field raster on request
(`bench.emit_field=1`).

### Phase 5 — Calibration against the operator

§4.5.1 Choose about 10 configs spread along the Pareto front. The operator plays each one blind
for about 5 minutes and rates it. The analysis reports which qualities predict the ratings. Weights
and qualities that do not predict the ratings are revised.
**Why:** Metrics are proxies. About one hour of playing makes all later sweeps trustworthy. Without
it the lab can optimise a number that does not feel good.

§4.5.2 This needs a way to load a lab config in a playable surface. The Manifold lab's knobs are
exactly Manifold's defaults, so the natural surface is a `?lab-config=<encoded config>` override
that boots the normal console with those defaults. It does not exist yet.

### Phase 6 — Model interface (non-MLPCore models)

§4.6.1 The scenarios currently call `rig.mlp` and `rig.fb` directly. To evaluate a model that is
not `MLPCore` + `FeedbackControllerCore` (for example a soft-target actor, an RBF net, or a
different dislike algorithm), the scenarios must go through a lab `Model` interface. The minimum
interface is: infer, like, dislike, explore / place / commit / undo, and train. A `model.kind`
parameter selects the implementation.
**Why it is last:** It is the largest refactor (about 2,600 lines of scenarios). Phases 1–5 give
value on the existing model first and show which parts of the interface the experiments need.

## 5. Compute budget

§5.1 Measured on this VPS at `a6b8f87` (12 cores, native Release, one process): a full run
(61 scenarios, 2048 probe points) takes **65 s** and about 5 MB RSS. `--smoke` takes **5 s**.

§5.2 Estimates: 100 configs × 5 seeds × all scenarios ≈ 9 CPU-hours, which is about 1 hour on 8
cores. A scenario subset or `--smoke` reduces this by 5–15×. `--dry-run` prints the estimate.

§5.3 Large sweeps must not run on the production VPS (home contract). Run them on the laptop or
a dedicated machine. On the VPS, use only smoke-sized verification sweeps with a low `--jobs`
value.

## Open / Deferred

- Which qualities matter, and their initial weights (Phase 4). A draft should come from the
  operator's own words about "good" behaviour, not from the metrics that happen to exist.
- The analysis language for Phase 4: Node only (one toolchain, the dashboard reads the same
  files) or Python (pandas / scikit-learn for sensitivity analysis). The Phase 2 files support both.
- Named base presets for the shipped products (firmware default, Manifold PAF default), so a sweep
  can start from "what ships now". This needs the exact shipped values read from both products.
- Whether the WASM target is ever useful in the lab. Currently native only, because §1.4 removes
  the parity need.
