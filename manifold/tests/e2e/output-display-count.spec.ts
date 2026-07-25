import { expect, test } from '@playwright/test';
import { loadProbe } from './helpers';
import type { MfDebugHook } from '../../src/console/ConsoleApp';

declare global {
  interface Window {
    __mf?: MfDebugHook;
  }
}

test('output sliders follow the active backend output count', async ({ page }) => {
  await loadProbe(page);

  // Drive the real UI path: output target → Outputs drawer → expanded MIDI
  // config. This deliberately does not use the debug setters; the regression
  // covers the same interaction an operator performs.
  await page.getByTitle(/^Mode:/).click();
  await page.getByRole('button', { name: 'MIDI', exact: true }).click();
  await page.getByTitle('Outputs').click();
  await page.getByTitle('Expand').click();
  await page.getByLabel('CCs').fill('2');

  // The count remains visible in condensed chrome after leaving the advanced
  // config, and closing the drawer reveals the same number of stage columns.
  await page.getByTitle('Condense').click();
  await expect(page.getByText('2 outputs', { exact: true })).toBeVisible();
  await page.getByTitle('Close').click();
  await expect(page.getByTestId('output-stage')).toHaveAttribute('data-output-count', '2');

  // Backends without a configured count present the full mode output set.
  const fullCount = await page.evaluate(() => window.__mf!.paramCount());
  await page.getByTitle(/^Mode:/).click();
  await page.getByRole('button', { name: 'OSC', exact: true }).click();
  await expect(page.getByTestId('output-stage')).toHaveAttribute('data-output-count', String(fullCount));
});
