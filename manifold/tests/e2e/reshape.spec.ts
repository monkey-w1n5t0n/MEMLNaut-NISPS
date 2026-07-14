/**
 * Runtime-shaped net reshape (one-core-engine P2.3).
 *
 * The WASM MLP is runtime-shaped: it boots at the default over-provisioned
 * 32→[10,14,18]→126 head, and `engine.reshape({ inputSize })` swaps in a new net
 * at the requested arity, warm-started from the overlapping weights. This spec
 * drives the reshape through the debug probe (`__nisps.reshape`) and asserts:
 *
 *   1. default dims are 32 inputs / 126 outputs (unchanged by P2.3);
 *   2. reshape to 4 inputs succeeds and `describe()` reports 4/126;
 *   3. post-ML outputs stay bounded in [0,1] after the reshape;
 *   4. getWeights length shrinks by (32-4)*10 = 280 → 2868 (biases unchanged);
 *   5. the spine still propagates — distinct inputs → distinct bounded outputs.
 */
import { test, expect } from '@playwright/test';
import { loadProbe, getOutputs, settleInputs, countChanged, allWithin } from './helpers';

// Default: 32*10 + 10*14 + 14*18 + 18*126 weights + (10+14+18+126) biases = 3148.
const DEFAULT_WEIGHT_COUNT = 3148;
// Reshaping to 4 inputs only shrinks the first layer: 3148 - (32-4)*10 = 2868.
const RESHAPED_WEIGHT_COUNT = 2868;

test.beforeEach(async ({ page }) => {
  await loadProbe(page);
});

test.describe('reshape — runtime-shaped MLP', () => {
  test('boots at the default 32 / 126 shape', async ({ page }) => {
    const arch = await page.evaluate(() => window.__nisps!.describe());
    expect(arch.inputSize).toBe(32);
    expect(arch.outputSize).toBe(126);

    const len = await page.evaluate(() => window.__nisps!.getWeights().length);
    expect(len).toBe(DEFAULT_WEIGHT_COUNT);
  });

  test('reshape to 4 inputs succeeds and describe reports 4 / 126', async ({ page }) => {
    const result = await page.evaluate(() => window.__nisps!.reshape(4));
    expect(result).not.toBeNull();
    expect(result!.inputSize).toBe(4);
    expect(result!.outputSize).toBe(126);

    const arch = await page.evaluate(() => window.__nisps!.describe());
    expect(arch.inputSize).toBe(4);
    expect(arch.outputSize).toBe(126);
  });

  test('getWeights length changes with the new arity', async ({ page }) => {
    const before = await page.evaluate(() => window.__nisps!.getWeights().length);
    expect(before).toBe(DEFAULT_WEIGHT_COUNT);

    await page.evaluate(() => window.__nisps!.reshape(4));

    const after = await page.evaluate(() => window.__nisps!.getWeights().length);
    expect(after).toBe(RESHAPED_WEIGHT_COUNT);
    expect(after).not.toBe(before);
  });

  test('outputs stay bounded after reshape', async ({ page }) => {
    await page.evaluate(() => window.__nisps!.reshape(4));
    await page.evaluate(() => window.__nisps!.setInputs(0.3, 0.7));
    const outs = await getOutputs(page);
    expect(outs.length).toBe(126);
    expect(allWithin(outs, 0, 1)).toBe(true);
  });

  test('spine still propagates after reshape', async ({ page }) => {
    await page.evaluate(() => window.__nisps!.reshape(4));

    const a = await settleInputs(page, 0.2, 0.8);
    const b = await settleInputs(page, 0.9, 0.1);
    expect(a.length).toBe(126);
    expect(b.length).toBe(126);
    expect(allWithin(a, 0, 1)).toBe(true);
    expect(allWithin(b, 0, 1)).toBe(true);
    // Distinct inputs must still move the mapping through the reshaped net.
    expect(countChanged(a, b, 1e-3)).toBeGreaterThan(0);
  });
});
