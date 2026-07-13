/**
 * Spine invariant.
 *
 * The engine spine (`src/engine/spine.ts`) is: setInputs → processed → ml →
 * routed, derived EAGERLY + SYNCHRONOUSLY off React's render cycle. This spec
 * asserts the two properties that make the spine the trustworthy core of the
 * app:
 *
 *   1. Pushing inputs through the spine yields BOUNDED, CONSISTENT routed
 *      outputs — distinct inputs map to distinct outputs, the same input
 *      (once the input/output EMA smoothing settles) converges to a stable
 *      vector, and both the post-ML and routed vectors stay in [0, 1].
 *   2. The probe (hence the WASM engine and the reactive spine) stays ALIVE
 *      across output-mode switches — flipping the convertible Console between
 *      Stages must never tear down or re-init the net.
 *
 * Distilled from `playground/tests/e2e/modes.spec.ts` ("cycling through all
 * modes leaves probe alive"). The playground drove mode changes by reloading
 * with a `nisps-mode-store` localStorage key; Manifold has no such store, so we
 * drive the real dock mode selector instead — a genuine in-tab Stage switch,
 * no reload, no probe teardown.
 */
import { test, expect } from '@playwright/test';
import { loadProbe, getOutputs, getRouted, settleInputs, countChanged, allWithin } from './helpers';

test.beforeEach(async ({ page }) => {
  await loadProbe(page);
});

test.describe('spine — bounded, consistent routed outputs', () => {
  test('setInputs yields bounded post-ML and routed vectors', async ({ page }) => {
    await page.evaluate(() => window.__nisps!.setInputs(0.25, 0.75));
    const outs = await getOutputs(page);
    const routed = await getRouted(page);

    expect(outs.length).toBeGreaterThan(0);
    expect(routed.length).toBe(outs.length);
    expect(allWithin(outs, 0, 1)).toBe(true);
    expect(allWithin(routed, 0, 1)).toBe(true);
  });

  test('distinct inputs produce distinct outputs; the same input converges', async ({ page }) => {
    // Settle at A, then read A again — smoothing has converged, so the two
    // reads must be (near-)identical: the mapping is a stable function of the
    // input once the pipeline state has caught up.
    const a1 = await settleInputs(page, 0.3, 0.7);
    const a2 = await settleInputs(page, 0.3, 0.7, 5);
    expect(a1.length).toBe(a2.length);
    expect(countChanged(a1, a2, 1e-3)).toBe(0);
    expect(allWithin(a1, 0, 1)).toBe(true);

    // A different input must move the mapping (spine actually propagates).
    const b = await settleInputs(page, 0.8, 0.2);
    expect(countChanged(a1, b, 1e-3)).toBeGreaterThan(0);
    expect(allWithin(b, 0, 1)).toBe(true);
  });

  test('routed output tracks the input across a sweep, staying bounded', async ({ page }) => {
    const points: Array<[number, number]> = [
      [0.1, 0.1],
      [0.5, 0.5],
      [0.9, 0.9],
    ];
    for (const [x, y] of points) {
      await settleInputs(page, x, y);
      const routed = await getRouted(page);
      expect(routed.length).toBeGreaterThan(0);
      expect(allWithin(routed, 0, 1)).toBe(true);
    }
  });
});

test.describe('spine — probe stays alive across mode switches', () => {
  /**
   * Switch the dock's output-mode selector via the real UI. The "M" button
   * (title `Mode: <label>`) opens the popover; each mode is a button named by
   * its label. We assert the selector's title updates (deterministic wait, no
   * sleep) so we know the switch landed before probing.
   */
  async function switchMode(page: import('@playwright/test').Page, label: string): Promise<void> {
    await page.getByTitle(/^Mode:/).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByTitle(`Mode: ${label}`)).toBeVisible();
  }

  test('cycling output modes keeps the probe ready and the spine live', async ({ page }) => {
    // Network-free modes only (OSC / CV need a bridge; Editor is a serial stub).
    const modes = ['Built-in Synth', 'MIDI', 'Particle System'];

    for (const label of modes) {
      await switchMode(page, label);

      // The probe (and thus the WASM engine + spine) must survive the switch.
      const ready = await page.evaluate(() => window.__nisps?.__ready === true);
      expect(ready, `probe not ready after switching to ${label}`).toBe(true);

      // And the spine must still propagate a fresh input to bounded outputs.
      await page.evaluate(() => window.__nisps!.setInputs(0.35, 0.65));
      const outs = await getOutputs(page);
      expect(outs.length, `no outputs after ${label}`).toBeGreaterThan(0);
      expect(allWithin(outs, 0, 1), `unbounded outputs after ${label}`).toBe(true);
    }
  });
});
