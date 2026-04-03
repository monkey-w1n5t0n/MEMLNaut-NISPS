/**
 * Shared helpers for e2e tests.
 */
const { expect } = require('@playwright/test');

/**
 * Navigate to a-immersive with ?debug=1 and wait for the WASM engine to
 * initialise and expose window.__nisps.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} extraParams  - additional query string, e.g. '&preset=beginner-1'
 */
async function loadApp(page, extraParams = '') {
  // Clear app state but mark help as seen so the overlay doesn't block clicks.
  await page.addInitScript(() => {
    localStorage.removeItem('nisps-a-immersive');
    localStorage.setItem('nisps-help-seen', '1');
  });
  await page.goto(`/a-immersive.html?debug=1${extraParams}`);
  // Wait until the debug probe is ready (WASM init is async).
  await page.waitForFunction(() => window.__nisps !== undefined, { timeout: 20_000 });
}

/**
 * Returns the current text content of the status line.
 * @param {import('@playwright/test').Page} page
 */
async function statusText(page) {
  return page.locator('#status-text').textContent();
}

module.exports = { loadApp, statusText };
