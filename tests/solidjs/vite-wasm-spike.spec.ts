/**
 * e2e tests for f01-vite-wasm-spike milestone.
 * Validates:
 *   VAL-PROJ-001: Vite dev server starts with COOP/COEP headers
 *   VAL-PROJ-002: SolidJS app renders without errors
 *   VAL-PROJ-003: WASM ML engine loads and inference runs
 */
import { test, expect, Page } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('Vite + WASM spike', () => {

  test('VAL-PROJ-001: COOP/COEP headers are set', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();

    const headers = response!.headers();
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
  });

  test('VAL-PROJ-002: SolidJS app renders without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');

    // Wait for app to render — the status text should appear
    await page.waitForFunction(() => {
      const root = document.getElementById('root');
      return root && root.textContent && root.textContent.includes('MEMLNaut');
    }, { timeout: 10_000 });

    // Filter out 404s for non-critical resources (e.g. favicon)
    const criticalErrors = errors.filter(e =>
      !e.includes('404') && !e.includes('Failed to load resource')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('VAL-PROJ-003: WASM loads and inference returns 20 bounded outputs (visual mode default)', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const outputs = probe.getOutputs();
      return {
        length: outputs.length,
        min: Math.min(...outputs),
        max: Math.max(...outputs),
        allBounded: outputs.every((v: number) => v >= 0 && v <= 1),
        isArray: Array.isArray(outputs),
      };
    });

    expect(result.length).toBe(20); // visual mode is default
    expect(result.min).toBeGreaterThanOrEqual(0);
    expect(result.max).toBeLessThanOrEqual(1);
    expect(result.allBounded).toBe(true);
  });

  test('WASM inference changes with different inputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      // Get outputs at default position
      const outputs1 = [...probe.getOutputs()];

      // Set different inputs and get new outputs
      probe.setInputs(0.75, 0.25);
      const outputs2 = [...probe.getOutputs()];

      return {
        same: outputs1.every((v: number, i: number) => v === outputs2[i]),
        outputs2Length: outputs2.length,
        outputs2Bounded: outputs2.every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.same).toBe(false);
    expect(result.outputs2Length).toBe(20); // visual mode default
    expect(result.outputs2Bounded).toBe(true);
  });

  test('debug probe not exposed without ?debug=1', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => {
      const root = document.getElementById('root');
      return root && root.textContent && root.textContent.includes('MEMLNaut');
    }, { timeout: 10_000 });

    const probeType = await page.evaluate(() => typeof (window as any).__nisps);
    expect(probeType).toBe('undefined');
  });

  test('initial state is untrained', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      return {
        exampleCount: probe.getExampleCount(),
        loss: probe.getLoss(),
      };
    });

    expect(result.exampleCount).toBe(0);
    expect(result.loss).toBeNull();
  });

  test('randomise changes outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const before = [...probe.getOutputs()];
      probe.randomise();
      const after = [...probe.getOutputs()];
      return {
        changed: !before.every((v: number, i: number) => v === after[i]),
        allBounded: after.every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.changed).toBe(true);
    expect(result.allBounded).toBe(true);
  });

  test('setInputs clamps out-of-range values', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      // Set extreme values — should be clamped to [0,1]
      probe.setInputs(-5, 99);
      const outputs = probe.getOutputs();
      return {
        length: outputs.length,
        allBounded: outputs.every((v: number) => v >= 0 && v <= 1),
        allFinite: outputs.every((v: number) => Number.isFinite(v)),
      };
    });

    expect(result.length).toBe(20); // visual mode default
    expect(result.allBounded).toBe(true);
    expect(result.allFinite).toBe(true);
  });
});
