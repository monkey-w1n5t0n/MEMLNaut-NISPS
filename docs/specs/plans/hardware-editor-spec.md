---
kind: plan
status: active
---

# Manifold as Hardware Editor — MEMLNaut USB-Serial Protocol, Firmware Command Surface, On-Device Persistence

*Dated 2026-07-21. Spec for plan item **§6.5d** (`simplification-plan.md:130`), audit findings **A4** / **S14** /
**L29**, ALIGNMENT **defect 3** (and the live half of **defect 5**). Vision bullet 5: "Manifold doubles as
interface/editor for the hardware MEMLNaut (settings, presets, training, examples, visualisation)."*

**Nothing here is implemented. No code was written for this document.** Every `file:line` below was read from
the working tree on 2026-07-21 and is marked ✓ (verified by reading the file) or ✗ (could not verify — stated
as unknown, never asserted). The tree was mid-flight with concurrent edits from other sessions
(`git status` showed 20+ modified files including `src/main.cpp`, `codegen/generate.ts`, `ConsoleApp.tsx`);
re-check citations in those files before relying on an exact line number.

---

## 1. Ground truth — what exists today

### 1.1 The browser end is a connect-lifecycle shell

| Fact | Evidence |
|---|---|
| `MemlnautSerial` handles `requestPort`/`open`/`close` and a 5-state status store, nothing else | ✓ `manifold/src/serial/memlnaut-serial.ts` (140 lines, not the 237 the audit reports — stale) |
| `saveModel` returns `false`, `restoreModel` returns `null`, `getSettings` returns `{}`, each with a `TODO: real protocol` | ✓ same file, the three methods under `// ---- Protocol stubs ----` |
| Baud 115200 is explicitly a placeholder | ✓ same file, `TODO(memlnaut-serial): negotiate the real baud rate` |
| The only consumer is `EditorPanel.tsx`; the only consumer of *that* is the Settings-drawer `editor` case | ✓ `manifold/src/console/Drawers.tsx:33` (import), `:579` (render). Repo-wide grep for `memlnaut-serial`/`getMemlnautSerial` finds no other importer. |
| `editor` is a top-level dock **output mode**, `audio: false`, description already promises "configure / save / restore" | ✓ `manifold/src/console/output-mode.ts:69-75` |
| The panel already carries an honest "not yet wired" note | ✓ `EditorPanel.tsx`, final `<p>` |

`manifold/src/serial/web-serial.d.ts` is an **ambient** (global) declaration file. Its header comment claims it
declares "just the surface memlnaut-serial.ts uses" — false: `manifold/src/backends/cv-backend.ts:56,95,123,133`
type-checks against the same global `SerialPort`/`navigator.serial`. There is one Web Serial *type* surface and
two *transport* implementations, not three (✓ grep for `navigator.serial|SerialPort` over `manifold/src` returns
exactly `web-serial.d.ts`, `cv-backend.ts`, `memlnaut-serial.ts`).

### 1.2 The firmware end has a USB CDC port, and nothing listening on it

| Fact | Evidence |
|---|---|
| `Serial` (USB CDC) is opened at boot and used **only** for diagnostics | ✓ `firmware/MEMLNaut-NISPS/src/main.cpp:125` (`Serial.begin(115200)`) |
| Core 0's `loop()` prints `"."` ~10×/s and a perf line ~1×/s onto that same stream | ✓ `src/main.cpp:166`, `:172` (`Serial.printf("ml: %d, aud: %d, q: %f\n", …)`) |
| **The USB CDC port is otherwise free**: MIDI runs on `Serial2` (UART1), not USB | ✓ `lib/memllib/src/interface/MIDIInOut.cpp:15` `MIDI_CREATE_CUSTOM_INSTANCE(HardwareSerial, Serial2, MIDI, …)`, `:81-88` |
| USB-MIDI (TinyUSB composite) is compiled out — `MIDI_USB_CLIENT` is defined nowhere | ✓ `MIDIInOut.cpp:55` is `#ifdef MIDI_USB_CLIENT`; grep across `platformio.ini`, `src/`, `glue/` finds no definition. The device enumerates as a plain CDC port. |
| There is no serial *reader* anywhere in firmware — no `Serial.read()`, no parser, no command dispatch | ✓ grep over `src/` + `glue/` |
| Core 0's control cadence is 5 ms (`ML_INFERENCE_PERIOD_US 5000`), core 1's drain 1 ms | ✓ `src/main.cpp:152-160`, `:208-216` |

