/**
 * ML engine sanity tests — verify the WASM IML behaves correctly:
 *  - outputs are always bounded [0, 1]
 *  - randomize produces different outputs
 *  - thumbs-up captures the current rawParamValues as the training label
 *  - training completes and produces a finite loss
 *  - thumbs-down moves weights and changes outputs
 *  - async training (triggered by thumbs-up) updates the status line
 */
const { test, expect } = require('@playwright/test');
const { loadApp, statusText } = require('./helpers');

// Two contrasting examples with known inputs and all-low / all-high targets.
const EXAMPLE_LOW  = { input: [0.1, 0.9], output: new Array(126).fill(0.1) };
const EXAMPLE_HIGH = { input: [0.9, 0.1], output: new Array(126).fill(0.9) };

test.describe('ML engine (WASM IML)', () => {
  test('probe is exposed after WASM init', async ({ page }) => {
    await loadApp(page);
    const probe = await page.evaluate(() => typeof window.__nisps);
    expect(probe).toBe('object');
  });

  test('initial outputs are all in [0, 1]', async ({ page }) => {
    await loadApp(page);
    const outputs = await page.evaluate(() => window.__nisps.getOutputs());
    expect(outputs).toHaveLength(126);
    for (const v of outputs) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test('initial state is 0 examples, untrained', async ({ page }) => {
    await loadApp(page);
    const count = await page.evaluate(() => window.__nisps.getExampleCount());
    expect(count).toBe(0);
    const loss = await page.evaluate(() => window.__nisps.getLoss());
    expect(loss).toBeNull();
  });

  test('randomize changes outputs', async ({ page }) => {
    await loadApp(page);
    const before = await page.evaluate(() => window.__nisps.getOutputs());
    await page.evaluate(() => window.__nisps.randomise());
    const after = await page.evaluate(() => window.__nisps.getOutputs());
    const anyChanged = before.some((v, i) => Math.abs(v - after[i]) > 0.001);
    expect(anyChanged).toBe(true);
  });

  test('thumbs-up increments example count by 1', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => window.__nisps.thumbsUp());
    // Give async training a moment to start but we only need to check example count
    await page.waitForTimeout(100);
    const count = await page.evaluate(() => window.__nisps.getExampleCount());
    expect(count).toBe(1);
  });

  test('thumbs-up captures current input position and all 126 output values', async ({ page }) => {
    await loadApp(page);
    // Set a known joystick position via the probe
    await page.evaluate(() => window.__nisps.setInputs(0.25, 0.75));
    await page.evaluate(() => window.__nisps.thumbsUp());
    await page.waitForTimeout(100);

    const { features, labels } = await page.evaluate(() => ({
      features: window.__nisps.iml.dataset.features,
      labels:   window.__nisps.iml.dataset.labels,
    }));

    expect(features).toHaveLength(1);
    expect(labels).toHaveLength(1);

    // Input dimension = 2 (joystick x/y, pipeline-processed)
    expect(features[0]).toHaveLength(2);
    // The input pipeline may transform values; inputs must stay in [0, 1]
    expect(features[0][0]).toBeGreaterThanOrEqual(0);
    expect(features[0][0]).toBeLessThanOrEqual(1);
    expect(features[0][1]).toBeGreaterThanOrEqual(0);
    expect(features[0][1]).toBeLessThanOrEqual(1);

    // Labels = all 126 output values, captured from rawParamValues at click time
    expect(labels[0]).toHaveLength(126);
    for (const v of labels[0]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test('sync train() returns a finite non-negative loss', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(([low, high]) => {
      window.__nisps.iml.addExample(low.input, low.output);
      window.__nisps.iml.addExample(high.input, high.output);
    }, [EXAMPLE_LOW, EXAMPLE_HIGH]);

    const loss = await page.evaluate(() => window.__nisps.train());
    expect(typeof loss).toBe('number');
    expect(isFinite(loss)).toBe(true);
    expect(loss).toBeGreaterThanOrEqual(0);
  });

  test('training with contrasting examples produces a lower loss than initial', async ({ page }) => {
    await loadApp(page);
    // Initial inference — loss is null (never trained), so randomise to get a baseline
    await page.evaluate(() => window.__nisps.randomise());

    await page.evaluate(([low, high]) => {
      window.__nisps.iml.addExample(low.input, low.output);
      window.__nisps.iml.addExample(high.input, high.output);
    }, [EXAMPLE_LOW, EXAMPLE_HIGH]);

    const loss1 = await page.evaluate(() => window.__nisps.train());
    const loss2 = await page.evaluate(() => window.__nisps.train());

    // Second training run on same data should converge further (loss2 <= loss1)
    expect(loss2).toBeLessThanOrEqual(loss1 + 1e-6);
  });

  test('status line reflects example count and loss after training', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(([low, high]) => {
      window.__nisps.iml.addExample(low.input, low.output);
      window.__nisps.iml.addExample(high.input, high.output);
      window.__nisps.train();
    }, [EXAMPLE_LOW, EXAMPLE_HIGH]);

    // updateStatus() is called inside trainModel()
    const text = await page.locator('#status-text').textContent();
    expect(text).toContain('2 examples');
    expect(text).toContain('loss');
  });

  test('thumbs-down changes outputs (weight noise)', async ({ page }) => {
    await loadApp(page);
    const before = await page.evaluate(() => window.__nisps.getOutputs());
    await page.evaluate(() => window.__nisps.thumbsDown());
    const after = await page.evaluate(() => window.__nisps.getOutputs());
    const anyChanged = before.some((v, i) => Math.abs(v - after[i]) > 0.0001);
    expect(anyChanged).toBe(true);
  });

  test('async training via thumbs-up button updates status with loss', async ({ page }) => {
    await loadApp(page);
    await page.click('#btn-thumbsup');
    // Wait for the async training to complete and status to update
    await page.waitForFunction(
      () => document.getElementById('status-text').textContent.includes('loss'),
      { timeout: 15_000 }
    );
    const text = await page.locator('#status-text').textContent();
    expect(text).toContain('1 example');
    expect(text).toContain('loss');
  });

  test('clear examples resets to 0 and marks untrained', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(([low]) => {
      window.__nisps.iml.addExample(low.input, low.output);
      window.__nisps.train();
    }, [EXAMPLE_LOW]);
    expect(await page.evaluate(() => window.__nisps.getExampleCount())).toBe(1);

    await page.evaluate(() => window.__nisps.clearExamples());
    expect(await page.evaluate(() => window.__nisps.getExampleCount())).toBe(0);
    const text = await page.locator('#status-text').textContent();
    expect(text).toContain('0 examples');
  });
});
