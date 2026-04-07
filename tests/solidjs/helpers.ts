/**
 * Shared helpers for SolidJS e2e tests.
 */
import { Page } from '@playwright/test';

/**
 * Navigate to SolidJS app with ?debug=1 and wait for WASM engine init.
 */
export async function loadSolidApp(page: Page, extraParams = '') {
  await page.addInitScript(() => {
    localStorage.removeItem('nisps-a-immersive');
    localStorage.setItem('nisps-help-seen', '1');
  });
  await page.goto(`/?debug=1${extraParams}`);
  await page.waitForFunction(() => (window as any).__nisps !== undefined, { timeout: 20_000 });
}
