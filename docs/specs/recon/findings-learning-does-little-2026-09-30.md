---
kind: finding
---

# Why "learning does little" — the like and the dislike, measured, and compared with upstream

*Dated 2026-09-30. Measured at commit `a21173a` plus the working-tree changes described in §7.
Immutable once committed: later results go in a new finding. Numbers come from the native
behavioural bench (`tests/cpp/ml_bench.cpp`) and from the Manifold ML lab (`manifold/src/lab/`).
British spelling. The operator's question: several settings "do not seem to do much" (the lab's
first sweep showed like-training rate, iterations and most dislike settings with no measurable
effect). Why, and how does upstream avoid it?*

## 1. Summary

1. **The like-training learning rate is inert.** At the shipped step cap (`kMaxAdjustedLr = 1`),
   every `lr` from 1.0 down to 0.001 gives the same fit (error 1.468 for all, to four digits).
   The optimiser is not RMSProp in practice: it is plain SGD at rate 1. The shipped `lr = 1.0`
   is an SGD-era number that was kept when RMSProp arrived (2026-07-25). §3.1.
2. **The like under-fits and forgets.** After 12 likes the net is still 0.26 (RMS per output)
   from the liked sounds. Retention error grows from 0.18 (1 like) to 0.96 (12 likes). §3.2.
3. **The like is not gentle either.** One like moves the whole mapping by 0.39 on average (max
   1.4). It is a large, blunt, inaccurate jump. A correct optimiser fits far better but moves the
   mapping more. §3.3.
4. **The dislike is not weak as Manifold delivers it.** One press held for 2.5 s moves the sound
   at the pressed point by 1.0 and the whole mapping by 0.36, and it moves the liked points by
   0.69. It erases likes. The "weak" numbers come from measuring only the first step. §3.4.
5. **Upstream does the opposite.** A like only stores the example. A background loop takes ~100
   small, genuinely normalised steps per second toward the stored likes. Likes are reinforced
   while dislikes push for 2.5 s. §4.
6. **In simulated play the optimiser fix matters for retention, not for the goal score,** and
   the mode matters far more than any optimiser setting. §3.5.

## 2. Method

