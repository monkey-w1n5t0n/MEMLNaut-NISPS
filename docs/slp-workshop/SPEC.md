# SLP-Workshop — output modes, gate sequences & config UX

**Status:** DRAFT / spec-only (2026-06-28). The SLP-Workshop firmware exists as
the `slp_workshop` mode (Synth Library Portland workshop; reuses the MEMLCelium
engine + MLP shape verbatim, foregrounds the Jolt / OU-noise learning gestures —
branch `workshop/synth-fw-audit`). The **three output modes** below are a planned
evolution: compile-time *slices* of that mode. This document specs the mode model,
the Manifold-side gate-sequence configuration, and a proposed UI so the firmware
and the browser app stay aligned. The output-mode slicing + Manifold config are
NOT implemented yet.

Companion docs: `docs/useq-celium/protocol.md` (the CV wire protocol), the
manifold backends (`manifold/src/backends/`), the input layer
(`manifold/src/inputs/`).

**Decisions locked (2026-06-28, operator):** (1) hardware keeps exactly 2 ratio
sequences (memlcelium verbatim); the browser may instantiate as many as the user
wants. (2) The 3 uSEQ gate-only jacks make gates *optional* — pure CV is valid;
if doing gates at all, use those 3 first, then convert CV jacks. (3) Split-net
input is per-input-channel engine routing (each pad/stick/CC tagged Continuous or
Rhythm). (4) Internal BPM clock now; external-MIDI-clock sync is a later nicety.

---

## 1. Ground truth: what `memlcelium` actually is

`memlcelium` is the **hybrid**, and it is **one MLP**, not two:

- Net: `MLP<4, [10,14,18], 56>` (`nisps/engines/memlcelium.hpp`).
- The 56 outputs are split:
  - `[0..13]` — **sequencer**: 2 sequences × **7 ratio-seq params** each.
  - `[14..55]` — **synthesis**: 42 continuous params (Voice 0 + Voice 1).
- The single net therefore produces **both** the continuous values **and** the
  RatioSeq parameters. An internal RatioSeq tick turns the seq params into note
  triggers; the engine already exposes `pop_events()` so those triggers can be
  consumed externally (MIDI / CV / gate) — that is the hook for gate outputs.

So the **two-separate-networks** hybrid is a genuinely different topology (two MLP
heads), which is why the hardware does the shared-net version and only the browser
(more compute, dynamic) does the split one.

### 7 ratio-seq params per track

`ratios[0..2]` (3), `phasor_mul` (1), `phase_off` (1), `amp_ratios[0..1]` (2) = 7.
(The April browser uSEQ-Celium used 8 — it added a pulse-width param. Use **7**
for firmware parity; pulse width can be an optional 8th later.)

---

## 2. The unifying model: two output STREAMS

Everything below collapses to two output streams, each driven by an MLP head:

| Stream         | MLP outputs                      | Generates            | Routes to            |
|----------------|----------------------------------|----------------------|----------------------|
| **Continuous** | 1 value per channel              | smooth 0..1 values   | MIDI CC / CV jack    |
| **Rhythm**     | 7 params per gate-sequence track | clock-driven gates   | MIDI note / gate jack|

A **mode** is just *which streams are active* and *whether they share a network*.

### How the Rhythm stream generates gates (RatioSeq)

Per gate-sequence track, each control tick (`nisps/engines/*` `ratio_seq_*`):

1. A shared **internal-BPM clock** advances a bar phasor. (External-MIDI-clock
   sync is a desirable later addition, not a launch requirement — operator.)
2. `seq_phasor = (bar_phasor × phasor_mul + phase_off) mod 1`.
3. `ratio_seq_3(seq_phasor, ratios, pw=0.5)` → **boolean gate** (the 3 ratios
   carve the cycle into proportional segments; the phasor's segment + pulse-width
   decide high/low).
4. `ratio_seq_2(amp_ratios)` → **2-level velocity** (127 / 64).
5. Rising edge → note-on / gate-high (with velocity); falling edge → note-off /
   gate-low.

