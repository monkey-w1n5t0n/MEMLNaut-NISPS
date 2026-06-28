# Upstream Firmware Survey — git archaeology of the MusicallyEmbodiedML ecosystem

_Dated 2026-06-27. Author: research agent (read-only). All SHAs from a fresh `git fetch --all` + memllib submodule-gitdir fetch (incl. operator's memllib fork `monkey-w1n5t0n/memllib`)._

## TL;DR — the divergence headline

**origin/main and upstream/main are two different codebases sharing one ancestor.** They forked at
`6efbe9c` ("voicing", 2026-04-14) and have NOT touched a common file since. origin/main is the
**complete C++20 + SolidJS clean rewrite** (`nisps/`, `playground/`, `firmware/`, schemas/codegen).
upstream/main is the **original Arduino `.ino` + `modes/*.hpp` firmware tree**, which the lab kept
developing in parallel. The 49 commits upstream has that origin lacks are **real firmware features on
an architecture origin deliberately abandoned** — they are *ports*, not *merges*. There is no clean
fast-forward or 3-way merge path; every integration is a re-implementation against the new core.

```
                6efbe9c "voicing" (2026-04-14)  ← merge-base, last shared tree
                /                         \
   origin/main (193 ahead)            upstream/main (49 ahead)
   C++20/SolidJS rewrite              old .ino/modes firmware tree
   pins memllib 4733ca0 (orphan)      pins memllib e291192 (+62 vs origin's line)
```

---

## 1. Branch map

### 1.1 Superproject — `origin` (operator fork) and `upstream` (lab)

| Branch | Remote | Last push | Author | vs its main¹ | Purpose | Judgment |
|---|---|---|---|---|---|---|
| `main` | origin | 2026-06-16 | monkey-w1n5t0n | — | The C++20/SolidJS rewrite. | canonical |
| `feat/feedback-explore-modes` | origin | 2026-06-08 | w1n5t0n | +42 / −193 | Pins memllib `abe93ec` = the `FEEDBACK_MODE` (avoid / randomise-outputs / randomise-MLP) commit. Source material for `docs/redesign/feedback-modes-port-spec.md`. | **real RL work to port** (already spec'd, not yet in main) |
| `feat/useq-celium-opus46` | origin | 2026-06-14 | w1n5t0n | +2 / −36 | MEMLCelium useq experiment (Opus-4.6 session). | experiment — superseded by opus47 |
| `useq-celium-opus47` | origin | 2026-04-20 | w1n5t0n | +6 / −36 | Later MEMLCelium useq iteration. | experiment |
| `feat/unified-preset-system` | origin | 2026-04-16 | w1n5t0n | +46 / −55 | Preset-system spike; heavily diverged, stale. | abandoned/spike |
| `port-solidjs` | origin | 2026-06-14 | w1n5t0n | +31 / −66 | Early SolidJS port scaffolding; main has moved well past it. | superseded by main |
| `main` | upstream | 2026-06-22 | chriskiefer | — | Old firmware tree; LiveFX/VerbFX/DJFX/staticmlp/jolts/noise. | **real firmware to port** |
| `SB2026` | upstream | 2026-05-15 | chriskiefer | +0 / −30² | Superbooth-2026 build: mode sample-rate, **DISLIKES**, screen layout, sample player. **Fully merged into upstream/main.** | merged — port via memllib |
| `SaxFX` | upstream | 2026-05-05 | chriskiefer | +0 / −42² | Sax FX app. **Fully merged into upstream/main.** | merged — historical |
| `bettysax` | upstream | 2026-02-21 | chriskiefer | +1 / −72² | Bettysax; 1 extra commit `c5f0314 "demo"` not in main. | novelty/demo |

¹ "+X / −Y" = (commits the branch is ahead of its own main) / (commits behind). For `git rev-list --left-right --count main...branch` the **left** count is main-only (= how far the branch is *behind*) and the **right** count is branch-only (= *ahead*) — read them in that order. For upstream branches, main = upstream/main.
² SB2026 / SaxFX show ahead=0 because they are *contained in* upstream/main (`git rev-list upstream/main..branch` = 0). The "−30/−42" is just how far main has advanced past their tip.

### 1.2 Submodule — `src/memllib` (lab `origin` = MusicallyEmbodiedML/memllib; `w1n5t0n` = operator fork)

memllib is where the **RL interface (`InterfaceRL`) and the DISLIKES/feedback logic actually live** — the
superproject only pins it. Two pins matter:

- **origin/main superproject pins memllib `4733ca0`** — an **orphaned commit**: not reachable from any
  ref in the lab repo *or* the operator's fork. Likely a rebased/abandoned tip. Cannot be diffed by SHA;
  treat origin/main's memllib as "stale, off-graph."
- **upstream/main superproject pins memllib `e291192`** ("l r input swap", 2026-06-22) — current lab tip,
  and it **already contains the SB2026 dislikes/rlview work** (`80420d1 "rlview and dislike"`,
  `d9bdcd6 "remove dislike opts screen"`).
- **origin/feat/feedback-explore-modes pins memllib `abe93ec`** ("InterfaceRL: add FEEDBACK_MODE setting",
  2026-06-08, authored by w1n5t0n on the operator's fork). This is the operator's own RL feedback commit,
  branched off lab `616b8e7` ("cc select"); it is +1/−6 vs `e291192`.

| memllib branch | Last push | Author | ahead of main³ | Purpose | Judgment |
|---|---|---|---|---|---|
| `main` (e291192) | 2026-06-22 | chriskiefer | — | Current lab RL lib (incl. dislikes). | canonical lib |
| `SB2026` (1997699) | 2026-05-15 | chriskiefer | +0 / −20 | Superbooth dislikes/rlview. **Fully merged into main.** | merged |
| `w1n5t0n/feat/feedback-explore-modes` (abe93ec) | 2026-06-08 | w1n5t0n | +1 / −6 | Operator's FEEDBACK_MODE 3-mode enum. | **real — already spec'd to port** |
| `maincandidate` | 2025-11-06 | chriskiefer | +54 | Pre-2026 staging. | historical |
| `displayview` | 2025-10-13 | chriskiefer | +82 / −11 | Display work. | historical |
| `bettysaxanalysis` | 2025-09-03 | A. Martelloni | +124 | Sax analysis. | historical |
| `display2`, `pafcarl`, `pafsynth`, `bunty_new`, `studiofx`, `xiasri`, `rlversion`, `sdcard`, `superbooth`, `display`, `imlzoom`, `tomchris`, `iceland`, `chris`, `features` | 2025-05…08 | chris / Martelloni | +120…+243 | 2025 app/feature branches. | historical/abandoned |

³ `git rev-list --left-right --count main...branch` inside the memllib gitdir.

### 1.3 Tags

| Tag | Points at | Date | In upstream/main? | In origin/main? | Notes |
|---|---|---|---|---|---|
| `LiveFX_1.0.0` | `701f2d9` | 2026-06-22 | yes | **no** | Newest firmware release; old tree. |
| `VerbFX_1.1.0` | `a18d9c6` | 2026-06-16 | yes | **no** | Large-verb FX release. |
| `DJFX_TR6S_MICROQ` | `ed4ac6d` | 2026-05-25 | yes | **no** | DJFX + TR-6S + MicroQ firmware. |
| `MEMLCelium_0_1_alpha` | `1e441cb` | 2026-04-20 | yes | **no** | MEMLCelium alpha; old tree. |
| `PAF_1_1_0` | `bae80fb` | 2026-03-29 | yes | **yes** | Pre-fork; in both. |
| `VerbFX` | `bae80fb` | 2026-03-29 | yes | **yes** | Same commit as PAF_1_1_0; pre-fork. |

Only the two pre-fork tags (`bae80fb`) exist in origin/main. Every release tag from `MEMLCelium_0_1_alpha`
onward marks **old-tree firmware origin/main never received**.

### 1.4 Sibling org repos (`gh repo list MusicallyEmbodiedML`, 70 repos)

Active / firmware-relevant:
- **`memlp`** (2026-06-24) — the underlying NN library for microcontrollers; memllib's dependency. Recently active.
- **`memllib`** (2026-06-22) — the RL/interface lib (the submodule). The live one.
- **`MEMLNaut`** (2025-11-13) — the hardware/board repo.
- **`memlp_tests` / `memlp_test` / `RLTests`** — test harnesses for the NN/RL libs; relevant if porting RL behavior and wanting reference vectors.
- **`musicallyembodiedml.github.io`** (2026-06-22) — the docs site referenced by CLAUDE.md.

Everything else is a 2024–2025 per-app fork (PAF, Xiasri, studioFX, euclidean, FM, subtractive, XMOS-era
boards, etc.) — historical context, **not integration targets**. The whole "one repo per app" pattern is
exactly what the `nisps/` rewrite consolidates; these forks are the museum.

---

## 2. Dated timeline

| Date | Event |
|---|---|
| 2026-03-29 | `bae80fb` — `PAF_1_1_0` / `VerbFX` tags. Last point both trees share a tag. |
| **2026-04-14** | **`6efbe9c` "voicing" — fork point (merge-base of origin/main & upstream/main).** |
| 2026-04-20 | `MEMLCelium_0_1_alpha` (`1e441cb`); memllib `psram`. First upstream-only release. |
| 2026-05-05 | upstream `SaxFX` branch tip (`33b6542 "memlib sub"`). (NB: `fcef420 "sax fx ftw"` is a *2026-05-15* commit on upstream/main, **not** the SaxFX tip — earlier draft conflated them.) |
| 2026-05-15 | upstream `SB2026` tip (`c617fcc` "mode sample rate, **dislikes**, screen layout, sample player"). memllib `SB2026` (`1997699`). |
| 2026-05-25 | `DJFX_TR6S_MICROQ` (`ed4ac6d`). |
| 2026-06-08 | origin `feat/feedback-explore-modes` — operator's `FEEDBACK_MODE` work; memllib fork `abe93ec`. |
| 2026-06-16 | **origin/main HEAD** (`f256217`, AudioWorklet fix). `VerbFX_1.1.0` (`a18d9c6`) on upstream. |
| 2026-06-22 | **upstream/main HEAD** (`701f2d9` "livefx"); `LiveFX_1.0.0`. memllib main `e291192`. |
| 2026-06-27 | This survey. |

---

## 3. Git relationships

- **Merge-base (superproject):** `6efbe9c` ("voicing", 2026-04-14).
- **origin/main vs upstream/main:** `git rev-list --left-right --count` = **193 / 49** (origin 193 ahead = the
  entire rewrite; upstream 49 ahead = continued old-tree firmware). The trees are disjoint above the base:
  upstream/main's top-level is `*.ino`, `modes/`, `voicespaces/`, `*AudioApp.hpp`; origin/main's is `nisps/`,
  `playground/`, `firmware/`, `schemas/`, `codegen/`. **Correction (verified):** it is *not* true that "no file
  is co-modified." A `git merge-tree`/name-status comparison above the base shows ~20 paths the two sides both
  touched — but for nearly all of them the relationship is **delete-on-origin / modify-on-upstream** (the old
  `.ino`, `modes/*.hpp`, `voicespaces/VerbFX/basic.hpp`, `src/memlp`), i.e. delete/modify *conflicts*, not
  content overlaps. The one genuine both-sides-`M` conflict is the **`src/memllib` gitlink** (origin → `4733ca0`,
  upstream → `e291192`). So the practical conclusion stands — every path resolves to a conflict (delete/modify or
  submodule-pin) with nothing cleanly 3-way-mergeable; upstream commits must be hand-ported — but the literal
  "no file is co-modified" was wrong.
- **What origin/main is *behind* on (the 49):** the upstream-only firmware features — newest first:
  `701f2d9 livefx`, `a18d9c6 verbfx`, `0538eb9 staticmlp`, `99bd9b1 jolts`, `7ceac18 noise` /
  `a6e7af1 explore noise update`, `75e0f44 large verb`, `414590b tr8s home mapping` / `be6eac7 fx, tr8s` /
  `5a34a4a djfx single-cc fix`, `d1182f1 djfx alpha`, `24c2ad8 d50, sysex`, `1436250 midi output select`,
  `98c7449 input selection`, `fcef420 sax fx`, `c617fcc SB dislikes/sample-rate/sample-player`,
  `ee2814e focus targets memlcelium`, `47fc77b/2429bcc geo push rlview`, `d301cc7 rlview and dislike`.
- **What origin/main is *ahead* on (the 193):** the whole platform — `nisps/` core, 8 engines as concepts,
  CRTP modes, WASM bridge, SolidJS playground, schemas/codegen, verification harness (golden+parity+lint+CI),
  a-immersive feature parity. None of this exists upstream.
- **memllib pin divergence:** origin/main → `4733ca0` (**orphaned**, off-graph); upstream/main → `e291192`
  (current, +62 commits on the lab main line, includes dislikes). origin's memllib pin is effectively
  abandoned and should be re-pinned regardless of what else is ported.
- **SB2026 / SaxFX are dead branches** (fully folded into upstream/main); the *content* worth taking is
  reachable from upstream/main and from memllib main. **bettysax** has one stray `c5f0314 "demo"` commit —
  ignorable.

---

## 4. Ranked integration recommendations

Because the architectures are disjoint, "integrate" means **port the behavior into `nisps/` + `playground/`**,
not `git merge`. Ranked by mission impact (RL/feedback richness and firmware-feature parity).

### Rank 1 — Land the FEEDBACK / DISLIKES port (origin already did the hard part)
- **Source commits:** memllib `abe93ec` (operator's `FEEDBACK_MODE` 3-mode enum) on
  `origin/feat/feedback-explore-modes`; cross-checked against memllib main `80420d1`/`d9bdcd6` (SB2026 dislikes
  in `InterfaceRL`) which upstream/main pins via `e291192`.
- **Why first:** This is the negative-feedback / RL core of the whole project, and the work is *already
  written up* as an implementation-ready spec at `docs/redesign/feedback-modes-port-spec.md` (new
  `nisps::ml::FeedbackController<MLP_T>`, WASM C API, 11 ctest cases, parity Stage 5). The branch
  `feat/feedback-explore-modes` and the half-present `nisps/ml/feedback.hpp` + `tests/cpp/test_mlp_feedback.cpp`
  in the working tree show this is mid-flight. **Finish it and merge to main.** The spec's AVOID reconciliation
  decision (route to existing `move_weights`, skip the firmware-only k-NN geometric centroid push) is sound and
  should be recorded in `ALIGNMENT.md`.
- **Action:** complete `nisps/ml/feedback.hpp`, wire WASM bindings + `mode-runtime.ts`, land the tests, re-pin
  memllib off the orphan. Do **not** try to port the old `ReplayMemory` geometric push now (out of scope per spec).

### Rank 2 — Re-pin memllib off the orphaned `4733ca0`
- **Source:** memllib main `e291192` (or `abe93ec` if you want the feedback commit pinned directly).
- **Why:** origin/main pins an off-graph commit nothing can resolve; this is a latent footgun (a fresh
  `submodule update` cannot check it out cleanly from the canonical remote). Pin to a real, reachable commit
  as part of Rank 1. Low effort, removes a trap.

### Rank 3 — Port the new upstream firmware engines as `nisps/` engines (selective)
The 49 upstream commits are firmware apps on the old tree. Port the ones with mission value, highest-value first:
- **`a18d9c6 verbfx` / `75e0f44 large verb`** (→ `VerbFX_1.1.0`): origin already has `verb_fx`; diff the upstream
  large-verb params and bring improvements into the engine. **Medium effort, high audio value.**
- **`d1182f1 djfx alpha` + `ed4ac6d` (→ `DJFX_TR6S_MICROQ`) + `5a34a4a` single-CC fix:** DJFX is a *new* engine
  not in origin's 8. Port as a new `nisps/engines/` engine + mode + schema if DJFX is wanted in the playground.
  **Higher effort (new engine).**
- **`701f2d9/adbc058 livefx` (→ `LiveFX_1.0.0`):** newest app; evaluate whether it subsumes existing FX modes
  before porting.
- **`0538eb9 staticmlp` + `99bd9b1 jolts` + `7ceac18 noise`/`a6e7af1 explore-noise`:** these are *RL/exploration*
  changes (static-MLP hold, jolts, explore-noise) that overlap conceptually with the Rank-1 feedback work and
  with origin's existing spread/noise model. Review them **alongside** the feedback port — some may already be
  covered by `RandomiseMlp`/`RandomiseOutputs`; "explore noise" likely maps to the existing `spread`/OU-noise
  knobs. **Audit before porting to avoid duplicating behavior.**
- **`414590b tr8s home mapping` / `be6eac7 fx, tr8s` / `10b8fca dynamic focus for TR8S` / `296bec6 target
  selection`:** the TR-8S focus-mask / dynamic-focus work is the firmware analogue of the `activeDims_` focus
  feature the feedback spec already accounts for. Useful reference for the focus-mask UI; port the *mask
  semantics*, not the firmware display code.

### Rank 4 — Take SB2026 sample-rate / sample-player only if needed
- **Source:** `c617fcc` (SB2026, already in upstream/main). Per-mode sample rate and a sample player are
  firmware-platform features; the playground runs through an AudioWorklet, so most of this is N/A. Port only the
  per-mode sample-rate concept if a mode genuinely needs it. **Low priority.**

### Do NOT integrate
- `port-solidjs`, `feat/unified-preset-system`, `feat/useq-celium-opus46`, `useq-celium-opus47` (origin):
  superseded/abandoned spikes — main has moved past them.
- upstream `SaxFX`, `bettysax` (incl. `c5f0314 "demo"`): app-specific / demo, no mission value to the rewrite.
- All 2024–2025 memllib feature branches and per-app org forks: historical museum.

---

## 5. Surprises

1. **upstream/main is the *old* tree, not "main ahead of the fork."** The naming invites the assumption that
   upstream advanced the same codebase; it didn't — the lab kept shipping the pre-rewrite `.ino` firmware. The
   49 commits are a *parallel* line, never to be fast-forwarded.
2. **origin/main pins an orphaned memllib commit (`4733ca0`)** that exists in neither the lab repo nor the
   operator's own memllib fork — an off-graph gitlink that a clean checkout cannot resolve.
3. **The dislikes/RL feedback work the task flagged as "to find" is already (a) merged into upstream via SB2026
   → memllib `e291192`, AND (b) re-implemented by the operator on `feat/feedback-explore-modes` (memllib
   `abe93ec`), AND (c) fully spec'd for the new core** in `docs/redesign/feedback-modes-port-spec.md` — with
   `nisps/ml/feedback.hpp` and `tests/cpp/test_mlp_feedback.cpp` already present (untracked) in the working tree.
   The feedback integration is not a research question; it's a half-finished implementation to land.

---

## Verification (checked against source)

_Adversarial re-check, 2026-06-27, independent of the original author. Re-ran the git/gh commands and a fresh
bare clone of lab + operator-fork memllib._

**Confirmed correct:**
- Merge-base `6efbe9c` "voicing" 2026-04-14 (`git merge-base origin/main upstream/main`).
- origin/main HEAD `f256217` 2026-06-16; upstream/main HEAD `701f2d9` "livefx" 2026-06-22.
- origin 193 ahead / upstream 49 ahead (`git rev-list --left-right --count origin/main...upstream/main`); the 49 upstream-only commits and the specific SHAs cited in §3 (`701f2d9`, `a18d9c6`, `0538eb9`, `99bd9b1`, `7ceac18`, `a6e7af1`, `75e0f44`, `414590b`, `be6eac7`, `5a34a4a`, `d1182f1`, `24c2ad8`, `1436250`, `98c7449`, `fcef420`, `c617fcc`, `ee2814e`, `47fc77b`, `2429bcc`, `d301cc7`) all resolve with matching messages.
- **memllib `4733ca0` is genuinely orphaned** — `git cat-file` fails for it even after fetching BOTH `MusicallyEmbodiedML/memllib` and `monkey-w1n5t0n/memllib` into a bare clone. The survey's headline surprise holds.
- memllib main = `e291192` and contains `80420d1 "rlview and dislike"` + `d9bdcd6 "remove dislike opts screen"`.
- memllib `abe93ec` "InterfaceRL: add FEEDBACK_MODE setting" 2026-06-08 by w1n5t0n, branched off `616b8e7 "cc select"`, +1/−6 vs main; superproject `feat/feedback-explore-modes` pins it.
- All six tags (`LiveFX_1.0.0` `701f2d9`, `VerbFX_1.1.0` `a18d9c6`, `DJFX_TR6S_MICROQ` `ed4ac6d`, `MEMLCelium_0_1_alpha` `1e441cb`, `PAF_1_1_0`/`VerbFX` `bae80fb`) — SHAs, dates, and origin/upstream containment all match.
- Upstream branch ahead/behind: SB2026 `c617fcc` +0/−30, SaxFX +0/−42, bettysax +1/−72 with stray `c5f0314 "demo"`; memllib SB2026 = `1997699`.

**Corrected (real errors found):**
1. **Origin-branch ahead/behind columns were inverted** in table 1.1 (the author read the `--left-right` left/right columns the wrong way round). Real values: `feat/feedback-explore-modes` +42/−193 (was +193/−42); `feat/useq-celium-opus46` +2/−36; `useq-celium-opus47` +6/−36; `feat/unified-preset-system` +46/−55; `port-solidjs` +31/−66. Fixed in table 1.1 and footnote ¹. (These branches are all *behind* main by ~the full rewrite, which is the opposite of what the original numbers implied.)
2. **SaxFX timeline tip was wrong** (§2): the SaxFX branch tip is `33b6542 "memlib sub"` (2026-05-05), not `fcef420 "sax fx ftw"` — `fcef420` is a 2026-05-15 upstream/main commit, not on SaxFX. Date was right, SHA/message wrong. Fixed.
3. **"No file is co-modified" (§3) was literally false.** ~20 paths are touched on both sides; for almost all the relation is delete-on-origin/modify-on-upstream (a conflict), and `src/memllib` is a genuine both-`M` submodule-pin conflict. The downstream conclusion (no clean 3-way merge; hand-port required) is unaffected. Fixed in §3.

The substance of the survey — disjoint trees, hand-port-only integration, orphaned memllib pin, feedback work already spec'd/half-implemented, ranked recommendations — survives verification. The errors are in the branch-delta bookkeeping, one timeline SHA, and one overstated absolute.

---

## Correction (2026-06-27, from the RL judge-panel skeptic, verified against source)

The **latest upstream `InterfaceRL` tip is `0a541cc` "highlighting"** (990 lines; `optimise()` at `:601`,
`kCentroidK=4` at the hpp `:296`, decay `0.0025f` at `:664`, `negLRRatio` at `:742`) — NOT `e291192`/`abe93ec`,
which are older. **Mode 1 "Geometric dislike" must be ported to `0a541cc` parity.** Note: the in-tree submodule
gitdir resolves none of `4733ca0`/`e291192`/`abe93ec`/`0a541cc` — only the separate `-upstream` memllib
checkout has them; the orphaned-pin footgun stands and `0a541cc` is the re-pin/port target. See
`docs/redesign/rl-feedback-design.md` §1 for the verified-ground-truth list.
