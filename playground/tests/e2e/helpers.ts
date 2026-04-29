/**
 * Playwright helpers for the SolidJS playground.
 *
 * The legacy Playwright suite at `tests/e2e/` targeted the old vanilla-JS
 * playground served via `python3 -m http.server`. This file is the
 * replacement for that suite's helpers.js and points at the new `vite
 * preview` server (see playground/playwright.config.ts).
 *
 * Conventions:
 *   - All helpers take a `Page` and return a Promise.
 *   - `loadApp` clears localStorage, navigates to the modes route, and
 *     waits for the WASM debug probe to be ready. Most tests should call
 *     this in `beforeEach`.
 *   - `waitForProbeReady` is the canonical way to wait for ML init.
 */
import type { Page } from '@playwright/test';

const ROUTE_HOME = '/';
const ROUTE_MODES = '/modes';

interface LoadOptions {
  /** Where to land. Defaults to `/modes` so ML init kicks in. */
  route?: string;
  /** Extra query string (e.g. `?spread=0.6`). Leading `?` optional. */
  query?: string;
  /**
   * Whether to wait for the debug probe's __ready flag. Defaults true.
   * Pass false for tests that explicitly want to observe the loading state.
   */
  waitForReady?: boolean;
  /** Timeout (ms) for probe readiness. */
  readyTimeoutMs?: number;
}

/**
 * Navigate to the playground with localStorage cleared and wait until the
 * debug probe (`window.__nisps`) reports the WASM is ready.
 *
 * Stream 11 talks to the SAME probe contract Stream 10 wires up — see
 * `playground/src/debug/probe.ts`. Tests that fail with `__ready === false`
 * after a long wait are a strong signal that the WASM isn't loading at all
 * (check `bun run preview` output and the browser network tab).
 */
export async function loadApp(page: Page, opts: LoadOptions = {}): Promise<void> {
  const route = opts.route ?? ROUTE_MODES;
  let query = opts.query ?? '';
  if (query && !query.startsWith('?')) query = '?' + query;
  const target = `${route}${query}`;
  const timeout = opts.readyTimeoutMs ?? 20_000;

  // Clear app state before the SPA boots so initial inference uses default
  // weights, not whatever the previous test left in localStorage.
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* private mode etc — ignore */
    }
  });

  await page.goto(target);
  // Wait for the probe to be installed at all; main.tsx installs it
  // synchronously before render, so this resolves on first paint.
  await page.waitForFunction(() => typeof window.__nisps !== 'undefined', { timeout });

  if (opts.waitForReady !== false) {
    await page.waitForFunction(
      async () => {
        const probe = window.__nisps;
        if (!probe) return false;
        try {
          await probe.__init();
        } catch {
          return false;
        }
        return probe.__ready === true;
      },
      { timeout },
    );
  }
}

/**
 * Returns true if the WASM ML init has succeeded on the current page. Tests
 * that depend on a working WASM probe can call this after `loadApp` (with
 * `waitForReady: false`) and `test.skip` if it returns false — that keeps
 * us from blocking on streams 7/10 finishing their wiring.
 */
export async function probeReady(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const probe = window.__nisps;
    if (!probe) return false;
    try { await probe.__init(); } catch { return false; }
    return probe.__ready === true;
  });
}

/**
 * Read the current debug probe outputs as a plain Float32Array-equivalent
 * `number[]` that survives JSON serialization across the page boundary.
 */
export async function getOutputs(page: Page): Promise<number[]> {
  return page.evaluate(() => Array.from(window.__nisps!.getOutputs()));
}

/**
 * Convenience: how many distinct values changed by more than `eps` between
 * two output snapshots? Useful for assertions like "RL noise actually moved
 * something".
 */
export function countChanged(a: number[], b: number[], eps = 1e-3): number {
  if (a.length !== b.length) return Math.abs(a.length - b.length);
  let n = 0;
  for (let i = 0; i < a.length; ++i) {
    if (Math.abs(a[i]! - b[i]!) > eps) ++n;
  }
  return n;
}

/**
 * Type-only export so spec files can use `Probe` if they need to.
 * window.__nisps is declared globally in `playground/src/debug/probe.ts`.
 */
export type Probe = NonNullable<Window['__nisps']>;
