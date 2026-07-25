import { test, expect } from '@playwright/test';
import { loadProbe } from './helpers';

test('legacy Xavier control is hidden until enabled in Settings', async ({ page }) => {
  await loadProbe(page);

  await page.getByTitle('Learning').click();
  await page.getByTitle('Expand').click();
  await expect(page.getByText('Xavier (centred) weight regime')).toHaveCount(0);

  await page.getByTitle('Close').click();
  await page.getByTitle('Settings').click();
  const featureFlag = page.getByRole('switch', { name: 'Xavier / spread randomisation' });
  await expect(featureFlag).toHaveAttribute('aria-checked', 'false');
  await featureFlag.click();
  await expect(featureFlag).toHaveAttribute('aria-checked', 'true');

  await page.getByTitle('Close').click();
  await page.getByTitle('Learning').click();
  await page.getByTitle('Expand').click();
  await expect(page.getByRole('switch', { name: 'Xavier (centred) weight regime' })).toBeVisible();
});
