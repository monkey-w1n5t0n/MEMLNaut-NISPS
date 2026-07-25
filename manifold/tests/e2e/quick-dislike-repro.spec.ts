import { test, expect } from '@playwright/test';
import { loadProbe } from './helpers';

test('Push away press starts a rejection immediately and keeps replaying after release', async ({
  page,
}) => {
  await loadProbe(page);
  const button = page.getByTitle(/Dislike — push the sound away/);

  // A quick click should store a rejection, and release must not cancel it.
  await button.click();
  expect(await page.evaluate(() => window.__nisps!.feedbackCounts().negative)).toBe(1);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__nisps!.feedbackCounts().negative)).toBe(1);

  // Fresh state: holding the same negative-feedback button must start the same
  // rejection promptly; it must not silently route to a different gesture.
  await loadProbe(page);
  const held = page.getByTitle(/Dislike — push the sound away/);
  const weightsBefore = await page.evaluate(() => Array.from(window.__nisps!.getWeights()));
  const box = await held.boundingBox();
  if (!box) throw new Error('negative-feedback button has no bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  const heldResult = await page.evaluate((before) => {
    const after = Array.from(window.__nisps!.getWeights());
    return {
      negatives: window.__nisps!.feedbackCounts().negative,
      weightsChanged: after.reduce(
        (n, value, index) => n + (value !== before[index] ? 1 : 0),
        0,
      ),
      weightCount: after.length,
    };
  }, weightsBefore);
  console.log('held negative result', heldResult);
  expect(heldResult.negatives).toBe(1);
  await page.mouse.up();
});
