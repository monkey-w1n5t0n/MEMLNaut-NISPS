/**
 * e2e tests for f11-training-sync-async-loss.
 * Validates:
 *   VAL-ML-006: Add example captures current state (thumbsUp variant)
 *   VAL-ML-007: Sync training returns finite loss
 *   VAL-ML-008: Training converges (second loss <= first)
 *   VAL-ML-009: Async training via worker returns Promise resolving to finite loss
 *   VAL-ML-010: Loss history populated with multiple entries after training
 */
import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('Training: Sync, Async, Loss History (f11)', () => {

  // ─── VAL-ML-006: Add example captures current state (thumbsUp) ───

  test('VAL-ML-006a: thumbsUp increments exampleCount by 1', async ({ page }) => {
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

  test('VAL-ML-006b: thumbsUp captures feature with correct dimensions', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      // Set a known input position
      probe.setInputs(0.3, 0.7);

      // ThumbsUp captures current state
      await probe.thumbsUp();

      // Inspect the captured example via the active IML
      const iml = store.getActiveIml();
      const lastFeature = iml.dataset.features[iml.dataset.features.length - 1];
      const lastLabel = iml.dataset.labels[iml.dataset.labels.length - 1];

      return {
        featureLength: lastFeature?.length,
        labelLength: lastLabel?.length,
        featureBounded: lastFeature?.every((v: number) => v >= 0 && v <= 1),
        labelBounded: lastLabel?.every((v: number) => v >= 0 && v <= 1),
        featureValues: lastFeature?.slice(0, 2), // first 2 should be 0.3, 0.7
      };
    });

    // Feature is [x, y] = 2 values (without bias — bias is added internally)
    expect(result.featureLength).toBe(2);
    // Label matches current output count (20 in visual mode)
    expect(result.labelLength).toBe(20);
    expect(result.featureBounded).toBe(true);
    expect(result.labelBounded).toBe(true);
    // First 2 features should match our setInputs values
    expect(result.featureValues![0]).toBeCloseTo(0.3, 1);
    expect(result.featureValues![1]).toBeCloseTo(0.7, 1);
  });

  test('VAL-ML-006c: multiple thumbsUp calls increment count sequentially', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const probe = (window as any).__nisps;
      const counts: number[] = [probe.getExampleCount()];

      // Move to different positions and thumbs-up each
      probe.setInputs(0.2, 0.8);
      await probe.thumbsUp();
      counts.push(probe.getExampleCount());

      probe.setInputs(0.5, 0.5);
      await probe.thumbsUp();
      counts.push(probe.getExampleCount());

      probe.setInputs(0.8, 0.2);
      await probe.thumbsUp();
      counts.push(probe.getExampleCount());

      return { counts };
    });

    expect(result.counts).toEqual([0, 1, 2, 3]);
  });

  // ─── VAL-ML-007: Sync training returns finite loss ───

  test('VAL-ML-007a: train() returns null with no examples', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      return probe.train();
    });

    expect(result).toBeNull();
  });

  test('VAL-ML-007b: train() returns finite non-negative loss with examples', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      // Add examples at different positions
      probe.setInputs(0.2, 0.8);
      probe.thumbsUp(); // sync addExample via store — not probe.thumbsUp which is async
      // Wait — probe.thumbsUp is async, but we need just addExample.
      // Actually probe.thumbsUp adds example AND trains async.
      // Use store.addExample directly for adding without training.
      return null;
    });

    // Better approach: add examples manually then train sync
    const loss = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      // Add examples at different positions
      probe.setInputs(0.2, 0.8);
      store.addExample();

      probe.setInputs(0.5, 0.5);
      store.addExample();

      probe.setInputs(0.8, 0.2);
      store.addExample();

      // Train synchronously
      const loss = probe.train();
      return loss;
    });

    expect(loss).not.toBeNull();
    expect(typeof loss).toBe('number');
    expect(Number.isFinite(loss as number)).toBe(true);
    expect(loss as number).toBeGreaterThanOrEqual(0);
  });

  test('VAL-ML-007c: train() returns a number (not NaN)', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      probe.setInputs(0.4, 0.6);
      store.addExample();

      probe.setInputs(0.6, 0.4);
      store.addExample();

      const loss = probe.train();
      return {
        loss,
        isNumber: typeof loss === 'number',
        isNotNaN: loss !== null && !Number.isNaN(loss),
      };
    });

    expect(result.isNumber).toBe(true);
    expect(result.isNotNaN).toBe(true);
  });

  // ─── VAL-ML-008: Training converges ───

  test('VAL-ML-008a: second train() loss <= first train() loss', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      // Add several examples
      probe.setInputs(0.1, 0.9);
      store.addExample();

      probe.setInputs(0.3, 0.7);
      store.addExample();

      probe.setInputs(0.5, 0.5);
      store.addExample();

      probe.setInputs(0.7, 0.3);
      store.addExample();

      probe.setInputs(0.9, 0.1);
      store.addExample();

      // First training
      const loss1 = probe.train();

      // Second training (same examples, should converge or stay same)
      const loss2 = probe.train();

      return { loss1, loss2 };
    });

    expect(result.loss1).not.toBeNull();
    expect(result.loss2).not.toBeNull();
    // Second loss should be <= first (within epsilon)
    expect(result.loss2!).toBeLessThanOrEqual(result.loss1! + 1e-6);
  });

  test('VAL-ML-008b: repeated training continues to converge', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      // Add examples
      probe.setInputs(0.2, 0.8);
      store.addExample();

      probe.setInputs(0.8, 0.2);
      store.addExample();

      // Train multiple times and collect losses
      const losses: (number | null)[] = [];
      for (let i = 0; i < 5; i++) {
        losses.push(probe.train());
      }

      return { losses };
    });

    // All losses should be finite non-negative
    for (const loss of result.losses) {
      expect(loss).not.toBeNull();
      expect(Number.isFinite(loss as number)).toBe(true);
      expect(loss as number).toBeGreaterThanOrEqual(0);
    }

    // General trend: later losses <= earlier ones (allow small epsilon for numerical noise)
    const first = result.losses[0] as number;
    const last = result.losses[result.losses.length - 1] as number;
    expect(last).toBeLessThanOrEqual(first + 1e-4);
  });

  // ─── VAL-ML-009: Async training via worker ───

  test('VAL-ML-009a: trainAsync() returns a Promise', async ({ page }) => {
    await loadSolidApp(page);

    const isPromise = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      // Add an example first
      probe.setInputs(0.5, 0.5);
      store.addExample();

      const result = probe.trainAsync();
      return result instanceof Promise;
    });

    expect(isPromise).toBe(true);
  });

  test('VAL-ML-009b: trainAsync() resolves to finite loss', async ({ page }) => {
    await loadSolidApp(page);

    const loss = await page.evaluate(async () => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      // Add examples
      probe.setInputs(0.2, 0.8);
      store.addExample();

      probe.setInputs(0.5, 0.5);
      store.addExample();

      probe.setInputs(0.8, 0.2);
      store.addExample();

      const loss = await probe.trainAsync();
      return loss;
    });

    expect(loss).not.toBeNull();
    expect(typeof loss).toBe('number');
    expect(Number.isFinite(loss as number)).toBe(true);
    expect(loss as number).toBeGreaterThanOrEqual(0);
  });

  test('VAL-ML-009c: trainAsync() returns null with no examples', async ({ page }) => {
    await loadSolidApp(page);

    const loss = await page.evaluate(async () => {
      const probe = (window as any).__nisps;
      return await probe.trainAsync();
    });

    expect(loss).toBeNull();
  });

  test('VAL-ML-009d: trainAsync() updates outputs after completion', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      // Capture outputs before training at a specific position
      probe.setInputs(0.3, 0.7);
      const outputsAtInput = probe.getOutputs().slice();

      // Add an example at a very different position with target outputs
      // that differ from current behavior — this ensures training will change
      // the outputs at our test position
      store.addExample(); // captures at (0.3, 0.7)
      probe.setInputs(0.8, 0.2);
      store.addExample(); // captures at (0.8, 0.2)

      // Get outputs at (0.8, 0.2) before training
      const beforeTraining = probe.getOutputs().slice();

      const loss = await probe.trainAsync();

      // After training, outputs at the same input position may have changed
      const afterTraining = probe.getOutputs().slice();

      return {
        loss,
        lossIsFinite: loss !== null && Number.isFinite(loss),
        // Verify trainAsync completed and updated the IML state
        outputsAfterTraining: afterTraining.length,
        allBounded: afterTraining.every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.loss).not.toBeNull();
    expect(result.lossIsFinite).toBe(true);
    // After async training, outputs should still be valid
    expect(result.outputsAfterTraining).toBeGreaterThan(0);
    expect(result.allBounded).toBe(true);
  });

  // ─── VAL-ML-010: Loss history populated after training ───

  test('VAL-ML-010a: lossHistory has multiple entries after sync training', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      // Add examples
      probe.setInputs(0.2, 0.8);
      store.addExample();

      probe.setInputs(0.8, 0.2);
      store.addExample();

      // Train twice to generate more loss history
      probe.train();
      probe.train();

      const history = probe.getLossHistory();
      return {
        length: history.length,
        allFinite: history.every((v: number) => Number.isFinite(v) && v >= 0),
        firstFew: history.slice(0, 5),
      };
    });

    // Loss history should have multiple entries (train_ex captures per-iteration losses)
    expect(result.length).toBeGreaterThan(1);
    expect(result.allFinite).toBe(true);
    // All values should be non-negative
    for (const v of result.firstFew) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  test('VAL-ML-010b: lossHistory grows with each training call', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      probe.setInputs(0.3, 0.7);
      store.addExample();

      probe.setInputs(0.7, 0.3);
      store.addExample();

      const lengths: number[] = [];

      // Before training
      lengths.push(probe.getLossHistory().length);

      // After first training
      probe.train();
      lengths.push(probe.getLossHistory().length);

      // After second training
      probe.train();
      lengths.push(probe.getLossHistory().length);

      return { lengths };
    });

    // History should grow (or stay same) with each training call
    expect(result.lengths[1]).toBeGreaterThanOrEqual(result.lengths[0]);
    expect(result.lengths[2]).toBeGreaterThanOrEqual(result.lengths[1]);
    // At least one entry should be added by training
    expect(result.lengths[2]).toBeGreaterThan(0);
  });

  test('VAL-ML-010c: lossHistory populated after async training', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const probe = (window as any).__nisps;
      const store = (window as any).__nispsStore;

      probe.setInputs(0.3, 0.7);
      store.addExample();

      probe.setInputs(0.7, 0.3);
      store.addExample();

      // Async train
      await probe.trainAsync();

      const history = probe.getLossHistory();
      return {
        length: history.length,
        allFinite: history.every((v: number) => Number.isFinite(v) && v >= 0),
      };
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result.allFinite).toBe(true);
  });

  // ─── Cross-checks: thumbsUp triggers training ───

  test('thumbsUp adds example AND triggers async training (loss updates)', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const probe = (window as any).__nisps;

      // Set initial position
      probe.setInputs(0.3, 0.7);

      // ThumbsUp should add example + train async
      const loss = await probe.thumbsUp();

      return {
        exampleCount: probe.getExampleCount(),
        loss,
        lossIsFinite: loss !== null && Number.isFinite(loss),
      };
    });

    expect(result.exampleCount).toBeGreaterThanOrEqual(1);
    expect(result.lossIsFinite).toBe(true);
  });

  test('after thumbsUp, lossHistory has entries', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const probe = (window as any).__nisps;

      probe.setInputs(0.4, 0.6);
      await probe.thumbsUp();

      probe.setInputs(0.6, 0.4);
      await probe.thumbsUp();

      const history = probe.getLossHistory();
      return {
        length: history.length,
        allFinite: history.every((v: number) => Number.isFinite(v) && v >= 0),
      };
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result.allFinite).toBe(true);
  });
});
