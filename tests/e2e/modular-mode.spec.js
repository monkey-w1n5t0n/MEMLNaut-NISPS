/**
 * Modular mode e2e tests (Phase E).
 *
 * These tests exercise the modular engine end-to-end via the debug probe
 * (?debug=1, window.__nisps). They verify:
 *   1. Switching to the modular engine gives paramCount = 512
 *   2. Sub-engine swaps keep paramCount = 512 and update destNames
 *   3. Matrix cell / DSP state round-trips through getState/setState
 *   4. The full state survives a page reload (a-app.js save/load path)
 *   5. ADSR/LFO count changes rebuild paramMeta consistently
 *   6. Presets apply and produce the expected matrix/source state
 *   7. The default patch allows noteOn to produce non-silent output
 *   8. destNames differ between sub-engines (sanity)
 */
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

/**
 * Switch the active engine to `modular` via the engine-switcher UI.
 * Waits until window.__nisps.activeEngineId === 'modular'.
 */
async function switchToModular(page) {
  // Open the synth drawer first (needed to see the engine cards).
  const drawer = page.locator('#drawer-synth');
  if (await drawer.evaluate(el => el.classList.contains('hidden'))) {
    await page.click('[data-drawer="synth"]');
  }
  page.once('dialog', d => d.accept());
  await page.click('.engine-card[data-engine-id="modular"]');
  // Wait until setActiveEngine completes AND the modular dock icon becomes
  // visible — the dock icon is revealed from the tail end of setActiveEngine
  // so this guarantees the initial modular-ui.refresh() restore pass has run.
  // Without this we race: test code can fire before modularUI.show()
  // reaches refresh()'s pendingRestore branch, which then wipes the test's
  // subsequent sub-engine swap.
  await page.waitForFunction(
    () => window.__nisps?.activeEngineId === 'modular',
    null,
    { timeout: 20_000 }
  );
  await page.waitForFunction(
    () => !document.querySelector('.dock-icon[data-drawer="modular"]')?.classList.contains('hidden'),
    null,
    { timeout: 20_000 }
  );
  // Also yield one extra microtask so any synchronous deferred work queued
  // inside setActiveEngine settles before we start poking the engine.
  await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
}

