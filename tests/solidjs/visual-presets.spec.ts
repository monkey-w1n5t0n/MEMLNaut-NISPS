/**
 * Visual Preset Chips tests — VAL-TRAIN-007 assertion.
 *
 * Covers feature f12-visual-presets:
 *   - Preset chips visible in training drawer
 *   - Clicking calm-to-chaotic loads 3 examples and triggers training
 *   - Status shows loss after preset loading
 *   - Each preset loads correct number of examples
 */

import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('Visual Presets (f12)', () => {
  test.beforeEach(async ({ page }) => {
    await loadSolidApp(page);
  });

  // ─── Preset chip visibility ───

  test('VAL-TRAIN-007a: preset chips are visible in training drawer', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();
    await expect(page.locator('#drawer-training')).toBeVisible();

    // All 5 preset chips should exist
    const chips = page.locator('.preset-chip');
    await expect(chips).toHaveCount(5);

    // Check each preset chip is present
    await expect(page.locator('.preset-chip[data-preset="calm-to-chaotic"]')).toBeVisible();
    await expect(page.locator('.preset-chip[data-preset="rainbow-sweep"]')).toBeVisible();
    await expect(page.locator('.preset-chip[data-preset="vortex"]')).toBeVisible();
    await expect(page.locator('.preset-chip[data-preset="spiral"]')).toBeVisible();
    await expect(page.locator('.preset-chip[data-preset="embers"]')).toBeVisible();
  });

  test('VAL-TRAIN-007b: preset chips have readable labels', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    const calm = page.locator('.preset-chip[data-preset="calm-to-chaotic"]');
    await expect(calm).toHaveText(/Calm/i);

    const rainbow = page.locator('.preset-chip[data-preset="rainbow-sweep"]');
    await expect(rainbow).toHaveText(/Rain/i);

    const vortex = page.locator('.preset-chip[data-preset="vortex"]');
    await expect(vortex).toHaveText(/Vortex/i);

    const spiral = page.locator('.preset-chip[data-preset="spiral"]');
    await expect(spiral).toHaveText(/Spir/i);

    const embers = page.locator('.preset-chip[data-preset="embers"]');
    await expect(embers).toHaveText(/Ember/i);
  });

  // ─── VAL-TRAIN-007: calm-to-chaotic loads 3 examples + training ───

  test('VAL-TRAIN-007c: clicking calm-to-chaotic loads 3 examples', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    // Verify fresh state
    let count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(0);

    // Click calm-to-chaotic preset
    await page.locator('.preset-chip[data-preset="calm-to-chaotic"]').click();

    // Wait for training to complete (loadVisualPreset does training)
    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 15_000 }
    );

    count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(3);
  });

  test('VAL-TRAIN-007d: status shows loss after clicking calm-to-chaotic', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    await page.locator('.preset-chip[data-preset="calm-to-chaotic"]').click();

    // Wait for training to complete
    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 15_000 }
    );

    // Status should show loss value
    const statusText = await page.locator('#status-text').textContent();
    expect(statusText).toContain('3 examples');
    expect(statusText).toMatch(/loss \d/);
    expect(statusText).not.toContain('untrained');

    // Loss should be a finite number
    const loss = await page.evaluate(() => (window as any).__nisps.getLoss());
    expect(loss).not.toBeNull();
    expect(typeof loss).toBe('number');
    expect(isFinite(loss as number)).toBe(true);
  });

  // ─── Other presets load correct example counts ───

  test('VAL-TRAIN-007e: rainbow-sweep loads 3 examples', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    await page.locator('.preset-chip[data-preset="rainbow-sweep"]').click();

    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 15_000 }
    );

    const count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(3);
  });

  test('VAL-TRAIN-007f: vortex loads 5 examples', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    await page.locator('.preset-chip[data-preset="vortex"]').click();

    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 15_000 }
    );

    const count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(5);
  });

  test('VAL-TRAIN-007g: spiral loads 3 examples', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    await page.locator('.preset-chip[data-preset="spiral"]').click();

    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 15_000 }
    );

    const count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(3);
  });

  test('VAL-TRAIN-007h: embers loads 3 examples', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    await page.locator('.preset-chip[data-preset="embers"]').click();

    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 15_000 }
    );

    const count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(3);
  });

  // ─── Preset clears previous examples ───

  test('VAL-TRAIN-007i: clicking a preset clears previous examples first', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    // Add a manual example first
    await page.locator('#btn-add-example').click();
    let count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(1);

    // Click a preset — should clear and load its own examples
    await page.locator('.preset-chip[data-preset="calm-to-chaotic"]').click();

    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 15_000 }
    );

    count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(3); // calm-to-chaotic has 3, not 4
  });

  // ─── Preset changes outputs ───

  test('VAL-TRAIN-007j: preset changes outputs from initial state', async ({ page }) => {
    await page.locator('.dock-icon[data-drawer="training"]').click();

    const outputsBefore = await page.evaluate(() => Array.from((window as any).__nisps.getOutputs()));

    await page.locator('.preset-chip[data-preset="calm-to-chaotic"]').click();

    await page.waitForFunction(
      () => (window as any).__nisps.getLoss() !== null,
      { timeout: 15_000 }
    );

    const outputsAfter = await page.evaluate(() => Array.from((window as any).__nisps.getOutputs()));

    // At least some outputs should differ after preset loading + training
    let changed = false;
    for (let i = 0; i < Math.min(outputsBefore.length, outputsAfter.length); i++) {
      if (Math.abs(outputsBefore[i] - outputsAfter[i]) > 0.001) {
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
  });
});
