# Dislike System: Technical & ML Analysis

*This doc describes **what the current system does**. For the broader design space — what "I don't like this" could mean, the input-/output-scope axes, alternative mechanisms, and the unresolved tensions — see [`dislike_system_design_space.md`](dislike_system_design_space.md).*

## 1. What it does, conceptually

The dislike system is a form of **interactive reinforcement learning with human feedback (RLHF)**, but heavily simplified for an embedded context. The user presses a button to say "I don't like what the synthesizer is doing right now." The system records that moment as a negative experience and trains the neural network to avoid reproducing that output, while ideally being guided toward the territory of positive (liked) outputs.

There is no environment model, no critic network, no TD learning. The MLP is both policy and target — it is trained directly by supervised targets that are constructed from human feedback.

---

## 2. Technical walkthrough

### 2a. When dislike is pressed — `_perform_dislike_action()`

The current sensor state (`controlInput`) and the network's current output (`action`) are stored together as a negative experience. If a nearby negative item already exists in the buffer (input distance < 0.05), its reward is made more negative (accumulated, capped at `-kMaxDislikeMultiplier`). Otherwise, one new item is stored with `reward = -1.0`.

`dislikeMultiplier_` doubles on each press (capped at 16) — it is reflected in the display and amplifies the push step in training.

### 2b. When like is pressed — `_perform_like_action()`

One item is stored with `reward = +1.0`. `dislikeMultiplier_` resets to 1.

### 2c. Per-cycle: `optimise()`

Every `optimiseDivisor` audio callbacks this runs:

**Step 1 — Compute input-conditioned centroid (k-NN)**

The `kCentroidK` (=4) positive memories whose stored `controlInput` is nearest to the current `controlInput` are averaged into `meanPositiveAction`. This is the contextually-relevant push target.

**Step 2 — Positive training batch (random sample)**

8 random items are drawn from the buffer. Those with positive reward train the network with:
```
lr = learningRateScaled * avgRewardPos
```

**Step 3 — Negative training batch (full scan)**

All items with `reward <= 0` are scanned. Each item's reward is decayed proportionally:
```
reward += 0.0025 * max(|reward|, 1.0)
```
Items with larger-magnitude rewards decay faster, so all items expire in roughly the same wall-clock time regardless of accumulated multiplier. Items are removed when `reward > -0.01`.

**Step 4 — Geometric push** *(only when ≥1 positive memory exists — see "Cold start" below)*

```
pushStep = clamp(|avgRewardNeg|, 0.25, 1.0) * 0.5
```

For each disliked action, a direction vector points from that action toward the positive centroid. The push is tapered by proximity to the centroid:
```
effectivePushStep = pushStep / (1 + len)
```
where `len` is the Euclidean distance from `neg_action` to `meanPositiveAction`. Actions already far from liked territory receive weaker pushes.

Only active parameter dimensions (from `activeDims_`) are moved; unfocused dimensions are left unchanged.

*Degenerate direction.* If a disliked action sits essentially **on** the centroid (`len <= 1e-4`), the toward-centroid direction is undefined. Rather than producing a zero push, each active dimension is instead nudged in a **random** direction (`d ∈ [-1, 1)` per dim). So disliking a sound that already resembles your liked prototype yields a random jolt, not a no-op.

**Step 4b — Cold start (no positive memories yet)**

The geometric push is guarded by `if (posMemCount > 0)`. Until at least one **like** has been recorded there is no centroid to push toward, so dislike falls back to training the negative batch *directly* with a **negative** learning rate:
```
lr = learningRateScaled * 0.1 * avgRewardNeg     // avgRewardNeg < 0  ⇒  lr < 0
```
This is plain inverted-gradient repulsion — gradient *ascent* away from the disliked output — not the contrastive metric-learning push. The "move toward the liked prototype" behaviour only engages once the buffer holds a positive example. The factor `0.1` keeps this cold-start push an order of magnitude gentler than a normal positive update.

**Step 5 — Dynamic negative LR**

```
negFraction = batchSizeNeg / (batchSizeNeg + totalPosCount)
negLRRatio  = 0.5 - 0.4 * negFraction
```
- Few dislikes → ratio ≈ 0.5 (push hard)
- Equal mix → ratio ≈ 0.3
- Flooded with dislikes → ratio ≈ 0.1 (prevent collapse)

