/**
 * Training-health panel (simplification-plan §6.5e / ALIGNMENT defect 6).
 *
 * The point of the panel is that "is the network learning?" becomes GENUINELY
 * answerable, so the test asserts two things a placeholder could not satisfy:
 *
 *   1. Before any training it says so plainly — no plot, no numbers.
 *   2. After a real fit it reports the iteration count and the endpoints of the
 *      core's own loss curve, and draws a polyline with one vertex per
 *      iteration.
 *
 * It also pins the disclosure rule: the panel is advanced surface, so it lives
 * at the Learning drawer's `expanded` depth (Manifold's existing DrawerDepth
 * mechanism) and must NOT appear in the condensed panel.
 */
import { test, expect } from '@playwright/test';
import { loadProbe } from './helpers';
import { PafSynthSchema } from '../../src/modes/generated';

const N_OUTPUTS = PafSynthSchema.ml.output_size;
const LOW = { input: [0.1, 0.9], output: new Array(N_OUTPUTS).fill(0.1) };
const HIGH = { input: [0.9, 0.1], output: new Array(N_OUTPUTS).fill(0.9) };

/** Open the Learning drawer and expand it to the advanced depth. */
async function openLearningExpanded(page: import('@playwright/test').Page) {
  await page.getByTitle('Learning', { exact: true }).click();
  await page.getByTitle('Expand', { exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await loadProbe(page);
});

test('training health is advanced surface — absent from the condensed drawer', async ({ page }) => {
  await page.getByTitle('Learning', { exact: true }).click();
  await expect(page.getByText('Training health')).toHaveCount(0);
});

test('with no training run the panel says so instead of drawing a curve', async ({ page }) => {
  await openLearningExpanded(page);
  await expect(page.getByText('Training health')).toBeVisible();
  await expect(page.getByText(/no training run yet/)).toBeVisible();
  await expect(page.locator('svg polyline')).toHaveCount(0);
});

test('after a real fit the panel reports the core loss curve', async ({ page }) => {
  const hist = await page.evaluate(
    ([low, high]) => {
      window.__nisps!.addExample(low.input, low.output);
      window.__nisps!.addExample(high.input, high.output);
      window.__nisps!.train();
      return Array.from(window.__nisps!.getLossHistory());
    },
    [LOW, HIGH],
  );
  expect(hist.length).toBeGreaterThan(1);

  await openLearningExpanded(page);
  await expect(page.getByText(/no training run yet/)).toHaveCount(0);
  await expect(page.getByText(`${hist.length} iter`)).toBeVisible();
  await expect(page.getByText(`start ${hist[0]!.toFixed(4)}`)).toBeVisible();
  await expect(page.getByText(`end ${hist[hist.length - 1]!.toFixed(4)}`)).toBeVisible();

  // One polyline vertex per recorded iteration — the plot is the data, not decor.
  const points = await page.locator('svg polyline').first().getAttribute('points');
  expect(points!.trim().split(/\s+/)).toHaveLength(hist.length);
});

test('layer stats show one row per layer with real weight-health numbers', async ({ page }) => {
  const layers = await page.evaluate(() => window.__nisps!.describe().numLayers);
  await openLearningExpanded(page);
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(layers);
  // mean|w| of a freshly-drawn net is non-zero — the table is reading the net.
  const meanAbs = await rows.first().locator('td').nth(1).innerText();
  expect(Number(meanAbs)).toBeGreaterThan(0);
});
