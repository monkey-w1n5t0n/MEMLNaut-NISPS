# MEMLNaut Mode-Schema Codegen

Bun + TypeScript tool that turns `schemas/modes/*.json` into:

- C++ headers under `nisps/modes/generated/<mode_id>_schema.hpp` (`constexpr` data, no runtime cost).
- TypeScript modules under `playground/src/modes/generated/<mode_id>_schema.ts` (typed `ModeSchema` objects).

The schemas are validated against `schemas/schema.json` (JSON Schema Draft 2020-12) on every run. Codegen exits non-zero if any schema fails validation.

## Run

```bash
cd codegen
bun install        # one-shot, fetches ajv + types
bun run generate.ts   # or: bun run generate
```

The script writes everything into the two output dirs in one shot. Re-running with no schema changes is a no-op (byte-identical output).

## Tests

`tests/golden_test.ts` regenerates from the live schemas into a temp dir and diffs against `tests/golden/`. The golden directory contains a snapshot of `paf_synth_schema.{hpp,ts}`. To refresh after intentional codegen changes:

```bash
bun run generate.ts
cp ../nisps/modes/generated/paf_synth_schema.hpp tests/golden/
cp ../playground/src/modes/generated/paf_synth_schema.ts tests/golden/
```

Run the test:

```bash
bun run test
```

## Adding a new mode

1. Drop a new `<mode_id>.json` into `schemas/modes/` (must validate against `schemas/schema.json`).
2. Run `bun run generate.ts`.
3. Commit the JSON + the regenerated C++/TS pair.

## Layout

```
codegen/
├── package.json         # ajv (+ formats) + bun-types
├── tsconfig.json
├── generate.ts          # ~400 lines, single entrypoint
├── README.md            # this file
├── templates/           # reference templates (NOT consumed — for review)
│   ├── cpp_schema.hpp.template
│   └── ts_schema.ts.template
└── tests/
    ├── golden_test.ts   # diffs latest output against tests/golden/
    └── golden/
        ├── paf_synth_schema.hpp
        └── paf_synth_schema.ts
```

## Conventions

- **C++ namespace**: `nisps::modes::generated`. All generated symbols are `inline constexpr` so `#include`-ing the header in multiple TUs is safe.
- **C++ types**: `std::array`, `std::string_view`, `std::size_t`. No `std::vector`, no heap.
- **`Curve` enum**: declared in `nisps/modes/generated/schema_types.hpp` as a temporary local copy. Once stream 1 lands `nisps/core/math.hpp`, replace the local enum with an `#include` (search for `TODO(stream-1)` in the generated header).
- **Float literals**: emitted with explicit `.f` suffix and decimal point, per the perf contract (architecture §3.3).
- **Order**: schemas are processed in alphabetical order of mode_id so output is stable.
- **Naming**: `mode_id` is `snake_case` in JSON; the generated C++ const prefix is `k` + PascalCase (e.g. `kPafSynthParams`); TS const is PascalCase + `Schema` (e.g. `PafSynthSchema`).
