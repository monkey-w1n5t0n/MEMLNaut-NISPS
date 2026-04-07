# User Testing

Testing surface, required tools, and resource cost classification.

---

## Validation Surface

**Surface**: Browser (web application)
**URL**: http://localhost:5174 (Vite dev server)
**Comparison URL**: http://localhost:7331/a-immersive.html (old playground app)

**Primary testing tool**: agent-browser
**Secondary tool**: Playwright e2e tests via `window.__nisps` debug probe

### Debug Probe Interface

When loaded with `?debug=1`, `window.__nisps` exposes:

| Method | Returns | Sync/Async |
|--------|---------|------------|
| getOutputs() | Float32Array(126) | Sync |
| getLoss() | number \| null | Sync |
| getWeights() | Float32Array | Sync |
| getExampleCount() | number | Sync |
| setInputs(x, y) | void | Sync |
| thumbsUp() | void | Sync |
| thumbsDown() | void | Sync |
| train() | number (loss) | Sync |
| trainAsync() | Promise<number> | Async |
| randomise() | void | Sync |
| clearExamples() | void | Sync |
| saveState() | void | Sync |
| evalLoss() | number \| null | Sync |
| inferBatch(points) | Float32Array[] | Sync |
| getLayerStats() | object[] | Sync |

`window.__nispsEoc` is ALWAYS available (no ?debug=1 required):
- `trainingTarget` getter/setter ('synth' | 'eoc')
- `imlEoc` getter (WasmIML | null)

### DOM Selectors for Validation

Key CSS selectors for UI state assertions:
- `.dock` — right-side dock container
- `.drawer` — drawer panels (`.hidden` when closed)
- `.heatmap-cell` — heatmap parameter bars
- `.heatmap-cell-bar` — bar width element
- `#status-text` — status line text
- `.rl-btn` — RL thumbs up/down buttons
- `.pill-opt[data-mode]` — output mode pills
- `.joystick-container` — joystick wrapper
- `#joy-map` — joystick canvas
- `.noise-ring` — noise indicator

### Skip List

These assertions require physical hardware and cannot be validated in headless browser:
- VAL-JOY-006 (Gamepad) — requires physical gamepad
- VAL-MIDI-001 (MIDI output) — requires physical MIDI device
- VAL-HAND-002 (Camera) — requires camera permission + gesture

## Validation Concurrency

**Machine specs**: 62GB RAM, 12 CPUs, ~23GB available

**agent-browser instances**:
- Each instance: ~300MB RAM (lightweight app)
- Dev server: ~200MB RAM
- Per-validator total: ~500MB
- Usable headroom (70% of 23GB): ~16GB
- Max concurrent: 5 validators (5 × 500MB = 2.5GB, well within budget)

**Playwright tests**: Run serially (single browser, single server)

---

## Flow Validator Guidance: Browser

**Surface**: Browser-based web application served by Vite dev server

**Isolation rules**:
- Each validator gets its own agent-browser session
- All validators share the same Vite dev server at http://localhost:5174
- localStorage is per-browser-profile — since each agent-browser session is independent, there's no state leakage between validators
- The debug probe (`window.__nisps`) is the primary testing interface; use JavaScript evaluation to call probe methods
- The app state is ephemeral per page load — clearing localStorage or reloading resets state

**Shared state concerns**:
- The Vite dev server is shared — if one validator causes a crash, it affects all validators
- No database or server-side state to worry about
- WASM binary is loaded fresh per page load

**Resource constraints**:
- Max 5 concurrent agent-browser sessions
- Each session: ~300MB RAM + browser process
- Keep screenshots minimal to avoid disk pressure

**Navigation patterns**:
- Load app with `?debug=1` to enable debug probe: `http://localhost:5174/?debug=1`
- Load without query params for production behavior: `http://localhost:5174`
- Use `localStorage.clear()` before tests requiring fresh state
