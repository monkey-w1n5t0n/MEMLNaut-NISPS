/**
 * Keyboard shortcuts e2e tests.
 *
 * Covers the useKeyboard hook bindings:
 *   1         → thumbs-down (changes outputs via weight noise)
 *   2         → thumbs-up  (adds example + triggers async training)
 *   z / Z     → undo       (restores previous weights)
 *   r / R     → randomise  (re-draws weights)
 *   t / T     → trainAsync (triggers async training)
 *   Space     → toggle follow mode
 *   c / C     → clear all
 *
 * Note: useKeyboard is wired in App.tsx via the onMount hook. The shortcuts
 * are suppressed inside form elements — all these tests run with no focused
 * input, so shortcuts fire on the document.
 */
import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';
test.describe('Keyboard shortcuts (useKeyboard hook)', () => {
    // ─── Key '1' → thumbs-down ─────────────────────────────────────────────────
    test('key 1 triggers thumbs-down: changes at least one output', async ({ page }) => {
        await loadSolidApp(page);
        const before = await page.evaluate(() => [...window.__nisps.getOutputs()]);
        await page.keyboard.press('1');
        // thumbsDown is synchronous — outputs update immediately
        const after = await page.evaluate(() => [...window.__nisps.getOutputs()]);
        const changed = before.some((v, i) => Math.abs(v - after[i]) > 0.0001);
        expect(changed).toBe(true);
    });
    test('key 1 keeps all outputs bounded [0,1]', async ({ page }) => {
        await loadSolidApp(page);
        await page.keyboard.press('1');
        const outputs = await page.evaluate(() => [...window.__nisps.getOutputs()]);
        for (const v of outputs) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });
    // ─── Key '2' → thumbs-up ───────────────────────────────────────────────────
    test('key 2 triggers thumbs-up: increments example count by 1', async ({ page }) => {
        await loadSolidApp(page);
        const before = await page.evaluate(() => window.__nisps.getExampleCount());
        await page.keyboard.press('2');
        // thumbsUp is async — wait for the example to be recorded
        await page.waitForFunction((countBefore) => window.__nisps.getExampleCount() > countBefore, before, { timeout: 5000 });
        const after = await page.evaluate(() => window.__nisps.getExampleCount());
        expect(after).toBe(before + 1);
    });
    // ─── Key 'z' → undo ────────────────────────────────────────────────────────
    test('key z triggers undo after thumbs-down: weights restored within 1e-4', async ({ page }) => {
        await loadSolidApp(page);
        // Capture weights before any operation
        const weightsBefore = await page.evaluate(() => [...window.__nisps.getWeights()]);
        // thumbs-down via key '1'
        await page.keyboard.press('1');
        // Verify weights changed
        const weightsAfterDown = await page.evaluate(() => [...window.__nisps.getWeights()]);
        const downChanged = weightsBefore.some((v, i) => Math.abs(v - weightsAfterDown[i]) > 1e-8);
        expect(downChanged).toBe(true);
        // undo via key 'z'
        await page.keyboard.press('z');
        const weightsAfterUndo = await page.evaluate(() => [...window.__nisps.getWeights()]);
        let maxDiff = 0;
        for (let i = 0; i < weightsBefore.length; i++) {
            maxDiff = Math.max(maxDiff, Math.abs(weightsBefore[i] - weightsAfterUndo[i]));
        }
        expect(maxDiff).toBeLessThan(1e-4);
    });
    test('key Z (shift-z) also triggers undo', async ({ page }) => {
        await loadSolidApp(page);
        const weightsBefore = await page.evaluate(() => [...window.__nisps.getWeights()]);
        await page.keyboard.press('1'); // thumbs-down
        await page.keyboard.press('Z'); // undo with shift
        const weightsAfterUndo = await page.evaluate(() => [...window.__nisps.getWeights()]);
        let maxDiff = 0;
        for (let i = 0; i < weightsBefore.length; i++) {
            maxDiff = Math.max(maxDiff, Math.abs(weightsBefore[i] - weightsAfterUndo[i]));
        }
        expect(maxDiff).toBeLessThan(1e-4);
    });
    // ─── Key 'r' → randomise ───────────────────────────────────────────────────
    test('key r triggers randomise: changes at least one output', async ({ page }) => {
        await loadSolidApp(page);
        const before = await page.evaluate(() => [...window.__nisps.getOutputs()]);
        await page.keyboard.press('r');
        const after = await page.evaluate(() => [...window.__nisps.getOutputs()]);
        const changed = before.some((v, i) => Math.abs(v - after[i]) > 0.0001);
        expect(changed).toBe(true);
    });
    test('key R (shift-r) also triggers randomise', async ({ page }) => {
        await loadSolidApp(page);
        const before = await page.evaluate(() => [...window.__nisps.getOutputs()]);
        await page.keyboard.press('R');
        const after = await page.evaluate(() => [...window.__nisps.getOutputs()]);
        const changed = before.some((v, i) => Math.abs(v - after[i]) > 0.0001);
        expect(changed).toBe(true);
    });
    // ─── Key 'Space' → toggle follow mode ──────────────────────────────────────
    test('Space toggles follow mode on', async ({ page }) => {
        await loadSolidApp(page);
        // Initial state: follow mode is off
        const initialFollow = await page.evaluate(() => window.__nispsInputStore?.followMode?.() ?? false);
        expect(initialFollow).toBe(false);
        // Space toggles it on
        await page.keyboard.press('Space');
        const afterSpace = await page.evaluate(() => window.__nispsInputStore?.followMode?.() ?? false);
        expect(afterSpace).toBe(true);
    });
    test('Space toggles follow mode off when already on', async ({ page }) => {
        await loadSolidApp(page);
        // Turn follow mode on, then off
        await page.keyboard.press('Space'); // on
        await page.keyboard.press('Space'); // off
        const followModeOff = await page.evaluate(() => window.__nispsInputStore?.followMode?.() ?? true);
        expect(followModeOff).toBe(false);
    });
    test('follow badge appears when follow mode is active via Space', async ({ page }) => {
        await loadSolidApp(page);
        // Badge should not be visible initially
        await expect(page.locator('.follow-badge')).not.toBeVisible();
        await page.keyboard.press('Space');
        // Badge should now be visible
        await expect(page.locator('.follow-badge')).toBeVisible();
    });
    test('Escape clears follow mode', async ({ page }) => {
        await loadSolidApp(page);
        await page.keyboard.press('Space'); // activate follow mode
        const isOn = await page.evaluate(() => window.__nispsInputStore?.followMode?.() ?? false);
        expect(isOn).toBe(true);
        await page.keyboard.press('Escape'); // clear follow mode
        const isOff = await page.evaluate(() => window.__nispsInputStore?.followMode?.() ?? true);
        expect(isOff).toBe(false);
    });
    // ─── Key 'c' → clear all ───────────────────────────────────────────────────
    test('key c clears all examples', async ({ page }) => {
        await loadSolidApp(page);
        // Add an example first
        await page.evaluate(async () => {
            await window.__nisps.thumbsUp();
        });
        const countBefore = await page.evaluate(() => window.__nisps.getExampleCount());
        expect(countBefore).toBeGreaterThan(0);
        await page.keyboard.press('c');
        const countAfter = await page.evaluate(() => window.__nisps.getExampleCount());
        expect(countAfter).toBe(0);
    });
    // ─── Shortcuts suppressed when typing in an input ──────────────────────────
    test('key 1 does NOT trigger thumbs-down when focus is inside a text input', async ({ page }) => {
        await loadSolidApp(page);
        // Inject a temporary text input into the DOM and focus it
        await page.evaluate(() => {
            const input = document.createElement('input');
            input.type = 'text';
            input.id = '__test-input';
            document.body.appendChild(input);
            input.focus();
        });
        const outputsBefore = await page.evaluate(() => [...window.__nisps.getOutputs()]);
        await page.keyboard.press('1');
        const outputsAfter = await page.evaluate(() => [...window.__nisps.getOutputs()]);
        // Outputs should NOT have changed — shortcut is suppressed while input is focused
        const changed = outputsBefore.some((v, i) => Math.abs(v - outputsAfter[i]) > 0.0001);
        expect(changed).toBe(false);
        // Cleanup
        await page.evaluate(() => {
            document.getElementById('__test-input')?.remove();
        });
    });
});
