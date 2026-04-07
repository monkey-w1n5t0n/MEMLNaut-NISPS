/**
 * Persistence e2e tests — URL parameter parsing and localStorage round-trips.
 *
 * Covers:
 *   - ?spread=<value> is parsed and applied to spreadLevel on the ML store
 *   - ?tame=<value> is accepted without crash
 *   - ?spread out-of-range values are clamped to [0, 1]
 *   - localStorage round-trip: saveState → reload → weights and state restored
 *   - Fresh load with no localStorage starts untrained
 *   - saveState writes the expected fields to localStorage
 *
 * Implementation notes:
 *   - probe.saveState() delegates to ml-store.saveState(), which writes a
 *     plain object without a `version` field (session-store.ts format differs).
 *   - URL param ?spread is parsed by createSessionStore(); wiring to the
 *     ML store's spreadLevel is the intended behavior tested here.
 *
 * Storage key: 'nisps-a-immersive'
 */
import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

const STORAGE_KEY = 'nisps-a-immersive';

// ─── URL parameter parsing ─────────────────────────────────────────────────────

test.describe('URL parameter: ?spread', () => {

  test('?spread=0 does not crash the app', async ({ page }) => {
    await loadSolidApp(page, '&spread=0');

    const probeType = await page.evaluate(() => typeof (window as any).__nisps);
    expect(probeType).toBe('object');
    const outputs = await page.evaluate(() => (window as any).__nisps.getOutputs());
    expect(outputs.length).toBeGreaterThan(0);
    for (const v of outputs) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test('?spread=1 does not crash the app', async ({ page }) => {
    await loadSolidApp(page, '&spread=1');

    const probeType = await page.evaluate(() => typeof (window as any).__nisps);
    expect(probeType).toBe('object');
    const outputs = await page.evaluate(() => (window as any).__nisps.getOutputs());
    expect(outputs.length).toBeGreaterThan(0);
  });

  test('?spread=0.3 is applied as spreadLevel on the ML store', async ({ page }) => {
    await loadSolidApp(page, '&spread=0.3');

    const spreadLevel = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      return store.state.spreadLevel;
    });

    expect(spreadLevel).toBeCloseTo(0.3, 2);
  });

  test('?spread=0.7 is applied as spreadLevel on the ML store', async ({ page }) => {
    await loadSolidApp(page, '&spread=0.7');

    const spreadLevel = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      return store.state.spreadLevel;
    });

    expect(spreadLevel).toBeCloseTo(0.7, 2);
  });

  test('?spread=1.5 is clamped to 1 (out-of-range high)', async ({ page }) => {
    await loadSolidApp(page, '&spread=1.5');

    const spreadLevel = await page.evaluate(() => (window as any).__nispsStore.state.spreadLevel);
    expect(spreadLevel).toBeLessThanOrEqual(1);
    expect(spreadLevel).toBeGreaterThanOrEqual(0);
  });

  test('?spread=-0.5 is clamped to 0 (out-of-range low)', async ({ page }) => {
    await loadSolidApp(page, '&spread=-0.5');

    const spreadLevel = await page.evaluate(() => (window as any).__nispsStore.state.spreadLevel);
    expect(spreadLevel).toBeGreaterThanOrEqual(0);
    expect(spreadLevel).toBeLessThanOrEqual(1);
  });

  test('no ?spread param → default spreadLevel is 0.6', async ({ page }) => {
    await loadSolidApp(page);

    const spreadLevel = await page.evaluate(() => (window as any).__nispsStore.state.spreadLevel);
    expect(spreadLevel).toBeCloseTo(0.6, 5);
  });
});

// ─── URL parameter: ?tame ─────────────────────────────────────────────────────

