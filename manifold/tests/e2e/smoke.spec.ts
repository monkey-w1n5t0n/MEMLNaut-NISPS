import { test, expect } from '@playwright/test';

/**
 * Manifold smoke test — proves the app is REAL (not a mockup): the WASM engine
 * loads, the reactive spine propagates (input change → output change in one
 * tick), the verdict feedback runs, and the convertible Console renders with no
 * "C15" string in the UI.
 */

declare global {
  interface Window {
    __nisps?: {
      getOutputs(): Float32Array;
      setInputs(x: number, y: number): void;
      thumbsDown(): number;
      getExampleCount(): number;
    };
  }
}

test('engine loads, spine propagates, console renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?debug=1');

  // 1. The probe + engine become ready (WASM compiled + instance created).
  await page.waitForFunction(() => {
    const n = window.__nisps;
    return !!n && n.getOutputs().length > 0;
  }, { timeout: 20_000 });

  // 2. Spine invariant: changing the input changes the output vector.
  const changed = await page.evaluate(() => {
    const n = window.__nisps!;
    n.setInputs(0.15, 0.15);
    const a = Array.from(n.getOutputs());
    n.setInputs(0.85, 0.85);
    const b = Array.from(n.getOutputs());
    const delta = a.reduce((s, v, i) => s + Math.abs(v - (b[i] ?? 0)), 0);
    return { len: a.length, delta };
  });
  expect(changed.len).toBeGreaterThan(0);
  expect(changed.delta).toBeGreaterThan(1e-4);

  // 3. Feedback runs without throwing.
  await page.evaluate(() => window.__nisps!.thumbsDown());

  // 4. The convertible Console rendered (assert on the dock drawer rail, which
  //    is always present — the old "MEMLNaut" wordmark only shows outside
  //    Particle mode now that the particle top bar is a heatmap strip).
  //    Drawers are closed by default, so assert on the rail button's title
  //    rather than the (hidden) drawer-header text.
  await expect(page.getByTitle('Learning')).toBeVisible();

  // 5. No "C15" anywhere in the rendered UI.
  const body = await page.evaluate(() => document.body.innerText);
  expect(body).not.toContain('C15');

  // 6. No console/page errors.
  expect(errors, errors.join('\n')).toEqual([]);
});
