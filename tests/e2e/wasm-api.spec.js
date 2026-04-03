/**
 * WASM API tests — verify new WasmIML methods:
 *  - inferBatch: batch inference across multiple input points
 *  - evalLoss: MSE loss evaluation without training
 *  - getLayerStats: per-layer weight statistics
 *  - lossHistory: full per-iteration loss curve after training
 *  - moveWeights with pin mask: pinned outputs stay unchanged
 */
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

const EXAMPLE_LOW  = { input: [0.1, 0.9], output: new Array(126).fill(0.1) };
const EXAMPLE_HIGH = { input: [0.9, 0.1], output: new Array(126).fill(0.9) };

test.describe('inferBatch', () => {
  test('returns correct count of output arrays, each length 126', async ({ page }) => {
    await loadApp(page);
    const result = await page.evaluate(() => {
      const outputs = window.__nisps.iml.inferBatch([[0.2, 0.8], [0.5, 0.5], [0.9, 0.1]]);
      return outputs.map(o => Array.from(o));
    });
    expect(result).toHaveLength(3);
    for (const arr of result) {
      expect(arr).toHaveLength(126);
    }
  });

  test('matches individual inference within 1e-5', async ({ page }) => {
    await loadApp(page);
    const points = [[0.1, 0.2], [0.3, 0.7], [0.5, 0.5], [0.8, 0.1], [0.0, 1.0]];
    const { batchResults, individualResults } = await page.evaluate((pts) => {
      const iml = window.__nisps.iml;
      const batch = iml.inferBatch(pts).map(o => Array.from(o));
      const individual = pts.map(([x, y]) => {
        iml.setInput(0, x);
        iml.setInput(1, y);
        iml.process();
        return Array.from(iml.getOutputs());
      });
      return { batchResults: batch, individualResults: individual };
    }, points);

    expect(batchResults).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 126; j++) {
        expect(Math.abs(batchResults[i][j] - individualResults[i][j])).toBeLessThan(1e-5);
      }
    }
  });

  test('all batch outputs are in [0, 1]', async ({ page }) => {
    await loadApp(page);
    const corners = [
      [0, 0], [0, 1], [1, 0], [1, 1],
      [0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5],
      [0.25, 0.75], [0.75, 0.25],
    ];
    const results = await page.evaluate((pts) => {
      return window.__nisps.iml.inferBatch(pts).map(o => Array.from(o));
    }, corners);

    expect(results).toHaveLength(10);
    for (const arr of results) {
      for (const v of arr) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

test.describe('evalLoss', () => {
  test('returns null when no examples exist', async ({ page }) => {
    await loadApp(page);
    const loss = await page.evaluate(() => window.__nisps.iml.evalLoss());
    expect(loss).toBeNull();
  });

  test('returns finite non-negative value when examples exist', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(([low, high]) => {
      window.__nisps.iml.addExample(low.input, low.output);
      window.__nisps.iml.addExample(high.input, high.output);
    }, [EXAMPLE_LOW, EXAMPLE_HIGH]);

    const loss = await page.evaluate(() => window.__nisps.iml.evalLoss());
    expect(typeof loss).toBe('number');
    expect(isFinite(loss)).toBe(true);
    expect(loss).toBeGreaterThanOrEqual(0);
  });

  test('does not change weights', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(([low, high]) => {
      window.__nisps.iml.addExample(low.input, low.output);
      window.__nisps.iml.addExample(high.input, high.output);
    }, [EXAMPLE_LOW, EXAMPLE_HIGH]);

    const { before, after } = await page.evaluate(() => {
      const weightsBefore = window.__nisps.getWeights();
      window.__nisps.iml.evalLoss();
      const weightsAfter = window.__nisps.getWeights();
      return { before: Array.from(weightsBefore), after: Array.from(weightsAfter) };
    });

    expect(before).toEqual(after);
  });
});

test.describe('getLayerStats', () => {
  test('returns 4 layers for [3, 32, 48, 64, 126] architecture', async ({ page }) => {
    await loadApp(page);
    const stats = await page.evaluate(() => window.__nisps.iml.getLayerStats());
    expect(stats).toHaveLength(4);
  });

  test('each layer has all 4 stat fields with valid ranges', async ({ page }) => {
    await loadApp(page);
    const stats = await page.evaluate(() => window.__nisps.iml.getLayerStats());
    for (const layer of stats) {
      expect(typeof layer.meanAbs).toBe('number');
      expect(typeof layer.maxAbs).toBe('number');
      expect(typeof layer.deadFrac).toBe('number');
      expect(typeof layer.satFrac).toBe('number');

      expect(layer.meanAbs).toBeGreaterThanOrEqual(0);
      expect(layer.maxAbs).toBeGreaterThanOrEqual(0);
      expect(layer.deadFrac).toBeGreaterThanOrEqual(0);
      expect(layer.deadFrac).toBeLessThanOrEqual(1);
      expect(layer.satFrac).toBeGreaterThanOrEqual(0);
      expect(layer.satFrac).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('lossHistory', () => {
  test('training populates lossHistory with multiple entries', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(([low, high]) => {
      window.__nisps.iml.addExample(low.input, low.output);
      window.__nisps.iml.addExample(high.input, high.output);
    }, [EXAMPLE_LOW, EXAMPLE_HIGH]);

    const histLen = await page.evaluate(() => {
      window.__nisps.train();
      return window.__nisps.iml.lossHistory.length;
    });
    expect(histLen).toBeGreaterThan(1);
  });

  test('all loss history entries are finite non-negative', async ({ page }) => {
    await loadApp(page);
    await page.evaluate(([low, high]) => {
      window.__nisps.iml.addExample(low.input, low.output);
      window.__nisps.iml.addExample(high.input, high.output);
    }, [EXAMPLE_LOW, EXAMPLE_HIGH]);

    const history = await page.evaluate(() => {
      window.__nisps.train();
      return [...window.__nisps.iml.lossHistory];
    });

    expect(history.length).toBeGreaterThan(0);
    for (const v of history) {
      expect(typeof v).toBe('number');
      expect(isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe('moveWeights with pin mask', () => {
  test('pinned output-layer weights unchanged, unpinned weights changed', async ({ page }) => {
    await loadApp(page);
    // The pin mask protects output-layer weights for pinned nodes.
    // Hidden layer weights still change (shared), so we compare flat weight
    // vectors and check that the output-layer segment for pinned nodes is
    // identical while unpinned weights differ.
    const { pinnedWeightsMatch, anyUnpinnedWeightChanged } = await page.evaluate(() => {
      const iml = window.__nisps.iml;
      const weightsBefore = Array.from(window.__nisps.getWeights());

      // Pin first 10 outputs
      const pinMask = new Uint8Array(126);
      for (let i = 0; i < 10; i++) pinMask[i] = 1;

      // Apply noise (spread=0 means no decay, just additive noise)
      iml.moveWeights(0.3, 0, pinMask);

      const weightsAfter = Array.from(window.__nisps.getWeights());

      // The architecture is [3, 32, 48, 64, 126].
      // Output layer: 126 nodes, each with 64+1=65 weights (64 inputs + bias).
      // The output layer weights are at the end of the flat array.
      const outputLayerWeights = 126 * 65; // 8190
      const outputLayerStart = weightsBefore.length - outputLayerWeights;
      const weightsPerNode = 65;

      // Check pinned nodes (first 10) have identical weights
      let pinnedAllMatch = true;
      for (let n = 0; n < 10; n++) {
        const nodeStart = outputLayerStart + n * weightsPerNode;
        for (let w = 0; w < weightsPerNode; w++) {
          if (weightsBefore[nodeStart + w] !== weightsAfter[nodeStart + w]) {
            pinnedAllMatch = false;
            break;
          }
        }
        if (!pinnedAllMatch) break;
      }

      // Check unpinned output nodes (10-125) have at least some changed weights
      let unpinnedChanged = false;
      for (let n = 10; n < 126; n++) {
        const nodeStart = outputLayerStart + n * weightsPerNode;
        for (let w = 0; w < weightsPerNode; w++) {
          if (weightsBefore[nodeStart + w] !== weightsAfter[nodeStart + w]) {
            unpinnedChanged = true;
            break;
          }
        }
        if (unpinnedChanged) break;
      }

      return { pinnedWeightsMatch: pinnedAllMatch, anyUnpinnedWeightChanged: unpinnedChanged };
    });

    expect(pinnedWeightsMatch).toBe(true);
    expect(anyUnpinnedWeightChanged).toBe(true);
  });
});