**Step 6 — Multiplier decay**

When items expire, `dislikeMultiplier_` halves per expired item, and fully resets to 1 if no negatives remain.

---

## 3. ML theory framing

This is closest to **imitation learning with negative examples** — specifically a simplified variant of contrastive supervised learning. The geometric push is a form of **metric learning**: given a state, push the output away from the disliked action and toward a positive prototype (the centroid). The reward decay is equivalent to **hard forgetting with a linear schedule**. (This framing applies to the warm path only — before any like exists, dislike degrades to inverted-gradient repulsion with no positive target; see Step 4b.)

It is not actor-critic RL (no value function), not Q-learning (no Bellman update), and not policy gradient (no log-probability weighting).

---

## 4. Strengths

**a. Interactive and immediate** — Human feedback is incorporated within one optimise cycle.

**b. State-conditioned** — Dislikes are anchored to specific sensor states, not just actions in isolation. The network learns "given state S, don't produce X", not just "never produce X".

**c. Geometric push preserves direction** — The push direction has semantic meaning: away from disliked, toward liked. This is more principled than inverting gradients, which pushes in a direction determined by the loss topology.

**d. Exponential multiplier accumulation** — Repeated dislikes in the same area build up emphasis without the user adjusting any parameter.

**e. Multiplier decay on expiry** — The multiplier tracks actual negative content in the buffer, rising and falling automatically.

**f. Full scan for negatives** — Every active dislike pushes every cycle (no sampling miss).

---

## 5. Weaknesses

**a. ~~Context-blind centroid~~** *(fixed: now k-NN)* — The original global centroid averaged across all input contexts; likes at very different states produced a phantom target.

**b. Positive centroid ignores time** — The centroid is unweighted by recency. Old likes have equal influence as recent ones.

**c. The 64-item buffer is small and undifferentiated** — No separate allocation for positive vs. negative items.

**d. ~~Reward decay is input-independent~~** *(partially fixed: decay now proportional to magnitude)* — All items still decay at the same rate per unit of |reward|.

**e. ~~pushStep magnitude is fixed~~** *(fixed: now tapers with distance from centroid)*

**f. No per-dimension weighting** — All output dimensions are treated equally; perceptually important parameters receive the same push as irrelevant ones.

**g. ~~Normalised direction without per-item magnitude~~** *(partially addressed: effectivePushStep tapers with distance)*

**h. ~~Duplicate-copy storage~~** *(fixed: accumulate reward instead)*

**i. Like resets multiplier globally** — A single like immediately drops emphasis even if the user still wants strong dislike sensitivity in the area.

**j. No exploration signal from dislikes** — There is no mechanism to increase exploration after a dislike; OU noise handles general exploration but is not boosted in response.

---

## 6. Improvements implemented

| # | Improvement | Where |
|---|---|---|
| a | Input-conditioned k-NN centroid (k=4) | `optimise()` |
| d | Accumulate reward into existing nearby item; proportional decay; capped pushStep | `_perform_dislike_action()`, `optimise()` |
| e | Push tapers by `1/(1+len)` where len = distance from centroid | `optimise()`, inner loop |
| g | Focus-aware push via `activeDims_`; wired in Braykore, MEMLCelium, BreakOr | `InterfaceRL.hpp/.cpp`, 3 mode files |
| i | Dynamic negative LR ratio: `0.5 - 0.4*negFraction` | `optimise()` |

## 7. Future improvement ideas

These are *tactical* refinements to the current avoidance mechanism. For *strategic* alternatives — different semantics for the feedback signal entirely, the input-/output-scope axes, and the "bad here" vs "bad anywhere" distinction — see [`dislike_system_design_space.md`](dislike_system_design_space.md).

- **Recency-weighted centroid** — exponentially weight positive memories by recency
- **Separate positive/negative buffer pools** — prevent dislike storm from evicting all positive history
- **Per-dimension weighting** — weight push by parameter perceptual importance (e.g., via FocusManager group priority)
- **Dislike-triggered noise boost** — temporarily increase OU noise sigma after a dislike to encourage exploration away from the disliked region
- **Adaptive decay based on current network output** — decay an item faster once the network's current output has moved away from the stored disliked action