So a gate is **clock + learned pattern**, not a threshold on a continuous value —
this is what makes "Rhythm" a distinct stream, and why it needs its own 7-params
per track rather than one output per gate.

**Defaults = firmware parity** (pulse width fixed at 0.5; 2-level velocity). Two
deferred extensions, not blocking: a per-track **pulse-width** (the 8th param →
controllable gate length, matters for envelope vs trigger) and **continuous
velocity/accent** instead of the 127/64 two-level. Add later if the workshop
wants them.

> Where RatioSeq runs in the browser: when the active engine *is* the memlcelium /
> SLP WASM engine, consume `pop_events()`. For CV/MIDI modes that don't run that
> audio engine, a small **TS RatioSeq** fed by the Rhythm MLP's 7-params/track
> drives the gates. (Implementation note — not built yet.)

---

## 3. Modes

### Firmware (SLP-Workshop) — compile-time, one chosen at build

Always **exactly 2 ratio sequences** (memlcelium verbatim) — the firmware does not
vary sequence count.

| Mode                  | Streams              | Net | MLP output_size            |
|-----------------------|----------------------|-----|----------------------------|
| **Continuous only**   | Continuous           | 1   | continuous params only     |
| **Continuous & Rhythm** (= memlcelium) | both, **shared** | 1 | 14 seq + 42 synth = 56 |
| **Rhythm only**       | Rhythm               | 1   | 2 × 7 = 14 seq params      |

### Browser (Manifold) — dynamic, switchable live

Same three **plus** a fourth, and with **as many ratio sequences as the user wants**
(each gate sequence = its own independent 7-param track; the net reshapes to suit):

- **Continuous & Rhythm (split nets)** — Continuous MLP + a separate Rhythm MLP.
  Browser-only (two MLP heads; hardware uses one). `output_size`: shared net =
  `continuous + 7 × n_gates` (mind the 126-output WASM cap → ~16 gates max shared);
  split net = the Rhythm net is sized independently, so it scales further.

The browser mode is implied by the Outputs config (§4), not a separate picker:
choosing continuous-count > 0 and gate-sequences = 0 ⇒ Continuous-only;
gates > 0 with Shared net ⇒ hybrid-shared; gates > 0 with Separate net ⇒
hybrid-split; continuous-count = 0 ⇒ Rhythm-only.

---

## 4. Configuring gate sequences (Manifold, CV **and** MIDI modes)

The user can add **gate-sequence outputs** in both CV and MIDI modes. Two new
controls only; everything else is automatic.

### 4.1 The two output kinds

- **Continuous** → CC (MIDI) / CV jack (CV).
- **Gate sequence** → note (MIDI) / gate jack (CV). Each = one RatioSeq track.

**MIDI mode** — two independent steppers (capped by the model output budget):

```
Continuous (CC):   [ 8 ]
Gate sequences:    [ 2 ]      each → a rhythm track → note on/off
```

**CV mode** — hardware is fixed (11 PWM/CV-capable + 3 digital/gate-only), so the
two counts are *linked*. Gates are **optional** — pure CV (0 gates) is valid. One
control:

```
uSEQ jacks            CV 11 · Gate 0
Gate sequences  0 ●───────────── 14
                └ first 3 are FREE (the gate-only digital jacks); the 4th+ convert a CV jack
```

