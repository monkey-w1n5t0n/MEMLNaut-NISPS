/**
 * e2e tests for f14-heatmap-strip.
 * Validates:
 *   VAL-HEAT-001: Bar count matches mode
 *   VAL-HEAT-002: Bar widths reflect outputs
 *   VAL-HEAT-003: Bars update on inference
 *   VAL-HEAT-004: Drag on bar sets value
 *   VAL-HEAT-005: Click opens param popup
 *   VAL-HEAT-006: Heatmap rebuilds on mode switch
 */
import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('Heatmap Strip', () => {

  // ─── VAL-HEAT-001: Bar count matches mode ───

  test('VAL-HEAT-001a: visual mode shows 20 heatmap bars', async ({ page }) => {
    await loadSolidApp(page);

    const barCount = await page.evaluate(() => {
      const cells = document.querySelectorAll('#heatmap-cells .heatmap-cell');
      return cells.length;
    });

    expect(barCount).toBe(20);
  });

  test('VAL-HEAT-001b: synth mode shows 126 heatmap bars', async ({ page }) => {
    await loadSolidApp(page);

    const barCount = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      await store.setOutputMode('synth');
      // Wait for DOM update
      await new Promise(r => setTimeout(r, 100));
      const cells = document.querySelectorAll('#heatmap-cells .heatmap-cell');
      return cells.length;
    });

    expect(barCount).toBe(126);
  });

  test('VAL-HEAT-001c: midi-cc mode shows 8 heatmap bars', async ({ page }) => {
    await loadSolidApp(page);

    const barCount = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      await store.setOutputMode('midi-cc');
      await new Promise(r => setTimeout(r, 100));
      const cells = document.querySelectorAll('#heatmap-cells .heatmap-cell');
      return cells.length;
    });

    expect(barCount).toBe(8);
  });

  test('VAL-HEAT-001d: audio-canvas mode shows 36 heatmap bars', async ({ page }) => {
    await loadSolidApp(page);

    const barCount = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      await store.setOutputMode('audio-canvas');
      await new Promise(r => setTimeout(r, 100));
      const cells = document.querySelectorAll('#heatmap-cells .heatmap-cell');
      return cells.length;
    });

    expect(barCount).toBe(36);
  });

  // ─── VAL-HEAT-002: Bar widths reflect outputs ───

  test('VAL-HEAT-002a: each heatmap bar has width proportional to output value', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      const outputs = probe.getOutputs();
      const cells = document.querySelectorAll('#heatmap-cells .heatmap-cell');

      // Check first 5 bars
      const checks: Array<{ index: number; output: number; barWidthPct: number }> = [];
      for (let i = 0; i < Math.min(5, cells.length); i++) {
        const bar = cells[i].querySelector('.heatmap-cell-bar') as HTMLElement;
        if (!bar) continue;
        const widthStr = bar.style.width;
        const barWidthPct = parseFloat(widthStr);
        checks.push({ index: i, output: outputs[i], barWidthPct });
      }
      return checks;
    });

    // Each bar width should be roughly proportional to the output value
    for (const check of result) {
      // Allow 5% tolerance (minimum bar width is 2%)
      const expectedMin = Math.max(2, Math.round(check.output * 100) - 5);
      const expectedMax = Math.round(check.output * 100) + 5;
      expect(check.barWidthPct).toBeGreaterThanOrEqual(expectedMin);
      expect(check.barWidthPct).toBeLessThanOrEqual(expectedMax);
    }
  });

  // ─── VAL-HEAT-003: Bars update on inference ───

  test('VAL-HEAT-003a: bars update when setInputs changes outputs', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;

      // Get initial bar widths
      const getBarWidths = () => {
        const cells = document.querySelectorAll('#heatmap-cells .heatmap-cell');
        return Array.from(cells).slice(0, 5).map(cell => {
          const bar = cell.querySelector('.heatmap-cell-bar') as HTMLElement;
          return bar ? parseFloat(bar.style.width) : 0;
        });
      };

      const widthsBefore = getBarWidths();

      // Change inputs to a different position
      probe.setInputs(0.9, 0.1);

      const widthsAfter = getBarWidths();

      return { widthsBefore, widthsAfter };
    });

    // At least one bar should have changed width
    let anyChanged = false;
    for (let i = 0; i < result.widthsBefore.length; i++) {
      if (Math.abs(result.widthsBefore[i] - result.widthsAfter[i]) > 0.5) {
        anyChanged = true;
        break;
      }
    }
    expect(anyChanged).toBe(true);
  });

  test('VAL-HEAT-003b: bar widths match output values after inference', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const probe = (window as any).__nisps;
      probe.setInputs(0.3, 0.7);

      const outputs = probe.getOutputs();
      const cells = document.querySelectorAll('#heatmap-cells .heatmap-cell');

      // Check a few bars
      const checks: Array<{ output: number; barWidthPct: number }> = [];
      for (let i = 0; i < Math.min(5, cells.length); i++) {
        const bar = cells[i].querySelector('.heatmap-cell-bar') as HTMLElement;
        if (!bar) continue;
        const barWidthPct = parseFloat(bar.style.width);
        checks.push({ output: outputs[i], barWidthPct });
      }
      return checks;
    });

    for (const check of result) {
      const expectedPct = Math.max(2, Math.round(check.output * 100));
      expect(Math.abs(check.barWidthPct - expectedPct)).toBeLessThanOrEqual(5);
    }
  });

  // ─── VAL-HEAT-004: Drag on bar sets value ───

  test('VAL-HEAT-004a: dragging a heatmap bar changes the output value', async ({ page }) => {
    await loadSolidApp(page);

    // Locate first heatmap cell
    const firstCell = page.locator('#heatmap-cells .heatmap-cell').first();
    await expect(firstCell).toBeVisible();

    // Use programmatic drag: set value directly via pointer events
    const result = await page.evaluate(async () => {
      const cell = document.querySelector('#heatmap-cells .heatmap-cell') as HTMLElement;
      if (!cell) return { success: false, error: 'no cell' };

      const rect = cell.getBoundingClientRect();

      // Simulate a drag from left to center of cell
      // pointerdown near left edge
      cell.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: rect.left + 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 1,
        bubbles: true,
        cancelable: true,
      }));

      // pointermove to center
      cell.dispatchEvent(new PointerEvent('pointermove', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 1,
        bubbles: true,
        cancelable: true,
      }));

      // pointerup at center
      cell.dispatchEvent(new PointerEvent('pointerup', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 1,
        bubbles: true,
        cancelable: true,
      }));

      // Wait a tick for reactive update
      await new Promise(r => setTimeout(r, 50));

      const bar = cell.querySelector('.heatmap-cell-bar') as HTMLElement;
      const barWidth = bar ? parseFloat(bar.style.width) : -1;

      return { success: true, barWidth, cellWidth: rect.width };
    });

    expect(result.success).toBe(true);
    // Should be close to 50% (within 25% tolerance for drag imprecision)
    expect(result.barWidth).toBeGreaterThan(25);
    expect(result.barWidth).toBeLessThan(75);
  });

  // ─── VAL-HEAT-005: Click opens param popup ───

  test('VAL-HEAT-005a: clicking a heatmap cell opens param popup', async ({ page }) => {
    await loadSolidApp(page);

    // Click the first heatmap cell (short click, not drag)
    const firstCell = page.locator('#heatmap-cells .heatmap-cell').first();
    await expect(firstCell).toBeVisible();

    const box = await firstCell.boundingBox();
    expect(box).not.toBeNull();

    // Short click in center of cell
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    // Check that param popup is visible
    const popup = page.locator('#param-popup');
    await expect(popup).toBeVisible({ timeout: 3000 });
  });

  // ─── VAL-HEAT-006: Heatmap rebuilds on mode switch ───

  test('VAL-HEAT-006a: heatmap rebuilds with correct count after mode switch', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(async () => {
      const store = (window as any).__nispsStore;

      // Check visual mode (20 bars)
      const visualCells = document.querySelectorAll('#heatmap-cells .heatmap-cell').length;

      // Switch to synth
      await store.setOutputMode('synth');
      await new Promise(r => setTimeout(r, 100));
      const synthCells = document.querySelectorAll('#heatmap-cells .heatmap-cell').length;

      // Switch back to visual
      await store.setOutputMode('visual');
      await new Promise(r => setTimeout(r, 100));
      const visualCellsAgain = document.querySelectorAll('#heatmap-cells .heatmap-cell').length;

      return { visualCells, synthCells, visualCellsAgain };
    });

    expect(result.visualCells).toBe(20);
    expect(result.synthCells).toBe(126);
    expect(result.visualCellsAgain).toBe(20);
  });

  test('VAL-HEAT-006b: heatmap bars show correct colors after rebuild', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const cells = document.querySelectorAll('#heatmap-cells .heatmap-cell');
      // Visual mode bars should have colored backgrounds
      const firstBar = cells[0]?.querySelector('.heatmap-cell-bar') as HTMLElement;
      return {
        hasBar: !!firstBar,
        hasBackground: firstBar ? firstBar.style.background !== '' : false,
        barCount: cells.length,
      };
    });

    expect(result.hasBar).toBe(true);
    expect(result.hasBackground).toBe(true);
    expect(result.barCount).toBe(20);
  });

  test('VAL-HEAT-006c: tooltip shows on hover over heatmap cell', async ({ page }) => {
    await loadSolidApp(page);

    const firstCell = page.locator('#heatmap-cells .heatmap-cell').first();
    await expect(firstCell).toBeVisible();

    // Hover over first cell
    await firstCell.hover();

    // Tooltip should become visible
    const tooltip = page.locator('#heatmap-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 3000 });

    // Tooltip should contain parameter name and value
    const text = await tooltip.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(3);
  });
});
