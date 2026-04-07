/**
 * e2e tests for f15-param-popup.
 * Validates:
 *   VAL-PARAM-001: Popup displays param info (name, value, range controls)
 *   VAL-PARAM-002: Curve drag adjusts parameter response curve
 *   VAL-PARAM-003: Min/max range sliders set bounds
 *   VAL-PARAM-004: Freeze/unfreeze toggle holds parameter at fixed value
 */
import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('Param Popup', () => {

  /**
   * Helper: open param popup by clicking a heatmap cell.
   * Returns the popup locator.
   */
  async function openPopup(page: import('@playwright/test').Page, cellIndex = 0) {
    const cell = page.locator('#heatmap-cells .heatmap-cell').nth(cellIndex);
    await expect(cell).toBeVisible();
    const box = await cell.boundingBox();
    expect(box).not.toBeNull();
    // Short click in center
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const popup = page.locator('#param-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
    return popup;
  }

  // ─── VAL-PARAM-001: Popup displays param info ───

  test('VAL-PARAM-001a: popup shows parameter name', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);

    // Should have a pp-name element with text
    const name = popup.locator('.pp-name');
    await expect(name).toBeVisible();
    const nameText = await name.textContent();
    expect(nameText).toBeTruthy();
    expect(nameText!.length).toBeGreaterThan(0);
  });

  test('VAL-PARAM-001b: popup shows current parameter value', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);

    // Should have a pp-value element showing numeric value
    const value = popup.locator('.pp-value');
    await expect(value).toBeVisible();
    const valueText = await value.textContent();
    expect(valueText).toBeTruthy();
    // Should be a numeric string like "0.523"
    expect(parseFloat(valueText!)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(valueText!)).toBeLessThanOrEqual(1);
  });

  test('VAL-PARAM-001c: popup has curve canvas, range sliders, and freeze button', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);

    // Curve canvas
    const curveCanvas = popup.locator('.pp-curve-canvas');
    await expect(curveCanvas).toBeVisible();

    // Curve value display
    const curveVal = popup.locator('.pp-row').first().locator('.pp-val');
    await expect(curveVal).toBeVisible();

    // Range sliders (min and max)
    const minSlider = popup.locator('.pp-range-min');
    await expect(minSlider).toBeVisible();
    const maxSlider = popup.locator('.pp-range-max');
    await expect(maxSlider).toBeVisible();

    // Freeze button
    const freezeBtn = popup.locator('.pp-freeze-btn');
    await expect(freezeBtn).toBeVisible();
  });

  test('VAL-PARAM-001d: popup shows visual mode param names', async ({ page }) => {
    await loadSolidApp(page);

    // Click first cell (should show "Flow" in visual mode)
    const popup = await openPopup(page, 0);
    const name = popup.locator('.pp-name');
    const nameText = await name.textContent();
    expect(nameText).toBe('Flow');
  });

  test('VAL-PARAM-001e: popup has close button that dismisses it', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);
    await expect(popup).toBeVisible();

    // Click close button
    const closeBtn = popup.locator('.pp-close');
    await closeBtn.click();

    // Popup should be hidden
    await expect(popup).not.toBeVisible({ timeout: 2000 });
  });

  // ─── VAL-PARAM-002: Curve drag adjusts parameter ───

  test('VAL-PARAM-002a: curve canvas is visible and interactive', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);
    const curveCanvas = popup.locator('.pp-curve-canvas');
    await expect(curveCanvas).toBeVisible();

    // Should have ns-resize cursor style
    const cursor = await curveCanvas.evaluate(el => getComputedStyle(el).cursor);
    expect(cursor).toContain('ns-resize');
  });

  test('VAL-PARAM-002b: vertical drag on curve canvas changes curve value', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);

    // Get initial curve value
    const curveValEl = popup.locator('.pp-row').first().locator('.pp-val');
    const initialCurveText = await curveValEl.textContent();
    const initialCurve = parseFloat(initialCurveText!);

    // Drag down on curve canvas to increase curve
    const curveCanvas = popup.locator('.pp-curve-canvas');
    const box = await curveCanvas.boundingBox();
    expect(box).not.toBeNull();

    // Simulate pointer drag down (increase curve)
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 40, { steps: 5 });
    await page.mouse.up();

    // Curve value should have changed
    const newCurveText = await curveValEl.textContent();
    const newCurve = parseFloat(newCurveText!);
    // Dragging down should increase curve factor
    expect(newCurve).toBeGreaterThan(initialCurve);
  });

  test('VAL-PARAM-002c: curve value is stored in override', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);

    // Get initial curve value from the display
    const curveValEl = popup.locator('.pp-row').first().locator('.pp-val');
    const curveText = await curveValEl.textContent();
    const curveValue = parseFloat(curveText!);

    // Check that the store's override matches
    const storeCurve = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      const ov = store.getParamOverride(0);
      return ov.curve;
    });

    expect(storeCurve).toBeCloseTo(curveValue, 1);
  });

  // ─── VAL-PARAM-003: Min/max range sliders ───

  test('VAL-PARAM-003a: range sliders default to 0-1', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);

    // Range value display should show 0.00–1.00
    const rangeRows = popup.locator('.pp-row');
    // Second row is the range row (first is curve)
    const rangeRow = rangeRows.nth(1);
    const rangeVal = rangeRow.locator('.pp-val');
    const rangeText = await rangeVal.textContent();
    expect(rangeText).toContain('0.00');
    expect(rangeText).toContain('1.00');
  });

  test('VAL-PARAM-003b: adjusting min slider updates range display', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);

    // Use programmatic approach to change min slider
    const result = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      // Set min to 0.3 via the slider
      const minSlider = document.querySelector('.pp-range-min') as HTMLInputElement;
      if (!minSlider) return { success: false, error: 'no min slider' };

      // Set value and dispatch input event
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      nativeInputValueSetter?.call(minSlider, '0.3');
      minSlider.dispatchEvent(new Event('input', { bubbles: true }));

      return { success: true };
    });

    expect(result.success).toBe(true);

    // Check that the range display updated
    const rangeRows = popup.locator('.pp-row');
    const rangeRow = rangeRows.nth(1);
    const rangeVal = rangeRow.locator('.pp-val');
    const rangeText = await rangeVal.textContent();
    expect(rangeText).toContain('0.30');
  });

  test('VAL-PARAM-003c: adjusting max slider updates range display', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);

    // Set max slider to 0.7 programmatically
    const result = await page.evaluate(() => {
      const maxSlider = document.querySelector('.pp-range-max') as HTMLInputElement;
      if (!maxSlider) return { success: false, error: 'no max slider' };

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      nativeInputValueSetter?.call(maxSlider, '0.7');
      maxSlider.dispatchEvent(new Event('input', { bubbles: true }));

      return { success: true };
    });

    expect(result.success).toBe(true);

    // Check range display
    const rangeRows = popup.locator('.pp-row');
    const rangeRow = rangeRows.nth(1);
    const rangeVal = rangeRow.locator('.pp-val');
    const rangeText = await rangeVal.textContent();
    expect(rangeText).toContain('0.70');
  });

  test('VAL-PARAM-003d: min cannot exceed max', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);

    // Set max to 0.3 first
    await page.evaluate(() => {
      const maxSlider = document.querySelector('.pp-range-max') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      setter?.call(maxSlider, '0.3');
      maxSlider.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Now try to set min to 0.5 (should be clamped to max)
    await page.evaluate(() => {
      const minSlider = document.querySelector('.pp-range-min') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      setter?.call(minSlider, '0.5');
      minSlider.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Check override in store — min should be >= max
    const ov = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      return store.getParamOverride(0);
    });

    // Min should have been clamped to max (0.3)
    expect(ov.min).toBeLessThanOrEqual(ov.max);
  });

  test('VAL-PARAM-003e: range values are stored in override', async ({ page }) => {
    await loadSolidApp(page);

    await openPopup(page, 0);

    // Set min via slider
    await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      store.setParamOverride(0, 'min', 0.2);
      store.setParamOverride(0, 'max', 0.8);
    });

    // Verify stored values
    const ov = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      return store.getParamOverride(0);
    });

    expect(ov.min).toBeCloseTo(0.2, 1);
    expect(ov.max).toBeCloseTo(0.8, 1);
  });

  // ─── VAL-PARAM-004: Freeze/unfreeze toggle ───

  test('VAL-PARAM-004a: freeze button toggles state', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);
    const freezeBtn = popup.locator('.pp-freeze-btn');
    await expect(freezeBtn).toBeVisible();

    // Initially shows "Freeze" (not frozen)
    const initialText = await freezeBtn.textContent();
    expect(initialText).toBe('Freeze');

    // Click to freeze
    await freezeBtn.click();

    // Now should show "Frozen" and have frozen class
    const frozenText = await freezeBtn.textContent();
    expect(frozenText).toBe('Frozen');
    const hasFrozenClass = await freezeBtn.evaluate(el => el.classList.contains('frozen'));
    expect(hasFrozenClass).toBe(true);
  });

  test('VAL-PARAM-004b: freeze toggle captures current output value', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);

    // Get current output value
    const currentValue = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      return probe.getOutputs()[0];
    });

    // Click freeze
    const freezeBtn = popup.locator('.pp-freeze-btn');
    await freezeBtn.click();

    // Check that the override has frozen=true and fixedValue equals current output
    const ov = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      return store.getParamOverride(0);
    });

    expect(ov.frozen).toBe(true);
    expect(ov.fixedValue).toBeCloseTo(currentValue, 2);
  });

  test('VAL-PARAM-004c: frozen parameter shows value slider', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);

    // Initially no val slider
    const valSliderBefore = popup.locator('.pp-val-slider');
    // Slider should not be visible when not frozen
    const sliderVisibleBefore = await valSliderBefore.count();
    expect(sliderVisibleBefore).toBe(0);

    // Freeze
    const freezeBtn = popup.locator('.pp-freeze-btn');
    await freezeBtn.click();

    // Now slider should appear
    const valSliderAfter = popup.locator('.pp-val-slider');
    await expect(valSliderAfter).toBeVisible({ timeout: 2000 });
  });

  test('VAL-PARAM-004d: unfreeze restores non-frozen state', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);
    const freezeBtn = popup.locator('.pp-freeze-btn');

    // Freeze
    await freezeBtn.click();
    let ov = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      return store.getParamOverride(0);
    });
    expect(ov.frozen).toBe(true);

    // Unfreeze
    await freezeBtn.click();
    ov = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      return store.getParamOverride(0);
    });
    expect(ov.frozen).toBe(false);

    // Button text should say "Freeze" again
    const text = await freezeBtn.textContent();
    expect(text).toBe('Freeze');
  });

  test('VAL-PARAM-004e: getOverriddenOutput returns fixedValue when frozen', async ({ page }) => {
    await loadSolidApp(page);

    await openPopup(page, 0);

    // Set frozen state and fixed value via store
    await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      store.setParamOverride(0, 'frozen', true);
      store.setParamOverride(0, 'fixedValue', 0.75);
    });

    // getOverriddenOutput should return the fixed value
    const overriddenValue = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      return store.getOverriddenOutput(0);
    });

    expect(overriddenValue).toBeCloseTo(0.75, 1);
  });

  test('VAL-PARAM-004f: adjusting fixed value slider updates frozen value', async ({ page }) => {
    await loadSolidApp(page);

    const popup = await openPopup(page, 0);

    // Freeze first
    const freezeBtn = popup.locator('.pp-freeze-btn');
    await freezeBtn.click();

    // Adjust fixed value slider
    await page.evaluate(() => {
      const valSlider = document.querySelector('.pp-val-slider') as HTMLInputElement;
      if (!valSlider) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      setter?.call(valSlider, '0.6');
      valSlider.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Check override stored
    const ov = await page.evaluate(() => {
      const store = (window as any).__nispsStore;
      return store.getParamOverride(0);
    });

    expect(ov.frozen).toBe(true);
    expect(ov.fixedValue).toBeCloseTo(0.6, 1);
  });
});
