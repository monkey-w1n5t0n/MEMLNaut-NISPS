# codegen — schemas → C++ + TypeScript

Bun scripts that turn the JSON schemas under `schemas/` into generated code for both
targets. The per-file inventory lives in `MAP.md` (§ `codegen/`) — this README only
covers how to run it.

- `generate.ts` — validates `schemas/modes/*.json` against `schemas/schema.json`, emits
  `nisps/modes/generated/<mode>_schema.hpp` (+ `schema_types.hpp`) and
  `manifold/src/modes/generated/<mode>_schema.ts` (+ `types.ts`, `index.ts`).
- `generate-midi-devices.ts` — validates `schemas/midi_devices/*.json` against
  `schemas/midi_device.schema.json`, emits `nisps/midi/generated/midi_devices.hpp` and
  `manifold/src/midi-devices/generated/{types,devices,index}.ts`.

Both validate with ajv (Draft 2020-12), exit non-zero on failure, and are idempotent
(re-running with unchanged schemas is byte-identical).

## Run

```bash
cd codegen
bun install
bun run generate.ts               # mode schemas
bun run generate-midi-devices.ts  # MIDI device templates
```

Schema or codegen changes ship with the regenerated C++ **and** TypeScript in the same
commit — CI re-runs both generators and fails on any diff.

## Golden test

`tests/golden_test.ts` re-runs `generate.ts` against the live output dirs, diffs
`paf_synth_schema.{hpp,ts}` against the snapshots in `tests/golden/`, then re-runs to
prove idempotency:

```bash
bun run test
```

After an intentional emission change, refresh the goldens:

```bash
bun run generate.ts
cp ../nisps/modes/generated/paf_synth_schema.hpp tests/golden/
cp ../manifold/src/modes/generated/paf_synth_schema.ts tests/golden/
```

## Adding a mode / device

Drop the new JSON into `schemas/modes/` (or `schemas/midi_devices/`), run the matching
generator, and commit the JSON plus the regenerated outputs together.
