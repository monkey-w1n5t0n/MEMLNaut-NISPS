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

  await page.evaluate(() => {
    window.__mf!.setOutputMode('midi');
    window.__mf!.setMidiCcCount(3);
  });
  await expect(page.getByTestId('output-stage')).toHaveAttribute('data-output-count', '3');

  await page.evaluate(() => window.__mf!.setMidiCcCount(7));
  await expect(page.getByTestId('output-stage')).toHaveAttribute('data-output-count', '7');

  const fullCount = await page.evaluate(() => {
    window.__mf!.setOutputMode('osc');
    return window.__mf!.paramCount();
  });
  await expect(page.getByTestId('output-stage')).toHaveAttribute('data-output-count', String(fullCount));
});
