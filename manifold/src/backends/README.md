# Output Backends (`manifold/src/backends/`)

Real output transports for the Manifold app. Exactly one backend is *active* at a
time, chosen by the dock **Mode** (Particle / MIDI / OSC / VCV / Built-in Synth /
Editor → `BackendId`). The `BackendManager` consumes the engine spine and
forwards each routed output vector to the active backend's `send()`.

See `docs/redesign/backends-spec.md` for the authoritative design.

## Files

| File | Role |
|---|---|
| `backend.ts` | The `OutputBackend` interface + `BackendContext` / `OutputMapping` / `BackendStatus`. |
| `mapping.ts` | Universal per-output baseline mapping (`applyCurve`, `mapOutput`) — shared by all backends, input-clamped. |
| `manager.ts` | `BackendManager` — single spine consumer; switches/teardowns backends; **gates synth audio**. |
| `midi-backend.ts` | `WebMidiBackend` — real Web MIDI CC out (per-output CC#/channel/range/name, throttled + dead-zone). |
| `osc-client.ts` | `NispsOscClient` — WS transport to the Deno OSC bridge (JSON protocol, auto-reconnect). |
| `osc-backend.ts` | `OscBridgeBackend` — OSC out over WS; per-output address path + physical range. |
| `vcv-backend.ts` | `VcvBackend` — drives + **trains** the VCV Rack NISPS module over the OSC↔WS bridge (streams `/nisps/input`, forwards the verdict loop to `/nisps/feedback`, receives `/nisps/output` + `/nisps/state`). |
| `passthrough-backend.ts` | No-op sink for synth (plays in-engine) / particles (rAF consumer) / editor. |
| `presets.ts` | Named per-backend output-config presets (localStorage, per-backend namespace). |
| `useBackendManager.ts` | Thin React binding: builds `BackendContext` from the store, switches Mode, surfaces status. |

## Audio gating

The Built-in Synth plays **inside** the engine (`EngineHost` pushes params to the
worklet on every spine tick). So the manager mutes audio on every non-synth Mode
via `engine.audio.setMuted(true)` and unmutes on the synth Mode. This is the
documented gate — cleanly suppressing the worklet push would need an engine
change that this workstream doesn't make.

## OSC bridge — the process must be running

Browsers cannot send UDP, so the OSC backend connects over WebSocket to the Deno
bridge, which encodes OSC and forwards over UDP. **Start the bridge locally** or
the OSC backend shows "bridge not running" (it auto-reconnects):

```bash
cd manifold/osc-bridge
deno run --allow-net bridge.ts
#   --osc-host 127.0.0.1 --osc-port 9000 --ws-port 8765 --listen-port 9001
# or, without Deno:
node bridge.mjs
```

Default bridge URL: `ws://localhost:8765` (configurable in the OSC config panel).
WS protocol (browser → bridge): `{ type:'params', payload:[[path,value],…] }`.

## VCV bridge — module **and** bridge must both be running

When Mode = **VCV**, the browser is authoritative in *bridged mode*: the
`VcvBackend` connects over the **same Deno bridge** and

- streams the current input vector continuously to **`/nisps/input`** (the
  browser drives the module's inputs),
- streams the routed per-output CV (uni 0–10 V / bipolar ±5 V), and
- forwards the **verdict loop** — thumbs-up/down + explore-and-place — to
  **`/nisps/feedback`** (`{ op:'up'|'down'|'rand'|'clear', spread, input[],
  output[] }`), so the module's embedded net trains in lock-step with the
  browser session.

It receives **`/nisps/output`** + **`/nisps/state`** back for status /
visualisation. The verdict forwarding is gated in `BackendManager.forwardFeedback`
— a no-op unless VCV is the active backend (otherwise the browser engine is the
learner). Both processes are required:

```bash
# 1) the VCV Rack NISPS module (vcv/) — default UDP listen port 7001
# 2) the Deno bridge, pointed at the module's UDP port:
cd manifold/osc-bridge
deno run --allow-net bridge.ts --osc-port 7001
```

Default VCV bridge URL: `ws://localhost:8765` (configurable in the VCV config
panel). Until the WS connects the backend shows "bridge not running"; until the
module replies it shows "waiting for module…".