### 1.3 There is no on-device persistence, but two mechanisms are already compiled in

- **LittleFS** (internal flash). memllib wraps it in `lib/memllib/src/hardware/FlashFS.hpp` ✓ — which has **zero
  consumers** in this repo (✓ grep for `FlashFS` hits only vendored TFT_eSPI example sketches under `.pio/`).
  Two problems with that wrapper: it defines `void begin()` and `bool exists()` as **non-`inline` free functions
  in a header** (✓ read in full — 22 lines), so including it from two translation units is a duplicate-symbol
  link error; and using it at all buys nothing over calling `LittleFS` directly.
- **The filesystem is currently sized to zero.** `platformio.ini` does not set `board_build.filesystem_size`
  (✓ grep), and the platform's default is `"0MB"` (✓ `~/.platformio/platforms/raspberrypi/builder/main.py:63`).
  With `_size == 0`, `LittleFS.begin()` returns `false` immediately (✓
  `~/.platformio/packages/framework-arduinopico/libraries/LittleFS/src/LittleFS.h:173`). **On-device flash
  persistence therefore requires a `platformio.ini` change that alters the flash layout of all 16 envs.**
- **LittleFS writes park core 1.** ✓ `…/LittleFS/src/LittleFS.cpp:186-193` and `:203-209`:
  `noInterrupts(); rp2040.idleOtherCore(); flash_range_program/flash_range_erase(...); rp2040.resumeOtherCore();
  interrupts();`. Core 1 is the audio core. **Any flash write stalls audio for the duration of the erase +
  program.** This is the single hardest constraint in this document.
- **SD card.** memllib ships `interface/SDCard.{hpp,cpp}` (SdFat over hardware SPI) ✓, the MEMLNaut board has
  dedicated SD pins ✓ `lib/memllib/src/hardware/memlnaut/Pins.hpp:87-90` (`SD_CS 13`, `SD_SCK 14`, `SD_MISO 12`,
  `SD_MOSI 15`), and `SDCard.cpp` **already compiles into every variant** ✓ (`.pio/build/pafsynth/…/interface/
  SDCard.cpp.o` exists). SPI writes do **not** lock out core 1. It needs a physical card fitted; whether the
  operator's units have one is ✗ unknown.

### 1.4 The model *is* transferable — the shapes already agree

- Firmware instantiates a compile-time `MLP<…>` whose dims come from the mode's generated schema; the browser
  reshapes its `MLPCore<DynamicStorage>` to **the same schema dims** on every mode switch ✓
  `manifold/src/console/ConsoleApp.tsx:252-257` (`engine.reshape({ inputSize, outputSize, hidden }, defaultSpread)`
  from `mode.ml`). So for a given `mode_id` the two nets have the *same* `weight_count` by construction.
- **But not unconditionally.** The browser also offers an axis-count reshape that changes `inputSize` alone ✓
  `ConsoleApp.tsx:290-322`, and `nisps_ml_create`'s default shape is a 32-input head ✓
  `manifold/src/inputs/input-layer.ts:17,38`. A live browser net can therefore be at `6→[10,10,14]→33` while the
  device is at `4→[10,10,14]→33`. **The protocol must carry the shape and refuse mismatches; it must never infer
  compatibility from `mode_id` alone.**
- Flat weight layout is already specified and identical on both targets: `[l0_w][l1_w][l2_w][l3_w][l0_b][l1_b]
  [l2_b][l3_b]`, little-endian `float32` ✓ `nisps/wasm/bindings.cpp:25-34` (comment), `nisps/ml/mlp.hpp:385-414`
  (`get_weights`/`set_weights`).
- Per-mode blob sizes (computed from `schemas/modes/*.json` ✓):

  | mode | dims | weights+biases | bytes |
  |---|---|---|---|
  | `sound_analysis_midi` | 10→[10,10,14]→8 | 494 | 1 976 |
  | `channel_strip`, `xiasri` | 4→[10,10,14]→24 | 674 | 2 696 |
  | `paf_synth` | 4→[10,10,14]→33 | 809 | 3 236 |
  | `elysiamorf` | 4→[10,14,18]→40 | 1 234 | 4 936 |
  | `verb_fx` | 4→[10,14,18]→47 | 1 367 | 5 468 |
  | `breakor`, `memlcelium`, `slp_workshop` | 4→[10,14,18]→56 | 1 538 | **6 152** |

  Worst case is ~6 KB. Small — but not small enough to sit in one frame without either a 6 KB RX buffer or
  chunking.

