# `reference/` — upstream source of truth, never compiled

These four files are `examples/InterfaceRL.{hpp,cpp,tpp}` +
`examples/InterfaceRLFileFormat.hpp`, copied verbatim from
[`MusicallyEmbodiedML/memllib`](https://github.com/MusicallyEmbodiedML/memllib) at
commit `e291192d8e4f2fca7b79670c4df9c2ec8bdf03cd` — the same commit the rest of this
vendored tree pins (see `../VENDORED.md`).

## Why they are here

`InterfaceRL` is the reference implementation of the whole NISPS feedback subsystem.
`nisps/ml/geo_push.hpp`, `nisps/ml/replay.hpp`, `nisps/ml/feedback.hpp`,
`nisps/ml/jolt.hpp` and `nisps/ml/ou_noise.hpp` are all ports of it, and several of them
still carry `// upstream InterfaceRL.hpp:NNN` line references.

The Phase-4 vendoring dropped `examples/` because nothing compiled it. That was correct
for the build and wrong for the codebase: with the source of truth out of tree, upstream
redesigned the geometric dislike (deleted the `/(1+len)` taper, doubled
`kGeometricPushScale`, tripled the negative-LR base, moved to batch training over all
negatives every tick) and we did not notice for months. Keeping these files in-tree turns
the next upstream drift into a `diff` instead of an archaeology session.

## Rules

- **Never compiled.** This directory sits OUTSIDE `../src/`, and PlatformIO's Library
  Dependency Finder only recursively compiles an Arduino-format library's `src/` folder
  (`../VENDORED.md` explains that mechanism at length). Do not move these under `src/`
  and do not add them to any build.
- **Never edited.** They are upstream's bytes. Our behaviour lives in `nisps/ml/`. A
  divergence from upstream is a decision recorded in `ALIGNMENT.md` or a task, not an
  edit here.
- **Re-sync with the rest of the tree**, in the same step and to the same commit —
  `../VENDORED.md` § "Re-syncing with upstream".
