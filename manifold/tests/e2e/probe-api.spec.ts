/**
 * Debug-probe API contract — `window.__nisps` (gated behind `?debug=1`).
 *
 * Ported from `playground/tests/e2e/ml-engine.spec.ts`. This is the ENGINE
 * contract, not playground UI, so it survives the playground's retirement:
 * every probe accessor must return the documented shape and never throw.
 *
 * Adaptations vs. the playground original:
 *   - Manifold's net is runtime-shaped and (since P5.3) boots at the BOOT MODE's
 *     schema `ml` config, so dims + weight count are derived from the imported
 *     schema, never hard-coded.
 *   - No `probe.__init()` / no `mlStore.iml` poke-through: Manifold's probe
 *     exposes `addExample()` and `routedOutputs()` directly, so the training
 *     tests drive the real public surface instead of an escape hatch.
 *   - The playground's `test.skip(!probeReady)` guard is gone — on Manifold the
 *     probe is only installed once WASM is live, so a not-ready probe is a
 *     genuine failure, not a pending-stream skip.
 */
import { test, expect } from '@playwright/test';
import { loadProbe, getOutputs, countChanged, allWithin, weightCountFromMl } from './helpers';
import { PafSynthSchema } from '../../src/modes/generated';

// The boot mode is paf_synth; all dims derive from its schema `ml` config.
const N_OUTPUTS = PafSynthSchema.ml.output_size; // 33
const WEIGHT_COUNT = weightCountFromMl(PafSynthSchema.ml); // 4→[10,10,14]→33 = 809
// 4 layers (3 hidden + output) * 4 stats per layer.
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

  test('randomise defaults to a broad full-range mapping', async ({ page }) => {
    const distribution = await page.evaluate(() => {
      const probe = window.__nisps!;
      const values: number[] = [];
      for (let draw = 0; draw < 48; ++draw) {
        probe.randomise();
        probe.setInputs(0.5, 0.5);
        values.push(...probe.getOutputs());
      }
      values.sort((a, b) => a - b);
      const percentile = (p: number) => values[Math.floor((values.length - 1) * p)]!;
      const centralFraction =
        values.filter((value) => value >= 0.35 && value <= 0.65).length / values.length;
      return {
        p05: percentile(0.05),
        p95: percentile(0.95),
        centralFraction,
      };
    });

    // The former implicit spread=0.6 regime put ~99.8% of values inside this
    // central band. Uniform spread=0 must visibly reach both sides of it.
    expect(distribution.p05).toBeLessThan(0.3);
    expect(distribution.p95).toBeGreaterThan(0.7);
    expect(distribution.centralFraction).toBeLessThan(0.8);
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

  test('thumbsDown returns a finite action; a geometric dislike changes outputs', async ({ page }) => {
    // Under the geometric-dislike core (one-core-engine P3) a dislike trains AWAY
    // from the HEARD (post-pipeline) vector. Passing the net's OWN output — as the
    // bare thumbsDown probe does — is intentionally inert (zero MSE derivative), so
    // we assert only its SHAPE there and drive a real, distinct heard vector for
    // the behaviour. Everything runs in ONE evaluate so the app's input rAF loop
    // cannot drift the input-pipeline EMA between reads (which would make the delta
    // timing-dependent).
    const r = await page.evaluate((n) => {
      const p = window.__nisps!;
      p.setFeedbackMode('avoid'); // geometric dislike proto mode maps to core Avoid
      p.setAvoidStyle(0); // Geometric (default)
      p.setInputs(0.3, 0.7);
      // Contract: thumbsDown returns a finite FeedbackAction and never throws.
      const action = p.thumbsDown();
      // Behaviour: a dislike with a heard vector DISTINCT from the output trains a
      // real push → outputs change deterministically.
      const before = Array.from(p.getOutputs());
      const heard = new Array(n).fill(0.9);
      p.dislikeGeometric(heard, 1.0); // trains + re-processes at the same input
      const after = Array.from(p.getOutputs());
      let changed = 0;
      for (let i = 0; i < before.length; ++i) {
        if (Math.abs(before[i]! - after[i]!) > 1e-4) ++changed;
      }
      return { action, changed };
    }, N_OUTPUTS);
    expect(typeof r.action).toBe('number');
    expect(Number.isFinite(r.action)).toBe(true);
    expect(r.changed).toBeGreaterThan(0);
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

  test('getLossHistory returns the REAL per-iteration curve after a sync train', async ({ page }) => {
    // Empty until something has actually trained — never a placeholder.
    expect(await page.evaluate(() => window.__nisps!.getLossHistory().length)).toBe(0);

    const hist = await page.evaluate(
      ([low, high]) => {
        window.__nisps!.addExample(low.input, low.output);
        window.__nisps!.addExample(high.input, high.output);
        window.__nisps!.train();
        return Array.from(window.__nisps!.getLossHistory());
      },
      [EXAMPLE_LOW, EXAMPLE_HIGH],
    );
    // The pre-§6.5e worker fabricated a 1-element "history" from the final loss.
    expect(hist.length).toBeGreaterThan(1);
    for (const v of hist) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(hist[hist.length - 1]!).toBeLessThan(hist[0]!);
  });

  test('async training publishes the worker net\'s real loss curve too', async ({ page }) => {
    const hist = await page.evaluate(
      async ([low, high]) => {
        window.__nisps!.addExample(low.input, low.output);
        window.__nisps!.addExample(high.input, high.output);
        await window.__nisps!.trainAsync();
        return Array.from(window.__nisps!.getLossHistory());
      },
      [EXAMPLE_LOW, EXAMPLE_HIGH],
    );
    expect(hist.length).toBeGreaterThan(1);
    for (const v of hist) expect(Number.isFinite(v)).toBe(true);
    expect(hist[hist.length - 1]!).toBeLessThan(hist[0]!);
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
