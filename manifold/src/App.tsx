/**
 * Manifold — app root. The convertible Console (ConsoleApp) wired to the real
 * engine, mounted under EngineProvider. ConsoleApp renders its single
 * "composite" stage unconditionally (the dead focus/altitude system was
 * deleted 2026-07 — simplification audit S15). The `?debug=1` probe is
 * installed once the engine is live.
 */

import { lazy, Suspense, useEffect } from 'react';
import { EngineProvider } from './engine/EngineProvider';
import type { EngineApiOptions } from './engine/engine-api';
import { useEngine } from './engine/useEngine';
import { installDebugProbe } from './debug/probe';
import { ConsoleApp } from './console';

/**
 * Engine options derived from the URL. Under `?debug=1` (the Playwright /
 * dev-probe gate) we pin a FIXED RNG seed so the net's initial weights — and
 * therefore inference, feedback, and reshape behaviour — are deterministic run
 * to run. Production (no debug flag) keeps the time-seeded default, so this
 * never changes what a real user hears.
 */
function engineOptions(): EngineApiOptions {
  if (typeof window === 'undefined') return {};
  try {
    const params = new URLSearchParams(window.location.search);
    // Fixed seed + fixed per-tick dt ⇒ deterministic weights AND deterministic
    // pipeline smoothing (the pipelines otherwise read performance.now()).
    if (params.get('debug') === '1') return { seed: 0xc0ffee, debugClockDt: 1 / 60 };
  } catch {
    /* no URL (SSR / sandbox) — fall through */
  }
  return {};
}

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

// The hidden ML lab (`?lab=1`) — code-split so the product bundle never loads
// it. It needs no live engine: its workers boot their own (src/lab/).
const LabApp = lazy(() => import('./lab/LabApp'));

function isLab(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('lab') === '1';
  } catch {
    return false;
  }
}

export function App() {
  if (isLab()) {
    return (
      <Suspense fallback={<Loading />}>
        <LabApp />
      </Suspense>
    );
  }
  return (
    <EngineProvider options={engineOptions()} fallback={<Loading />}>
      <ProbeInstaller />
      <ConsoleApp />
    </EngineProvider>
  );
}
