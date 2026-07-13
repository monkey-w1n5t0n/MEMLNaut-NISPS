/**
 * Debug-probe API contract — `window.__nisps` (gated behind `?debug=1`).
 *
 * Ported from `playground/tests/e2e/ml-engine.spec.ts`. This is the ENGINE
 * contract, not playground UI, so it survives the playground's retirement:
 * every probe accessor must return the documented shape and never throw.
 *
 * Adaptations vs. the playground original:
 *   - Manifold's WASM net is `MLP<32,10,14,18,126>` (playground was `<2,...>`),
 *     so `getWeights()` has 3148 elements, not 2848 (derivation below).
 *   - No `probe.__init()` / no `mlStore.iml` poke-through: Manifold's probe
 *     exposes `addExample()` and `routedOutputs()` directly, so the training
 *     tests drive the real public surface instead of an escape hatch.
 *   - The playground's `test.skip(!probeReady)` guard is gone — on Manifold the
 *     probe is only installed once WASM is live, so a not-ready probe is a
 *     genuine failure, not a pending-stream skip.
 */
import { test, expect } from '@playwright/test';
import { loadProbe, getOutputs, countChanged, allWithin } from './helpers';

// Fixed by the WASM build (`nisps/wasm/bindings.cpp`: MLP<32,10,14,18,126>).
const N_OUTPUTS = 126;
// weight_count = 32*10 + 10*14 + 14*18 + 18*126  (weights)
//              + 10 + 14 + 18 + 126              (biases)
//              = 320 + 140 + 252 + 2268 + 168 = 3148
const WEIGHT_COUNT = 3148;
// DefaultMLP::kNumLayers (4) * 4 stats per layer.
const LAYER_STATS = 16;

const EXAMPLE_LOW = { input: [0.1, 0.9], output: new Array(N_OUTPUTS).fill(0.1) };
const EXAMPLE_HIGH = { input: [0.9, 0.1], output: new Array(N_OUTPUTS).fill(0.9) };

test.beforeEach(async ({ page }) => {
  await loadProbe(page);
});

