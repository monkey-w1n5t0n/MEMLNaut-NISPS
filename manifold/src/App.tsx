/**
 * Manifold — app root. The convertible Console (ConsoleApp) wired to the real
 * engine, mounted under EngineProvider. Defaults to the hero `focus="composite"`
 * (the convertible centerpiece). The `?debug=1` probe is installed once the
 * engine is live.
 */

import { useEffect } from 'react';
import { EngineProvider } from './engine/EngineProvider';
import { useEngine } from './engine/useEngine';
import { installDebugProbe } from './debug/probe';
import { ConsoleApp } from './console';

function Loading() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg)',
        color: 'var(--fg)',
        fontFamily: 'var(--font-mono)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--sp-3)',
      }}
    >
      <strong
        style={{
          color: 'var(--accent)',
          fontSize: 'var(--fs-2xl)',
          letterSpacing: 'var(--ls-tight)',
        }}
      >
        Manifold
      </strong>
      <span style={{ color: 'var(--fg-dim)', fontSize: 'var(--fs-xs)' }}>loading engine…</span>
    </div>
  );
}

/** Installs the debug probe once the engine is in context. */
function ProbeInstaller() {
  const engine = useEngine();
  useEffect(() => {
    if (engine) installDebugProbe(engine);
  }, [engine]);
  return null;
}

export function App() {
  return (
    <EngineProvider fallback={<Loading />}>
      <ProbeInstaller />
      <ConsoleApp focus="composite" />
    </EngineProvider>
  );
}
