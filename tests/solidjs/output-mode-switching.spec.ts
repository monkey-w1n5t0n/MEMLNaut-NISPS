/**
 * e2e tests for f13-output-mode-switching.
 * Validates:
 *   VAL-MODE-001: Default mode is visual
 *   VAL-MODE-002: Switch to synth mode
 *   VAL-MODE-003: Switch to MIDI CC mode
 *   VAL-MODE-004: Switch to Audio Canvas mode
 *   VAL-MODE-005: Mode switch triggers MLP resize
 *   VAL-MODE-006: Confirmation dialog on destructive resize
 *   VAL-MODE-007: MLP warm-start preserves hidden weights
 */
import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('Output Mode Switching', () => {

  // ─── VAL-MODE-001: Default mode is visual ───

  test('VAL-MODE-001a: on fresh load, output mode is visual', async ({ page }) => {
    await loadSolidApp(page);

    const mode = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      return store.state.outputMode;
    });

    expect(mode).toBe('visual');
  });

  test('VAL-MODE-001b: fresh load shows flow field (20 outputs)', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      return {
        outputCount: probe.getOutputs().length,
        outputMode: (window as any).__nispsStore.state.outputMode,
      };
    });

    expect(result.outputMode).toBe('visual');
    expect(result.outputCount).toBe(20);
  });

  test('VAL-MODE-001c: flowfield canvas is visible in visual mode', async ({ page }) => {
    await loadSolidApp(page);

    const canvasVisible = await page.evaluate(() => {
      const canvas = document.getElementById('flowfield-canvas');
      if (!canvas) return false;
      const rect = canvas.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    expect(canvasVisible).toBe(true);
  });

  // ─── VAL-MODE-002: Switch to synth mode ───

  test('VAL-MODE-002a: switching to synth mode changes outputCount to 126', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      await store.setOutputMode('synth');

      return {
        outputMode: store.state.outputMode,
        outputCount: probe.getOutputs().length,
        allBounded: probe.getOutputs().every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.outputMode).toBe('synth');
    expect(result.outputCount).toBe(126);
    expect(result.allBounded).toBe(true);
  });

  // ─── VAL-MODE-003: Switch to MIDI CC mode ───

  test('VAL-MODE-003a: switching to midi-cc mode changes outputCount to default 8', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      await store.setOutputMode('midi-cc');

      return {
        outputMode: store.state.outputMode,
        outputCount: probe.getOutputs().length,
        allBounded: probe.getOutputs().every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.outputMode).toBe('midi-cc');
    expect(result.outputCount).toBe(8);
    expect(result.allBounded).toBe(true);
  });

  // ─── VAL-MODE-004: Switch to Audio Canvas mode ───

  test('VAL-MODE-004a: switching to audio-canvas mode changes outputCount to 36', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      await store.setOutputMode('audio-canvas');

      return {
        outputMode: store.state.outputMode,
        outputCount: probe.getOutputs().length,
        allBounded: probe.getOutputs().every((v: number) => v >= 0 && v <= 1),
      };
    });

    expect(result.outputMode).toBe('audio-canvas');
    expect(result.outputCount).toBe(36);
    expect(result.allBounded).toBe(true);
  });

  // ─── VAL-MODE-005: Mode switch triggers MLP resize ───

  test('VAL-MODE-005a: switching from visual (20) to synth (126) changes output count', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      const beforeCount = probe.getOutputs().length;

      await store.setOutputMode('synth');

      return {
        beforeCount,
        afterCount: probe.getOutputs().length,
      };
    });

    expect(result.beforeCount).toBe(20);
    expect(result.afterCount).toBe(126);
  });

  test('VAL-MODE-005b: switching back to visual produces 20 outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      await store.setOutputMode('synth');
      const synthCount = probe.getOutputs().length;

      await store.setOutputMode('visual');

      return {
        synthCount,
        visualCount: probe.getOutputs().length,
      };
    });

    expect(result.synthCount).toBe(126);
    expect(result.visualCount).toBe(20);
  });

  test('VAL-MODE-005c: MLP IML instances have correct nOutputs after resize', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      await store.setOutputMode('synth');

      const imlJoy = store.getImlJoy();
      const imlHand = store.getImlHand();

      return {
        joyOutputs: imlJoy?.nOutputs,
        handOutputs: imlHand?.nOutputs,
        probeCount: probe.getOutputs().length,
      };
    });

    expect(result.joyOutputs).toBe(126);
    expect(result.handOutputs).toBe(126);
    expect(result.probeCount).toBe(126);
  });

  // ─── VAL-MODE-006: Confirmation dialog on destructive resize ───

  test('VAL-MODE-006a: confirmation dialog appears when switching modes with training data', async ({ page }) => {
    await loadSolidApp(page);

    // Set up a listener for the confirmation dialog before the mode switch
    let dialogTriggered = false;
    page.on('dialog', async dialog => {
      dialogTriggered = true;
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('reset');
      await dialog.accept();
    });

    await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      // Add some training examples
      probe.thumbsUp();
      probe.thumbsUp();
      probe.thumbsUp();

      const count = probe.getExampleCount();

      // Now switch mode - should trigger confirmation
      await store.setOutputMode('synth');
    });

    expect(dialogTriggered).toBe(true);
  });

  test('VAL-MODE-006b: cancelling confirmation prevents mode switch', async ({ page }) => {
    await loadSolidApp(page);

    // Set up a listener to dismiss the dialog
    page.on('dialog', async dialog => {
      await dialog.dismiss();
    });

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      // Add some training examples
      probe.thumbsUp();
      probe.thumbsUp();

      // Try to switch mode - will be cancelled
      await store.setOutputMode('synth');

      return {
        mode: store.state.outputMode,
        outputCount: probe.getOutputs().length,
        exampleCount: probe.getExampleCount(),
      };
    });

    // Mode should remain unchanged after cancel
    expect(result.mode).toBe('visual');
    expect(result.outputCount).toBe(20);
    expect(result.exampleCount).toBeGreaterThanOrEqual(2);
  });

  test('VAL-MODE-006c: no confirmation when switching with no training data', async ({ page }) => {
    await loadSolidApp(page);

    let dialogTriggered = false;
    page.on('dialog', async dialog => {
      dialogTriggered = true;
      await dialog.accept();
    });

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      // No examples added - fresh state
      const count = probe.getExampleCount();

      // Switch mode - should NOT trigger confirmation
      await store.setOutputMode('synth');

      return {
        exampleCountBefore: count,
        mode: store.state.outputMode,
        outputCount: probe.getOutputs().length,
      };
    });

    expect(dialogTriggered).toBe(false);
    expect(result.mode).toBe('synth');
    expect(result.outputCount).toBe(126);
  });

  // ─── VAL-MODE-007: MLP warm-start preserves hidden weights ───

  test('VAL-MODE-007a: hidden layer weights preserved on mode switch', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      // Randomize weights so they have distinct values
      probe.randomise();

      // Get weights before mode switch
      const weightsBefore = probe.getWeights();
      const beforeCount = weightsBefore.length;

      // Compute hidden layer weight count (same architecture hidden layers)
      // Architecture: [3, 32, 48, 64, N_outputs]
      // Hidden layer 1: 32 * (3+1) = 128 weights
      // Hidden layer 2: 48 * (32+1) = 1584 weights
      // Hidden layer 3: 64 * (48+1) = 3136 weights
      // Total hidden: 128 + 1584 + 3136 = 4848
      const hiddenWeightCount = 3 * (32 + 1) + 32 * (48 + 1) + 48 * (64 + 1);

      // Switch mode (20 → 126 outputs)
      await store.setOutputMode('synth');

      const weightsAfter = probe.getWeights();

      return {
        beforeCount,
        afterCount: weightsAfter.length,
        hiddenWeightCount,
        // Check that hidden weights are preserved (first hiddenWeightCount values)
        hiddenWeightsMatch: weightsBefore.slice(0, hiddenWeightCount).every(
          (w: number, i: number) => Math.abs(w - weightsAfter[i]) < 1e-6
        ),
        // Output layer weights should be different (resized)
        outputWeightsChanged: beforeCount !== weightsAfter.length,
      };
    });

    expect(result.hiddenWeightsMatch).toBe(true);
    expect(result.outputWeightsChanged).toBe(true);
  });

  test('VAL-MODE-007b: mode switch to smaller output count also preserves hidden weights', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      // Start in synth mode (126 outputs)
      await store.setOutputMode('synth');
      probe.randomise();

      const weightsBefore = probe.getWeights();

      // Switch to visual (20 outputs) — shrink
      await store.setOutputMode('visual');

      const weightsAfter = probe.getWeights();

      const hiddenWeightCount = 3 * (32 + 1) + 32 * (48 + 1) + 48 * (64 + 1);

      return {
        hiddenWeightsMatch: weightsBefore.slice(0, hiddenWeightCount).every(
          (w: number, i: number) => Math.abs(w - weightsAfter[i]) < 1e-6
        ),
      };
    });

    expect(result.hiddenWeightsMatch).toBe(true);
  });

  // ─── Mode switching via UI (pill toggle) ───

  test('mode pill toggle is visible in mode drawer', async ({ page }) => {
    await loadSolidApp(page);

    // Open the mode drawer
    await page.click('[data-drawer="mode"]');

    // Check that pill toggle exists
    const pillToggle = page.locator('#output-mode-toggle');
    await expect(pillToggle).toBeVisible();

    // Check all mode options exist
    const pills = page.locator('#output-mode-toggle .pill-opt');
    await expect(pills).toHaveCount(4);
  });

  test('clicking synth pill switches to synth mode', async ({ page }) => {
    await loadSolidApp(page);

    // Open mode drawer
    await page.click('[data-drawer="mode"]');

    // Click synth pill
    await page.click('#output-mode-toggle .pill-opt[data-mode="synth"]');

    // Wait for async mode switch to complete
    await page.waitForFunction(() => {
      const store = (window as any).__nispsStore;
      return store.state.outputMode === 'synth' && (window as any).__nisps.getOutputs().length === 126;
    }, { timeout: 10_000 });

    const result = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;
      return {
        mode: store.state.outputMode,
        outputCount: probe.getOutputs().length,
      };
    });

    expect(result.mode).toBe('synth');
    expect(result.outputCount).toBe(126);
  });

  test('active pill reflects current mode', async ({ page }) => {
    await loadSolidApp(page);

    // Open mode drawer
    await page.click('[data-drawer="mode"]');

    // Visual should be active by default
    const visualPill = page.locator('#output-mode-toggle .pill-opt[data-mode="visual"]');
    await expect(visualPill).toHaveClass(/active/);

    // Click synth
    await page.click('#output-mode-toggle .pill-opt[data-mode="synth"]');

    // Visual should no longer be active, synth should be
    const synthPill = page.locator('#output-mode-toggle .pill-opt[data-mode="synth"]');
    await expect(synthPill).toHaveClass(/active/);
  });

  // ─── Inference works after mode switch ───

  test('inference works correctly after multiple mode switches', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      const probe = (window as any).__nisps;

      // visual → synth → midi-cc → visual
      await store.setOutputMode('synth');
      probe.setInputs(0.3, 0.7);
      const synthOutputs = probe.getOutputs();

      await store.setOutputMode('midi-cc');
      probe.setInputs(0.3, 0.7);
      const midiOutputs = probe.getOutputs();

      await store.setOutputMode('visual');
      probe.setInputs(0.3, 0.7);
      const visualOutputs = probe.getOutputs();

      return {
        synthCount: synthOutputs.length,
        midiCount: midiOutputs.length,
        visualCount: visualOutputs.length,
        synthBounded: synthOutputs.every((v: number) => v >= 0 && v <= 1),
        midiBounded: midiOutputs.every((v: number) => v >= 0 && v <= 1),
        visualBounded: visualOutputs.every((v: number) => v >= 0 && v <= 1),
        synthFinite: synthOutputs.every((v: number) => Number.isFinite(v)),
        midiFinite: midiOutputs.every((v: number) => Number.isFinite(v)),
        visualFinite: visualOutputs.every((v: number) => Number.isFinite(v)),
      };
    });

    expect(result.synthCount).toBe(126);
    expect(result.midiCount).toBe(8);
    expect(result.visualCount).toBe(20);
    expect(result.synthBounded).toBe(true);
    expect(result.midiBounded).toBe(true);
    expect(result.visualBounded).toBe(true);
    expect(result.synthFinite).toBe(true);
    expect(result.midiFinite).toBe(true);
    expect(result.visualFinite).toBe(true);
  });
});
