/**
 * RigProvider — owns the DualRig for the page and switches dual mode on while a
 * gamepad is present. `useRig()` gives consumers the rig plus a live snapshot.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DualRig, type RigSnapshot } from './dual-rig';
import { watchGamepadPresence } from './gamepad-presence';

const RigContext = createContext<DualRig | null>(null);

export function RigProvider({ children }: { children: ReactNode }) {
  const [rig, setRig] = useState<DualRig | null>(null);

  // Created inside the effect (not in state init) so StrictMode's
  // mount → unmount → mount replay disposes one rig and builds a fresh one.
  useEffect(() => {
    const r = new DualRig();
    setRig(r);
    void r.init();
    const off = watchGamepadPresence((present) => r.setActive(present));
    return () => {
      off();
      r.dispose();
      setRig(null);
    };
  }, []);

  return <RigContext.Provider value={rig}>{children}</RigContext.Provider>;
}

/** The rig, or null outside a provider. */
export function useRigOptional(): DualRig | null {
  return useContext(RigContext);
}

const EMPTY_SNAPSHOT_SUBSCRIBE = () => () => {};

/** Live rig snapshot (null outside a provider). Re-renders on every change. */
export function useRigSnapshot(rig: DualRig | null): RigSnapshot | null {
  return useSyncExternalStore(
    rig ? rig.subscribe : EMPTY_SNAPSHOT_SUBSCRIBE,
    () => (rig ? rig.getSnapshot() : null),
    () => null,
  );
}