### 1.5 Training examples are **not** readable out of the core today

`MLPCore` exposes `example_count()` ✓ `nisps/ml/mlp.hpp:441` and `clear_examples()` ✓ `:443`, but the per-example
accessors `sample_features_(s)` / `sample_labels_(s)` are **private** ✓ `:577`, `:581`. Exporting the training
set from the device is therefore a real (small) addition to `nisps/ml/mlp.hpp`, not a wiring job.

Worse for the editor: the firmware's `FeedbackController` — which owns explore/place state and drives
`add_example` — is a **function-local static inside `bind_peripherals()`** ✓
`firmware/MEMLNaut-NISPS/glue/peripherals.hpp:152`. It is unreachable from `main.cpp` or any command handler.
Any command that touches feedback state requires hoisting it first.

### 1.6 The discipline to copy already exists in-repo

`firmware/useq-celium/shared/protocol.h` ✓ is a C header of `static const` constants + `static inline` helpers,
mirrored constant-for-constant by `manifold/src/backends/useq-protocol.ts` ✓, pinned by
`manifold/src/backends/useq-protocol.test.ts` ✓ (`test('frame sizes match the C header')`), documented as
`kind: spec` in `docs/specs/useq-cv-protocol.md` ✓. The device-side parser is a ~20-line resync state machine ✓
`firmware/useq-celium/main/src/main.cpp:93-110`. **Verified live**: `bun test src tests/*.test.ts` in `manifold/`
→ `23 pass, 0 fail, 6 files, 65 ms`.

### 1.7 L29 — `InputChain`/`OutputChain` have no firmware consumer

✓ Repo-wide grep: the only non-test, non-self references are `nisps/wasm/bindings.cpp:76-77,194-195,968,1011`
and `tests/cpp/{test_pipeline,parity_check}.cpp`. `nisps/pipeline/output_chain.hpp:13` says "firmware would pick
its mode's NOut" — aspirational, present-tense-adjacent, and currently false. `InputChain` already serialises
(`state_size()`, round-trip test ✓ `tests/cpp/test_pipeline.cpp:131-150`), which matters below.

---

## 2. Invariants

Beyond the repo-wide hard constraints (platform-neutral allocation-free `nisps/`; native↔WASM parity ≤1e-5;
schema changes ship both codegen outputs; RT-safe worklet + SPSC dual-core discipline), this area adds:

- **I1 — The wire format has exactly one source of truth.** A single C header under `firmware/`, mirrored in TS,
  pinned by a test that fails when they diverge. No constant is written twice by hand in the same language.
- **I2 — No hand-maintained per-mode table anywhere in the protocol.** Mode identity, net shape, param count and
  ordering reach the wire from codegen output on both sides, or they do not reach it at all.
- **I3 — A model blob is applied only against a proven-identical contract.** Shape *and* schema fingerprint must
  match. On mismatch the device NAKs; it never partially applies, never truncates, never zero-pads.
- **I4 — Serial servicing is bounded.** The core-0 pump reads at most a fixed byte budget per `loop()` iteration.
  The 5 ms `tick_control()` cadence ✓ (`src/main.cpp:152,160`) is not to be perturbed by a host that streams.
- **I5 — Serial handling never runs on core 1.** Core 1 is audio + MIDI drain. All parsing, buffering, filesystem
  and ML mutation happen on core 0.
- **I6 — Flash writes are an explicit, announced, user-initiated act.** Because they park core 1 (§1.3), a
  persist is never automatic, never periodic, and never a side effect of another command.
- **I7 — Diagnostics and protocol do not share the stream unframed.** Either the diagnostics are silenced for the
  session or they are carried inside a frame. Never raw ASCII interleaved with binary payloads.
- **I8 — The device is authoritative about itself.** The browser asks and believes; it never assumes a firmware
  build from a mode name, a port name, or a USB descriptor.
- **I9 — No compat shim.** The stubs are deleted, not deprecated. `EditorPanel` is the only consumer (§1.1).

---

## 3. Design

### 3.1 Transport and channel

USB CDC (`Serial`), 8N1; the CDC baud parameter is ignored by the hardware but the host must supply one —
**115200**, matching what the firmware already calls and what `cv-backend.ts:133` uses. No second UART, no
composite USB device, no TinyUSB reconfiguration.

