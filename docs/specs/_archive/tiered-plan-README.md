---
deprecated-by: 2026-07-13
superseded-by: MAIN.md
---

# Tiered Specs — MEMLNaut-NISPS (Deprecated)

**Note:** This tiered planning approach was not built out; the corpus adopted a flat MAIN.md layout instead (see `docs/specs/MAIN.md`).

This corpus was the **prescriptive plan** for the project: what we are building and why, organised from
high-level intent down to implementation specifics. It is distinct from the two orienting docs at the repo
root:

- **`MAP.md`** — "what *is*" (neutral inventory of the code as it stands). Voice: stenographer.
- **`ALIGNMENT.md`** — "how good is what is, vs. what we need" (dated, opinionated gap diagnosis). Voice: critic.
- **`docs/specs/` (this corpus)** — "what we are *going to build*" (prescriptive, tiered). Voice: architect.

## The five tiers

```
T0  Mission                        [SHARED across all products]
T1  Capabilities & Principles      [SHARED]
T2  Architecture & Contracts
     ├ contracts spine (schema/codegen, ML-core API, ControlEvent/outputs, crystallization)  [SHARED]
     ├ core engine architecture
     ├ firmware architecture
     ├ playground architecture
     └ backends architecture
T3  Component Design   →  core | playground | firmware | backends   (branches per product)
T4  Implementation specifics  →  (same branches)  →  spawn bd issues/epics
```

Files:

| Tier | File(s) | Status |
|------|---------|--------|
| T0 | `T0-mission.md` | **draft — awaiting audit** |
| T1 | `T1-capabilities-and-principles.md` | **draft — awaiting audit** |
| T2 | `T2-architecture-and-contracts.md` (+ per-product sections) | not started |
| T3 | `T3-component-design/{core,playground,firmware,backends}.md` | not started |
| T4 | `T4-implementation/{core,playground,firmware,backends}.md` → beads | not started |
| — | `00-decisions-log.md` | the interview outcomes that seed these tiers |
| ref | `slp-workshop-firmware.md` | **evolving** — SLP-Workshop: Part I shipped (mode + Jolt / OU-explore gestures), Part II planned (output modes, gate sequences, Manifold config UX) |

## Audit protocol (why tiers exist)

The point of tiering: **each tier is audited and agreed before the tier below it is authored.** A change is
only made *downstream* of a tier when that tier itself got something wrong. So:

1. T0 + T1 are reviewed and approved first (they constrain everything).
2. Only then is T2 authored; reviewed; approved.
3. Only then T3; then T4 → beads → execution.

If review of a lower tier reveals that an upper tier is wrong, **fix the upper tier first**, then propagate.
Every tier file ends with a "Traces up to" line citing the tier(s) above it that justify its content.

## Keeping it honest

Per the project's doc-sync rule: when code changes invalidate a spec, update the spec in the same commit.
When a T4 item is implemented and verified, it migrates from "spec" to MAP.md ("what is"); the spec entry
is pruned. Stale prescription is worse than none.

Recon that seeded this corpus: `.local/recon/dossier/00-GROUND-TRUTH.md` + `00-DECISIONS.md`.
