/**
 * Runtime-shaped net reshape (one-core-engine P2.3 + P5.3).
 *
 * The WASM MLP is runtime-shaped. Since P5.3 the app reshapes the net to the
 * BOOT MODE's schema `ml` config once WASM is ready, with normal modes using
 * Manifold's default 2-input working shape rather than the schema's 4-input
 * capacity. This spec
 * asserts FROM the imported schema — never hard-coded dim numbers — that:
 *
 *   1. the net boots at the boot mode's schema dims + weight count;
 *   2. `engine.reshape(n)` to a DIFFERENT arity succeeds and `describe()` reports
 *      the new input size while keeping the schema output size;
 *   3. getWeights length tracks the new arity;
 *   4. post-ML outputs stay bounded in [0,1] and the spine still propagates.
 */
import { test, expect } from '@playwright/test';
import { loadProbe, getOutputs, settleInputs, countChanged, allWithin, weightCountFromMl } from './helpers';
import { PafSynthSchema } from '../../src/modes/generated';

// The boot mode (ConsoleApp `modeId` initial state) is paf_synth.
const BOOT = PafSynthSchema.ml;
const BOOT_INPUT = 2;
const BOOT_OUTPUT = BOOT.output_size; // 33
const BOOT_WEIGHTS = weightCountFromMl({ ...BOOT, input_size: BOOT_INPUT }); // 2→[10,10,14]→33 = 787

// A reshape target arity guaranteed to differ from the boot arity.
const OTHER_INPUT = BOOT_INPUT + 6; // 10
// Reshaping only the input arity shifts the first layer: (Δin)*hidden0.
const OTHER_WEIGHTS = BOOT_WEIGHTS + (OTHER_INPUT - BOOT_INPUT) * BOOT.hidden_layers[0]!;

test.beforeEach(async ({ page }) => {
  await loadProbe(page);
});

test.describe('reshape — runtime-shaped MLP', () => {
  test('boots at the Manifold default input shape', async ({ page }) => {
    const arch = await page.evaluate(() => window.__nisps!.describe());
    expect(arch.inputSize).toBe(BOOT_INPUT);
    expect(arch.outputSize).toBe(BOOT_OUTPUT);
    expect(arch.hidden).toEqual([...BOOT.hidden_layers]);

    const len = await page.evaluate(() => window.__nisps!.getWeights().length);
    expect(len).toBe(BOOT_WEIGHTS);
  });

  test('reshape to a new arity succeeds and describe reports it', async ({ page }) => {
    const result = await page.evaluate((n) => window.__nisps!.reshape(n), OTHER_INPUT);
    expect(result).not.toBeNull();
    expect(result!.inputSize).toBe(OTHER_INPUT);
    expect(result!.outputSize).toBe(BOOT_OUTPUT);

    const arch = await page.evaluate(() => window.__nisps!.describe());
    expect(arch.inputSize).toBe(OTHER_INPUT);
    expect(arch.outputSize).toBe(BOOT_OUTPUT);
  });

  test('getWeights length changes with the new arity', async ({ page }) => {
    const before = await page.evaluate(() => window.__nisps!.getWeights().length);
    expect(before).toBe(BOOT_WEIGHTS);

    await page.evaluate((n) => window.__nisps!.reshape(n), OTHER_INPUT);

    const after = await page.evaluate(() => window.__nisps!.getWeights().length);
    expect(after).toBe(OTHER_WEIGHTS);
    expect(after).not.toBe(before);
  });

  test('outputs stay bounded after reshape', async ({ page }) => {
    await page.evaluate((n) => window.__nisps!.reshape(n), OTHER_INPUT);
    await page.evaluate(() => window.__nisps!.setInputs(0.3, 0.7));
    const outs = await getOutputs(page);
    expect(outs.length).toBe(BOOT_OUTPUT);
    expect(allWithin(outs, 0, 1)).toBe(true);
  });

  test('spine still propagates after reshape', async ({ page }) => {
    await page.evaluate((n) => window.__nisps!.reshape(n), OTHER_INPUT);

    const a = await settleInputs(page, 0.2, 0.8);
    const b = await settleInputs(page, 0.9, 0.1);
    expect(a.length).toBe(BOOT_OUTPUT);
    expect(b.length).toBe(BOOT_OUTPUT);
    expect(allWithin(a, 0, 1)).toBe(true);
    expect(allWithin(b, 0, 1)).toBe(true);
    // Distinct inputs must still move the mapping through the reshaped net.
    expect(countChanged(a, b, 1e-3)).toBeGreaterThan(0);
  });
});
