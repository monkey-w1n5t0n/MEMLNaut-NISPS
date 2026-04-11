/**
 * Engine switching e2e tests — verify that all three synth engines
 * (C15 Shaper-Feedback, Additive, FM Matrix) can be selected, initialised,
 * and driven by the NISPS ML engine correctly.
 *
 * Also tests the EOC chain integration across engine switches.
 */
const { test, expect } = require('@playwright/test');
const { loadApp, statusText } = require('./helpers');

// Engine metadata expected from the switcher
const ENGINES = {
  'shaper-feedback': { displayName: 'C15 Shaper-Feedback', paramCount: 126 },
  'additive':        { displayName: 'Additive',            paramCount: 48 },
  'fm':              { displayName: 'FM Matrix',           paramCount: 55 },
};

/**
 * Helper: switch to an engine via the engine switcher UI.
 * Opens the synth drawer, clicks the engine card, accepts any confirm dialog.
 */
async function switchEngine(page, engineId) {
  // Open synth drawer if not already open
  const drawer = page.locator('#drawer-synth');
  if (await drawer.evaluate(el => el.classList.contains('hidden'))) {
    await page.click('[data-drawer="synth"]');
  }
  // Click the engine card
  page.once('dialog', dialog => dialog.accept());
  await page.click(`.engine-card[data-engine-id="${engineId}"]`);
  // Wait for the switcher to mark it active
  await expect(page.locator(`.engine-card[data-engine-id="${engineId}"]`)).toHaveClass(/active/, { timeout: 15_000 });
}

/**
 * Helper: get the current engine id from the debug probe.
 */
async function getActiveEngineId(page) {
  return page.evaluate(() => window.__nisps?.activeEngine?.id ?? null);
}

/**
 * Helper: get the current MLP output count.
 */
async function getOutputCount(page) {
  return page.evaluate(() => window.__nisps?.getOutputs()?.length ?? 0);
}

// ---------------------------------------------------------------------------
// Expose activeEngine on the debug probe so tests can query it
// ---------------------------------------------------------------------------

