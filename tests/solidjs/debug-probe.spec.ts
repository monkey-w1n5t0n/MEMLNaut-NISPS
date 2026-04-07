/**
 * e2e tests for f03-debug-probe-scaffold.
 * Validates:
 *   VAL-PROJ-005: Debug probe exposed with ?debug=1
 *   VAL-PROJ-006: Debug probe NOT exposed without ?debug=1
 */
import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

const EXPECTED_METHODS = [
  'getOutputs',
  'getLoss',
  'getWeights',
  'getExampleCount',
  'setInputs',
  'thumbsUp',
  'thumbsDown',
  'train',
  'trainAsync',
  'randomise',
  'clearExamples',
  'saveState',
  'evalLoss',
  'inferBatch',
  'getLayerStats',
] as const;

test.describe('Debug Probe (f03)', () => {

  // ─── VAL-PROJ-005: window.__nisps exposed with ?debug=1 ───

  test('VAL-PROJ-005a: typeof window.__nisps === "object" with ?debug=1', async ({ page }) => {
    await loadSolidApp(page);

    const probeType = await page.evaluate(() => typeof (window as any).__nisps);
    expect(probeType).toBe('object');
  });

  test('VAL-PROJ-005b: window.__nisps has all required methods', async ({ page }) => {
    await loadSolidApp(page);

    const methodNames = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      return Object.keys(probe).filter(k => typeof probe[k] === 'function');
    });

    for (const method of EXPECTED_METHODS) {
      expect(methodNames).toContain(method);
    }

    // Verify we have at least the expected number of methods
    expect(methodNames.length).toBeGreaterThanOrEqual(EXPECTED_METHODS.length);
  });

  test('VAL-PROJ-005c: enumerate all methods are callable', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const checks: Record<string, boolean> = {};
      const expectedMethods = [
        'getOutputs', 'getLoss', 'getWeights', 'getExampleCount',
        'setInputs', 'thumbsUp', 'thumbsDown', 'train', 'trainAsync',
        'randomise', 'clearExamples', 'saveState', 'evalLoss',
        'inferBatch', 'getLayerStats',
      ];
      for (const name of expectedMethods) {
        checks[name] = typeof probe[name] === 'function';
      }
      return checks;
    });

    for (const [method, isFunction] of Object.entries(result)) {
      expect(isFunction, `Method "${method}" should be a function`).toBe(true);
    }
  });

  // ─── VAL-PROJ-006: window.__nisps is undefined without ?debug=1 ───

  test('VAL-PROJ-006: window.__nisps is undefined without ?debug=1', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('nisps-a-immersive');
      localStorage.setItem('nisps-help-seen', '1');
    });
    // Load WITHOUT ?debug=1
    await page.goto('/');
    await page.waitForFunction(() => {
      const root = document.getElementById('root');
      return root && root.textContent && root.textContent.includes('MEMLNaut');
    }, { timeout: 10_000 });

    const probeType = await page.evaluate(() => typeof (window as any).__nisps);
    expect(probeType).toBe('undefined');
  });

  // ─── Probe method smoke tests ───

  test('probe.getOutputs returns array of 126 bounded values', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const outputs = (window as any).__nisps.getOutputs();
      return {
        isArray: Array.isArray(outputs),
        length: outputs.length,
        allBounded: outputs.every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.isArray).toBe(true);
    expect(result.length).toBe(126);
    expect(result.allBounded).toBe(true);
  });

  test('probe.getLoss returns null on fresh load', async ({ page }) => {
    await loadSolidApp(page);

    const loss = await page.evaluate(() => (window as any).__nisps.getLoss());
    expect(loss).toBeNull();
  });

  test('probe.getExampleCount returns 0 on fresh load', async ({ page }) => {
    await loadSolidApp(page);

    const count = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(count).toBe(0);
  });

  test('probe.setInputs updates outputs synchronously', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const before = [...probe.getOutputs()];
      probe.setInputs(0.1, 0.9);
      const after = [...probe.getOutputs()];
      return { changed: !before.every((v: number, i: number) => v === after[i]), bounded: after.every((v: number) => v >= 0 && v <= 1) };
    });

    expect(result.changed).toBe(true);
    expect(result.bounded).toBe(true);
  });

  test('probe.randomise changes all outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const before = [...probe.getOutputs()];
      probe.randomise();
      const after = [...probe.getOutputs()];
      return {
        changed: !before.every((v: number, i: number) => v === after[i]),
        bounded: after.every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.changed).toBe(true);
    expect(result.bounded).toBe(true);
  });

  test('probe.thumbsDown changes outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      probe.setInputs(0.5, 0.5);
      const before = [...probe.getOutputs()];
      probe.thumbsDown();
      const after = [...probe.getOutputs()];
      return { changed: !before.every((v: number, i: number) => v === after[i]) };
    });

    expect(result.changed).toBe(true);
  });

  test('probe.train returns null with no examples', async ({ page }) => {
    await loadSolidApp(page);

    const loss = await page.evaluate(() => (window as any).__nisps.train());
    expect(loss).toBeNull();
  });

  test('probe.evalLoss returns null with no examples', async ({ page }) => {
    await loadSolidApp(page);

    const loss = await page.evaluate(() => (window as any).__nisps.evalLoss());
    expect(loss).toBeNull();
  });

  test('probe.inferBatch returns correct shape', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const batch = probe.inferBatch([[0.5, 0.5], [0.25, 0.75], [0.1, 0.9]]);
      return {
        length: batch.length,
        eachLength: batch.map((r: number[]) => r.length),
        allBounded: batch.flat().every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.length).toBe(3);
    expect(result.eachLength).toEqual([126, 126, 126]);
    expect(result.allBounded).toBe(true);
  });

  test('probe.getLayerStats returns valid stats', async ({ page }) => {
    await loadSolidApp(page);

    const stats = await page.evaluate(() => (window as any).__nisps.getLayerStats());

    // Architecture is [3, 32, 48, 64, 126] → 4 layers
    expect(stats.length).toBe(4);
    for (const layer of stats) {
      expect(typeof layer.meanAbs).toBe('number');
      expect(typeof layer.maxAbs).toBe('number');
      expect(typeof layer.deadFrac).toBe('number');
      expect(typeof layer.satFrac).toBe('number');
      expect(layer.deadFrac).toBeGreaterThanOrEqual(0);
      expect(layer.deadFrac).toBeLessThanOrEqual(1);
      expect(layer.satFrac).toBeGreaterThanOrEqual(0);
      expect(layer.satFrac).toBeLessThanOrEqual(1);
    }
  });

  test('probe.saveState writes valid JSON to localStorage', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      probe.saveState();
      const raw = localStorage.getItem('nisps-a-immersive');
      if (!raw) return { valid: false, reason: 'no data' };
      try {
        const parsed = JSON.parse(raw);
        return {
          valid: true,
          hasWeights: Array.isArray(parsed.weights),
          hasInputState: Array.isArray(parsed.inputState),
          hasOutputState: Array.isArray(parsed.outputState),
          hasExampleCount: typeof parsed.exampleCount === 'number',
        };
      } catch (e) {
        return { valid: false, reason: String(e) };
      }
    });

    expect(result.valid).toBe(true);
    if ('hasWeights' in result) {
      expect(result.hasWeights).toBe(true);
      expect(result.hasInputState).toBe(true);
      expect(result.hasOutputState).toBe(true);
      expect(result.hasExampleCount).toBe(true);
    }
  });

  test('probe.clearExamples resets example count', async ({ page }) => {
    await loadSolidApp(page);

    const count = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      // Even though we haven't added examples, clearExamples should work
      probe.clearExamples();
      return probe.getExampleCount();
    });

    expect(count).toBe(0);
  });

  test('probe.getWeights returns array', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const weights = (window as any).__nisps.getWeights();
      return {
        isArray: Array.isArray(weights),
        length: weights.length,
        allNumbers: weights.every((v: number) => typeof v === 'number' && Number.isFinite(v)),
      };
    });

    expect(result.isArray).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result.allNumbers).toBe(true);
  });
});
