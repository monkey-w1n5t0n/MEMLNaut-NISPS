---
kind: finding
date: 2026-07-25
immutable: true
---

# Findings — Manifold “Push away” vs upstream geometric dislike

_Read-only comparison, 2026-07-25. “Confirmed” claims cite source; “Inference” labels
interpretation. No implementation decision is made here._

## Scope and source identity

The hardware repository named in the question,
[`MusicallyEmbodiedML/MEMLNaut`](https://github.com/MusicallyEmbodiedML/MEMLNaut),
does not contain the active ML implementation. The firmware repository is
[`MusicallyEmbodiedML/MEMLNaut-NISPS`](https://github.com/MusicallyEmbodiedML/MEMLNaut-NISPS/tree/701f2d9f1b4698e0ddfa147193928489de12601f),
whose `src/memllib` submodule pins
[`MusicallyEmbodiedML/memllib` at `e291192`](https://github.com/MusicallyEmbodiedML/memllib/tree/e291192d8e4f2fca7b79670c4df9c2ec8bdf03cd).
The local read-only copies of upstream `InterfaceRL.hpp`, `.tpp`, and `.cpp` have Git
blob hashes `03e9255`, `9ec762b`, and `60204d1`, respectively—the same blobs returned
by GitHub for that pin. The comparison below is therefore against the exact upstream
source, not an approximation. Provenance is recorded locally in
`firmware/MEMLNaut-NISPS/lib/memllib/reference/README.md:1-15`.

## Confirmed behaviour

### The mental model is substantially right, but “different” needs a target

A negative verdict has no supervised label by itself. Upstream defines “different” as:
take the output that was heard, find the mean output of the four liked positions nearest
the current control input, and create a new target one unit farther from that liked
centroid in output space. With no likes—or a degenerate zero-length direction—it uses a
random direction. The target is clamped to `[0,1]`
([upstream `InterfaceRL.tpp:698-761`](https://github.com/MusicallyEmbodiedML/memllib/blob/e291192d8e4f2fca7b79670c4df9c2ec8bdf03cd/examples/InterfaceRL.tpp#L698-L761);
local mirror `firmware/MEMLNaut-NISPS/lib/memllib/reference/InterfaceRL.tpp:698-761`).

That target is then passed to `synthMapping.TrainBatch`. Inference subsequently reads
the same MLP through `synthMapping.GetOutput`. Therefore current upstream push-away is
**weight training on the mapping MLP**, not a separate rejection layer after inference
([upstream training call](https://github.com/MusicallyEmbodiedML/memllib/blob/e291192d8e4f2fca7b79670c4df9c2ec8bdf03cd/examples/InterfaceRL.tpp#L757-L761);
[upstream inference path](https://github.com/MusicallyEmbodiedML/memllib/blob/e291192d8e4f2fca7b79670c4df9c2ec8bdf03cd/examples/InterfaceRL.tpp#L869-L890)).
OU noise and `paramTransformHook` do exist after MLP inference, but are independent of
the dislike algorithm (`InterfaceRL.tpp:877-890`).

The Manifold path has the same basic semantics. The UI passes its current post-output-
pipeline vector to `FeedbackController.dislike`, which calls the WASM geometric-dislike
entry point (`manifold/src/console/ConsoleApp.tsx:509-535`;
`manifold/src/feedback/controller.ts:347-373`;
`manifold/src/engine/wasm-iml.ts:956-978`). The C++ controller computes the target and
calls `MLPCore::train_targets`, which runs forward propagation, backpropagation and one
RMSProp update on the same network weights (`nisps/ml/feedback.hpp:395-477`;
`nisps/ml/mlp.hpp:250-287`).

### The target maths now matches current upstream, but the training schedule does not

Current Manifold main now matches upstream’s untapered target formula and constants:
`kGeometricPushScale=1.0`, `kNegLRBase=1.5`, no `/(1+distance)` taper
(`nisps/ml/geo_push.hpp:1-110`; upstream `InterfaceRL.hpp:406-414` and
`InterfaceRL.tpp:723-761`). It also now uses the upstream RMSProp update rather than
interpreting an upstream RMSProp learning rate as plain SGD
(`nisps/ml/training.hpp:1-92`).

The remaining major divergence is dose:

- Upstream stores the dislike at press time, then its main loop calls `optimise()` on
  subsequent cycles (`InterfaceRL.tpp:38-54,186-232`).
- Every optimisation scans **all** live negatives and batch-trains them again
  (`InterfaceRL.tpp:673-761`).
- Upstream computes one liked centroid around the **current live control input** and
  applies it to every negative in that cycle, even if the user has moved away from the
  original disliked position (`InterfaceRL.tpp:698-755`). Manifold instead computes the
  centroid at the just-pressed negative’s stored input (`nisps/ml/feedback.hpp:431-467`).
- A negative remains at full strength for 2500 ms, then expires; the number of updates
  depends on the mode’s loop rate (`InterfaceRL.hpp:406-414`).
- Manifold collapses press and optimisation into **one synchronous
  `train_targets` call for only the just-pressed negative**, then proportionally decays
  stored negatives (`nisps/ml/feedback.hpp:395-477`; `nisps/ml/replay.hpp:165-185`).
  There is no background/per-frame feedback optimiser.

Thus a Manifold click names a strongly displaced target, but takes only one step toward
it. Upstream keeps walking toward its target for the next 2.5 seconds. This is the most
direct explanation for a remaining perceptual strength difference.

As checked on 2026-07-25, the WASM served by
`https://meml.lnfinitemonkeys.org/next/nisps.wasm` has SHA-256
`d1c58a59517a00c6f51870ea1ec21194561b81058e22bbfb2e11de4af45c645a`, exactly matching
`manifold/public/nisps.wasm` on current main. The reported live behaviour therefore
cannot be explained by production still serving the pre-RMSProp or tapered binary.

### Upstream also cancels a nearby positive; Manifold does not

Upstream’s default replay policy is `REPLACE_10_PERCENT`
(`InterfaceRL.hpp:404-405`). When a negative is stored, a positive within input-space
distance `0.10` is removed before the negative is added
(`InterfaceRL.tpp:904-929,950-979`). Manifold’s replay method only deepens or adds a
negative and leaves positives intact (`nisps/ml/replay.hpp:102-121`). Manifold also
keeps liked examples in the separate MLP dataset
(`manifold/src/feedback/controller.ts:375-390`).

**Inference:** this is less about the first click’s amplitude than persistence. A later
positive training run can pull the mapping back toward a sound rejected near an
existing like, whereas upstream removes that local positive from its continuously
trained replay set.

### Current measured scale

On current main, the native behavioural benchmark at shape `2→16→16→16→8`, seed
`24301`, reports:

- one geometric dislike: at-point L2 movement `0.05335`;
- one legacy undirected Diffuse dislike: `0.22626`;
- repeated geometric dislikes: `0.05314` after 1, `0.33748` after 10, `1.09504`
  after 100.

Commands:

```bash
scripts/bench-ml.sh --native-only --scenario A4_negative_once
scripts/bench-ml.sh --native-only --scenario D1_geo_anatomy
```

These numbers confirm that the current path is no longer inert, but also that a single
geometric press is still about 4.2× smaller than the legacy random-diffusion gesture in
this benchmark. They do not by themselves establish the right musical feel.

At Manifold’s current default PAF shape (`4→10→10→14→33`), the same seeded scenarios
report one-click movement `0.09654` geometric versus `0.20788` Diffuse (about 2.2×
smaller), and geometric movement `0.55935` after ten presses. These are vector L2
distances across 33 parameters, so they establish that weights move; they do not prove
that the affected parameters produce a perceptually obvious timbral change.

The more revealing PAF-shape `A12_like_then_dislike` journey dislikes exactly where a
liked target was taught. With one update, distance from that rejected liked target
changes from `0.38291` to `0.36030` (`rejection_moved=-0.02261`): the mapping moves, but
slightly **toward** the particular target the user just rejected. Ten updates change the
distance to `0.67843` (`rejection_moved=+0.29552`). This is deterministic evidence that
one update is not sufficient to realise the user-facing semantic in an important
contradictory-feedback case; it also motivates testing upstream’s nearby-like removal
separately.

## Why it likely felt weak

1. **Fixed today: optimiser mismatch.** Before `f57cddc`, the port used a tiny upstream
   RMSProp learning rate inside plain SGD, reducing one press to roughly `5.3e-5`
   movement.
2. **Fixed today: superseded push formula.** Before `ec31180`, the port halved the target
   step, used one-third the negative-LR base, and tapered the step by distance—the exact
   case upstream says made “no” ineffective.
3. **Still present: one update versus a time window of updates.** Manifold performs one
   weight update per click; upstream replays all dislikes repeatedly for 2.5 seconds.
4. **Still present: highly asymmetric teaching dose.** A Manifold like trains the whole
   positive dataset at `lr=1.0` for up to 1000 iterations, while a dislike takes one
   roughly `0.0015` RMSProp step. Relative to the lurch caused by a like, correction
   still feels small (`ALIGNMENT.md:66-84`).
5. **Potential persistence mismatch:** nearby likes are retained locally but removed by
   upstream’s default replay policy, so future positive retraining may partly undo the
   rejection.

## Recommended next experiment

Do not start by increasing `geo_lr` blindly. That can make a click stronger but does not
answer whether the intended interaction is one discrete correction or a short-lived
repulsive constraint.

Add a deterministic “advance feedback by `dt`” core seam and benchmark three matched
variants from the same seeded prefix:

1. current one-shot update;
2. upstream-style replay of all negatives for 2500 ms, while separately testing whether
   centroid lookup follows each stored negative or upstream’s current live input;
3. a bounded discrete equivalent (for example 10/25/50 steps at press time) that avoids
   wall-clock ownership in the core.

For each, report at-point movement, neighbourhood rings, global blast ratio, collateral
movement at liked positions, and like→dislike→like persistence. Then perform an
in-Manifold blind A/B at the real per-mode output arities and choose the smallest dose
that makes one rejection obvious without damaging liked regions. Test the nearby-like
removal policy as a separate axis rather than coupling it to dose.
