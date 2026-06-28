/**
 * useEngine / useEngineVersion — React hooks over the EngineApi.
 *
 * `useEngine()` returns the EngineApi from context (or null before it loads).
 *
 * `useEngineVersion()` subscribes to engine state changes via
 * `useSyncExternalStore(engine.subscribe, engine.version)`. It returns the
 * VERSION COUNTER (a number), NOT the output array — so a component re-renders
 * when engine state changes but reads the live `Float32Array` imperatively
 * (`engine.getOutputs()` / `engine.routedOutput()`) inside a rAF loop or on
 * render. This keeps per-frame audio inference off React's render cycle.
 */

import { useContext, useSyncExternalStore } from 'react';
import type { EngineApi } from './engine-api';
import { EngineContext } from './EngineProvider';

/** The EngineApi from context, or null until the WASM has loaded. */
export function useEngine(): EngineApi | null {
  return useContext(EngineContext);
}

/** Like {@link useEngine} but throws if used outside a ready provider. */
export function useEngineOrThrow(): EngineApi {
  const engine = useContext(EngineContext);
  if (!engine) {
    throw new Error('useEngineOrThrow: no EngineApi in context (still loading or no provider)');
  }
  return engine;
}

/**
 * Subscribe to the engine's monotonic version counter. Re-renders the caller
 * on any engine state change; the returned number is the counter (read the
 * live arrays imperatively from the engine). Returns 0 when there's no engine.
 */
export function useEngineVersion(engine: EngineApi | null): number {
  return useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    () => (engine ? engine.version() : 0),
    () => 0,
  );
}