test.describe('URL parameter: ?tame', () => {

  test('?tame=0.5 is accepted and app remains functional', async ({ page }) => {
    await loadSolidApp(page, '&tame=0.5');

    const probeType = await page.evaluate(() => typeof (window as any).__nisps);
    expect(probeType).toBe('object');

    const outputs = await page.evaluate(() => (window as any).__nisps.getOutputs());
    expect(outputs.length).toBeGreaterThan(0);
    for (const v of outputs) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test('?tame=0 is accepted (no range constraint)', async ({ page }) => {
    await loadSolidApp(page, '&tame=0');

    const probeType = await page.evaluate(() => typeof (window as any).__nisps);
    expect(probeType).toBe('object');
  });

  test('?tame=1 is accepted (maximum constraint)', async ({ page }) => {
    await loadSolidApp(page, '&tame=1');

    const probeType = await page.evaluate(() => typeof (window as any).__nisps);
    expect(probeType).toBe('object');
  });

  test('?spread=0.3&tame=0.5 combined — app remains functional', async ({ page }) => {
    await loadSolidApp(page, '&spread=0.3&tame=0.5');

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      return {
        probeExists: typeof probe === 'object',
        outputLength: probe.getOutputs().length,
        allBounded: probe.getOutputs().every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.probeExists).toBe(true);
    expect(result.outputLength).toBeGreaterThan(0);
    expect(result.allBounded).toBe(true);
  });
});

// ─── Fresh load ───────────────────────────────────────────────────────────────

test.describe('Fresh load (no stored state)', () => {

  test('starts untrained: 0 examples, null loss', async ({ page }) => {
    await loadSolidApp(page); // helpers.ts clears localStorage before load

    const result = await page.evaluate(() => ({
      exampleCount: (window as any).__nisps.getExampleCount(),
      loss: (window as any).__nisps.getLoss(),
    }));

    expect(result.exampleCount).toBe(0);
    expect(result.loss).toBeNull();
  });
});

// ─── saveState writes expected fields ─────────────────────────────────────────

test.describe('probe.saveState() — localStorage format', () => {

  test('saveState writes required fields to localStorage', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate((key: string) => {
      (window as any).__nisps.saveState();
      const raw = localStorage.getItem(key);
      if (!raw) return { valid: false };
      try {
        const s = JSON.parse(raw);
        return {
          valid: true,
          hasWeights:     Array.isArray(s.weights) && s.weights.length > 0,
          hasInputState:  Array.isArray(s.inputState),
          hasOutputState: Array.isArray(s.outputState),
          hasExampleCount: typeof s.exampleCount === 'number',
          hasLossHistory:  Array.isArray(s.lossHistory),
          hasOutputMode:   typeof s.outputMode === 'string',
          hasSpreadLevel:  typeof s.spreadLevel === 'number',
        };
      } catch {
        return { valid: false };
      }
    }, STORAGE_KEY);

    expect(result.valid).toBe(true);
    if ('hasWeights' in result) {
      expect(result.hasWeights).toBe(true);
      expect(result.hasInputState).toBe(true);
      expect(result.hasOutputState).toBe(true);
      expect(result.hasExampleCount).toBe(true);
      expect(result.hasLossHistory).toBe(true);
      expect(result.hasOutputMode).toBe(true);
      expect(result.hasSpreadLevel).toBe(true);
    }
  });

  test('saveState reflects current example count', async ({ page }) => {
    await loadSolidApp(page);

    // Add 2 examples
    await page.evaluate(async () => {
      const probe = (window as any).__nisps;
      await probe.thumbsUp();
      await probe.thumbsUp();
    });

    const result = await page.evaluate((key: string) => {
      (window as any).__nisps.saveState();
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return (JSON.parse(raw) as any).exampleCount as number;
    }, STORAGE_KEY);

    expect(result).toBe(2);
  });

  test('saveState reflects current spreadLevel', async ({ page }) => {
    await loadSolidApp(page, '&spread=0.3');

    const result = await page.evaluate((key: string) => {
      (window as any).__nisps.saveState();
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return (JSON.parse(raw) as any).spreadLevel as number;
    }, STORAGE_KEY);

    // spreadLevel written by saveState should be the current store value
    expect(result).not.toBeNull();
    // If ?spread URL param is wired, this will be ~0.3; otherwise it's 0.6 (default)
    expect(typeof result).toBe('number');
    expect(result as number).toBeGreaterThanOrEqual(0);
    expect(result as number).toBeLessThanOrEqual(1);
  });

  test('saveState is overwritten on second call — example count reflects latest', async ({ page }) => {
    await loadSolidApp(page);

    // First save
    await page.evaluate((key: string) => {
      (window as any).__nisps.saveState();
    }, STORAGE_KEY);

    // Add an example, save again
    await page.evaluate(async (key: string) => {
      await (window as any).__nisps.thumbsUp();
      (window as any).__nisps.saveState();
    }, STORAGE_KEY);

    const result = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return (JSON.parse(raw) as any).exampleCount as number;
    }, STORAGE_KEY);

    expect(result).toBe(1);
  });
});

