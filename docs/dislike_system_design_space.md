# Negative Feedback: Design Space & Tensions

*Dated 2026-06-08. Companion to [`dislike_system_analysis.md`](dislike_system_analysis.md), which describes **what the current system does**. This doc is the opinionated map of **what it could do** and the design choices that are currently made implicitly. Prune or promote entries to beads as decisions get made.*

---

## 0. Why this doc exists

The current dislike system (see the analysis doc) commits to exactly one interpretation of a button press: *avoidance, conditioned on the current control position*. That is a defensible choice, but it is one point in a much larger design space, and the firmware makes the choice **silently** — nothing in the UI or code marks it as *a* choice rather than *the* behaviour. For an interactive instrument where "I don't like this" is the primary teaching signal, the semantics of that signal is a first-class design surface, not an implementation detail.

This doc lays out (1) what the signal can *mean*, (2) two orthogonal *scope* axes that the current system has hard-coded, (3) a catalogue of *mechanisms* that respond to it, (4) how the missing "bad anywhere" case fits the existing architecture, and (5) the unresolved tensions.

---

## 1. The core ambiguity: four kinds of meaning

"I don't like this" is semantically overloaded. At least four *fundamentally different intents* can hide behind one button:

| # | Meaning | The thing being judged | Natural response |
|---|---------|------------------------|------------------|
| 1 | **Absolute value** — "this output is bad" | a point/region in output space, conditioned on input | move away from it |
| 2 | **Relative preference** — "this is *worse than what I just had*" | a comparison between two outputs | rank, don't rate |
| 3 | **Exploration / boredom** — "show me something *else*" | nothing is forbidden; the point is just uninteresting *now* | increase search/novelty |
| 4 | **Navigation / undo** — "the last *change* made it worse" | the transition, not the state | revert recent updates |

The current implementation collapses all four into **#1**. Humans give reliable **preferences** (#2) and noisy absolute ratings (#1); in a creative tool, #3 ("meh, next") is probably the *most common* real intent; #4 treats the replay buffer as a navigation history rather than a training set. None of #2–#4 is expressible today.

---

## 2. The two scope axes (currently hard-coded)

Independently of *meaning*, every negative carries two **scopes**. The current system fixes both and exposes neither.

- **Input-scope** — *where* does the judgement apply?
  `here` (this control-position neighbourhood) ↔ `anywhere` (all input positions).
- **Output-scope** — *what* is being judged?
  this exact output point ↔ a radius `r` in parameter space around it.

```
                output-scope →
                point            radius r
input-scope ↓
  here       (current system)   "this kind of sound is bad HERE"
  anywhere   degenerate*        "this kind of sound is bad, full stop"
```
\* banning a measure-zero point everywhere does nothing — `anywhere` only makes sense with a radius.

The user's two requests map directly onto the **input-scope** axis:

- **"this output is bad *to have happen at this position*"** = `here` × radius → today's behaviour, made deliberate.
- **"this output is bad"** (period) = `anywhere` × radius → **not currently expressible**.

The code makes this concrete: the negative training pair is `(neg_input, pushed_target)`, i.e. it trains `f(neg_input) → away`. The avoidance is anchored to the control position where dislike was pressed. There is no code path that expresses an input-independent ban. So these are not two ends of a spectrum the system handles — one end is simply unbuilt.

**Design move:** make `input-scope` a selectable property of each dislike, and promote the output-space radius `r` to a first-class parameter (a knob, the way input-locality — the `0.05` accumulation distance — implicitly already is).

---

## 3. Mechanism catalogue

Responses to a negative, grouped by which *meaning* they serve. Several are composable.

### Serving #1 (absolute value / avoidance)