**The diagnostics collision (I7) is resolved by session state.** On `HELLO` the firmware sets an
`editor_session` flag; while set, `loop()`'s `Serial.println(".")` and perf `printf` (✓ `src/main.cpp:166,172`)
are suppressed and the same information is emitted as a `TELEMETRY` frame instead. `BYE`, a host disconnect
(DTR drop), or a 5 s silence timeout clears the flag and restores the prints. Boot-time prints
(`"Serial initialised."`, `"Bound peripherals to mode."`) happen before any session and are harmless — the
host-side parser drops non-sync bytes anyway.

*Rejected:* moving diagnostics to a second UART (costs pins and a second cable) and CDC-composite dual ports
(complicates the Web Serial port picker for one debug convenience).

### 3.2 Framing

Variable-length, because payloads range from 0 bytes to a 6 KB model (§1.4). Fixed-length-per-type (the useq
choice) does not survive that.

```
 byte 0      sync      0xA5 host→device, 0x5A device→host
 byte 1      type      u8
 bytes 2..3  length    u16 LE, payload bytes, 0..MEMLED_MAX_PAYLOAD
 bytes 4..   payload
 last 2      crc       u16 LE, CRC-16/CCITT-FALSE over bytes [1 .. 3+length]
```

- **CRC-16, not XOR-8.** useq's XOR-8 is right for a 26-byte frame streamed at 100 Hz where a corrupt frame is
  discarded and replaced 10 ms later. It is wrong for a 6 KB model transfer, where a 1-in-256 undetected
  corruption silently installs wrong weights and the user hears an inexplicable instrument. Bitwise CRC-16 is
  ~15 lines, table-free, and identical on both sides.
- **`MEMLED_MAX_PAYLOAD = 512`.** Bounds the device RX buffer at 518 bytes and each frame's service time at
  ~45 ms of wire time worst case — hence I4's byte budget. Larger objects chunk (§3.4).
- Both directions use the same frame shape; only the sync byte differs, so one parser implementation serves
  both ends.

Home: **`firmware/shared/memlnaut-editor-protocol.h`** — deliberately *not* under `firmware/MEMLNaut-NISPS/`,
because it is shared with the browser exactly as `firmware/useq-celium/shared/protocol.h` is. Mirror:
**`manifold/src/serial/memlnaut-protocol.ts`**. Parity test: **`manifold/src/serial/memlnaut-protocol.test.ts`**
(picked up by the existing `bun test src tests/*.test.ts` glob — do not touch that script).

### 3.3 Identity: a codegen-emitted schema fingerprint (discharges I2, I3)

The one genuinely new idea in this spec, and the thing that makes "derive from schema codegen, not hand-defined
tables" concrete.

`codegen/generate.ts` gains one emitted constant per mode: a **FNV-1a 64 hash over a canonical serialisation of
the mode's contract-bearing schema fields** — `mode_id`, `engine_id`, `ml` (`input_size`, `hidden_layers`,
`output_size`, `default_spread`), `params[]` as `(name, min, max, default, curve, group)` in order, and
`voice_spaces` (names + curve overrides) in order. Deliberately **excluded**: `label`, `_note`, `ui` — cosmetic,
and a label edit must not invalidate a user's trained model.

Emitted into both generated worlds in the same change (hard constraint):

- `nisps/modes/generated/<mode>_schema.hpp` → `inline constexpr std::uint64_t k<Mode>SchemaHash = 0x…ull;`
  alongside the existing `k<Mode>ModeId` ✓ (`nisps/modes/generated/paf_synth_schema.hpp:10`)
- `manifold/src/modes/generated/<mode>_schema.ts` → `schema_hash: '0x…'` on the existing `ModeSchema` const