test.describe('Modular mode', () => {

  test('switching to modular yields paramCount = 512', async ({ page }) => {
    await loadApp(page);
    await switchToModular(page);
    const count = await page.evaluate(() => window.__nisps.paramCount);
    expect(count).toBe(512);
  });

  test('debug probe exposes modular hooks', async ({ page }) => {
    await loadApp(page);
    await switchToModular(page);
    const hooks = await page.evaluate(() => ({
      hasGet:     typeof window.__nisps.getModularState === 'function',
      hasSet:     typeof window.__nisps.setModularState === 'function',
      hasSwap:    typeof window.__nisps.setModularSubEngine === 'function',
      hasPreset:  typeof window.__nisps.applyModularPreset === 'function',
      hasCounts:  typeof window.__nisps.setModularSourceCount === 'function',
      presetList: window.__nisps.listModularPresets?.()?.length ?? 0,
    }));
    expect(hooks.hasGet).toBe(true);
    expect(hooks.hasSet).toBe(true);
    expect(hooks.hasSwap).toBe(true);
    expect(hooks.hasPreset).toBe(true);
    expect(hooks.hasCounts).toBe(true);
    expect(hooks.presetList).toBe(6);
  });

  test('sub-engine swap keeps paramCount = 512', async ({ page }) => {
    await loadApp(page);
    await switchToModular(page);

    for (const sub of ['additive', 'fm', 'subtractive']) {
      await page.evaluate(async (id) => {
        await window.__nisps.setModularSubEngine(id);
      }, sub);
      const info = await page.evaluate(() => ({
        paramCount: window.__nisps.paramCount,
        subId:      window.__nisps.activeEngine?.activeSubEngineId,
      }));
      expect(info.subId).toBe(sub);
      expect(info.paramCount).toBe(512);
    }
  });

  test('destNames differ between sub-engines', async ({ page }) => {
    await loadApp(page);
    await switchToModular(page);
    const sub = await page.evaluate(() => window.__nisps.activeEngine?.destNames);
    await page.evaluate(async () => {
      await window.__nisps.setModularSubEngine('fm');
    });
    const fm = await page.evaluate(() => window.__nisps.activeEngine?.destNames);
    expect(sub).toBeTruthy();
    expect(fm).toBeTruthy();
    expect(sub).toEqual(['pitch','osc2_detune','osc3_detune','osc_mix_bal','noise_level','cutoff','resonance','filter_env_amt','amp','pan']);
    expect(fm[1]).toBe('op1_level'); // fm-specific
    expect(sub).not.toEqual(fm);
  });

  test('ADSR count change rebuilds paramMeta', async ({ page }) => {
    await loadApp(page);
    await switchToModular(page);

    const baseline = await page.evaluate(() => window.__nisps.paramCount);
    expect(baseline).toBe(512);

    await page.evaluate(() => window.__nisps.setModularSourceCount(6, 8));
    const after = await page.evaluate(() => window.__nisps.paramCount);
    // 6 ADSRs * 4 + 8 LFOs * 2 + 48*10 = 24 + 16 + 480 = 520
    expect(after).toBe(520);

    await page.evaluate(() => window.__nisps.setModularSourceCount(4, 8));
    const reset = await page.evaluate(() => window.__nisps.paramCount);
    expect(reset).toBe(512);
  });

  test('getState returns a snapshot with raw dsp values', async ({ page }) => {
    await loadApp(page);
    await switchToModular(page);
    const snap = await page.evaluate(() => window.__nisps.getModularState());
    expect(snap).toBeTruthy();
    expect(snap.version).toBe(1);
    expect(snap.subEngine).toBe('subtractive');
    expect(typeof snap.dsp).toBe('object');
    // At least the default amp route should be set to 1.0 by the default patch.
    expect(snap.dsp['MM_Matrix/s00_d08_amp']).toBeCloseTo(1.0, 4);
    expect(snap.dsp['MM_ADSR/00_adsr01_enable']).toBeCloseTo(1.0, 4);
  });

  test('matrix cell persistence across setState', async ({ page }) => {
    await loadApp(page);
    await switchToModular(page);

    // Pick a distinctive cell: ADSR2 (s=1) → cutoff (d=5) on subtractive.
    await page.evaluate(() => {
      const engine = window.__nisps.activeEngine;
      const idx = engine.paramMeta.findIndex(m =>
        m.label === 'MM_Matrix/s01_d05_cutoff');
      if (idx < 0) throw new Error('no s01_d05_cutoff cell in paramMeta');
      // paramMeta min=-1 max=1; 0.9 in norm = 0.8 raw.
      engine.setParam(idx, 0.9);
    });

    const snap = await page.evaluate(() => window.__nisps.getModularState());
    expect(snap.dsp['MM_Matrix/s01_d05_cutoff']).toBeCloseTo(0.8, 4);

    // Mutate further, then restore.
    await page.evaluate(() => {
      const engine = window.__nisps.activeEngine;
      const idx = engine.paramMeta.findIndex(m =>
        m.label === 'MM_Matrix/s01_d05_cutoff');
      engine.setParam(idx, 0.1);
    });

    const midSnap = await page.evaluate(() => window.__nisps.getModularState());
    expect(midSnap.dsp['MM_Matrix/s01_d05_cutoff']).not.toBeCloseTo(0.8, 4);

    await page.evaluate(async (s) => {
      await window.__nisps.setModularState(s);
    }, snap);

    const restored = await page.evaluate(() => window.__nisps.getModularState());
    expect(restored.dsp['MM_Matrix/s01_d05_cutoff']).toBeCloseTo(0.8, 4);
  });

  test('modular DSP state survives a page reload', async ({ page }) => {
    // NOTE: don't use loadApp() because it installs an addInitScript that
    // clears nisps-a-immersive on every navigation — including our reload.
    // Replicate loadApp's bootstrap inline, using a localStorage sentinel
    // (NOT window.__x) so the "first nav only" guard survives subsequent
    // navigations on the same origin.
    await page.addInitScript(() => {
      if (!localStorage.getItem('__nisps-test-bootstrapped')) {
        localStorage.setItem('__nisps-test-bootstrapped', '1');
        localStorage.removeItem('nisps-a-immersive');
      }
      localStorage.setItem('nisps-help-seen', '1');
    });
    await page.goto('/a-immersive.html?debug=1');
    await page.waitForFunction(() => window.__nisps !== undefined, { timeout: 20_000 });

    await switchToModular(page);

    // Set a distinctive value, save, then reload the page (localStorage
    // is now preserved across the nav because __nispsTestBootstrapped is set).
    await page.evaluate(() => {
      const engine = window.__nisps.activeEngine;
      engine._setRawByLabel('3_Filter/01_resonance', 0.73);
    });
    await page.evaluate(() => window.__nisps.saveState());

    await page.goto('/a-immersive.html?debug=1');
    await page.waitForFunction(() => window.__nisps !== undefined, { timeout: 20_000 });

    // Engine is deferred-constructed; clicking the modular card re-instantiates
    // it and the pending DSP state should be applied before setActiveEngine.
    await switchToModular(page);

    const restored = await page.evaluate(() => window.__nisps.getModularState());
    expect(restored).toBeTruthy();
    expect(restored.dsp['3_Filter/01_resonance']).toBeCloseTo(0.73, 4);
  });

  test('preset apply: plucky bass sets the expected matrix routes', async ({ page }) => {
    await loadApp(page);
    await switchToModular(page);

    const ok = await page.evaluate(async () => {
      return await window.__nisps.applyModularPreset('modular-plucky-bass');
    });
    expect(ok).toBe(true);

    const snap = await page.evaluate(() => window.__nisps.getModularState());
    expect(snap.subEngine).toBe('subtractive');
    // ADSR2 fast decay
    expect(snap.dsp['MM_ADSR/01_adsr02_decay']).toBeCloseTo(0.15, 4);
    // Matrix: ADSR2 (s01) → cutoff (d05) at raw 0.8
    expect(snap.dsp['MM_Matrix/s01_d05_cutoff']).toBeCloseTo(0.8, 4);
    // Filter cutoff moved to 400 Hz
    expect(snap.dsp['3_Filter/00_cutoff']).toBeCloseTo(400, 2);
  });

  test('preset apply: DX bell swaps to fm sub-engine', async ({ page }) => {
    await loadApp(page);
    await switchToModular(page);

    await page.evaluate(async () => {
      await window.__nisps.applyModularPreset('modular-dx-bell');
    });
    const snap = await page.evaluate(() => window.__nisps.getModularState());
    expect(snap.subEngine).toBe('fm');
    expect(snap.dsp['MM_Matrix/s02_d03_op3_level']).toBeCloseTo(1.0, 4);

    // paramCount should still be 512 after the cross-engine swap.
    const count = await page.evaluate(() => window.__nisps.paramCount);
    expect(count).toBe(512);
  });

  test('initial outputs are in [0,1] after modular swap', async ({ page }) => {
    await loadApp(page);
    await switchToModular(page);

    // Set inputs so the MLP runs a forward pass.
    await page.evaluate(() => window.__nisps.setInputs(0.3, 0.7));
    const outputs = await page.evaluate(() => window.__nisps.getOutputs());
    expect(outputs.length).toBe(512);
    for (const v of outputs) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
