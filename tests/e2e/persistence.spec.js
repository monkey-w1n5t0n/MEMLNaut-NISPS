/**
 * State persistence tests — localStorage round-trip and URL param application.
 */
const { test, expect } = require('@playwright/test');
const { loadApp, statusText } = require('./helpers');

const STORAGE_KEY = 'nisps-a-immersive';

test.describe('State persistence', () => {
  test('fresh load with no localStorage starts untrained', async ({ page }) => {
    await loadApp(page); // helpers.js clears localStorage before load
    const text = await statusText(page);
    expect(text).toContain('0 examples');
    expect(text).toContain('untrained');
  });

  test('URL ?preset=beginner-1 applies preset on load', async ({ page }) => {
    await loadApp(page, '&preset=beginner-1');
    const selected = await page.locator('#synth-preset-select').inputValue();
    expect(selected).toBe('beginner-1');
  });

  test('URL ?preset=advanced-2 applies advanced preset', async ({ page }) => {
    await loadApp(page, '&preset=advanced-2');
    const selected = await page.locator('#synth-preset-select').inputValue();
    expect(selected).toBe('advanced-2');
  });

  test('URL ?spread=0 is accepted without crash', async ({ page }) => {
    await loadApp(page, '&spread=0');
    // App should be functional — probe must still exist
    const probe = await page.evaluate(() => typeof window.__nisps);
    expect(probe).toBe('object');
  });

  test('URL ?spread=1 is accepted without crash', async ({ page }) => {
    await loadApp(page, '&spread=1');
    const probe = await page.evaluate(() => typeof window.__nisps);
    expect(probe).toBe('object');
  });

  test('examples + weights persist across reload via localStorage', async ({ page }) => {
    // Navigate fresh — no init script so localStorage is untouched between loads.
    // Suppress the help overlay by pre-setting nisps-help-seen via evaluate.
    await page.goto(`/a-immersive.html?debug=1`);
    await page.evaluate(() => localStorage.removeItem('nisps-a-immersive'));
    await page.evaluate(() => localStorage.setItem('nisps-help-seen', '1'));
    await page.waitForFunction(() => window.__nisps !== undefined, { timeout: 20_000 });

    // Write 2 examples directly to localStorage in the app's save format.
    await page.evaluate(([key]) => {
      const state = {
        features: [[0.1, 0.9], [0.9, 0.1]],
        labels:   [new Array(126).fill(0.2), new Array(126).fill(0.8)],
        handFeatures: [],
        handLabels:   [],
        noiseLevel:   0.05,
        outputMode:   'visual',
        inputMode:    'joystick',
        joyX: 0.5, joyY: 0.5,
        groupOverrides:    null,
        visualOverrides:   null,
        midiCCOverrides:   null,
        audioCanvasState:  null,
        synthPresetId:     null,
      };
      localStorage.setItem(key, JSON.stringify(state));
    }, [STORAGE_KEY]);

    // Reload — no addInitScript registered, so localStorage is preserved.
    await page.reload();
    await page.waitForFunction(() => window.__nisps !== undefined, { timeout: 20_000 });

    // loadState() runs sync training; wait for status to show a loss value.
    await page.waitForFunction(
      () => document.getElementById('status-text').textContent.includes('loss'),
      { timeout: 15_000 }
    );

    const count = await page.evaluate(() => window.__nisps.getExampleCount());
    expect(count).toBe(2);
    const text = await statusText(page);
    expect(text).toContain('2 examples');
    expect(text).toContain('loss');
  });

  test('saveState probe writes valid JSON to localStorage', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => window.__nisps.saveState());

    const raw = await page.evaluate(([key]) => localStorage.getItem(key), [STORAGE_KEY]);
    expect(raw).not.toBeNull();

    const state = JSON.parse(raw);
    expect(Array.isArray(state.features)).toBe(true);
    expect(Array.isArray(state.labels)).toBe(true);
    expect(typeof state.outputMode).toBe('string');
    expect(typeof state.noiseLevel).toBe('number');
  });

  test('localStorage state is overwritten on next saveState call', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => window.__nisps.saveState());

    const before = await page.evaluate(([key]) => localStorage.getItem(key), [STORAGE_KEY]);

    // Add an example and save again
    await page.evaluate(() => {
      window.__nisps.iml.addExample([0.3, 0.7], new Array(126).fill(0.5));
      window.__nisps.saveState();
    });

    const after = await page.evaluate(([key]) => localStorage.getItem(key), [STORAGE_KEY]);
    // State changed — the feature array should now include our example
    const parsed = JSON.parse(after);
    expect(parsed.features.length).toBeGreaterThan(0);
  });
});
