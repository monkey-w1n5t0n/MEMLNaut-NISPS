import { test, expect } from '@playwright/test';

/**
 * Dual-engine mode: a gamepad appearing reconfigures the app — the main engine
 * drives the Powerful Synth Engine (left stick) and a second MLP engine drives
 * the sequencer (right stick). A fake gamepad is injected before load so the
 * whole path (presence → auto-config → Sequencer drawer → synth start →
 * sequencer clock → notes over the shared ring) runs for real in Chromium.
 */

declare global {
  interface Window {
    __mf?: { getModeId(): string };
    __fakePad?: { axes: number[] };
  }
}

test('a gamepad switches on dual mode; the sequencer plays the synth', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript(() => {
    const pad = { axes: [0, 0, 0.6, -0.4] };
    window.__fakePad = pad;
    const fake = () => ({
      id: 'Fake Pad',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: pad.axes,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    });
    let present = false;
    navigator.getGamepads = () => (present ? ([fake()] as unknown as Gamepad[]) : []);
    window.addEventListener('load', () => {
      setTimeout(() => {
        present = true;
        window.dispatchEvent(new Event('gamepadconnected'));
      }, 800);
    });
  });

  await page.goto('/?debug=1');

  // 1. Auto-reconfigure: the synth's preset mode becomes active.
  await page.waitForFunction(() => window.__mf?.getModeId().startsWith('psynth:'), undefined, { timeout: 20_000 });

  // 2. The Sequencer drawer shows dual mode on, with its menu.
  await page.getByTitle('Sequencer').click();
  await expect(page.getByText('dual mode on')).toBeVisible();
  await expect(page.getByText('Melody maker', { exact: true })).toBeVisible();
  await expect(page.getByText('Octave offset', { exact: true })).toBeVisible();

  // 3. Play: the synth starts and the sequencer clock advances.
  await page.getByRole('button', { name: 'play', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'pause', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Step \d+ \/ 16/)).toBeVisible({ timeout: 10_000 });

  // 4. Naming rule.
  expect(await page.locator('body').innerText()).not.toContain('C15');
  expect(errors).toEqual([]);
});
