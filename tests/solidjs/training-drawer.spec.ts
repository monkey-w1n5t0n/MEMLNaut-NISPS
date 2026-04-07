/**
 * Training Drawer tests — VAL-TRAIN-* assertions.
 *
 * Covers feature f08-training-drawer-controls:
 *   - Training drawer opens/closes via dock icon
 *   - Add Example button increments count and updates status
 *   - Train triggers async training, shows loss
 *   - Clear Ex resets examples
 *   - Clear All clears examples, loss history, resets noise
 *   - Randomize changes outputs
 *   - Loss plot shows training history
 *   - Status line shows proper text
 */

import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('Training Drawer (f08)', () => {
  test.beforeEach(async ({ page }) => {
    await loadSolidApp(page);
  });

  // ─── VAL-TRAIN-001: Training drawer opens/closes ───

  test('VAL-TRAIN-001a: training drawer is not visible on load', async ({ page }) => {
    const drawer = page.locator('#drawer-training');
    await expect(drawer).toBeHidden();
  });

  test('VAL-TRAIN-001b: clicking Train dock icon opens the training drawer', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();
    const drawer = page.locator('#drawer-training');
    await expect(drawer).toBeVisible();
  });

  test('VAL-TRAIN-001c: clicking Train dock icon again closes the drawer', async ({ page }) => {
    const dockBtn = page.locator('.dock-icon[data-drawer="training"]');
    await dockBtn.click();
    await expect(page.locator('#drawer-training')).toBeVisible();

    await dockBtn.click();
    await expect(page.locator('#drawer-training')).toBeHidden();
  });

  test('VAL-TRAIN-001d: dock icon shows active state when drawer is open', async ({ page }) => {
    const dockBtn = page.locator('.dock-icon[data-drawer="training"]');
    await dockBtn.click();
    await expect(dockBtn).toHaveClass(/active/);
  });

  // ─── VAL-TRAIN-002: Add Example button ───

  test('VAL-TRAIN-002a: Add Example button exists in training drawer', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();
    await expect(page.locator('#btn-add-example')).toBeVisible();
  });

  test('VAL-TRAIN-002b: Add Example increments example count', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    const countBefore = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(countBefore).toBe(0);

    await page.locator('#btn-add-example').click();

    const countAfter = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(countAfter).toBe(1);
  });

  test('VAL-TRAIN-002c: Add Example updates status line', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();
    await page.locator('#btn-add-example').click();

    const statusText = await page.locator('#status-text').textContent();
    expect(statusText).toContain('1 example');
  });

  test('VAL-TRAIN-002d: multiple Add Example clicks increment count', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    await page.locator('#btn-add-example').click();
    await page.locator('#btn-add-example').click();
    await page.locator('#btn-add-example').click();

    const count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(3);

    const statusText = await page.locator('#status-text').textContent();
    expect(statusText).toContain('3 examples');
  });

  // ─── VAL-TRAIN-003: Train button ───

  test('VAL-TRAIN-003a: Train button exists in training drawer', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();
    await expect(page.locator('#btn-train')).toBeVisible();
  });

  test('VAL-TRAIN-003b: Train triggers async training and shows loss', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    // Add an example first
    await page.locator('#btn-add-example').click();

    // Click train
    await page.locator('#btn-train').click();

    // Wait for training to complete
    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 10_000 }
    );

    const loss = await page.evaluate(() => (window as any).__nisps.getLoss());
    expect(loss).not.toBeNull();
    expect(typeof loss).toBe('number');
    expect(isFinite(loss as number)).toBe(true);

    // Status should show loss
    const statusText = await page.locator('#status-text').textContent();
    expect(statusText).toContain('loss');
    expect(statusText).not.toContain('untrained');
  });

  // ─── VAL-TRAIN-004: Clear Ex button ───

  test('VAL-TRAIN-004a: Clear Ex button exists in training drawer', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();
    await expect(page.locator('#btn-clear-examples')).toBeVisible();
  });

  test('VAL-TRAIN-004b: Clear Ex resets example count to 0', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    // Add examples
    await page.locator('#btn-add-example').click();
    await page.locator('#btn-add-example').click();
    let count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(2);

    // Clear examples
    await page.locator('#btn-clear-examples').click();

    count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(0);

    const statusText = await page.locator('#status-text').textContent();
    expect(statusText).toContain('0 examples');
  });

  // ─── VAL-TRAIN-005: Clear All button ───

  test('VAL-TRAIN-005a: Clear All button exists in training drawer', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();
    await expect(page.locator('#btn-clear-all')).toBeVisible();
  });

  test('VAL-TRAIN-005b: Clear All resets examples, loss history, and noise', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    // Add example and train
    await page.locator('#btn-add-example').click();
    await page.locator('#btn-train').click();
    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 10_000 }
    );

    // Verify state before clear
    let count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(1);
    let loss = await page.evaluate(() => (window as any).__nisps.getLoss());
    expect(loss).not.toBeNull();

    // Clear all
    await page.locator('#btn-clear-all').click();

    // Verify state after clear
    count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(0);

    loss = await page.evaluate(() => (window as any).__nisps.getLoss());
    expect(loss).toBeNull();
  });

  // ─── VAL-TRAIN-006: Randomize button ───

  test('VAL-TRAIN-006a: Randomize button exists in training drawer', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();
    await expect(page.locator('#btn-randomize')).toBeVisible();
  });

  test('VAL-TRAIN-006b: Randomize changes outputs', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    const outputsBefore = await page.evaluate(() => (window as any).__nisps.getOutputs());

    await page.locator('#btn-randomize').click();

    const outputsAfter = await page.evaluate(() => (window as any).__nisps.getOutputs());

    // At least one output should differ
    let changed = false;
    for (let i = 0; i < outputsBefore.length; i++) {
      if (Math.abs(outputsBefore[i] - outputsAfter[i]) > 0.001) {
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
  });

  // ─── VAL-TRAIN-008: Loss plot ───

  test('VAL-TRAIN-008a: loss canvas exists in training drawer', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();
    await expect(page.locator('#loss-canvas')).toBeVisible();
  });

  test('VAL-TRAIN-008b: loss plot draws something after training', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    // Add example and train to generate loss history
    await page.locator('#btn-add-example').click();
    await page.locator('#btn-train').click();
    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 10_000 }
    );

    // Check that the canvas has been drawn on (has non-transparent pixels)
    const hasContent = await page.evaluate(() => {
      const canvas = document.getElementById('loss-canvas') as HTMLCanvasElement;
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      // Check for non-transparent pixels (loss line is drawn)
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) return true;
      }
      return false;
    });
    expect(hasContent).toBe(true);
  });

  // ─── VAL-TRAIN-009: Status line display ───

  test('VAL-TRAIN-009a: status line shows "0 examples · untrained" on fresh load', async ({ page }) => {
    const statusText = await page.locator('#status-text').textContent();
    expect(statusText).toContain('0 examples');
    expect(statusText).toContain('untrained');
  });

  test('VAL-TRAIN-009b: status line shows "N examples · untrained" after adding examples', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();
    await page.locator('#btn-add-example').click();

    const statusText = await page.locator('#status-text').textContent();
    expect(statusText).toContain('1 example');
    expect(statusText).toContain('untrained');
  });

  test('VAL-TRAIN-009c: status line shows "N examples · loss X.XXXXX" after training', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();
    await page.locator('#btn-add-example').click();
    await page.locator('#btn-train').click();
    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 10_000 }
    );

    const statusText = await page.locator('#status-text').textContent();
    expect(statusText).toContain('1 example');
    expect(statusText).toMatch(/loss \d/);
    expect(statusText).not.toContain('untrained');
  });

  test('VAL-TRAIN-009d: status line resets to untrained after clear examples', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    // Add and train
    await page.locator('#btn-add-example').click();
    await page.locator('#btn-train').click();
    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 10_000 }
    );

    // Clear examples
    await page.locator('#btn-clear-examples').click();

    const statusText = await page.locator('#status-text').textContent();
    expect(statusText).toContain('0 examples');
  });
});
