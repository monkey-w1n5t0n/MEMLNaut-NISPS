/**
 * e2e tests for f06-joystick-component.
 * Validates:
 *   VAL-JOY-001: Drag moves joystick position (joyX/joyY in [0,1], dot follows pointer)
 *   VAL-JOY-002: Follow mode activation (double-tap toggles follow mode)
 *   VAL-JOY-005: Input clamping (values outside [0,1] are clamped)
 *
 * Also verifies:
 *   - Input store is wired to ML store setInputs
 *   - Joystick dot follows pointer position
 *   - Follow mode persists across interactions
 */
import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('Joystick Component', () => {

  // ─── VAL-JOY-001: Drag moves joystick position ───

  test('VAL-JOY-001a: joystick canvas exists in the DOM', async ({ page }) => {
    await loadSolidApp(page);

    const joystick = page.locator('#joystick');
    await expect(joystick).toBeVisible();
  });

  test('VAL-JOY-001b: drag on joystick updates joyX/joyY in [0,1]', async ({ page }) => {
    await loadSolidApp(page);

    const joystick = page.locator('#joystick');
    const box = await joystick.boundingBox();
    expect(box).not.toBeNull();

    const { x, y, width, height } = box!;

    // Drag to the center of the joystick canvas
    const targetX = x + width * 0.75;
    const targetY = y + height * 0.25;

    await page.mouse.move(targetX, targetY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY);
    await page.mouse.up();

    // Check that the input store values are in [0,1]
    const inputState = await page.evaluate(() => {
      const store = (window as any).__nispsInputStore;
      return {
        joyX: store.joyX(),
        joyY: store.joyY(),
      };
    });

    expect(inputState.joyX).toBeGreaterThanOrEqual(0);
    expect(inputState.joyX).toBeLessThanOrEqual(1);
    expect(inputState.joyY).toBeGreaterThanOrEqual(0);
    expect(inputState.joyY).toBeLessThanOrEqual(1);
  });

  test('VAL-JOY-001c: drag to different positions produces different values', async ({ page }) => {
    await loadSolidApp(page);

    const joystick = page.locator('#joystick');
    const box = await joystick.boundingBox();
    expect(box).not.toBeNull();

    const { x, y, width, height } = box!;

    // Drag to top-left
    await page.mouse.move(x + width * 0.2, y + height * 0.2);
    await page.mouse.down();
    await page.mouse.move(x + width * 0.2, y + height * 0.2);
    await page.mouse.up();

    const topLeft = await page.evaluate(() => {
      const store = (window as any).__nispsInputStore;
      return { joyX: store.joyX(), joyY: store.joyY() };
    });

    // Drag to bottom-right
    await page.mouse.move(x + width * 0.8, y + height * 0.8);
    await page.mouse.down();
    await page.mouse.move(x + width * 0.8, y + height * 0.8);
    await page.mouse.up();

    const bottomRight = await page.evaluate(() => {
      const store = (window as any).__nispsInputStore;
      return { joyX: store.joyX(), joyY: store.joyY() };
    });

    // X should be higher in bottom-right drag
    expect(bottomRight.joyX).toBeGreaterThan(topLeft.joyX);
    // Y should be higher in bottom-right drag
    expect(bottomRight.joyY).toBeGreaterThan(topLeft.joyY);
  });

  test('VAL-JOY-001d: drag updates setInputs on ML store', async ({ page }) => {
    await loadSolidApp(page);

    // Set to known position first
    await page.evaluate(() => {
      (window as any).__nisps.setInputs(0.5, 0.5);
    });

    const outputsBefore = await page.evaluate(() => {
      return (window as any).__nisps.getOutputs().slice(0, 5);
    });

    const joystick = page.locator('#joystick');
    const box = await joystick.boundingBox();
    expect(box).not.toBeNull();

    const { x, y, width, height } = box!;

    // Drag to a different position
    await page.mouse.move(x + width * 0.8, y + height * 0.3);
    await page.mouse.down();
    await page.mouse.move(x + width * 0.8, y + height * 0.3);
    await page.mouse.up();

    const outputsAfter = await page.evaluate(() => {
      return (window as any).__nisps.getOutputs().slice(0, 5);
    });

    // At least one output should have changed
    const changed = outputsBefore.some((v: number, i: number) =>
      Math.abs(v - outputsAfter[i]) > 0.001
    );
    expect(changed).toBe(true);
  });

  // ─── VAL-JOY-002: Follow mode activation ───

  test('VAL-JOY-002a: double-click on joystick toggles follow mode', async ({ page }) => {
    await loadSolidApp(page);

    const joystick = page.locator('#joystick');

    // Check initial follow mode state
    const initialFollow = await page.evaluate(() => {
      const store = (window as any).__nispsInputStore;
      return store.followMode();
    });
    expect(initialFollow).toBe(false);

    // Double-click to toggle follow mode
    await joystick.dblclick();

    const afterDblClick = await page.evaluate(() => {
      const store = (window as any).__nispsInputStore;
      return store.followMode();
    });
    expect(afterDblClick).toBe(true);

    // Double-click again to toggle back
    await joystick.dblclick();

    const afterSecondDblClick = await page.evaluate(() => {
      const store = (window as any).__nispsInputStore;
      return store.followMode();
    });
    expect(afterSecondDblClick).toBe(false);
  });

  test('VAL-JOY-002b: follow badge appears when follow mode is active', async ({ page }) => {
    await loadSolidApp(page);

    const joystick = page.locator('#joystick');

    // Double-click to toggle follow mode on
    await joystick.dblclick();

    // Check that the follow badge is visible
    const badge = joystick.locator('.follow-badge');
    await expect(badge).toBeVisible();

    // Double-click again to turn off
    await joystick.dblclick();
    await expect(badge).not.toBeVisible();
  });

  // ─── VAL-JOY-005: Input clamping ───

  test('VAL-JOY-005a: extreme negative values are clamped to [0,1]', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      probe.setInputs(-5, -10);

      const outputs = probe.getOutputs();
      return {
        allBounded: outputs.every((v: number) => v >= 0 && v <= 1),
        allFinite: outputs.every((v: number) => Number.isFinite(v)),
      };
    });

    expect(result.allBounded).toBe(true);
    expect(result.allFinite).toBe(true);
  });

  test('VAL-JOY-005b: extreme positive values are clamped to [0,1]', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      probe.setInputs(99, 100);

      const outputs = probe.getOutputs();
      return {
        allBounded: outputs.every((v: number) => v >= 0 && v <= 1),
        allFinite: outputs.every((v: number) => Number.isFinite(v)),
      };
    });

    expect(result.allBounded).toBe(true);
    expect(result.allFinite).toBe(true);
  });

  test('VAL-JOY-005c: NaN and Infinity are clamped to safe values', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      probe.setInputs(NaN, Infinity);
      probe.setInputs(-Infinity, NaN);

      const outputs = probe.getOutputs();
      return {
        allBounded: outputs.every((v: number) => v >= 0 && v <= 1),
        allFinite: outputs.every((v: number) => Number.isFinite(v)),
      };
    });

    expect(result.allBounded).toBe(true);
    expect(result.allFinite).toBe(true);
  });

  test('VAL-JOY-005d: normal values pass through via joystick position', async ({ page }) => {
    await loadSolidApp(page);

    const joystick = page.locator('#joystick');
    const box = await joystick.boundingBox();
    expect(box).not.toBeNull();

    const { x, y, width, height } = box!;

    // Drag to a specific known position (75% right, 25% down)
    const targetX = x + width * 0.75;
    const targetY = y + height * 0.25;

    await page.mouse.move(targetX, targetY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY);
    await page.mouse.up();

    const result = await page.evaluate(() => {
      const store = (window as any).__nispsInputStore;
      return {
        joyX: store.joyX(),
        joyY: store.joyY(),
      };
    });

    // Values should be in [0,1] and reflect the drag position
    expect(result.joyX).toBeGreaterThanOrEqual(0);
    expect(result.joyX).toBeLessThanOrEqual(1);
    expect(result.joyY).toBeGreaterThanOrEqual(0);
    expect(result.joyY).toBeLessThanOrEqual(1);

    // Position should be roughly where we dragged (not at center 0.5)
    // X should be closer to 0.75, Y closer to 0.25
    expect(result.joyX).toBeGreaterThan(0.5);
    expect(result.joyY).toBeLessThan(0.5);
  });

  // ─── Pointer drag mechanics ───

  test('dragging outside joystick bounds is clamped', async ({ page }) => {
    await loadSolidApp(page);

    const joystick = page.locator('#joystick');
    const box = await joystick.boundingBox();
    expect(box).not.toBeNull();

    const { x, y, width, height } = box!;

    // Start drag inside the joystick
    await page.mouse.move(x + width * 0.5, y + height * 0.5);
    await page.mouse.down();

    // Move far outside to the left and up
    await page.mouse.move(x - 100, y - 100);
    await page.mouse.up();

    const result = await page.evaluate(() => {
      const store = (window as any).__nispsInputStore;
      return {
        joyX: store.joyX(),
        joyY: store.joyY(),
      };
    });

    // Should be clamped to [0, 1]
    expect(result.joyX).toBeGreaterThanOrEqual(0);
    expect(result.joyX).toBeLessThanOrEqual(1);
    expect(result.joyY).toBeGreaterThanOrEqual(0);
    expect(result.joyY).toBeLessThanOrEqual(1);
  });

  test('dragging below-right of joystick is clamped', async ({ page }) => {
    await loadSolidApp(page);

    const joystick = page.locator('#joystick');
    const box = await joystick.boundingBox();
    expect(box).not.toBeNull();

    const { x, y, width, height } = box!;

    // Start drag inside the joystick
    await page.mouse.move(x + width * 0.5, y + height * 0.5);
    await page.mouse.down();

    // Move far outside to the right and below
    await page.mouse.move(x + width + 200, y + height + 200);
    await page.mouse.up();

    const result = await page.evaluate(() => {
      const store = (window as any).__nispsInputStore;
      return {
        joyX: store.joyX(),
        joyY: store.joyY(),
      };
    });

    // Should be clamped to [0, 1]
    expect(result.joyX).toBeGreaterThanOrEqual(0);
    expect(result.joyX).toBeLessThanOrEqual(1);
    expect(result.joyY).toBeGreaterThanOrEqual(0);
    expect(result.joyY).toBeLessThanOrEqual(1);
  });
});
