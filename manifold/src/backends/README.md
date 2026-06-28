# Output Backends (`manifold/src/backends/`)

Real output transports for the Manifold app. Exactly one backend is *active* at a
time, chosen by the dock **Mode** (Particle / MIDI / OSC / Built-in Synth /
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
