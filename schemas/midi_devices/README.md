# MIDI device templates

Canonical, committed source of truth for controlling **external hardware synths**
over MIDI CC from NISPS — ingested by **both** the RP2350 firmware and the Manifold
browser engine from one set of files.

## Files

- `../midi_device.schema.json` — Draft 2020-12 meta-schema (validated by codegen).
- `<device>.json` — one template per device. Each param:
  `{ id, cc, label, min, max, default, group }` — `label` is what humans see, `cc`
  is the MIDI Control Change number, `group` is a coarse UI section.
- Verified CC provenance + sources for every device live in `../../synth-midi-cc.json`.

Currently shipped (CC-controllable): `moog_sub37`, `moog_sub_phatty`,
`creamware_pro12_asb`, `elektron_analog_keys`, `asm_hydrasynth`, `roland_jd800`.

## Regenerate after editing

```bash
bun run codegen/generate-midi-devices.ts
```

Emits (do **not** hand-edit the outputs):
- `nisps/midi/generated/midi_devices.hpp` — no-heap `constexpr` (firmware + WASM).
- `manifold/src/midi-devices/generated/` — typed catalogue for the browser.

Idempotent. To (re)derive these files from the research artifact:
`bun run codegen/seed-midi-devices.ts`.

## Using it

**Browser (Manifold, live at `/next/`):** Outputs drawer → MIDI backend →
**Device template** → pick a synth → tick the parameters to control → **Apply**.
This fills the per-output CC table (CC#/channel/name) and the CC count; the result
is savable via the named-preset bar. Parameters are shown by name, not CC number.

**Firmware:** one flashable variant per device. The model maps the joystick to a
curated 8-param subset (`pick_cc_slots` prefers musical params over Bank Select /
housekeeping CCs). Build + flash, e.g.:

```bash
scripts/build-and-flash-firmware.sh ExtSynthSub37
# others: ExtSynthSubPhatty ExtSynthPro12 ExtSynthAnalogKeys ExtSynthHydrasynth ExtSynthJD800
```

Set the synth to receive on the template's `default_channel` (1 by default).

## Notes / caveats

- `default` is a neutral midpoint (64); it's only sent when a param is *fixed*,
  not when the model is driving it live.
- The firmware drives 8 params; the browser can drive as many as the engine has
  outputs. To change the firmware's default subset for a device, reorder/curate
  that device's `params` (or its `group`s) and regenerate — `pick_cc_slots` takes
  the first non-`global` params.
- Roland JD-800 only *receives* a small CC set (its panel sliders emit SysEx);
  Korg Polysix and the Behringer "RD-9" are intentionally excluded (no usable CC).
