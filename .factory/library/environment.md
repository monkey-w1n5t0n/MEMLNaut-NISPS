# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external dependencies, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## External Dependencies

- **Node.js**: v25.4.0
- **npm**: v11.7.0
- **Playwright**: v1.59.1 (chromium headless shell v1217 installed)
- **Emscripten**: NOT required — existing WASM binaries are transplanted as-is

## WASM Binaries (transplanted from playground/)

- `public/nisps.wasm` (36KB) — ML engine
- `public/nisps.js` (14KB) — Emscripten glue
- `public/nisps-wasm-worker.js` — Training worker (from playground/js/nisps/)
- `public/c15/c15_engine.wasm` (270KB) — C15 synthesizer
- `public/c15/parameters.json` (163KB) — C15 parameter definitions
- `public/c15/worklet-processor.js` — C15 AudioWorklet
- `public/faust/` — Faust DSP files (fetched at runtime)

## CDN Dependencies

- **MediaPipe** (cdn.jsdelivr.net): Hand tracking only, lazy-loaded on mode switch to Hands
- **Google Fonts**: JetBrains Mono (loaded in index.html)

## Browser Requirements

- SharedArrayBuffer support (requires COOP/COEP headers)
- WebMIDI support (MIDI CC mode)
- AudioWorklet support (C15 synth)
- getUserMedia (hand tracking camera)
- Gamepad API (gamepad input)

## Platform Notes

- Linux x86_64 (kernel 6.14.0)
- No Docker
- 62GB RAM, 12 CPU cores
- ffmpeg 7.1.1 available (not used by SolidJS app)