- Native bench, shape `2→10/10/14→33` (Manifold's boot net, `paf_synth`), seed `0x5EED`,
  12 "scattered" examples (A1), `--set` flags from the parameter registry. RMSProp settings go
  through the product's `MLPCore::set_optim`, the same path Manifold uses.
- Manifold lab: simulated musicians (3 personas × goals *place* and *taste*) play the real
  `EngineApi` + `FeedbackController` in WASM. Every config plays the same episodes. Δ is the mean
  paired score difference in points (0–100) with a 95% interval. Confirm runs use held-out seeds
  1001–1016. Score is a provisional proxy (spec Phase 5).
- Upstream: read from the vendored reference (`firmware/MEMLNaut-NISPS/lib/memllib/reference/`,
  `InterfaceRL.{hpp,tpp}`) and a memlp checkout that matches the constants `nisps/ml/training.hpp`
  says it ported from `ea777502`. The memlp bytes could not be verified against that commit.

## 3. Findings

### 3.1 The like learning rate is inert (step-cap saturation)

RMSProp's step is `min(lr / (sqrt(sq_avg) + eps), max_adj_lr) · g`. `MLPCore::train` scales every
per-sample gradient by `1/N`, so gradients are about 1e-3. Then `lr / sqrt(sq_avg)` is above the
cap of 1 on nearly every step, the cap binds, and the step is just `g`.

A1 (12 examples, 1000 epochs, mean L2 error over 33 outputs at the examples; lower is better):

| Setting | Error | Final loss |
|---|---|---|
| shipped (lr 1, cap 1) | 1.468 | 0.0660 |
| lr 0.1 / 0.03 / 0.01 / 0.003 / 0.001, cap 1 | **1.468** (identical) | 0.0660 |
| lr 0.0001, cap 1 | 1.506 | 0.0693 |
| SGD, lr 1 (lab-only) | **1.468** (identical to shipped) | 0.0660 |
| lr 1, cap 3 / 10 / 100 | 1.267 / 0.985 / 1.437 | 0.049 / 0.032 / 0.063 |
| **lr 0.01, cap 1e6** (normalised) | **0.175** | 0.0012 |
| lr 0.003, cap 1e6 | 0.454 | 0.0088 |
| lr 0.03 / 0.1, cap 1e6 | 0.904 / 1.652 | 0.034 / 0.088 |
| lr 0.01, cap 1e6, 100 / 30 epochs | 1.177 / 1.376 | 0.043 / 0.058 |

Through the real Manifold engine in WASM (`lab.test.ts`), 12 fixed examples: shipped 1.154;
lr 0.01 at cap 1 is within 0.3% of that; lr 1 with cap 10 gives 0.526; lr 0.01 with cap 1e6 gives
0.189. The optimiser settings survive `nisps_ml_reshape` (ConsoleApp reshapes at boot).

Two lessons. (a) `lr` only means something once the cap is lifted, and then the useful range is
narrow: 0.003–0.01 fits, 0.03+ oscillates, and lr 1 with an uncapped step (`lr = 1`, `cap = 1e6`)
is catastrophic (lab score 0.014). (b) Cap 100 is worse than cap 10: a bigger cap is not simply
better.

### 3.2 The like under-fits and forgets

J1 (likes added one at a time; retention = mean error at all earlier likes; lower is better):

| Setting | @1 | @5 | @12 | @20 | mean | effective dims | range use |
|---|---|---|---|---|---|---|---|
| shipped | 0.176 | 0.504 | **0.957** | 0.935 | 0.692 | 2.8 | 0.75 |
| cap 10, lr 1 | 0.151 | 0.159 | 0.176 | 0.477 | 0.262 | 4.9 | 0.95 |
| cap 1e6, lr 0.01, 1000 ep | 0.153 | 0.154 | 0.168 | 0.566 | 0.248 | 3.9 | 0.99 |
| cap 1e6, lr 0.003, 1000 ep | 0.170 | 0.132 | 0.170 | 0.348 | **0.206** | 6.5 | 0.95 |
| cap 1e6, lr 0.003, 300 ep | 0.170 | 0.325 | 0.359 | 0.574 | 0.310 | 5.4 | 0.94 |
| cap 1e6, lr 0.001, 300 ep | 0.173 | 0.356 | 0.932 | 0.818 | 0.703 | 3.3 | 0.86 |

One like fits. The more likes, the worse the shipped optimiser reproduces the earlier ones, while
the net has the capacity (789 weights for 12 × 33 targets). A working optimiser keeps all twelve.
It also uses more of each output's range (0.75 → 0.95+) and varies more outputs independently
(effective dimensions 2.8 → 6.5).

### 3.3 The cost side: a working optimiser moves the mapping more

U4 (`U4_pos_config`, 40 likes with random 33-D targets; those targets exceed the net's capacity,
so the retention column mainly measures capacity here):

| Setting | Lurch mean | Lurch max | Retention error |
|---|---|---|---|
| shipped | 0.389 | 1.43 | 1.16 |
| cap 10 | 0.873 | 1.94 | 1.04 |
| cap 1e6, lr 0.003, 1000 ep | 1.38 | 2.16 | 1.11 |
| cap 1e6, lr 0.003, 300 ep | 0.858 | 1.24 | 1.13 |
| cap 1e6, lr 0.003, 30 ep | 0.278 | 0.566 | 1.25 |

*Lurch* = mean L2 change of the whole field per like. Fitting costs movement. Upstream avoids the
trade-off by spreading the same movement over seconds (about 0.001 per tick), which is smooth
instead of a jump. The like also runs **synchronously on the press** for up to 1000 epochs.

### 3.4 The held dislike is large, and it erases likes

A4 and A12 with Manifold's dislike defaults (lr 0.003), after 12 likes:

| Dislike | Movement at point | Whole field (median) | Movement at liked points |
|---|---|---|---|
| first step only (what the bench measured before 2026-09-28) | 0.026 | 0.0049 | 0.017 |
| **held 2.5 s at 200 Hz (what Manifold does)** | **1.002** | **0.356** | **0.690** |
| held, lr 0.001 (upstream) | 1.001 | 0.533 | 0.786 |
| held, lr 0.01 or 0.03 | 1.003 | 0.303 | 0.663 (equal: cap again) |

A12 (dislike exactly where a like was placed): the first step moves the sound 0.003 *toward* the
rejected like; the held dislike moves it 0.39 away. So "weak" is a measuring artefact, and the real
problem is blunt and destructive. In simulated push-away play the liked sounds end 0.38 away from
where they were liked, whatever the optimiser does; with the replay turned off
(`geoUpdatesPerSecond = 0`) the same error is 0.16.

### 3.5 In simulated play (Manifold lab)

Presets, held-out seeds 1001–1016, 96 episodes per config, Δ vs shipped:

| Preset | Score | Δ (95% CI) | Wins | Like error |
|---|---|---|---|---|
| shipped (push-away, burst, cap 1) | 4.9 | – | – | 0.380 |
| cap 10 | 6.0 | +1.2 ± 2.1 | 46% | 0.367 |
| real RMSProp (lr 0.003, cap 1e6), push-away | 4.2 | −0.7 ± 1.5 | 53% | 0.416 |
| upstream-like (background, upstream dislike, 16/16/16) | 10.2 | **+5.3 ± 4.1** | 61% | **0.147** |
| **real RMSProp + explore & place** | 21.6 | **+16.7 ± 3.8** | 78% | **0.056** |

One-at-a-time sweep (146 configs, 7,008 episodes, 8 seeds): the optimiser and like settings have no
credible effect on the goal score in push-away, because dislikes erase likes. In explore-and-place
the optimiser fix lowers the like error (0.088 → 0.052–0.056) without a credible score change. The
best combination stays *explore & place + first hidden layer 16 + scratchpad nudge 0.2*
(+20.6 ± 4.1 on held-out seeds). Adding the optimiser fix to it: +20.5 to +20.8, like error
0.089 → 0.054–0.069. Background like inside explore-and-place is worse (+13.7).

## 4. Comparison with upstream (InterfaceRL e291192)

| | Upstream | Manifold today |
|---|---|---|
| Like | stores (input, **heard** action incl. OU noise); **no weight update on the press**; positives never expire | adds (input, **clean** output) and **retrains synchronously**, lr 1.0, ≤1000 epochs |
| Like training | background, ~100 Hz (every 2nd 200 Hz tick), `TrainBatch` of 8 sampled with replacement, **one batch-mean RMSProp step**, lr 1e-3 × knob, runs indefinitely | none in the background |
| Optimiser regime | RMSProp, cap 1, but batch-mean gradients + global norm-clip 5: the step is normalised | RMSProp, cap 1, per-sample `1/N` gradients, no norm-clip: **saturated, = SGD lr 1** |
| Dislike store | dedup radius 0.10; a near **positive is deleted**; reward stays −1; no refresh | dedup 0.05; deepens to −16; refreshes action and age; **no** positive removal |
| Dislike training | one batch step per tick over **all** live negatives, lr 1.1–1.5e-3, ~100 Hz, 2.5 s | one sequential step per negative per tick (N× steps), lr 3e-3 × ratio, 200 Hz, 2.5 s, plus one immediate cycle |
| Net | 10→16→16→N, leaky ReLU + **hard-sigmoid** output | 2→10→10→14→N, leaky ReLU + sigmoid |
| OU exploration | dt 0.004, reflected at the rails; user hears it and the like stores it | dt 0.001, clamped; like stores the clean output |
| Slow-change ramps | post-Jolt LR ramp (~5 s), long OU correlation (~1–2 min) | none; the ramp exists in the core but nothing applies it |

The essential difference is *when* and *how* learning happens: continuous, small, normalised steps
that let likes keep pulling while dislikes push, against one large synchronous retrain plus a
dislike that overpowers it. Expressible in Manifold's engine today (lab preset `upstream-like`):
background like training and the upstream dislike settings. Not expressible without core changes:
hard-sigmoid output, batch-mean + norm-clip gradients, nearby-like removal, reflected OU at dt
0.004, sampling with replacement.

## 5. What this does not show

1. **The musicians are mine.** The explore-and-place policy is a competent hill-climber; the
   push-away policy only dislikes and likes whole sounds. A better push-away policy could close
   part of the +16.7 gap. Every mode comparison carries this bias.
2. **The score is a proxy** (spec Phase 5). "Better" here means a simulated user with a hidden
   goal got closer, not that it feels better.
3. **The upstream profile is partial** (§4). Its result is "upstream's shape of learning helps in
   push-away", not "upstream's algorithm beats ours".
4. U4's random 33-D targets exceed capacity; its retention column is a capacity measure.
5. Lurch is a proxy for "the instrument shifts under you", and it is not comparable across modes
   (explore-and-place changes the real net only at its commit step; the lab divides by all
   gestures to compensate).

## 6. Candidate changes (nothing applied)

1. **Stop shipping `lr = 1.0` under a capped RMSProp.** Smallest change: raise
   `kMaxAdjustedLr` from 1 to 10 (one constant; J1 mean retention 0.69 → 0.26). Cleaner: lift the
   cap (or drop the `1/N` gradient scale, which RMSProp does not need) and set `lr` 0.003–0.01.
   Either changes the golden vectors and the like's feel (more movement per like: §3.3), and the
   synchronous 1000-epoch retrain should move off the press at the same time.
2. **Decide the boot feedback mode.** Explore-and-place scored +16.7 (+10.8 with today's optimiser).
   It is a different interaction (audition, then place), so this is a product decision that needs
   real play, not a default flip.
3. **Make the dislike stop erasing likes.** Options, cheapest first: replay off
   (`geoUpdatesPerSecond = 0`); upstream's removal of a nearby positive on dislike; background
   reinforcement of likes (lab: +5.3, like error 0.147).
4. **Scratchpad nudge 0.05 → 0.2 and first hidden layer 16** (explore-and-place; +8.3 ± 3.6 and
   +7.6 ± 5.5 over the mode's base).
5. Whatever is chosen: check it **by ear** first (spec Phase 5). The lab picks candidates; it does
   not decide.

## 7. Changes made with this finding, and how to reproduce

Made (default-preserving; ctest, golden vectors and native↔WASM parity unchanged):
`OptimConfig` and `MLPCore::set_optim` (`nisps/ml/training.hpp`, `mlp.hpp`); WASM
`nisps_ml_set_optim` (carried through `nisps_ml_reshape`); TS `EngineApiOptions.optim`;
opt-in `FeedbackController` `backgroundLearning`; `EngineApi.trainStep`; bench row
`U4_pos_config`; lab knobs, presets, grid runs, lurch and like-error measures.

```bash
# 3.1, 3.2 — native bench at Manifold's shape
nisps/build/nisps_ml_bench --shape 2,10,10,14,33 --scenario A1_at_example \
  --set optim.max_adj_lr=1000000 --set train.lr=0.01
nisps/build/nisps_ml_bench --shape 2,10,10,14,33 --scenario J1_positive_only --set optim.max_adj_lr=10
# 3.3
nisps/build/nisps_ml_bench --shape 2,10,10,14,33 --scenario U4_balanced_positives --set optim.max_adj_lr=10
# 3.4
nisps/build/nisps_ml_bench --shape 2,10,10,14,33 --scenario A4_negative_once,A12_like_then_dislike \
  --set fb.geo_lr=0.003 --set bench.press_hold_ms=2500
# 3.5 — Manifold lab
cd manifold
bun run lab -- --presets all --seeds 16
bun run lab -- --seeds 8 --jobs 4                       # one-at-a-time, 4 mode combinations
bun run lab -- --seeds 16 --confirm "feedbackMode=explore-and-place,h1=16,nudgeStddev=0.2"
bun run lab -- --grid learningRate,optimMaxAdjLr --base feedbackMode=explore-and-place
```

The lab also runs in the browser at `/next/?lab=1`.
