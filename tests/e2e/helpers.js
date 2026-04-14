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

/**
 * Switch to synth output mode (required for Patch Editor / synth preset flows).
 */
async function enterSynthMode(page) {
  await page.click('[data-drawer="mode"]');
  await page.click('[data-mode="synth"]');
  // Close mode drawer to avoid covering other controls.
  const drawer = page.locator('#drawer-mode');
  if (!(await drawer.evaluate(el => el.classList.contains('hidden')))) {
    const closeBtn = drawer.locator('.drawer-close');
    if (await closeBtn.count() > 0) await closeBtn.first().click();
  }
}

/**
 * Switch active engine to modular via the engine-switcher UI.
 * Waits for `__nisps.activeEngineId === 'modular'` and the modular dock icon.
 */
async function switchToModular(page) {
  const drawer = page.locator('#drawer-synth');
  if (await drawer.evaluate(el => el.classList.contains('hidden'))) {
    await page.click('[data-drawer="synth"]');
  }
  page.once('dialog', d => d.accept());
  await page.click('.engine-card[data-engine-id="modular"]');
  await page.waitForFunction(
    () => window.__nisps?.activeEngineId === 'modular',
    null,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    () => !document.querySelector('.dock-icon[data-drawer="modular"]')?.classList.contains('hidden'),
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
}

/**
 * Open the Patch Editor by pressing 'E'. Requires synth output mode.
 * Waits for the modal to be visible (not .hidden).
 */
async function openPatchEditor(page) {
  await page.keyboard.press('e');
  await page.waitForSelector('.pe-root:not(.hidden)', { timeout: 5_000 });
}

/**
 * Open the Patch Bay by pressing 'M'. Requires modular engine active.
 */
async function openPatchBay(page) {
  await page.keyboard.press('m');
  await page.waitForSelector('.pb-root:not(.hidden)', { timeout: 5_000 });
}

module.exports = {
  loadApp,
  statusText,
  enterSynthMode,
  switchToModular,
  openPatchEditor,
  openPatchBay,
};
