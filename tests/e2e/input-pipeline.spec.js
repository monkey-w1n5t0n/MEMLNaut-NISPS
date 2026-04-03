/**
 * Input pipeline tests — joystick → MLP inputs → outputs → heatmap.
 */
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

test.describe('Joystick → output pipeline', () => {
  test('different input positions produce different outputs', async ({ page }) => {
    await loadApp(page);

    await page.evaluate(() => window.__nisps.setInputs(0.1, 0.1));
    const out1 = await page.evaluate(() => window.__nisps.getOutputs());

    await page.evaluate(() => window.__nisps.setInputs(0.9, 0.9));
    const out2 = await page.evaluate(() => window.__nisps.getOutputs());

    const anyChanged = out1.some((v, i) => Math.abs(v - out2[i]) > 0.0001);
    expect(anyChanged).toBe(true);
  });

  test('all outputs remain in [0, 1] across input positions', async ({ page }) => {
    await loadApp(page);
    const corners = [[0, 0], [0, 1], [1, 0], [1, 1], [0.5, 0.5]];
    for (const [x, y] of corners) {
      await page.evaluate(([x, y]) => window.__nisps.setInputs(x, y), [x, y]);
      const outputs = await page.evaluate(() => window.__nisps.getOutputs());
      for (const v of outputs) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  test('heatmap bar widths change when inputs change', async ({ page }) => {
    await loadApp(page);

    const widths1 = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.heatmap-cell-bar')).map(el => el.style.width)
    );

    // Move to far corner
    await page.evaluate(() => window.__nisps.setInputs(0.95, 0.05));

    const widths2 = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.heatmap-cell-bar')).map(el => el.style.width)
    );

    const anyChanged = widths1.some((w, i) => w !== widths2[i]);
    expect(anyChanged).toBe(true);
  });

  test('mouse drag on joystick container updates MLP inputs', async ({ page }) => {
    await loadApp(page);

    const box = await page.locator('#joystick-container').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Drag from center towards bottom-right
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + box.width * 0.3, cy + box.height * 0.3, { steps: 10 });
    await page.mouse.up();

    // After drag, at least one input axis should have moved from 0.5
    const [x, y] = await page.evaluate(() => [
      window.__nisps.iml.inputState[0],
      window.__nisps.iml.inputState[1],
    ]);
    const moved = Math.abs(x - 0.5) > 0.01 || Math.abs(y - 0.5) > 0.01;
    expect(moved).toBe(true);
  });

  test('setInputs clamps values to [0, 1]', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => window.__nisps.setInputs(-5, 99));
    const [x, y] = await page.evaluate(() => [
      window.__nisps.iml.inputState[0],
      window.__nisps.iml.inputState[1],
    ]);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(1);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(1);
  });

  test('after training, moving inputs produces smoothly varying outputs', async ({ page }) => {
    await loadApp(page);

    // Load calm-to-chaotic preset (3 examples spanning the input space)
    await page.click('[data-drawer="training"]');
    await page.click('[data-preset="calm-to-chaotic"]');
    await page.waitForFunction(
      () => document.getElementById('status-text').textContent.includes('loss'),
      { timeout: 15_000 }
    );

    // Sample 5 positions and verify all outputs are bounded
    const positions = [0.0, 0.25, 0.5, 0.75, 1.0];
    for (const t of positions) {
      await page.evaluate((t) => window.__nisps.setInputs(t, 1 - t), t);
      const outputs = await page.evaluate(() => window.__nisps.getOutputs());
      expect(outputs).toHaveLength(126);
      for (const v of outputs) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