CI already fails on a stale generated tree (`.github/workflows/ci.yml`, step *"Codegen is committed and
idempotent"* ✓ `:129`), and `codegen/tests/golden/paf_synth_schema.{hpp,ts}` ✓ will need regenerating in the
same commit.

The device reports its hash in `DESCRIBE`; the browser compares against **its own** generated hash for that
mode. Equal ⇒ weights, settings and examples are interchangeable. Unequal ⇒ the UI says *"this MEMLNaut is
running a different build of `paf_synth`"* and disables transfer. No table, no version negotiation matrix, no
per-mode special case — and the check is exact rather than heuristic.

### 3.4 Command set (protocol v1)

Types are `static const uint8_t` in the shared header. `ACK`/`NAK` are the universal replies; `NAK` carries a
one-byte reason code from an enum in the same header.

**Host → device**

| Type | Payload | Reply |
|---|---|---|
| `HELLO` | `u16 host_proto_ver` | `DESCRIBE` — opens the session, silences diagnostics |
| `BYE` | — | `ACK` — closes the session, restores diagnostics |
| `GET_MODEL` | — | `MODEL_BEGIN`, then `MODEL_CHUNK`×N |
| `PUT_MODEL_BEGIN` | `u64 schema_hash, u16 dims[5], u32 weight_count, u32 crc32` | `ACK`/`NAK` |
| `PUT_MODEL_CHUNK` | `u16 index, bytes` | `ACK` |
| `PUT_MODEL_END` | — | `ACK` (applied) / `NAK` (CRC or count mismatch — **nothing applied**) |
| `GET_SETTINGS` | — | `SETTINGS` |
| `SET_SETTING` | `u16 id, f32 value` | `ACK`/`NAK` |
| `PERSIST` | `u8 slot` | `ACK`/`NAK` — see I6 |
| `LOAD_PERSISTED` | `u8 slot` | `ACK`/`NAK` |
| `CLEAR_EXAMPLES` | — | `ACK` |
| `SUBSCRIBE` | `u16 mask, u8 rate_hz` | `ACK` — telemetry stream on/off |

**Device → host**

`DESCRIBE`, `MODEL_BEGIN`, `MODEL_CHUNK`, `SETTINGS`, `TELEMETRY`, `LOG` (UTF-8 text, framed — the session
replacement for the raw prints), `ACK`, `NAK`.

`DESCRIBE` payload: `u16 proto_ver`, `u64 schema_hash`, `mode_id` (fixed 24-byte NUL-padded ASCII, from
`generated::k<Mode>ModeId` ✓), `u16 dims[5]`, `u32 weight_count`, `u16 max_examples`, `u16 capability_bits`,
`char fw_build[16]`. The capability bits are what let one protocol serve 16 firmware variants without a
per-variant table: `HAS_PERSIST`, `HAS_SD`, `HAS_EXAMPLE_EXPORT`, `HAS_TELEMETRY`, `IS_SEQUENCER`.

**PUT_MODEL is atomic (I3).** Chunks land in a staging buffer sized `weight_count * 4` — for the largest mode
6 152 bytes of core-0 RAM, allocated as a `static` array sized from `MLPType::weight_count()` at compile time,
so no heap. `set_weights` is called once, from `PUT_MODEL_END`, only after the CRC-32 over the whole blob
matches and `weight_count` and `dims[5]` equal the device's own.

**Settings (I2, honestly).** Not everything can come from codegen, and pretending otherwise would be the
hand-defined table under a different name. The split:

- *Derived from codegen, on both sides:* the training triple `learning_rate` / `max_iterations` / `min_error`
  (defaults + identity from `schemas/ml_defaults.json` → `nisps::ml::generated::kMlTrainDefaults` ✓ and
  `manifold/src/modes/generated/ml_defaults.ts` ✓ — both mirrors already exist), and `voice_space_index` whose
  legal range is the generated `voice_spaces` list ✓.
- *Genuinely device-side, enumerated in the shared header:* `pin_value`, `joystick_single` (the Dual/Single
  toggle ✓ `glue/settings_view.hpp:54-58`), `explore_intensity` (RVX1 ✓ `glue/peripherals.hpp:124-126`),
  `master_volume` (RVGain1 ✓ `:115-117` — note it drives `AudioDriver::SetMasterVolume` directly, not the mode). These are `ModeBase`/peripheral concepts with no schema home; there
  are four of them; they live in one enum in the shared header and nowhere else.

**Telemetry closes ALIGNMENT defect 5's live half.** The `TELEMETRY` payload carries `PERF_GET_MEAN(MLSTATS)`
and `AUDIOLOOP_MEAN` — numbers the firmware **already computes and prints** ✓ `src/main.cpp:172` — plus
`example_count()`, `eval_loss()`, and (paged) the loss history the operator deliberately kept on device
(audit L25). That is the on-device timing report ALIGNMENT defect 5 asks for, at near-zero marginal cost,
displayed in a browser panel that already knows how to draw a loss curve (`console/TrainingHealth.tsx` ✓).

### 3.5 Persistence

**Primary: LittleFS on internal flash**, because it needs no accessory and every unit has it.

Required changes: `board_build.filesystem_size` in `platformio.ini`'s `[env]` block (§1.3 — currently absent,
default `0MB`, `begin()` fails), a `glue/persistence.hpp` that calls `LittleFS` **directly** (not memllib's
`FlashFS.hpp`, whose non-`inline` header functions are a duplicate-symbol trap and which adds nothing — §1.3),
and a fixed on-disk record:

```
/memlnaut/<mode_id>/<slot>.mdl   magic, u16 record_ver, u64 schema_hash, u16 dims[5],
                                 u32 weight_count, f32 weights[], settings block, u32 crc32
```

`schema_hash` on disk is checked on load exactly as on the wire (I3), so a firmware reflash that changes the
schema invalidates old saves loudly instead of loading garbage.

**The audio stall is real and must be surfaced, not hidden.** Sequence for `PERSIST`: mute via
`AudioDriver::SetMasterVolume(0)`, emit `LOG "saving…"`, write, restore volume, `ACK`. The browser shows a
determinate "Saving to device — audio will pause" state. The alternative — pretending a flash erase is free —
would be exactly the kind of plausible-looking lie this repo has been deleting all week.

**Not chosen, but noted:** the SD path (`interface/SDCard.hpp` ✓, already compiled ✓, pins ✓) does not park
core 1 and is the right home for bulk artefacts (full example sets, session recordings) if the operator's units
have cards fitted. Left behind the `HAS_SD` capability bit rather than built speculatively.

### 3.6 Browser side

`manifold/src/serial/memlnaut-serial.ts` is **rewritten, not extended**: the three stub methods and their
`TODO`s are deleted (I9 — sole consumer is `EditorPanel.tsx`, §1.1). The class becomes a framed-transport
driver: a read loop over `port.readable`, a resync parser identical in shape to the TS mirror's encoder, a
promise-keyed request/reply map, and the same `subscribe()` store it already has (which `EditorPanel` already
consumes via `useSyncExternalStore` ✓).

`EditorPanel.tsx` grows: a device card (mode, build, dims, compatibility verdict), Save-to-device /
Load-from-device with the compatibility gate and a progress state, a settings section, and a live telemetry
strip. **The "not yet wired" note is deleted in the same commit as the code that wires it** — a note that
outlives its truth is the failure mode this repo keeps finding.

`output-mode.ts:72`'s description ("configure / save / restore") becomes true and needs no edit. Two small
hygiene items ride along: fix `web-serial.d.ts`'s false header comment (§1.1) and move it to a shared location
now that two modules provably depend on it.

---

## 4. Deletions

| Deleted | Named consumers | Why safe |
|---|---|---|
| `MemlnautSerial.saveModel` / `.restoreModel` / `.getSettings` bodies + `TODO`s | `EditorPanel.tsx` only (✓ grep) | Replaced in the same change; no external caller |
| `EditorPanel`'s "not yet wired" `<p>` | none | Becomes false the moment step 6 lands |
| The unconditional `Serial.println(".")` / perf `printf` in `src/main.cpp:166-175` | none (human eyeball on a serial monitor) | Not deleted — made session-conditional. Outside a session behaviour is unchanged. |
| `lib/memllib/src/hardware/FlashFS.hpp` — *not* deleted | none (✓ zero consumers) | Vendored upstream code; deleting it diverges the vendor tree for no gain (`VENDORED.md` re-sync). We simply do not use it, and `persistence.hpp` says why. |

Nothing else. In particular the `cvgate` backend's Web Serial code stays untouched — different device, different
protocol, no shared transport worth extracting for two implementations.

---

## 5. Sequenced implementation plan

Each step is independently landable and independently verifiable. Steps 1–4 are agent-safe with the existing
gates. Steps 5–8 need hardware and are honestly marked.

**Step 0 — L29 disposition (do first, it is one line either way).**
`nisps/pipeline/output_chain.hpp:13` and `input_chain.hpp`'s header currently imply a firmware consumer that does
not exist (§1.7). If the operator answers **Q4** (below) with "not now", soften both comments to say the chains
are browser-side today, in this step. If "yes", they stay and step 8 fulfils them. Either way L29 stops being an
open lie after step 0.
*Verification:* `bash scripts/lint-cpp.sh` (comment-only change; the lint strips comments before matching ✓).