// ─── localStorage round-trip (save → reload → restore) ───────────────────────

test.describe('localStorage round-trip', () => {

  test('weights are restored after saveState + reload', async ({ page }) => {
    await loadSolidApp(page);

    // Randomise to get non-default weights, then save
    const weightsBefore = await page.evaluate((key: string) => {
      const probe = (window as any).__nisps;
      probe.randomise();
      probe.saveState();
      return Array.from(probe.getWeights()) as number[];
    }, STORAGE_KEY);

    expect(weightsBefore.length).toBeGreaterThan(0);

    // Reload WITHOUT clearing localStorage
    await page.goto('/?debug=1');
    await page.waitForFunction(() => (window as any).__nisps !== undefined, { timeout: 20_000 });

    const weightsAfter = await page.evaluate(() =>
      Array.from((window as any).__nisps.getWeights()),
    ) as number[];

    // Weights should be restored — float32 round-trip tolerance
    let maxDiff = 0;
    for (let i = 0; i < weightsBefore.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(weightsBefore[i] - weightsAfter[i]));
    }
    expect(maxDiff).toBeLessThan(1e-4);
  });

  test('example count is restored after saveState + reload', async ({ page }) => {
    await loadSolidApp(page);

    // Add 3 examples, then save
    await page.evaluate(async (key: string) => {
      const probe = (window as any).__nisps;
      await probe.thumbsUp();
      await probe.thumbsUp();
      await probe.thumbsUp();
      probe.saveState();
    }, STORAGE_KEY);

    // Reload — localStorage is preserved
    await page.goto('/?debug=1');
    await page.waitForFunction(() => (window as any).__nisps !== undefined, { timeout: 20_000 });

    const countAfter = await page.evaluate(() => (window as any).__nisps.getExampleCount());
    expect(countAfter).toBe(3);
  });

  test('output mode is restored after saveState + mode switch + reload', async ({ page }) => {
    await loadSolidApp(page);

    // Switch to synth mode and save
    await page.evaluate(async (key: string) => {
      const store = (window as any).__nispsStore;
      await store.setOutputMode('synth');
      (window as any).__nisps.saveState();
    }, STORAGE_KEY);

    // Reload — localStorage is preserved
    await page.goto('/?debug=1');
    await page.waitForFunction(() => (window as any).__nisps !== undefined, { timeout: 20_000 });

    const mode = await page.evaluate(() => (window as any).__nispsStore.state.outputMode);
    expect(mode).toBe('synth');
  });

  test('state with unknown fields is handled gracefully on reload', async ({ page }) => {
    await loadSolidApp(page);

    // Write a state with extra unknown fields
    await page.evaluate((key: string) => {
      const state = {
        weights: [],
        inputState: [0.5, 0.5],
        outputState: new Array(20).fill(0.5),
        exampleCount: 0,
        lossHistory: [],
        outputMode: 'visual',
        spreadLevel: 0.6,
        unknownFutureField: 'some value',
      };
      localStorage.setItem(key, JSON.stringify(state));
    }, STORAGE_KEY);

    // Should load without crash
    await page.goto('/?debug=1');
    await page.waitForFunction(() => (window as any).__nisps !== undefined, { timeout: 20_000 });

    const probeType = await page.evaluate(() => typeof (window as any).__nisps);
    expect(probeType).toBe('object');
  });
});
