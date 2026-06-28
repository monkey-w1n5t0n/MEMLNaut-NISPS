/**
 * EngineProvider — the React binding layer for the headless EngineApi.
 *
 * This is the ONLY place (with useEngine.ts) where `engine/` touches React.
 * The lint rule "skins may not import engine internals; engine may not import
 * React" is satisfied: the engine is React-free, and this provider only
 * consumes the public `EngineApi` façade.
 *
 * The engine is created asynchronously (the WASM must load). Until it's ready,
 * `useEngine()` returns null; consumers should guard on it.
 */

import {
  createContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { createEngine, EngineApi, type EngineApiOptions } from './engine-api';

export const EngineContext = createContext<EngineApi | null>(null);

export interface EngineProviderProps {
  children: ReactNode;
  options?: EngineApiOptions;
  /** Optional fallback rendered until the engine has loaded. */
  fallback?: ReactNode;
}

export function EngineProvider(props: EngineProviderProps): JSX.Element {
  const [engine, setEngine] = useState<EngineApi | null>(null);

  useEffect(() => {
    let disposed = false;
    let created: EngineApi | null = null;
    void createEngine(props.options ?? {}).then((eng) => {
      if (disposed) {
        eng.dispose();
        return;
      }
      created = eng;
      setEngine(eng);
    });
    return () => {
      disposed = true;
      created?.dispose();
    };
    // Recreate only if the options object identity changes.
  }, [props.options]);

  if (!engine) {
    return <>{props.fallback ?? null}</>;
  }
  return <EngineContext.Provider value={engine}>{props.children}</EngineContext.Provider>;
}