test.describe('ML engine — debug probe contract', () => {
  test('probe is installed and reports ready', async ({ page }) => {
    const kind = await page.evaluate(() => typeof window.__nisps);
    expect(kind).toBe('object');
    const ready = await page.evaluate(() => window.__nisps!.__ready);
    expect(ready).toBe(true);
  });

  test('initial outputs are bounded in [0, 1]', async ({ page }) => {
    const outs = await getOutputs(page);
    expect(outs).toHaveLength(N_OUTPUTS);
    expect(allWithin(outs, 0, 1)).toBe(true);
  });

  test('initial state is 0 examples and no loss', async ({ page }) => {
    const count = await page.evaluate(() => window.__nisps!.getExampleCount());
    expect(count).toBe(0);
    const loss = await page.evaluate(() => window.__nisps!.getLoss());
    expect(loss).toBeNull();
  });

  test('randomise changes outputs', async ({ page }) => {
    await page.evaluate(() => window.__nisps!.setInputs(0.3, 0.7));
    const before = await getOutputs(page);
    await page.evaluate(() => window.__nisps!.randomise());
    await page.evaluate(() => window.__nisps!.setInputs(0.3, 0.7));
    const after = await getOutputs(page);
    expect(countChanged(before, after, 1e-3)).toBeGreaterThan(0);
  });

  test('setInputs runs inference and yields bounded outputs', async ({ page }) => {
    await page.evaluate(() => window.__nisps!.setInputs(0.25, 0.75));
    const outs = await getOutputs(page);
    expect(outs).toHaveLength(N_OUTPUTS);
    expect(allWithin(outs, 0, 1)).toBe(true);
  });

  test('thumbsUp returns a finite FeedbackAction and keeps the count sane', async ({ page }) => {
    await page.evaluate(() => window.__nisps!.setInputs(0.4, 0.6));
    const action = await page.evaluate(() => window.__nisps!.thumbsUp());
    expect(typeof action).toBe('number');
    expect(Number.isFinite(action)).toBe(true);
    const count = await page.evaluate(() => window.__nisps!.getExampleCount());
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('thumbsDown moves weights and changes outputs', async ({ page }) => {
    await page.evaluate(() => window.__nisps!.setInputs(0.3, 0.7));
    const before = await getOutputs(page);
    await page.evaluate(() => window.__nisps!.thumbsDown());
    await page.evaluate(() => window.__nisps!.setInputs(0.3, 0.7));
    const after = await getOutputs(page);
    expect(countChanged(before, after, 1e-4)).toBeGreaterThan(0);
  });

  test('addExample reports success and bumps the example count', async ({ page }) => {
    const ok = await page.evaluate(
      ([ex]) => window.__nisps!.addExample(ex.input, ex.output),
      [EXAMPLE_LOW],
    );
    expect(typeof ok).toBe('boolean');
    expect(ok).toBe(true);
    const count = await page.evaluate(() => window.__nisps!.getExampleCount());
    expect(count).toBe(1);
  });

  test('train() with two contrasting examples does not increase loss', async ({ page }) => {
    await page.evaluate(
      ([low, high]) => {
        window.__nisps!.addExample(low.input, low.output);
        window.__nisps!.addExample(high.input, high.output);
      },
      [EXAMPLE_LOW, EXAMPLE_HIGH],
    );

    const loss1 = await page.evaluate(() => window.__nisps!.train());
    expect(typeof loss1).toBe('number');
    expect(Number.isFinite(loss1)).toBe(true);
    expect(loss1).toBeGreaterThanOrEqual(0);

    const loss2 = await page.evaluate(() => window.__nisps!.train());
    expect(loss2).toBeLessThanOrEqual(loss1 + 1e-6);
  });

  test('async training resolves to a finite non-negative loss', async ({ page }) => {
    await page.evaluate(
      ([low, high]) => {
        window.__nisps!.addExample(low.input, low.output);
        window.__nisps!.addExample(high.input, high.output);
      },
      [EXAMPLE_LOW, EXAMPLE_HIGH],
    );
    const loss = await page.evaluate(() => window.__nisps!.trainAsync());
    expect(typeof loss).toBe('number');
    expect(Number.isFinite(loss)).toBe(true);
    expect(loss).toBeGreaterThanOrEqual(0);
  });

  test('clearExamples resets the dataset count to 0', async ({ page }) => {
    await page.evaluate(
      ([ex]) => window.__nisps!.addExample(ex.input, ex.output),
      [EXAMPLE_LOW],
    );
    expect(await page.evaluate(() => window.__nisps!.getExampleCount())).toBe(1);
    await page.evaluate(() => window.__nisps!.clearExamples());
    expect(await page.evaluate(() => window.__nisps!.getExampleCount())).toBe(0);
  });

  test('evalLoss returns a non-negative number or null', async ({ page }) => {
    const v = await page.evaluate(() => window.__nisps!.evalLoss());
    if (v !== null) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  test('inferBatch returns N * outputSize bounded floats', async ({ page }) => {
    const points: ReadonlyArray<readonly [number, number]> = [
      [0.0, 0.0],
      [0.5, 0.5],
      [1.0, 1.0],
    ];
    const flat = await page.evaluate(
      (pts) => Array.from(window.__nisps!.inferBatch(pts as [number, number][])),
      points,
    );
    expect(flat).toHaveLength(points.length * N_OUTPUTS);
    expect(allWithin(flat, 0, 1)).toBe(true);
  });

  test('getLayerStats returns 4 floats per layer, all finite', async ({ page }) => {
    const stats = await page.evaluate(() => Array.from(window.__nisps!.getLayerStats()));
    expect(stats).toHaveLength(LAYER_STATS);
    for (const v of stats) expect(Number.isFinite(v)).toBe(true);
  });

  test('getWeights returns the full weight vector', async ({ page }) => {
    const len = await page.evaluate(() => window.__nisps!.getWeights().length);
    expect(len).toBe(WEIGHT_COUNT);
  });
});
