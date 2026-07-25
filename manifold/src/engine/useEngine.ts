/**
 * useEngine / useEngineVersion — React hooks over the EngineApi.
 *
 * `useEngine()` returns the EngineApi from context (or null before it loads).
 *
 * `useEngineVersion()` subscribes only to structural/training state.
 * `useEngineOutputVersion()` is the opt-in, throttled live-output channel for
 * DOM consumers. Canvas consumers read live buffers imperatively instead.
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

/**
 * Subscribe to the engine's throttled live-output channel. Disabled consumers
 * neither subscribe nor re-render and report version 0.
 */
export function useEngineOutputVersion(
  engine: EngineApi | null,
  enabled = true,
): number {
  return useSyncExternalStore(
    (cb) => (engine && enabled ? engine.subscribeOutputs(cb) : () => {}),
    () => (engine && enabled ? engine.outputVersion() : 0),
    () => 0,
  );
}