**Step 1 — the shared header + TS mirror + parity test. No behaviour anywhere.**
`firmware/shared/memlnaut-editor-protocol.h`, `manifold/src/serial/memlnaut-protocol.ts`,
`manifold/src/serial/memlnaut-protocol.test.ts`. Encoder/decoder + CRC-16 in both languages; the test asserts
frame offsets, `MEMLED_MAX_PAYLOAD`, every type byte, and CRC-16 against fixed vectors.
*Verification:* `cd manifold && bun run typecheck && bun run test` (the new test is picked up by the existing
glob — **do not change the test script**). Additionally register a host C++ test that includes the header and
asserts the same vectors: add a source to `nisps_modes_tests`, which already puts the repo root on its include
path for exactly this reason ✓ (`nisps/CMakeLists.txt:134`). Then `bash scripts/build-cpp-tests.sh` proves the C
and TS encoders agree on the same vectors on both sides.
*Note:* `scripts/parity-check.sh` says nothing about any of this — it exercises PAFSynth and ChannelStrip at
all-params-0.5. A green parity run is not evidence for this step.

**Step 2 — codegen emits the schema fingerprint.**
`codegen/generate.ts` + `codegen/lib.ts`; C++ and TS in the same commit; `codegen/tests/golden/*` regenerated.
*Verification:* `cd codegen && bun run generate.ts` twice (idempotence), `bun run test` (golden + curve-drift),
then `bash scripts/build-cpp-tests.sh` (the generated headers are compiled by `nisps_modes_tests` ✓). CI's
"Codegen is committed and idempotent" step ✓ is the backstop.

