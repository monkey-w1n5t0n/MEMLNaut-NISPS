/**
 * UI state machine tests — drawers, mode switching, preset chips, keyboard shortcuts.
 */
const { test, expect } = require('@playwright/test');
const { loadApp, statusText } = require('./helpers');

test.describe('UI interactions', () => {
  test.describe('Dock drawers', () => {
    test('Train dock button opens training drawer', async ({ page }) => {
      await loadApp(page);
      await expect(page.locator('#drawer-training')).toHaveClass(/hidden/);
      await page.click('[data-drawer="training"]');
      await expect(page.locator('#drawer-training')).not.toHaveClass(/hidden/);
    });

    test('Drawer close button hides the drawer', async ({ page }) => {
      await loadApp(page);
      await page.click('[data-drawer="training"]');
      await expect(page.locator('#drawer-training')).not.toHaveClass(/hidden/);
      await page.click('#drawer-training .drawer-close');
      await expect(page.locator('#drawer-training')).toHaveClass(/hidden/);
    });

    test('Mode dock button opens mode drawer', async ({ page }) => {
      await loadApp(page);
      await page.click('[data-drawer="mode"]');
      await expect(page.locator('#drawer-mode')).not.toHaveClass(/hidden/);
    });

    test('Engine dock button opens engine drawer', async ({ page }) => {
      await loadApp(page);
      await page.click('[data-drawer="params"]');
      await expect(page.locator('#drawer-params')).not.toHaveClass(/hidden/);
    });

    test('multiple drawers can be open simultaneously', async ({ page }) => {
      await loadApp(page);
      await page.click('[data-drawer="training"]');
      await page.click('[data-drawer="mode"]');
      // The app doesn't auto-close drawers — both can be open
      await expect(page.locator('#drawer-training')).not.toHaveClass(/hidden/);
      await expect(page.locator('#drawer-mode')).not.toHaveClass(/hidden/);
    });
  });

  test.describe('Output mode switching', () => {
    test('default mode is visual — synth quick controls hidden', async ({ page }) => {
      await loadApp(page);
      await expect(page.locator('#synth-quick-controls')).toHaveClass(/hidden/);
      await expect(page.locator('#midi-cc-quick-controls')).toHaveClass(/hidden/);
    });

    test('switching to Synth shows synth quick controls', async ({ page }) => {
      await loadApp(page);
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await expect(page.locator('#synth-quick-controls')).not.toHaveClass(/hidden/);
    });

    test('switching to MIDI CC shows midi-cc quick controls', async ({ page }) => {
      await loadApp(page);
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="midi-cc"]');
      await expect(page.locator('#midi-cc-quick-controls')).not.toHaveClass(/hidden/);
    });

    test('switching back to Visual hides synth controls', async ({ page }) => {
      await loadApp(page);
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.click('[data-mode="visual"]');
      await expect(page.locator('#synth-quick-controls')).toHaveClass(/hidden/);
    });

    test('heatmap shows 20 bars in visual mode', async ({ page }) => {
      await loadApp(page);
      const count = await page.locator('.heatmap-cell').count();
      expect(count).toBe(20);
    });

    test('heatmap shows 126 bars in synth mode', async ({ page }) => {
      await loadApp(page);
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      const count = await page.locator('.heatmap-cell').count();
      expect(count).toBe(126);
    });
  });

  test.describe('Status line', () => {
    test('shows 0 examples · untrained on fresh load', async ({ page }) => {
      await loadApp(page);
      const text = await statusText(page);
      expect(text).toContain('0 examples');
      expect(text).toContain('untrained');
    });
  });

  test.describe('Training controls', () => {
    test('Randomize button changes heatmap bar widths', async ({ page }) => {
      await loadApp(page);
      await page.click('[data-drawer="training"]');

      const widthsBefore = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.heatmap-cell-bar')).map(el => el.style.width)
      );
      await page.click('#btn-randomize');
      const widthsAfter = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.heatmap-cell-bar')).map(el => el.style.width)
      );

      const anyChanged = widthsBefore.some((w, i) => w !== widthsAfter[i]);
      expect(anyChanged).toBe(true);
    });

    test('preset chip loads examples and trains', async ({ page }) => {
      await loadApp(page);
      await page.click('[data-drawer="training"]');
      await page.click('[data-preset="calm-to-chaotic"]');

      // calm-to-chaotic has 3 examples; training is async
      await page.waitForFunction(
        () => document.getElementById('status-text').textContent.includes('loss'),
        { timeout: 15_000 }
      );
      const text = await statusText(page);
      expect(text).toContain('3 examples');
      expect(text).toContain('loss');
    });

    test('Clear Ex resets example count to 0', async ({ page }) => {
      await loadApp(page);
      await page.click('[data-drawer="training"]');
      await page.click('[data-preset="calm-to-chaotic"]');
      await page.waitForFunction(
        () => document.getElementById('status-text').textContent.includes('loss'),
        { timeout: 15_000 }
      );

      await page.click('#btn-clear-examples');
      const text = await statusText(page);
      expect(text).toContain('0 examples');
    });
  });

  test.describe('Keyboard shortcuts', () => {
    test('key 2 triggers thumbs-up (adds example)', async ({ page }) => {
      await loadApp(page);
      const before = await page.evaluate(() => window.__nisps.getExampleCount());
      await page.keyboard.press('2');
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => window.__nisps.getExampleCount());
      expect(after).toBe(before + 1);
    });

    test('key 1 triggers thumbs-down (changes outputs)', async ({ page }) => {
      await loadApp(page);
      const before = await page.evaluate(() => window.__nisps.getOutputs());
      await page.keyboard.press('1');
      const after = await page.evaluate(() => window.__nisps.getOutputs());
      const anyChanged = before.some((v, i) => Math.abs(v - after[i]) > 0.0001);
      expect(anyChanged).toBe(true);
    });

    test('key Z triggers undo after thumbs-down', async ({ page }) => {
      await loadApp(page);
      const before = await page.evaluate(() => window.__nisps.getWeights());
      await page.keyboard.press('1'); // thumbs-down
      await page.keyboard.press('z'); // undo
      const after = await page.evaluate(() => window.__nisps.getWeights());
      // Weights should be restored (approximately)
      const maxDiff = before.reduce((m, v, i) => Math.max(m, Math.abs(v - after[i])), 0);
      expect(maxDiff).toBeLessThan(1e-4);
    });
  });
});
