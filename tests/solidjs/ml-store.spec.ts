/**
 * e2e tests for f04-ml-store-dual-iml.
 * Validates:
 *   VAL-ML-001: Initial outputs bounded [0,1]
 *   VAL-ML-002: Initial state is untrained
 *   VAL-ML-022: Output count changes with mode
 */
import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('ML Store — Dual IML', () => {

  // ─── VAL-ML-001: Initial outputs bounded [0,1] ───

  test('VAL-ML-001a: getOutputs() returns 126 values on fresh load', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const outputs = probe.getOutputs();
      return {
        length: outputs.length,
        isArray: Array.isArray(outputs),
      };
    });

    expect(result.isArray).toBe(true);
    expect(result.length).toBe(126);
  });

  test('VAL-ML-001b: all initial outputs are in [0,1]', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const outputs = (window as any).__nisps.getOutputs();
      return {
        min: Math.min(...outputs),
        max: Math.max(...outputs),
        allBounded: outputs.every((v: number) => v >= 0 && v <= 1),
        allFinite: outputs.every((v: number) => Number.isFinite(v)),
      };
    });

    expect(result.allBounded).toBe(true);
    expect(result.allFinite).toBe(true);
    expect(result.min).toBeGreaterThanOrEqual(0);
    expect(result.max).toBeLessThanOrEqual(1);
  });

  // ─── VAL-ML-002: Initial state is untrained ───

  test('VAL-ML-002a: getExampleCount() returns 0 on fresh load', async ({ page }) => {
    await loadSolidApp(page);

    const count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(0);
  });

  test('VAL-ML-002b: getLoss() returns null on fresh load', async ({ page }) => {
    await loadSolidApp(page);

    const loss = await page.evaluate(() => (window as any).__nisps.getLoss());
    expect(loss).toBeNull();
  });

  // ─── VAL-ML-022: Output count changes with mode ───

  test('VAL-ML-022a: default output count is 126 (synth mode default)', async ({ page }) => {
    await loadSolidApp(page);

    const length = await page.evaluate(() => (window as any).__nisps.getOutputs().length);
    expect(length).toBe(126);
  });

  test('VAL-ML-022b: outputCount signal tracks current count', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      return store.outputCount();
    });

    // Default is 126 (synth mode is default)
    expect(result).toBe(126);
  });

  test('VAL-ML-022c: mode change to visual produces 20 outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      // Switch mode via store
      await store.setOutputMode('visual');

      return {
        outputCount: probe.getOutputs().length,
        allBounded: probe.getOutputs().every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.outputCount).toBe(20);
    expect(result.allBounded).toBe(true);
  });

  test('VAL-ML-022d: mode change back to synth produces 126 outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      // Switch to visual first
      await store.setOutputMode('visual');

      // Now switch to synth
      await store.setOutputMode('synth');

      return {
        outputCount: probe.getOutputs().length,
        allBounded: probe.getOutputs().every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.outputCount).toBe(126);
    expect(result.allBounded).toBe(true);
  });

  test('VAL-ML-022e: mode change to midi-cc produces dynamic output count (default 8)', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      // Switch to midi-cc mode
      await store.setOutputMode('midi-cc');

      return {
        outputCount: probe.getOutputs().length,
        allBounded: probe.getOutputs().every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.outputCount).toBe(8); // default MIDI CC count
    expect(result.allBounded).toBe(true);
  });

  test('VAL-ML-022f: mode change to audio-canvas produces 36 outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      // Switch to audio-canvas mode
      await store.setOutputMode('audio-canvas');

      return {
        outputCount: probe.getOutputs().length,
        allBounded: probe.getOutputs().every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.outputCount).toBe(36);
    expect(result.allBounded).toBe(true);
  });

  // ─── ML Store state after mode switch ───

  test('after mode switch to visual, outputs are still valid for inference', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      // Switch to visual
      await store.setOutputMode('visual');

      // Set inputs and verify inference works
      probe.setInputs(0.3, 0.7);
      const outputs = probe.getOutputs();
      return {
        length: outputs.length,
        allBounded: outputs.every((v: number) => v >= 0 && v <= 1),
        allFinite: outputs.every((v: number) => Number.isFinite(v)),
      };
    });

    expect(result.length).toBe(20);
    expect(result.allBounded).toBe(true);
    expect(result.allFinite).toBe(true);
  });

  test('dual IML instances exist for joystick and hand tracking', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      const imlJoy = store.getImlJoy();
      const imlHand = store.getImlHand();
      return {
        hasJoyIml: imlJoy !== null,
        hasHandIml: imlHand !== null,
        joyInputs: imlJoy?.nInputs,
        handInputs: imlHand?.nInputs,
        joyOutputs: imlJoy?.nOutputs,
        handOutputs: imlHand?.nOutputs,
      };
    });

    expect(result.hasJoyIml).toBe(true);
    expect(result.hasHandIml).toBe(true);
    expect(result.joyInputs).toBe(2);
    expect(result.handInputs).toBe(14);
    expect(result.joyOutputs).toBe(126);
    expect(result.handOutputs).toBe(126);
  });

  test('loss remains null and exampleCount remains 0 after mode switch', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      // Switch modes
      await store.setOutputMode('visual');

      return {
        exampleCount: probe.getExampleCount(),
        loss: probe.getLoss(),
      };
    });

    expect(result.exampleCount).toBe(0);
    expect(result.loss).toBeNull();
  });
});
