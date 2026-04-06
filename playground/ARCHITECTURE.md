# Playground Architecture

## Event Systems

### Event Bus (preferred for new code)

The shared event bus at `js/event-bus.js` is the preferred event system for all new playground code. It provides namespaced pub/sub with wildcard support and automatic timestamping.

**Import:**

```js
import { EventBus, getDefaultBus, SEQ, ML, UI } from './js/event-bus.js';
```

**API:**

| Method | Description |
|--------|-------------|
| `new EventBus(audioCtx?)` | Create a new bus. Optional AudioContext for `seq.*` timestamps. |
| `bus.on(event, cb)` | Subscribe. Exact (`'seq.step'`) or wildcard (`'seq.*'`). |
| `bus.off(event, cb)` | Unsubscribe. Same signature as `on()`. |
| `bus.emit(event, data?)` | Emit. A `timestamp` field is added automatically. |
| `bus.setAudioContext(ctx)` | Set or replace the AudioContext for `seq.*` timestamps. |
| `getDefaultBus(audioCtx?)` | Get (or lazily create) the shared singleton bus. |

**Namespace conventions:**

| Prefix | Constants | Purpose |
|--------|-----------|---------|
| `seq.*` | `SEQ.STEP`, `SEQ.NOTE_ON`, `SEQ.NOTE_OFF`, `SEQ.PARAM_CHANGE`, `SEQ.LOOP_START` | Sequencer transport and timing events. Timestamped via `AudioContext.currentTime`. |
| `ml.*` | `ML.TRAINED`, `ML.FROZEN`, `ML.UNFROZEN`, `ML.DELTA_UPDATE` | ML engine state changes. |
| `ui.*` | `UI.PARAM_SELECT`, `UI.CHAIN_EDIT`, `UI.PRESET_LOAD`, `UI.FREEZE_TOGGLE` | UI interaction events. |

New features should define their own namespace constants following the same pattern.

**Callbacks** receive `(data, eventName)` where `data` always includes a `timestamp` field (`AudioContext.currentTime` for `seq.*`, `performance.now()` for everything else).

### DOM CustomEvents (existing code)

Existing code uses DOM `CustomEvent` dispatched on DOM elements (e.g. `controlsurface:change`, `eoc:change`). These work fine and should **not** be migrated at this time. Both systems coexist without conflict.

When the app is rewritten in the future, the goal is to unify on the event bus and retire DOM CustomEvents for inter-module communication.
