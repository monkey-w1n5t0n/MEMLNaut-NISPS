/**
 * uSEQ-Celium mode-switch smoke test.
 *
 * Verifies the mode pill opens the drawer, the drawer exposes the expected
 * sub-panels (arch, training, BPM, routing) + Connect button + PANIC button,
 * and that switching to another output mode hides the drawer while switching
 * back re-opens it.
 *
 * No hardware is touched: `navigator.serial.requestPort()` requires a user
 * gesture and a physical device, so we assert the button is present/clickable
 * without actually connecting.
 */
const { test, expect } = require('@playwright/test');
const { loadApp } = require('./helpers');

test.describe('uSEQ-Celium mode', () => {
  test('mode pill opens the uSEQ-Celium drawer with arch/training/BPM/routing containers', async ({ page }) => {
    await loadApp(page);

    // Drawer starts hidden.
    await expect(page.locator('#drawer-useq-celium')).toHaveClass(/hidden/);

    // Click the uSEQ-Celium output-mode pill (it lives in the Mode drawer).
    await page.click('[data-drawer="mode"]');
    await page.click('[data-mode="useq-celium"]');

    // Drawer opens.
    await expect(page.locator('#drawer-useq-celium')).not.toHaveClass(/hidden/);

    // Core UI landmarks exist.
    await expect(page.locator('#useq-connect-btn')).toBeVisible();
    await expect(page.locator('#useq-status')).toBeVisible();
    await expect(page.locator('#useq-arch-container')).toBeAttached();
    await expect(page.locator('#useq-training-container')).toBeAttached();
    await expect(page.locator('#useq-bpm-container')).toBeAttached();
    await expect(page.locator('#useq-routing-container')).toBeAttached();
  });

  test('PANIC button is visible and wired', async ({ page }) => {
    await loadApp(page);
    await page.click('[data-drawer="mode"]');
    await page.click('[data-mode="useq-celium"]');
    await expect(page.locator('#useq-panic-btn')).toBeVisible();
    // Resume button starts hidden (panic has not fired).
    await expect(page.locator('#useq-resume-btn')).toBeHidden();
  });

  test('switching to Synth hides the uSEQ-Celium drawer; switching back re-opens it', async ({ page }) => {
    await loadApp(page);

    await page.click('[data-drawer="mode"]');
    await page.click('[data-mode="useq-celium"]');
    await expect(page.locator('#drawer-useq-celium')).not.toHaveClass(/hidden/);

    await page.click('[data-mode="synth"]');
    await expect(page.locator('#drawer-useq-celium')).toHaveClass(/hidden/);

    await page.click('[data-mode="useq-celium"]');
    await expect(page.locator('#drawer-useq-celium')).not.toHaveClass(/hidden/);
  });
});