**Step 3 — firmware command surface, read-only commands.**
`glue/editor_serial.hpp`: the bounded pump (I4), the parser, `HELLO`/`DESCRIBE`/`GET_SETTINGS`/`GET_MODEL`/
`SUBSCRIBE`/`BYE`, the session flag gating the diagnostics. Called from `loop()` on core 0 next to
`tick_control()`. Deliberately no mutation yet.
*Verification (weak, be honest):* `pio run -e slpworkshop -e pafsynth -e selftest` compiles and the flash/RAM
delta is reported (CI's firmware job already does this ✓ `.github/workflows/ci.yml:213,223`). Compilation is
**all** that is verified without hardware. The parser itself should be structured so its byte-level core is
Arduino-free and host-testable — the precedent is `glue/codec_config.hpp`, deliberately Arduino-free and covered
by `tests/cpp/test_mode_driver_config.cpp` ✓. Follow it: put the state machine in the shared header or a pure
sibling, and the `Serial` reads in the glue.

**Step 4 — browser transport + read-only editor UI.**
Rewrite `memlnaut-serial.ts` onto the framed protocol; `EditorPanel` renders `DESCRIBE` + telemetry + the
compatibility verdict. Save/Load still absent.
*Verification:* `bun run typecheck && bun run test && bun run build`. A Playwright e2e can cover the panel's
**disconnected** rendering only — Web Serial cannot be driven headlessly. Do not claim more. The frame codec is
covered by step 1's unit test; the *round trip* is not covered by anything until hardware.

**Step 5 — firmware mutating commands.**
`PUT_MODEL_*` (staging buffer + atomic apply), `SET_SETTING`, `CLEAR_EXAMPLES`. Requires hoisting the
`FeedbackController` out of `bind_peripherals`'s function-local static (§1.5) if any command touches feedback
state; if v1 avoids feedback entirely, say so and leave it.
*Verification:* compile + size. The atomicity logic (CRC-32 accumulate, count check, single `set_weights`) is
host-testable if written as a pure function over spans — do that, and cover it in `nisps_modes_tests`.

**Step 6 — Save-to-device / Load-from-device in the UI**, gated on the schema hash + dims match, with progress
and the explicit incompatibility message. Delete the "not yet wired" note here.
*Verification:* typecheck + unit + build; e2e for the **gate** (a fake `DESCRIBE` with a wrong hash must disable
the buttons) is worth writing because it is pure logic.

**Step 7 — persistence.**
`board_build.filesystem_size` in `platformio.ini` (**changes the flash layout of all 16 envs — rebuild and
re-report sizes**), `glue/persistence.hpp` on `LittleFS` directly, the record format, `PERSIST`/`LOAD_PERSISTED`,
the mute-around-write sequence.
*Verification:* all 16 envs build and the size table is re-baselined (`scripts/build-firmware.sh --all`). The
record encode/decode is pure and host-testable; the flash behaviour, the stall duration, and whether the audio
interruption is acceptable are **operator chokepoints — no automated gate reaches them.**

**Step 8 — (conditional on Q4) `InputChain`/`OutputChain` firmware wiring.**
`InputChain` in `bind_peripherals` between the joystick callbacks and `mode.set_input`; `OutputChain<MLPType::
kOutput>` in `ModeBase::tick_control` before `engine_.set_params`. Both configs become editor settings, which is
the only reason firmware would want them configurable at all. Note the cost honestly: `OutputChain<NMax>` adds an
`NMax`-float state array to every mode instance and a per-tick pass at 200 Hz.
*Verification:* host tests already exist for both chains ✓ (`tests/cpp/test_pipeline.cpp`) and parity stage 7
covers them ✓ (`tests/cpp/parity_check.cpp:341-394`) — but **neither proves the firmware wiring**, and the thing
that actually changes (how the joystick *feels*) can only be judged by ear on hardware.

---

## 6. Open questions — operator only

1. **Persistence medium and the audio stall.** Internal flash (always present, but every save parks core 1 and
   interrupts audio for the erase+program — §1.3) or SD (no stall, but needs a card fitted, and it is ✗ unknown
   whether your units have one)? If flash: is a brief, announced audio interruption on an explicit save
   acceptable, or does that rule flash out?
2. **What "presets" means for the device.** Vision bullet 5 says *settings, presets, training, examples,
   visualisation*. This spec covers settings, model transfer, telemetry, and persistence slots. It does **not**
   define a preset object — and §6.5c (curated/advanced split) is supposed to define exactly that, and is
   scheduled *before* this item. Does the editor wait for 5c's preset model, or ship slots-of-weights now and
   absorb presets later?
3. **Do examples need to leave the device?** Exporting the training set requires a new public accessor on
   `MLPCore` (§1.5) and probably hoisting the `FeedbackController` (§1.5). "Train on device, curate in browser"
   implies yes; "save/restore a model" implies no. This is the difference between a small v1 and a much larger
   one.
4. **L29 / step 8: should firmware gain the browser's input pipeline?** Deadzone, circular clamp, momentum zoom
   and EMA would change the feel of every hardware mode, and only your ears can judge it. If the answer is "not
   now", step 0 softens the comments and the question closes cleanly.
5. **Whose model wins on connect?** When the browser connects and both ends hold a trained net for the same
   mode, does the editor do nothing until told (proposed default), or offer/auto-pull the device's?

## 7. Decisions taken here (not questions)

- CRC-16 for frames, CRC-32 for whole-model transfers, not useq's XOR-8 — §3.2.
- Variable-length frames with a 512-byte cap and chunked models, not one large frame — §3.2, I4.
- Diagnostics silenced by session flag rather than moved to another port — §3.1, I7.
- Compatibility by codegen-emitted schema fingerprint + explicit dims, never by `mode_id` alone — §3.3, I3.
- `LittleFS` called directly; memllib's `FlashFS.hpp` not used and not deleted — §3.5, §4.
- The four device-side settings live in an enum in the shared header, and the spec says plainly that they are
  not codegen-derived rather than pretending — §3.4.
- Protocol header at `firmware/shared/`, not inside `firmware/MEMLNaut-NISPS/`, mirroring useq-celium.

## 8. Where verification is weak

Say this out loud in any PR description that lands these steps:

- **`scripts/parity-check.sh` proves nothing here.** It exercises PAFSynth and ChannelStrip with all params at
  0.5. It touches no serial code, no framing, no persistence.
- **Nothing in CI executes firmware.** The firmware job compiles three envs and reports sizes ✓
  (`.github/workflows/ci.yml:213,223`). A protocol that compiles is not a protocol that works.
- **Web Serial cannot be exercised headlessly.** Playwright can cover the panel's disconnected and
  incompatible-device states, and the frame codec is unit-tested on both sides — the *round trip over a real
  cable* is untested until someone plugs a MEMLNaut in.
- **Mitigation worth building early:** a tiny host-side loopback harness — the TS encoder feeding the C parser
  compiled natively into `nisps_modes_tests` — turns "the two ends agree about bytes" from a hope into a gate,
  and costs about an hour. It still says nothing about USB CDC, flash timing, or feel.
- **Step 7 has no automated gate at all** beyond "16 envs still build". Flash layout, stall duration and
  recovery-after-power-loss are hardware chokepoints.
