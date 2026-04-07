/**
 * e2e tests for f05-reactive-inference-loop.
 * Validates:
 *   VAL-ML-004: Inference runs when inputs change — different positions produce different outputs
 *   VAL-ML-005: setInputs is synchronous — getOutputs reflects new state immediately
 *
 * Also verifies input clamping behavior (values outside [0,1] are clamped).
 */
import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('Reactive Inference Loop (f05)', () => {

  // ─── VAL-ML-004: Inference runs when inputs change ───

  test('VAL-ML-004a: setInputs(0.25, 0.25) and setInputs(0.75, 0.75) produce different outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      probe.setInputs(0.25, 0.25);
      const outputsA = [...probe.getOutputs()];

      probe.setInputs(0.75, 0.75);
      const outputsB = [...probe.getOutputs()];

      return {
        outputsA: outputsA.slice(0, 5),
        outputsB: outputsB.slice(0, 5),
        same: outputsA.every((v: number, i: number) => v === outputsB[i]),
        allBoundedA: outputsA.every((v: number) => v >= 0 && v <= 1),
        allBoundedB: outputsB.every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.same).toBe(false);
    expect(result.allBoundedA).toBe(true);
    expect(result.allBoundedB).toBe(true);
  });

  test('VAL-ML-004b: multiple distinct positions all produce different outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const positions = [
        [0.1, 0.1],
        [0.3, 0.7],
        [0.5, 0.5],
        [0.7, 0.3],
        [0.9, 0.9],
      ];

      const outputSets: number[][] = [];
      for (const [x, y] of positions) {
        probe.setInputs(x, y);
        outputSets.push([...probe.getOutputs()]);
      }

      // Every pair should differ in at least one output
      let allDifferent = true;
      for (let i = 0; i < outputSets.length && allDifferent; i++) {
        for (let j = i + 1; j < outputSets.length && allDifferent; j++) {
          const same = outputSets[i].every((v, idx) => v === outputSets[j][idx]);
          if (same) allDifferent = false;
        }
      }

      const allBounded = outputSets.every(
        set => set.every((v: number) => v >= 0 && v <= 1)
      );

      return { allDifferent, allBounded, count: outputSets.length, eachLength: outputSets[0].length };
    });

    expect(result.allDifferent).toBe(true);
    expect(result.allBounded).toBe(true);
    expect(result.count).toBe(5);
    expect(result.eachLength).toBe(126);
  });

  test('VAL-ML-004c: changing only X produces different outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      probe.setInputs(0.2, 0.5);
      const outputs1 = [...probe.getOutputs()];

      probe.setInputs(0.8, 0.5);
      const outputs2 = [...probe.getOutputs()];

      return {
        same: outputs1.every((v: number, i: number) => v === outputs2[i]),
      };
    });

    expect(result.same).toBe(false);
  });

  test('VAL-ML-004d: changing only Y produces different outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      probe.setInputs(0.5, 0.2);
      const outputs1 = [...probe.getOutputs()];

      probe.setInputs(0.5, 0.8);
      const outputs2 = [...probe.getOutputs()];

      return {
        same: outputs1.every((v: number, i: number) => v === outputs2[i]),
      };
    });

    expect(result.same).toBe(false);
  });

  // ─── VAL-ML-005: setInputs is synchronous ───

  test('VAL-ML-005a: getOutputs immediately reflects setInputs — no async delay', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      // Call setInputs then immediately read outputs — no await
      probe.setInputs(0.3, 0.7);
      const outputs = probe.getOutputs();

      return {
        length: outputs.length,
        allBounded: outputs.every((v: number) => v >= 0 && v <= 1),
        allFinite: outputs.every((v: number) => Number.isFinite(v)),
        hasNonZero: outputs.some((v: number) => v > 0),
      };
    });

    expect(result.length).toBe(126);
    expect(result.allBounded).toBe(true);
    expect(result.allFinite).toBe(true);
    // With random weights, outputs shouldn't all be zero
    expect(result.hasNonZero).toBe(true);
  });

  test('VAL-ML-005b: sequential setInputs calls produce consistent results', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      // Set to position A
      probe.setInputs(0.4, 0.6);
      const outputsA1 = [...probe.getOutputs()];

      // Set to position B
      probe.setInputs(0.8, 0.2);
      const outputsB = [...probe.getOutputs()];

      // Set back to position A — should produce same results as first time
      probe.setInputs(0.4, 0.6);
      const outputsA2 = [...probe.getOutputs()];

      return {
        a1EqualsA2: outputsA1.every((v: number, i: number) => v === outputsA2[i]),
        aDiffersB: !outputsA1.every((v: number, i: number) => v === outputsB[i]),
      };
    });

    // Same inputs → same outputs (deterministic)
    expect(result.a1EqualsA2).toBe(true);
    // Different inputs → different outputs
    expect(result.aDiffersB).toBe(true);
  });

  test('VAL-ML-005c: repeated setInputs with same values produces same outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      const allOutputs: number[][] = [];
      for (let i = 0; i < 5; i++) {
        probe.setInputs(0.5, 0.5);
        allOutputs.push([...probe.getOutputs()]);
      }

      // All 5 should be identical (deterministic inference)
      const allSame = allOutputs.slice(1).every(
        set => set.every((v, i) => v === allOutputs[0][i])
      );

      return { allSame, count: allOutputs.length };
    });

    expect(result.allSame).toBe(true);
    expect(result.count).toBe(5);
  });

  // ─── Input clamping (values outside [0,1]) ───

  test('setInputs(-5, 99) clamps to [0,1] and produces valid outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      probe.setInputs(-5, 99);
      const outputs = probe.getOutputs();

      // Also verify: setInputs(-5,99) should produce same result as setInputs(0,1)
      // since clamping maps -5→0 and 99→1
      const outputsClamped = [...outputs];

      probe.setInputs(0, 1);
      const outputsExplicit = [...probe.getOutputs()];

      return {
        length: outputsClamped.length,
        allBounded: outputsClamped.every((v: number) => v >= 0 && v <= 1),
        allFinite: outputsClamped.every((v: number) => Number.isFinite(v)),
        matchesClamped: outputsClamped.every((v: number, i: number) => v === outputsExplicit[i]),
      };
    });

    expect(result.length).toBe(126);
    expect(result.allBounded).toBe(true);
    expect(result.allFinite).toBe(true);
    // Clamped values should produce same outputs as explicitly clamped values
    expect(result.matchesClamped).toBe(true);
  });

  test('setInputs with NaN is handled gracefully', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      // First set valid inputs
      probe.setInputs(0.5, 0.5);
      const validOutputs = [...probe.getOutputs()];

      // Try NaN — Math.max(0, Math.min(1, NaN)) = NaN in JS
      // But we should handle it gracefully
      try {
        probe.setInputs(NaN, 0.5);
      } catch (e) {
        // If it throws, that's also acceptable
        return { handled: true, threw: true };
      }

      const outputs = probe.getOutputs();
      return {
        handled: true,
        threw: false,
        allFinite: outputs.every((v: number) => Number.isFinite(v)),
        length: outputs.length,
      };
    });

    expect(result.handled).toBe(true);
    if (!result.threw) {
      // If it didn't throw, outputs should still be valid
      expect(result.allFinite).toBe(true);
    }
  });

  test('setInputs with very small values near 0 boundary', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      probe.setInputs(0.001, 0.001);
      const outputs = probe.getOutputs();

      return {
        allBounded: outputs.every((v: number) => v >= 0 && v <= 1),
        allFinite: outputs.every((v: number) => Number.isFinite(v)),
      };
    });

    expect(result.allBounded).toBe(true);
    expect(result.allFinite).toBe(true);
  });

  test('setInputs with values very close to 1 boundary', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      probe.setInputs(0.999, 0.999);
      const outputs = probe.getOutputs();

      return {
        allBounded: outputs.every((v: number) => v >= 0 && v <= 1),
        allFinite: outputs.every((v: number) => Number.isFinite(v)),
      };
    });

    expect(result.allBounded).toBe(true);
    expect(result.allFinite).toBe(true);
  });

  test('setInputs(0, 0) clamps correctly to corner position', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      probe.setInputs(0, 0);
      const outputs = probe.getOutputs();

      // Verify -1 and -0.001 clamp to same as 0
      probe.setInputs(-1, -0.001);
      const outputsNeg = probe.getOutputs();

      return {
        allBounded: outputs.every((v: number) => v >= 0 && v <= 1),
        matchesCorner: outputs.every((v: number, i: number) => v === outputsNeg[i]),
      };
    });

    expect(result.allBounded).toBe(true);
    expect(result.matchesCorner).toBe(true);
  });

  // ─── Synchronous consistency (three-step verification) ───

  test('three-step verification: setInputs(A) → setInputs(B) → setInputs(A) returns to original', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      // Step 1: Position A
      probe.setInputs(0.25, 0.25);
      const outputsA = [...probe.getOutputs()];

      // Step 2: Position B
      probe.setInputs(0.75, 0.75);
      const outputsB = [...probe.getOutputs()];

      // Step 3: Back to A
      probe.setInputs(0.25, 0.25);
      const outputsA2 = [...probe.getOutputs()];

      return {
        aMatchesA2: outputsA.every((v: number, i: number) => v === outputsA2[i]),
        aDiffersB: !outputsA.every((v: number, i: number) => v === outputsB[i]),
        bBounded: outputsB.every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.aMatchesA2).toBe(true);
    expect(result.aDiffersB).toBe(true);
    expect(result.bBounded).toBe(true);
  });

  // ─── Bus emission verification ───

  test('setInputs emits outputs on bus topic', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const bus = (window as any).__nispsBus;
      const topic = bus.getTopic('ml.outputs');

      // Record initial value (topic is callable — returns signal value)
      const before = topic ? topic() : null;

      // Change inputs
      const probe = (window as any).__nisps;
      probe.setInputs(0.2, 0.8);

      // Read bus value after change
      const after = topic ? topic() : null;

      return {
        hasTopic: topic !== null && topic !== undefined,
        beforeType: before ? before.constructor.name : 'null',
        afterType: after ? after.constructor.name : 'null',
        beforeLength: before ? before.length : 0,
        afterLength: after ? after.length : 0,
        changed: before !== after,
      };
    });

    expect(result.hasTopic).toBe(true);
    expect(result.afterLength).toBe(126);
    expect(result.changed).toBe(true);
  });
});
