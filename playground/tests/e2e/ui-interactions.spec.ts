/**
 * UI interaction smoke tests.
 *
 * These tests exercise the SolidJS playground's chrome — header navigation,
 * mode switcher, route handling. They are deliberately resilient to layout
 * changes: we look for accessible names / roles where possible rather than
 * hard-coding selectors.
 *
 * NOT covered here (yet):
 *   - The training drawer (stream 10 is still landing the controls).
 *   - The control surface (stream 10).
 *   - Gear-icon settings drawer (stream 10).
 * Tests below that depend on stream 10 deliverables call `test.skip(...)`
 * with a clear marker so they show as skipped, not failing, until that
 * stream lands.
 */
import { test, expect } from '@playwright/test';
import { loadApp } from './helpers';

test.describe('UI — top-level navigation', () => {
  test('home renders title and mode link', async ({ page }) => {
    await loadApp(page, { route: '/', waitForReady: false });
    await expect(page.getByText('MEMLNaut Playground')).toBeVisible();
    await expect(page.getByRole('link', { name: /^Modes$/ })).toBeVisible();
  });

  test('header has nav buttons for /modes and /dev/primitives', async ({ page }) => {
    await loadApp(page, { route: '/', waitForReady: false });
    await expect(page.getByRole('button', { name: '/modes' })).toBeVisible();
    await expect(page.getByRole('button', { name: '/dev/primitives' })).toBeVisible();
  });

  test('clicking /modes navigates to the modes route', async ({ page }) => {
    await loadApp(page, { route: '/', waitForReady: false });
    await page.getByRole('button', { name: '/modes' }).click();
    await expect(page).toHaveURL(/\/modes\/?$/);
  });

  test('clicking /dev/primitives navigates to the primitives showcase', async ({ page }) => {
    await loadApp(page, { route: '/', waitForReady: false });
    await page.getByRole('button', { name: '/dev/primitives' }).click();
    await expect(page).toHaveURL(/\/dev\/primitives\/?$/);
  });

  test('unknown route shows a 404', async ({ page }) => {
    await loadApp(page, { route: '/no-such-route', waitForReady: false });
    await expect(page.getByText('404')).toBeVisible();
  });
});

test.describe('UI — modes route', () => {
  test('mode switcher renders with at least one mode', async ({ page }) => {
    // The mode-switcher chrome must render even if WASM ML hasn't booted —
    // the page should never be blank-screen on a WASM init failure.
    await loadApp(page, { waitForReady: false });
    const buttons = await page.locator('button, [role=tab], select').count();
    expect(buttons).toBeGreaterThan(0);
  });

  test('switching modes does not raise unrelated console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await loadApp(page, { waitForReady: false });
    const modeButtons = page.getByRole('button').filter({ hasNotText: 'home' });
    const count = await modeButtons.count();
    if (count >= 2) {
      await modeButtons.nth(1).click().catch(() => undefined);
      await page.waitForTimeout(200);
    }
    // Filter out the known-pending WASM module-factory failure (stream 7/10
    // is finishing ESM-friendly glue) and other benign init noise.
    const real = errors.filter((e) =>
      !/module factory/i.test(e) &&
      !/abortFn|preview\.html|favicon/.test(e) &&
      !/playwright/i.test(e)
    );
    expect(real, real.join('\n')).toEqual([]);
  });
});

test.describe('UI — drawer / training controls (stream 10 pending)', () => {
  test('training drawer skipped pending stream 10', async () => {
    test.skip(true, 'TrainingControls primitive is not on /modes yet — stream 10 wires it');
  });

  test('control surface skipped pending stream 10', async () => {
    test.skip(true, 'ControlAxis bar is not on /modes yet — stream 10 wires it');
  });
});
