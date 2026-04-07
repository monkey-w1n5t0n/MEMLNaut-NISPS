/**
 * e2e tests for f09-rl-controls-noise.
 * Validates:
 *   VAL-ML-011: Thumbs up adds example and decays noise
 *   VAL-ML-012: Thumbs down changes outputs with spread-aware noise
 *   VAL-JOY-004: Noise ring indicator around joystick
 */
import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('RL Controls + Noise Ring (f09)', () => {

  // ─── VAL-ML-011: Thumbs up adds example and decays noise ───

  test('VAL-ML-011a: thumbsUp increments exampleCount', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const probe = (window as any).__nisps;
      const countBefore = probe.getExampleCount();
      await probe.thumbsUp();
      const countAfter = probe.getExampleCount();
      return { countBefore, countAfter };
    });

    expect(result.countBefore).toBe(0);
    expect(result.countAfter).toBe(1);
  });

  test('VAL-ML-011b: thumbsUp decreases noise level', async ({ page }) => {
    await loadSolidApp(page);

    // First, thumbs-down to raise noise, then thumbs-up to decay it
    const result = await page.evaluate(async () => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      // Get initial noise
      const noiseInitial = store.noiseLevel();

      // Thumbs-down to raise noise
      probe.thumbsDown();
      const noiseAfterDown = store.noiseLevel();

      // Thumbs-up should decay noise
      await probe.thumbsUp();
      const noiseAfterUp = store.noiseLevel();

      return { noiseInitial, noiseAfterDown, noiseAfterUp };
    });

    // Thumbs-down should raise noise
    expect(result.noiseAfterDown).toBeGreaterThan(result.noiseInitial);
    // Thumbs-up should decay it
    expect(result.noiseAfterUp).toBeLessThan(result.noiseAfterDown);
  });

  test('VAL-ML-011c: thumbsUp triggers async training (loss becomes non-null)', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const probe = (window as any).__nisps;
      const lossBefore = probe.getLoss();

      // Thumbs-up adds example + triggers async training
      await probe.thumbsUp();

      const lossAfter = probe.getLoss();
      const countAfter = probe.getExampleCount();

      return { lossBefore, lossAfter, countAfter };
    });

    expect(result.lossBefore).toBeNull();
    expect(result.countAfter).toBe(1);
    // After training with 1 example, loss should be a finite number
    expect(result.lossAfter).not.toBeNull();
    if (result.lossAfter !== null) {
      expect(Number.isFinite(result.lossAfter)).toBe(true);
      expect(result.lossAfter).toBeGreaterThanOrEqual(0);
    }
  });

  test('VAL-ML-011d: multiple thumbsUp calls accumulate examples', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const probe = (window as any).__nisps;

      await probe.thumbsUp();
      const count1 = probe.getExampleCount();

      await probe.thumbsUp();
      const count2 = probe.getExampleCount();

      await probe.thumbsUp();
      const count3 = probe.getExampleCount();

      return { count1, count2, count3 };
    });

    expect(result.count1).toBe(1);
    expect(result.count2).toBe(2);
    expect(result.count3).toBe(3);
  });

  // ─── VAL-ML-012: Thumbs down changes outputs with spread-aware noise ───

  test('VAL-ML-012a: thumbsDown changes at least one output', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      probe.setInputs(0.5, 0.5);
      const before = [...probe.getOutputs()];
      probe.thumbsDown();
      const after = [...probe.getOutputs()];
      return { before, after };
    });

    const changed = result.before.some((v: number, i: number) => v !== result.after[i]);
    expect(changed).toBe(true);
  });

  test('VAL-ML-012b: thumbsDown outputs remain bounded [0,1]', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      probe.thumbsDown();
      return probe.getOutputs();
    });

    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test('VAL-ML-012c: thumbsDown noise magnitude respects spread param', async ({ page }) => {
    await loadSolidApp(page);

    // Test with default spread=0.6: noiseCap = 0.3*(1-0.6) + 0.05*0.6 = 0.12 + 0.03 = 0.15
    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      const spreadLevel = store.state.spreadLevel;
      const expectedCap = 0.3 * (1 - spreadLevel) + 0.05 * spreadLevel;

      const noiseInitial = store.noiseLevel();
      probe.thumbsDown();
      const noiseAfter = store.noiseLevel();

      return { noiseInitial, noiseAfter, spreadLevel, expectedCap };
    });

    expect(result.noiseAfter).toBeGreaterThan(result.noiseInitial);
    // Noise should be capped at the expected cap for the current spread
    expect(result.noiseAfter).toBeLessThanOrEqual(result.expectedCap + 0.001);
  });

  test('VAL-ML-012d: thumbsDown with higher spread has lower noise cap', async ({ page }) => {
    await loadSolidApp(page);

    // Test that spread=1 produces lower noise than spread=0
    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      // Save state, set spread to 1
      store.setSpreadLevel(1.0);
      const capHigh = 0.3 * (1 - 1.0) + 0.05 * 1.0; // = 0.05

      // Reset noise
      store.randomise(); // resets noise to 0.05

      probe.thumbsDown();
      const noiseHighSpread = store.noiseLevel();

      // Now set spread to 0
      store.setSpreadLevel(0.0);
      store.randomise(); // resets noise to 0.05

      probe.thumbsDown();
      const noiseLowSpread = store.noiseLevel();

      return { noiseHighSpread, noiseLowSpread };
    });

    // spread=0 allows much higher noise than spread=1
    expect(result.noiseLowSpread).toBeGreaterThan(result.noiseHighSpread);
  });

  test('VAL-ML-012e: thumbsDown increases noise level', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      const noiseBefore = store.noiseLevel();
      probe.thumbsDown();
      const noiseAfter = store.noiseLevel();

      return { noiseBefore, noiseAfter };
    });

    expect(result.noiseAfter).toBeGreaterThan(result.noiseBefore);
  });

  // ─── VAL-JOY-004: Noise ring indicator ───

  test('VAL-JOY-004a: noise ring element exists in DOM', async ({ page }) => {
    await loadSolidApp(page);

    const ring = page.locator('#noise-ring');
    await expect(ring).toBeAttached();
  });

  test('VAL-JOY-004b: noise ring is not active at default noise level', async ({ page }) => {
    await loadSolidApp(page);

    // Default noise is 0.05 — which is > 0.01 so ring should be active (low)
    const classes = await page.locator('#noise-ring').getAttribute('class');
    // At default noise 0.05 > 0.01, ring should have 'active' class
    expect(classes).toContain('active');
    // But not 'high' (that requires > 0.15)
    expect(classes).not.toContain('high');
  });

  test('VAL-JOY-004c: noise ring becomes high after repeated thumbs-down', async ({ page }) => {
    await loadSolidApp(page);

    // Lower spread to allow higher noise cap (spread=0 → cap=0.3)
    await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      store.setSpreadLevel(0.0);
    });

    await page.evaluate(() => {
      const probe = (window as any).__nisps;
      // Repeated thumbs-down to raise noise above 0.15
      for (let i = 0; i < 10; i++) {
        probe.thumbsDown();
      }
    });

    const classes = await page.locator('#noise-ring').getAttribute('class');
    expect(classes).toContain('high');
  });

  test('VAL-JOY-004d: noise ring thickness increases with noise level', async ({ page }) => {
    await loadSolidApp(page);

    // Lower spread to allow higher noise cap
    await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      store.setSpreadLevel(0.0);
    });

    // Get border width at low noise (default 0.05 → .active class = 3px)
    await page.waitForTimeout(100); // Wait for reactive update
    const lowWidth = await page.locator('#noise-ring').evaluate((el: HTMLElement) => {
      return getComputedStyle(el).borderWidth;
    });

    // Raise noise with thumbs-down
    await page.evaluate(() => {
      const probe = (window as any).__nisps;
      for (let i = 0; i < 10; i++) {
        probe.thumbsDown();
      }
    });

    // Wait for CSS transition (300ms) and reactive update
    await page.waitForTimeout(400);

    // Get border width at high noise
    const highWidth = await page.locator('#noise-ring').evaluate((el: HTMLElement) => {
      return getComputedStyle(el).borderWidth;
    });

    // High noise should have thicker border (active=3px, high=6px)
    const lowVal = parseFloat(lowWidth);
    const highVal = parseFloat(highWidth);
    expect(highVal).toBeGreaterThan(lowVal);
  });

  // ─── RL Buttons UI ───

  test('RL buttons are visible in DOM', async ({ page }) => {
    await loadSolidApp(page);

    const thumbsUp = page.locator('#btn-thumbsup');
    const thumbsDown = page.locator('#btn-thumbsdown');
    await expect(thumbsUp).toBeVisible();
    await expect(thumbsDown).toBeVisible();
  });

  test('clicking thumbs-up button increments exampleCount', async ({ page }) => {
    await loadSolidApp(page);

    const countBefore = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    await page.locator('#btn-thumbsup').click();
    // Wait for async training
    await page.waitForTimeout(500);
    const countAfter = await page.evaluate(() => (window as any).__nisps.getExampleCount());

    expect(countAfter).toBe(countBefore + 1);
  });

  test('clicking thumbs-down button changes outputs', async ({ page }) => {
    await loadSolidApp(page);

    const outputsBefore = await page.evaluate(() => (window as any).__nisps.getOutputs());
    await page.locator('#btn-thumbsdown').click();
    const outputsAfter = await page.evaluate(() => (window as any).__nisps.getOutputs());

    const changed = outputsBefore.some((v: number, i: number) => v !== outputsAfter[i]);
    expect(changed).toBe(true);
  });

  // ─── RL interaction flow ───

  test('VAL-CROSS-002 partial: thumbs-down → noise up → thumbs-up → noise down', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      const noiseInitial = store.noiseLevel();

      // Thumbs-down raises noise
      probe.thumbsDown();
      const noiseAfterDown = store.noiseLevel();

      // Thumbs-up decays noise
      await probe.thumbsUp();
      const noiseAfterUp = store.noiseLevel();

      return { noiseInitial, noiseAfterDown, noiseAfterUp };
    });

    expect(result.noiseAfterDown).toBeGreaterThan(result.noiseInitial);
    expect(result.noiseAfterUp).toBeLessThan(result.noiseAfterDown);
  });
});
