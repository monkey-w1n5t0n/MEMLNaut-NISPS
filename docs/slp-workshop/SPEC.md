# SLP-Workshop — output modes, gate sequences & config UX

**Status:** DRAFT / spec-only (2026-06-28). The SLP-Workshop firmware (a fork of
`memlcelium`) is being built by another agent and is WIP. This document specs the
mode model, the Manifold-side gate-sequence configuration, and a proposed UI so
the firmware and the browser app stay aligned. Nothing here is implemented yet.

Companion docs: `docs/useq-celium/protocol.md` (the CV wire protocol), the
manifold backends (`manifold/src/backends/`), the input layer
(`manifold/src/inputs/`).

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

1. A shared **clock** advances a bar phasor (BPM-driven).
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

> Where RatioSeq runs in the browser: when the active engine *is* the memlcelium /
> SLP WASM engine, consume `pop_events()`. For CV/MIDI modes that don't run that
> audio engine, a small **TS RatioSeq** fed by the Rhythm MLP's 7-params/track
> drives the gates. (Implementation note — not built yet.)

---

## 3. Modes

### Firmware (SLP-Workshop) — compile-time, one chosen at build

| Mode                  | Streams              | Net | MLP output_size (≈)        |
|-----------------------|----------------------|-----|----------------------------|
| **Continuous only**   | Continuous           | 1   | continuous params only     |
| **Continuous & Rhythm** (= memlcelium) | both, **shared** | 1 | 14 seq + 42 synth = 56 |
| **Rhythm only**       | Rhythm               | 1   | 7 × n_tracks (e.g. 14)     |

### Browser (Manifold) — dynamic, switchable live

Same three **plus** a fourth:

- **Continuous & Rhythm (split nets)** — Continuous MLP + a separate Rhythm MLP.
  Browser-only (two MLP heads; hardware uses one).

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
two counts are *linked*. One control:

```
uSEQ jacks            CV 8 · Gate 6
Gate sequences  3 ●───────────── 14
                └ 3 are free (digital pins); each extra converts a CV jack
```

Rule: `gates ∈ [3, 14]`, `CV = 14 − gates` (so CV ∈ [0, 11]; gates=3 ⇒ CV=11).
"Add more gates by swapping CV outs to gate outs" = dragging this up past 3.

> Wire-protocol impact: **none**. A CV jack acting as a gate just carries 0/full
> (or the 2-level velocity) in its `u16` slot; the 3 dedicated gate bits stay the
> digital pins (`docs/useq-celium/protocol.md`). The CV backend's `CvSpec` already
> lets any output target a CV *or* a gate channel — this extends it so PWM jacks
> can be gate targets too.

### 4.2 The Rhythm network (shown only when gate sequences > 0)

```
Rhythm network:   ( Shared )   ( Separate ◀ default )
```

- **Separate** (default): the Rhythm stream gets its **own MLP**. The input is
  then automatic, following the active input source:
  - **XY pad (internal)** → a **second on-screen XY pad** appears (the Rhythm
    pad); the first drives Continuous.
  - **Gamepad** → the controller switches to **double-stick**: **left stick →
    Continuous**, **right stick → Rhythm**.
- **Shared**: one MLP drives both streams; a **single** input source feeds it
  (one pad / one stick). This is the hardware-parity hybrid.

That is the whole decision surface: **two numbers + one toggle.** The second
pad / double-stick is a consequence shown as an explanatory line, not a separate
control. It reuses the existing input layer (`InputSource.axisCount()` already
supports gamepad single↔double-stick; "Separate" composes a second `xy-pad`
source or flips the gamepad to 4-axis).

### 4.3 Per-output detail (advanced, optional)

In `BackendAdvanced` (full-depth modal), each output row can override the
defaults: which model output drives each CC/CV; which rhythm track drives each
note/gate; gate threshold (for continuous-derived gates); MIDI note#/channel; CV
polarity. Defaults (identity assignment) make this unnecessary for the common case.

---

## 5. Proposed UI summary (the "simple" target)

Outputs panel, top to bottom:

1. **Output kinds** — `Continuous [n]` + `Gate sequences [n]` (MIDI), or the
   linked `Gate sequences 3–14` slider with the live `CV n · Gate n` readout (CV).
2. **Rhythm network** toggle `( Shared | Separate )` + the one-line input
   explainer — only when gate sequences > 0.
3. The existing per-output rows (off/fixed/live, mute, arm, min/max/curve) +
   the per-backend specifics (CC#, CV jack, note#) as today.

No mode dropdown for the rhythm/continuous split — the counts + toggle *are* the
mode.

---

## 6. Open questions / deltas to build later

- **Manifold engine**: today one MLP head on the spine. "Separate" needs a second
  Rhythm MLP head + a second input slice. Scope: engine + input-layer change.
- **TS RatioSeq**: a browser-side RatioSeq (or a `pop_events()` bridge) to turn
  Rhythm-MLP params into gate/note events for the CV & MIDI backends.
- **MIDI backend**: gate sequences → note on/off (it currently only sends CC).
- **CvSpec**: allow PWM jacks (cv1..cv11) to be gate targets (velocity gate),
  with the digital pins still the always-on 3.
- **Reshape**: the dynamic browser net's `output_size` = continuous_count +
  7 × gate_sequences (shared) — confirm against the reshape/reset-on-reshape flow.
- **Firmware output_size** for "Continuous only" / "Rhythm only" — the other
  agent's call; this doc only fixes the *shapes*, not exact counts.