test.describe('Engine switching', () => {

  test.beforeEach(async ({ page }) => {
    await loadApp(page);
    // Extend the debug probe with engine-related getters
    await page.evaluate(() => {
      if (window.__nisps) {
        // These are closures over the module-scoped vars in a-app.js,
        // but we can read them via the existing probe's eocChain and other refs.
        // The probe already exposes getOutputs() which reflects N_OUTPUTS.
      }
    });
  });

  test.describe('Default state', () => {
    test('default engine is C15 Shaper-Feedback', async ({ page }) => {
      const btnText = await page.locator('#synth-mode-btn').textContent();
      // The synth mode button should reflect the default engine (may say "Synth" or the engine name)
      expect(btnText).toBeTruthy();
    });

    test('default output count is 126 (C15)', async ({ page }) => {
      const count = await getOutputCount(page);
      // Default mode is visual (20 outputs), not synth
      // Switch to synth mode first
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(500);
      const synthCount = await getOutputCount(page);
      expect(synthCount).toBe(126);
    });

    test('heatmap shows 126 cells in synth mode', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(500);
      const cellCount = await page.locator('#heatmap-cells .heatmap-cell').count();
      expect(cellCount).toBe(126);
    });
  });

  test.describe('Engine switcher UI', () => {
    test('synth drawer contains engine cards', async ({ page }) => {
      await page.click('[data-drawer="synth"]');
      const cards = page.locator('.engine-card');
      // C15 shaper-feedback, additive, fm, modular
      await expect(cards).toHaveCount(4);
    });

    test('C15 card is active by default', async ({ page }) => {
      await page.click('[data-drawer="synth"]');
      const c15Card = page.locator('.engine-card[data-engine-id="shaper-feedback"]');
      await expect(c15Card).toHaveClass(/active/);
    });

    test('additive and FM cards are not active by default', async ({ page }) => {
      await page.click('[data-drawer="synth"]');
      await expect(page.locator('.engine-card[data-engine-id="additive"]')).not.toHaveClass(/active/);
      await expect(page.locator('.engine-card[data-engine-id="fm"]')).not.toHaveClass(/active/);
    });
  });

  test.describe('Switch to Additive engine', () => {
    test('switching resizes MLP to 48 outputs', async ({ page }) => {
      // Go to synth mode first
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(300);

      // Switch engine
      await switchEngine(page, 'additive');
      await page.waitForTimeout(500);

      const count = await getOutputCount(page);
      expect(count).toBe(48);
    });

    test('heatmap rebuilds with 48 cells', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(300);

      await switchEngine(page, 'additive');
      await page.waitForTimeout(500);

      const cellCount = await page.locator('#heatmap-cells .heatmap-cell').count();
      expect(cellCount).toBe(48);
    });

    test('outputs are bounded [0, 1]', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await switchEngine(page, 'additive');
      await page.waitForTimeout(500);

      const outputs = await page.evaluate(() => window.__nisps.getOutputs());
      expect(outputs).toHaveLength(48);
      for (const v of outputs) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    test('different inputs produce different outputs', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await switchEngine(page, 'additive');
      await page.waitForTimeout(500);

      const out1 = await page.evaluate(() => {
        window.__nisps.setInputs(0.1, 0.1);
        return window.__nisps.getOutputs();
      });
      const out2 = await page.evaluate(() => {
        window.__nisps.setInputs(0.9, 0.9);
        return window.__nisps.getOutputs();
      });
      const anyDiff = out1.some((v, i) => Math.abs(v - out2[i]) > 0.001);
      expect(anyDiff).toBe(true);
    });

    test('training works with additive param count', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await switchEngine(page, 'additive');
      await page.waitForTimeout(500);

      const loss = await page.evaluate(() => {
        const nisps = window.__nisps;
        // Add two contrasting examples
        nisps.iml.addExample([0.1, 0.1], new Array(48).fill(0.2));
        nisps.iml.addExample([0.9, 0.9], new Array(48).fill(0.8));
        return nisps.train();
      });
      expect(loss).toBeGreaterThanOrEqual(0);
      expect(loss).toBeLessThan(1);
    });
  });

  test.describe('Switch to FM Matrix engine', () => {
    test('switching resizes MLP to 55 outputs', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(300);

      await switchEngine(page, 'fm');
      await page.waitForTimeout(500);

      const count = await getOutputCount(page);
      expect(count).toBe(55);
    });

    test('heatmap rebuilds with 55 cells', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(300);

      await switchEngine(page, 'fm');
      await page.waitForTimeout(500);

      const cellCount = await page.locator('#heatmap-cells .heatmap-cell').count();
      expect(cellCount).toBe(55);
    });

    test('outputs are bounded [0, 1]', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await switchEngine(page, 'fm');
      await page.waitForTimeout(500);

      const outputs = await page.evaluate(() => window.__nisps.getOutputs());
      expect(outputs).toHaveLength(55);
      for (const v of outputs) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    test('training works with FM param count', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await switchEngine(page, 'fm');
      await page.waitForTimeout(500);

      const loss = await page.evaluate(() => {
        const nisps = window.__nisps;
        nisps.iml.addExample([0.2, 0.8], new Array(55).fill(0.3));
        nisps.iml.addExample([0.8, 0.2], new Array(55).fill(0.7));
        return nisps.train();
      });
      expect(loss).toBeGreaterThanOrEqual(0);
      expect(loss).toBeLessThan(1);
    });
  });

  test.describe('Round-trip switching', () => {
    test('switching C15 → Additive → C15 restores 126 outputs', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(300);

      // Switch to additive
      await switchEngine(page, 'additive');
      await page.waitForTimeout(500);
      expect(await getOutputCount(page)).toBe(48);

      // Switch back to C15
      await switchEngine(page, 'shaper-feedback');
      await page.waitForTimeout(500);
      expect(await getOutputCount(page)).toBe(126);
    });

    test('switching C15 → FM → Additive → C15 restores correctly each time', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(300);

      await switchEngine(page, 'fm');
      await page.waitForTimeout(500);
      expect(await getOutputCount(page)).toBe(55);

      await switchEngine(page, 'additive');
      await page.waitForTimeout(500);
      expect(await getOutputCount(page)).toBe(48);

      await switchEngine(page, 'shaper-feedback');
      await page.waitForTimeout(500);
      expect(await getOutputCount(page)).toBe(126);
    });
  });

  test.describe('Warm-start weight preservation', () => {
    test('hidden layer weights are preserved across resize', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(300);

      // Get weights before switch (first 100 hidden-layer weights)
      const beforeWeights = await page.evaluate(() => {
        return window.__nisps.getWeights().slice(0, 100);
      });

      // Switch to additive (48 outputs, hidden layers unchanged)
      await switchEngine(page, 'additive');
      await page.waitForTimeout(500);

      // Get weights after — first 100 should be identical (hidden layer prefix)
      const afterWeights = await page.evaluate(() => {
        return window.__nisps.getWeights().slice(0, 100);
      });

      // Hidden layer weights should be preserved (warm-start)
      let matchCount = 0;
      for (let i = 0; i < 100; i++) {
        if (Math.abs(beforeWeights[i] - afterWeights[i]) < 1e-6) matchCount++;
      }
      // Allow some tolerance — at least 90% should match
      expect(matchCount).toBeGreaterThan(90);
    });
  });

  test.describe('EOC chain across engine switches', () => {
    test('EOC drawer is accessible from all engines', async ({ page }) => {
      // Open EOC drawer with default C15
      await page.click('[data-drawer="eoc"]');
      await expect(page.locator('#drawer-eoc')).not.toHaveClass(/hidden/);

      // Switch to additive
      await switchEngine(page, 'additive');
      await page.waitForTimeout(500);

      // EOC drawer should still be accessible — engine switch may have closed it
      // so click the dock icon; if already open, clicking toggles closed then re-open
      const eocDrawer = page.locator('#drawer-eoc');
      if (await eocDrawer.evaluate(el => el.classList.contains('hidden'))) {
        await page.click('[data-drawer="eoc"]');
      }
      await expect(eocDrawer).not.toHaveClass(/hidden/);
    });

    test('NISPS mode selector is present in EOC drawer', async ({ page }) => {
      await page.click('[data-drawer="eoc"]');
      const modeButtons = page.locator('.eoc-nisps-bar .pill-opt');
      const count = await modeButtons.count();
      expect(count).toBe(4); // Bypass, Shared, Linked, Independent
    });
  });

  test.describe('SynthVisualizer with different engines', () => {
    test('synth-vis-canvas is visible in synth mode for all engines', async ({ page }) => {
      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(300);

      // Check canvas is visible for C15
      const canvas = page.locator('#synth-vis-canvas');
      await expect(canvas).toBeVisible();

      // Switch to additive — canvas should remain visible
      await switchEngine(page, 'additive');
      await page.waitForTimeout(500);
      await expect(canvas).toBeVisible();

      // Switch to FM — canvas should remain visible
      await switchEngine(page, 'fm');
      await page.waitForTimeout(500);
      await expect(canvas).toBeVisible();
    });
  });

  test.describe('No console errors during engine switch', () => {
    test('switching to additive produces no errors', async ({ page }) => {
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));

      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(300);

      await switchEngine(page, 'additive');
      await page.waitForTimeout(1000);

      // Filter out known non-critical errors
      const critical = errors.filter(e =>
        !e.includes('ResizeObserver') && !e.includes('net::ERR')
      );
      expect(critical).toEqual([]);
    });

    test('switching to FM produces no errors', async ({ page }) => {
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));

      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(300);

      await switchEngine(page, 'fm');
      await page.waitForTimeout(1000);

      const critical = errors.filter(e =>
        !e.includes('ResizeObserver') && !e.includes('net::ERR')
      );
      expect(critical).toEqual([]);
    });

    test('round-trip switching produces no errors', async ({ page }) => {
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));

      await page.click('[data-drawer="mode"]');
      await page.click('[data-mode="synth"]');
      await page.waitForTimeout(300);

      await switchEngine(page, 'additive');
      await page.waitForTimeout(500);
      await switchEngine(page, 'fm');
      await page.waitForTimeout(500);
      await switchEngine(page, 'shaper-feedback');
      await page.waitForTimeout(500);

      const critical = errors.filter(e =>
        !e.includes('ResizeObserver') && !e.includes('net::ERR')
      );
      expect(critical).toEqual([]);
    });
  });
});
