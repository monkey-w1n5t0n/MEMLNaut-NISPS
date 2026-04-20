# uSEQ-Celium — browser-driven CV/gate over WebSerial

uSEQ-Celium turns a uSEQ v1.0 module + 8-channel expander into a pure CV/gate
output stage driven from the NISPS playground browser app. All rhythm shaping
(voice-engine ratioSeq, gate timing, velocity dynamics) and continuous CV
generation (dual-MLP mapped from gamepad sticks) run in the browser; the
firmware is a dumb translator that reads `StateSnapshot` packets over USB CDC
and sets 3 main CVs + 3 hard gates + 8 expander CVs. See
[`protocol.md`](./protocol.md) for the wire format.

## Quick-start

### 1. Flash firmware (main + expander)

```bash
cd firmware/useq-celium
pio run -e main     -t upload   # uSEQ v1.0 main module
pio run -e expander -t upload   # expander board
```

The `-t checkprogsize` target builds without flashing. Both envs target
RP2040 via the Earle Philhower arduino-pico core.

### 2. Serve the playground

```bash
cd playground && python3 -m http.server 8000
# open http://localhost:8000/a-immersive.html
```

Select the `uSEQ-Celium` pill in the Mode drawer (right-hand dock → Mode).
Click **Connect uSEQ** and pick the serial device corresponding to the main
module. The state producer starts immediately and streams `StateSnapshot`
packets at 500 Hz.

WebSerial works only on Chromium-family browsers (Chrome, Edge, Brave). On
Firefox / Safari the Connect button stays disabled.

## UI overview

The uSEQ-Celium drawer contains:

- **Connect uSEQ** — serial connect/disconnect. Status readout next to it.
- **PANIC** — one-click zero-all-outputs. Keyboard **Escape** while the
  drawer is open triggers the same. A green **Resume** button appears
  alongside; click it (or press Escape again after restart) to restore the
  composer's snapshot source. Panic state is never persisted.
- **Arch** — editable voice count (1–4) and MLP hidden layers (rhythm +
  CV MLP). Rebuilding the rhythm MLP drops training examples (by design —
  output size changes).
- **Training** — thumbs-up / add-example / clear / randomise for each MLP.
  Driven by the two gamepad sticks (left stick → rhythm MLP inputs; right
  stick → CV MLP inputs).
- **BPM** — 30–300 BPM slider driving the voice engine.
- **Routing** — 14-channel table. Each channel picks a `mode` + `source`:
  - Channels 0–2 (hard gates): source = `voice-N` (0–3) or `none`.
  - Channels 3–5 (main CV), 6–13 (expander CV): mode = `continuous`
    (source = `cv-mlp-N` index or `static` with a value) OR mode =
    `dynamic-gate` (source = `voice-N`, outputs velocity while the gate
    is high).

## Testing without hardware

```bash
node firmware/useq-celium/tools/loopback_smoke.mjs --pattern ramp --duration 5
```

Spins up a loopback transport (socat PTY pair if available, TCP fallback
otherwise) and runs the browser-side `encodeStateSnapshot` through a Node
port of the firmware parser. Checks framing + CRC + sequence continuity.
Exit 0 = `PASS`, exit 1 = `FAIL`. See
[`firmware/useq-celium/tools/README.md`](../../firmware/useq-celium/tools/README.md).

Playwright mode-switch smoke: `npx playwright test tests/e2e/useq-celium-mode.spec.js`
(doesn't touch real hardware; asserts the drawer wires up correctly).

## Known limitations

- **ratioSeq phaseOffset semantics**: `ratio-seq.js` applies `phaseOffset`
  once in JS; the C++ firmware reference (MEMLCelium mode in the main
  firmware) may apply it twice (once in the generator, once in the phasor).
  If you patch the generator against firmware behaviour, reconcile then.
- **MLP weight I/O**: import/export uses `nisps-wasm.js`'s `_getFlatWeights`
  / `_setFlatWeights` private-prefix accessors. If the WASM wrapper renames
  those (see `playground/js/nisps/nisps-wasm.js`), the adapter's session
  export/import will need a parallel rename.
- **Voice-count change**: changing voice count rebuilds the rhythm MLP
  (`nOutputs = voiceCount * 7`) and wipes training examples. Weights are
  drawn fresh. This is a deliberate design choice — storing + remapping
  across arch changes wasn't worth the complexity for this mode.
- **WebSerial only on Chromium**: Firefox / Safari / iOS won't work. A TCP
  fallback exists in the loopback smoke test but is not wired into the
  browser bridge.

## Further reading

- [`protocol.md`](./protocol.md) — wire protocol (StateSnapshot,
  ExpanderFrame, CRC8, framing rules).
- [`../../firmware/useq-celium/tools/README.md`](../../firmware/useq-celium/tools/README.md) —
  harness / smoke-test usage.
- `tests/e2e/useq-celium-mode.spec.js` — mode-switch Playwright test.
