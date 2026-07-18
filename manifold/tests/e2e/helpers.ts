/**
 * Playwright helpers for the Manifold app.
 *
 * Ported from `playground/tests/e2e/helpers.ts` and adapted to Manifold's
 * probe surface. Differences from the playground probe:
 *   - Manifold's probe has NO `__init()` — it is installed by `App.tsx` only
 *     AFTER the engine (and its WASM) are live, and `__ready` is a live getter
 *     over the spine state. So "ready" == `window.__nisps.__ready === true`.
 *   - The probe is gated behind `?debug=1` (see `src/debug/probe.ts`), not a
 *     route. We always navigate to `/?debug=1`.
 *   - `routedOutputs()` (plural) is the post-output-pipeline vector.
 */
import type { Page } from '@playwright/test';
import type { DebugProbe } from '../../src/debug/probe';

declare global {
  interface Window {
    __nisps?: DebugProbe;
  }
}

const READY_TIMEOUT = 20_000;

/**
 * Navigate to the Manifold app with the `?debug=1` probe installed and
 * localStorage cleared (fresh default weights, not a prior test's state), then
 * wait until `window.__nisps` reports the WASM engine is ready.
 *
 * `extraQuery` is appended after `debug=1` (leading `&` optional).
 */
export async function loadProbe(page: Page, extraQuery = ''): Promise<void> {
  // Clear persisted ML/settings state before the SPA boots so initial
  // inference uses default weights.
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* private mode etc — ignore */
    }
  });

  let q = extraQuery.trim();
  if (q && !q.startsWith('&')) q = '&' + q;
  await page.goto(`/?debug=1${q}`);

  await page.waitForFunction(
    () => {
      const n = window.__nisps;
      return !!n && n.__ready === true && n.getOutputs().length > 0;
    },
    undefined,
    { timeout: READY_TIMEOUT },
  );
}

/** Read the live post-ML output vector as a JSON-safe number[]. */
export async function getOutputs(page: Page): Promise<number[]> {
  return page.evaluate(() => Array.from(window.__nisps!.getOutputs()));
}

/** Read the live routed (post output-pipeline) vector as a JSON-safe number[]. */
export async function getRouted(page: Page): Promise<number[]> {
  return page.evaluate(() => Array.from(window.__nisps!.routedOutputs()));
}

/** Push the same raw XY input `n` times so the input/output EMA smoothing
 *  settles, then return the converged post-ML outputs. */
export async function settleInputs(page: Page, x: number, y: number, n = 40): Promise<number[]> {
  return page.evaluate(
    ([px, py, count]) => {
      const probe = window.__nisps!;
      for (let i = 0; i < count; i++) probe.setInputs(px, py);
      return Array.from(probe.getOutputs());
    },
    [x, y, n] as const,
  );
}

/**
 * How many values differ by more than `eps` between two snapshots. Length
 * mismatch counts as the absolute size difference.
 */
export function countChanged(a: number[], b: number[], eps = 1e-3): number {
  if (a.length !== b.length) return Math.abs(a.length - b.length);
  let n = 0;
  for (let i = 0; i < a.length; ++i) {
    if (Math.abs(a[i]! - b[i]!) > eps) ++n;
  }
  return n;
}

/** True iff every value is within [lo, hi] (with a tiny float tolerance). */
export function allWithin(xs: number[], lo = 0, hi = 1, tol = 1e-6): boolean {
  for (const v of xs) {
    if (!(v >= lo - tol && v <= hi + tol)) return false;
  }
  return true;
}

/**
 * The MLP weight count implied by an ml config — sum over consecutive layers of
 * `(prev + 1) * next` (the +1 is the per-layer bias), matching nisps'
 * `weight_count()`. Layers = `[input_size, ...hidden_layers, output_size]`.
 * E.g. the default 32→[10,14,18]→126 head = 3148; paf_synth 4→[10,10,14]→33 = 809.
 */
export function weightCountFromMl(ml: {
  readonly input_size: number;
  readonly hidden_layers: readonly number[];
  readonly output_size: number;
}): number {
  const layers = [ml.input_size, ...ml.hidden_layers, ml.output_size];
  let total = 0;
  for (let i = 0; i < layers.length - 1; i++) total += (layers[i]! + 1) * layers[i + 1]!;
  return total;
}

export type Probe = DebugProbe;