- **Repulsion toward positive centroid** *(current)*. Push the disliked action toward the k-NN positive centroid. Needs a positive target to know "which way"; suffers the **phantom-centroid** problem (likes at unrelated inputs pull toward nonsense) and the **cold-start hack** (no likes ⇒ inverted-gradient fallback). See analysis doc §2c, Step 4b.
- **Subtractive / forget.** Don't repel — *delete or down-weight the positive example(s) responsible* for the current output and let the net relax toward its prior/regulariser. Dislike = "retract my own earlier mistake." Kills phantom-centroid (no fabricated target) and cold-start (nothing to forget ⇒ honest no-op) in one move. Does nothing if the bad output is the net's own generalisation rather than a stored like.
- **Repel toward a fixed prior.** Keep repulsion but push toward a designer "home" patch or the net's init instead of a data-derived centroid. Eliminates cold-start *and* phantom-centroid at the cost of pulling everything toward one fixed aesthetic.
- **Hard output-space barrier** *(non-learning)*. A forbidden ball/half-space in parameter space; the MLP output is projected/deflected out of it downstream, before it reaches the synth. Immediate and exact; doesn't fight the net (vs. learning, which keeps trying to enter the region and gets punished forever). The literal reading of "this timbre must *never* happen." Best for **safety/structural** bans.

### Serving #2 (relative preference)

- **Contrastive / pairwise.** Record `prev_output ≻ current_output` and train a ranking loss (Bradley-Terry / triplet margin) instead of a push to a synthetic target. The principled version of what the analysis doc *claims* (RLHF) but doesn't do. Needs a reference ("what is *prev*?" — last like, or the output N callbacks ago); heavier bookkeeping, identical MLP training cost.

### Serving #3 (exploration / boredom)

- **Exploration boost.** Dislike doesn't forbid — it *raises local OU-noise sigma* or kicks the output to a fresh region and lets it re-settle. Nearly free; often the true intent of "I don't like this" in a creative context. Downside: nothing is avoided, so bad regions can recur. (Already listed as future-idea in analysis doc §7.)

### Serving #4 (navigation / undo)

- **Undo / checkpoint.** Like = checkpoint, dislike = revert to last good. Keep a small ring of weight snapshots (the MLP is tiny — cheap on SRAM) or a history of parameter deltas. Ergonomically excellent (save / load-last-good) but it's navigation, not learning — doesn't generalise to new input locations.

### Cross-cutting (refine *any* of the above)

- **Dimension attribution.** "It's not the whole sound, it's *one thing*." Act only on the offending output dim(s) — found by sensitivity, or interactively via the focus control. The existing focus-aware `activeDims_` push is a crude version; making attribution the *point* of dislike is a real design.
- **Stiffness reshaping.** A different complaint entirely: not "this sound is bad" but "this *zone is twitchy*." Flatten the local input→output Jacobian (localised smoothness penalty) so small gestures stop lurching into bad timbres. Addresses playability/dynamics, which nothing else here covers.
- **Dead-zone the input region.** Treat dislike as a statement about the *input* location: collapse output variance there toward a safe default, making that control-zone inert. Lets you "paint out" parts of the surface; changes the instrument's character (zones go dead).

---

## 4. How "bad anywhere" fits the existing architecture

The missing `input-scope = anywhere` case does **not** need a parallel subsystem. The replay item already stores `(input, action, reward)`. Two additions:

1. A field `input_scope ∈ {local, global}` on the negative item.
2. For `global` items, `input` is a **wildcard**.

Then branch in the negative-batch builder of `optimise()`:

- **Local negative** *(today)*: push at its stored input. Unchanged.
- **Global negative**: it has no fixed input, so *instantiate* push-targets lazily — sweep a sample of inputs (the buffer's own stored inputs are a free, already-relevant distribution), run the forward pass, and for any input whose **current output lands within `r` of the banned action**, emit a repulsion pair there. Push *toward* the k-NN positive centroid **computed at that sampled input**.

> **Conceptually: a global ban is a local dislike replicated across the input distribution, evaluated on demand.** One field, one branch — not a second system.

This quietly fixes a latent inconsistency in the current code: today the "toward" centroid is conditioned on the *current* control position but applied to negatives stored at *other* positions (a mismatch). Per-input centroids are more correct for the local case too.

**Cost:** `N_sampled_inputs` extra forward passes per optimise cycle. The net is tiny, so this is bounded and fine on the MCU.

**Or skip learning entirely** for true "never emit this": the **hard output-space barrier** (§3). Arguably you want **both layers**:
- Hard barrier for safety/structural bans (input-independent by nature).
- Learned conditional push for taste (input-conditioned).

---

## 5. Tensions & open decisions

These are the choices that selecting from §§1–4 forces. None is resolved.

1. **Precedence: global ban vs. local like.** A `global` ban can collide with a local positive — "I loved this exact sound *here*" vs. "this sound is banned everywhere." Does a local positive *carve an exception*, or does the ban win? Suggested split: for **taste**, local positives override (bans are defaults, likes are intent); for a **safety** barrier, ban wins.
2. **Radius `r` is now first-class, and it lives in *output* space.** Banning a measure-zero point does nothing. `r` = "how wide is the forbidden timbre zone" and probably wants to be a knob, parallel to the input-locality distance.
3. **Absolute vs. relative signal.** Absolute thumbs are noisy; pairwise preferences are reliable. Moving to #2 is more principled but needs a well-defined reference and more state.
4. **Learning vs. navigation.** Does dislike *teach the mapping* (#1, #2) or *steer through it* (#3, #4)? These feel identical to the user but are architecturally opposite — one mutates weights to generalise, the other treats weights as a place you move around in. Picking per-gesture (below) may beat picking globally.
5. **UX: how is meaning *and* scope selected from one button?** The control surface can disambiguate without conscious mode-switching:
   - Object **while holding a control position** → "bad *here*" (you're pointing at a location).
   - A **ban gesture** (long-press, or pressing with controls at rest — "I'm talking about the *sound*, not a place") → "bad *anywhere*."
   - Short / long / double-press, or press-while-focusing, can additionally select meaning (#3 next vs. #1 avoid vs. dimension attribution).
   The open question is how much intent a single button can carry before it becomes a mode-memory burden.

---

## 6. Recommended first step

Best ratio of *flaw-fixed* to *diff-size*: implement the **subtractive / forget** mechanism (§3) — it directly removes the phantom-centroid and cold-start hacks documented in the analysis doc, and is a more honest model of what shaping an on-the-fly mapping *is* (sculpting your own example set, not fighting a fabricated adversary).

For the input-scope work: spike the `input_scope` field + the global-negative branch (§4) behind a compile flag and A/B it against the current push on hardware, leaving the hard-barrier layer as a separate small follow-up.

---

## 7. Status of ideas (promote to beads when committed)

| Idea | Fixes | Effort | Notes |
|------|-------|--------|-------|
| Subtractive/forget | phantom-centroid, cold-start | small | §3; recommended first |
| `input_scope` local/global + lazy global negatives | missing "bad anywhere" | medium | §4; needs `r` knob |
| Per-input k-NN centroid | current centroid/neg-input mismatch | small | falls out of §4 |
| Hard output-space barrier | true "never emit this" | small | §3; non-learning; safety layer |
| Pairwise/contrastive loss | noisy absolute signal | medium | §3 (#2); needs reference state |
| Exploration boost | no exploration response | small | §3 (#3); analysis doc §7 already lists |
| Gesture-disambiguated dislike | scope/meaning selection | medium (UX) | §5.5 |

---

## 8. Implemented: the `FEEDBACK_MODE` setting (2026-06-08)

A runtime `FEEDBACK_MODE` setting now selects what the thumbs-down (MomA2) toggle does, realising meaning **#3 (exploration)** as a concrete "explore-then-keep" workflow that drops avoidance entirely. Lives in `InterfaceRL` (`src/memllib/examples/InterfaceRL.{hpp,cpp}`); TR8S exposes it via a `RotarySelectView` ("Down Action"). Default `AVOID` is the historical behaviour, so other modes are unaffected.

- **`AVOID`** — unchanged geometric-push avoidance (§3, current system).
- **`RANDOMISE_OUTPUTS`** — down bypasses the MLP and holds a **static random output** (focus-aware via `activeDims_`; re-rolls on each down); up keeps it as a +1 at the current input, resumes inference + learning. Learning is paused while held.
- **`RANDOMISE_MLP`** — down snapshots the live weights and **randomises the net** (live inference continues; the left toggle re-rolls / jolts the temp net); up commits the current output in place, the existing **drag gesture** commits at a repositioned input, and down-again **cancels**. Every exit restores the snapshot and resumes learning, so the kept output trains into the *original* net.

Notes that shaped the implementation:
- Both "keep" paths store `action` (the post-focus output actually heard), consistent with normal likes.
- The like/dislike control (`MomA`) is momentary and fires only on *press* — so the originally-specified "release up to record" isn't possible on that contact; repositioning uses the existing freeze-move-place drag gesture instead.
- Not yet persisted across reboots (defaults to `AVOID` on boot) — a follow-up if wanted.