Rule: `gates ∈ [0, 14]`; `CV = gates ≤ 3 ? 11 : 14 − gates`. So the first 3 gate
sequences land on the dedicated gate-only jacks and cost no CV (gates 0→11 CV;
3→11 CV; 6→8 CV; 14→0 CV). "Add more gates by swapping CV outs to gate outs" only
kicks in past 3. (If you want gates at all, those 3 gate-only jacks are there to
use; if you don't, they sit idle and you keep all 11 CV.)

> Wire-protocol impact: **none**. A CV jack acting as a gate just carries 0/full
> (or the 2-level velocity) in its `u16` slot; the 3 dedicated gate bits stay the
> digital pins (`docs/useq-celium/protocol.md`). The CV backend's `CvSpec` already
> lets any output target a CV *or* a gate channel — this extends it so PWM jacks
> can be gate targets too.

### 4.2 The Rhythm network (shown only when gate sequences > 0)

```
Rhythm network:   ( Shared )   ( Separate ◀ default )
```

- **Separate** (default): the Rhythm stream gets its **own MLP**, so each input
  channel is **routed to one of the two engines** (Continuous or Rhythm). The
  routing is automatic per source kind:
  - **XY pad (internal)** → a **second on-screen XY pad** appears; pad 1 →
    Continuous, pad 2 → Rhythm.
  - **Gamepad** → **double-stick**: left stick → Continuous, right stick → Rhythm.
  - **MIDI controller** → **per-CC routing**: each learned CC has a small
    `Continuous | Rhythm` toggle, so the user assigns which knobs drive which
    engine. (The pad/gamepad cases are just the pre-grouped 2-axis versions of
    this same per-channel routing.)
- **Shared**: one MLP drives both streams; **all** input channels feed the single
  net (one pad / one stick / all CCs). This is the hardware-parity hybrid.

That is the whole decision surface: **two numbers + one toggle.** The second
pad / double-stick / per-CC tag is a *consequence* of Separate, surfaced inline,
not a separate mode control. It reuses the existing input layer
(`InputSource.axisCount()` already supports gamepad single↔double-stick; per-axis
labels exist via `axisLabels()`) — "Separate" adds an engine tag per input axis
and composes a second `xy-pad` source / flips the gamepad to 4-axis as needed.

### 4.3 Per-output detail (advanced, optional)

In `BackendAdvanced` (full-depth modal), each output row can override the
defaults: which model output drives each CC/CV; which rhythm track drives each
note/gate; gate threshold (for continuous-derived gates); MIDI note#/channel; CV
polarity. Defaults (identity assignment) make this unnecessary for the common case.

---

## 5. Proposed UI summary (the "simple" target)

Outputs panel, top to bottom:

1. **Output kinds** — `Continuous [n]` + `Gate sequences [n]` (MIDI), or the
   linked `Gate sequences 0–14` slider with the live `CV n · Gate n` readout (CV).
2. **Rhythm network** toggle `( Shared | Separate )` + the inline input surface
   (2nd pad / double-stick / per-CC engine tags) — only when gate sequences > 0.
3. The existing per-output rows (off/fixed/live, mute, arm, min/max/curve) +
   the per-backend specifics (CC#, CV jack, note#) as today.

No mode dropdown for the rhythm/continuous split — the counts + toggle *are* the
mode.

---

## 6. Open questions / deltas to build later

Build deltas (when we proceed):

- **Manifold engine**: today one MLP head on the spine. "Separate" needs a second
  Rhythm MLP head + per-input-axis engine routing. Scope: engine + input-layer.
- **TS RatioSeq**: a browser-side RatioSeq (or a `pop_events()` bridge) to turn
  Rhythm-MLP params into gate/note events for the CV & MIDI backends. 2 sequences
  on firmware; arbitrary count in the browser.
- **MIDI backend**: gate sequences → note on/off (it currently only sends CC).
- **CvSpec**: allow PWM jacks (cv1..cv11) to be gate targets (incl. velocity-CV),
  with the 3 digital pins as the first-used gate jacks.
- **Reshape**: shared-net `output_size` = continuous + 7 × gate_sequences (≤126
  WASM cap) — confirm against the reshape/reset-on-reshape flow.
- **Firmware output_size** for "Continuous only" / "Rhythm only" — slices of the
  `slp_workshop` mode (`workshop/synth-fw-audit`); the firmware agent's call. This
  doc fixes the *shapes*, not exact counts.

Deferred niceties (explicitly not blocking): external-MIDI-clock sync; per-track
pulse-width (gate length); continuous velocity/accent beyond 127/64.
