/**
 * Geometric dislike (feedback Mode 1) — the SHARED C++/WASM core primitive
 * (one-core-engine P3; rl-feedback-design §2.1). Drives the probe's read-only
 * count accessors + the dislikeGeometric driver.
 *
 * The core reads the MLP's CURRENT input and the passed HEARD (post-pipeline)
 * output vector. With NO positives it runs the cold-start fallback and returns
 * FeedbackAction 15 (GeometricColdStart); with positives it computes the k-NN
 * centroid push-away target and returns 14 (GeometricPush).
 */
import { test, expect } from '@playwright/test';
import { loadProbe, settleInputs, countChanged, allWithin } from './helpers';
import { PafSynthSchema } from '../../src/modes/generated';

// The boot mode is paf_synth; the heard vector must match its output arity.
const N_OUTPUTS = PafSynthSchema.ml.output_size; // 33
// A heard vector deliberately distinct from any plausible net output.
const HEARD = new Array(N_OUTPUTS).fill(0.9);

test.describe('geometric dislike (Mode 1) — core-backed', () => {
  test.beforeEach(async ({ page }) => {
    await loadProbe(page);
  });

  test('dislike before any likes returns cold-start (15) and stores a negative', async ({ page }) => {
    const r = await page.evaluate((heard) => {
      const p = window.__nisps!;
      p.setFeedbackMode('avoid'); // geometric dislike proto mode maps to core Avoid
      p.setAvoidStyle(0); // Geometric (default)
      p.setInputs(0.5, 0.5);
      const action = p.dislikeGeometric(heard);
      return { action, counts: p.feedbackCounts() };
    }, HEARD);
    expect(r.action).toBe(15); // GeometricColdStart
    expect(r.counts.positive).toBe(0);
    expect(r.counts.negative).toBe(1);
  });

  test('two likes then a dislike pushes (14), changes the disliked output, stays bounded', async ({ page }) => {
    await page.evaluate(() => {
      window.__nisps!.setFeedbackMode('avoid');
      window.__nisps!.setAvoidStyle(0);
    });

    // Like at two distinct inputs — the core's thumbsUp auto-stores a positive
    // into the k-NN centroid while in Avoid+Geometric mode (ADR §2.1).
    await settleInputs(page, 0.2, 0.3);
    await page.evaluate(() => window.__nisps!.thumbsUp());
    await settleInputs(page, 0.8, 0.7);
    await page.evaluate(() => window.__nisps!.thumbsUp());

    // Settle at a third input and capture the heard-≠-output baseline there.
    const before = await settleInputs(page, 0.5, 0.5);
    // Sanity: the heard vector we will pass genuinely differs from the outputs.
    expect(countChanged(before, HEARD, 1e-3)).toBeGreaterThan(0);

    // Dislike at the settled input with an explicit lr for a visibly-audible push.
    const res = await page.evaluate((heard) => {
      const p = window.__nisps!;
      const action = p.dislikeGeometric(heard, 1.0);
      return { action, counts: p.feedbackCounts() };
    }, HEARD);

    // Re-settle at the same input; the weights moved, so the output must too.
    const after = await settleInputs(page, 0.5, 0.5);

    expect(res.action).toBe(14); // GeometricPush (positives exist → not cold-start)
    expect(res.counts.positive).toBeGreaterThanOrEqual(2);
    expect(res.counts.negative).toBe(1);
    expect(countChanged(before, after, 1e-4)).toBeGreaterThan(0);
    expect(allWithin(after, 0, 1)).toBe(true);
  });

  test('parameterised replay applies configured dose then expires by wall time', async ({ page }) => {
    const result = await page.evaluate((heard) => {
      const p = window.__nisps!;
      p.setFeedbackMode('avoid');
      p.setAvoidStyle(0);
      p.setGeometricConfig(0.001, 20, 100);
      p.setInputs(0.4, 0.6);
      p.dislikeGeometric(heard);
      const first = p.advanceGeometric(0.05);
      const live = p.feedbackCounts().negative;
      const second = p.advanceGeometric(0.05);
      const expired = p.feedbackCounts().negative;
      return { first, live, second, expired };
    }, HEARD);

    expect(result).toEqual({ first: 1, live: 1, second: 1, expired: 0 });
  });

  test('Push away starts once on pointer-down and holding never rerolls', async ({ page }) => {
    const button = page.getByTitle(/Dislike — push the sound away/);
    const box = await button.boundingBox();
    if (!box) throw new Error('negative-feedback button has no bounds');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    expect(await page.evaluate(() => window.__nisps!.feedbackCounts().negative)).toBe(1);

    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.__nisps!.feedbackCounts().negative)).toBe(1);

    await page.mouse.up();
    expect(await page.evaluate(() => window.__nisps!.feedbackCounts().negative)).toBe(1);
    await expect(button).not.toHaveAttribute('title', /hold|re-roll/);
  });

  test('expanded Learning panel starts calibrated and can restore upstream defaults', async ({ page }) => {
    await page.getByTitle('Learning', { exact: true }).click();
    await page.getByTitle('Expand', { exact: true }).click();

    await expect(page.getByText('push · learning rate', { exact: true })).toBeVisible();
    await expect(page.getByText('push · updates / second', { exact: true })).toBeVisible();
    await expect(page.getByText('push · lifetime', { exact: true })).toBeVisible();
    await expect(page.getByText('0.0030', { exact: true })).toBeVisible();
    await expect(page.getByText('200 Hz', { exact: true })).toBeVisible();
    await expect(page.getByText('2.5 s', { exact: true })).toBeVisible();
    await expect(page.getByText('≈ 500 replay updates + the press')).toBeVisible();

    await page.getByRole('button', { name: 'Upstream defaults' }).click();
    await expect(page.getByText('0.0010', { exact: true })).toBeVisible();
  });
});
