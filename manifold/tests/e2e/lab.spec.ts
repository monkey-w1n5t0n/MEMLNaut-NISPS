import { test, expect } from '@playwright/test';

/**
 * The hidden ML lab (`?lab=1`): the page loads without the console, its Web
 * Workers boot the real WASM engine, a small one-at-a-time sweep completes,
 * and results + sensitivity render. Kept small (24 episodes) so it is a smoke,
 * not a benchmark.
 */
test('hidden lab runs a small sweep in workers', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/?lab=1');
  await expect(page.getByText('ML Lab')).toBeVisible();
  await expect(page.getByText('Shipped defaults')).toBeVisible();

  await page.getByLabel('seeds per persona × goal').fill('2');
  for (const name of ['Patient, good ears', 'Unsure ears']) {
    await page.getByRole('switch', { name, exact: true }).click();
  }
  // Vary only the nudge size: shipped, both mode bases, 4 nudge candidates.
  const knobs = ['Hidden layer 1', 'Hidden layer 2', 'Hidden layer 3', 'Weight-draw spread', 'Like: learning rate',
    'Like: max iterations', 'Dislike: learning rate', 'Dislike: replay rate (Hz)', 'Dislike: lifetime (ms)'];
  for (const name of knobs) await page.getByRole('switch', { name, exact: true }).click();

  const runBtn = page.getByRole('button', { name: /Run one-at-a-time \(6 configs · 24 episodes\)/ });
  await expect(runBtn).toBeEnabled();
  await runBtn.click();

  await expect(page.getByText(/24\/24 episodes/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('All configs')).toBeVisible();
  await expect(page.getByText('Sensitivity')).toBeVisible();
  await expect(page.getByText('Recommendation')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'shipped', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
