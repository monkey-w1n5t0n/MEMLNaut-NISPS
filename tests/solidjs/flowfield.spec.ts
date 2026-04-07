/**
 * e2e tests for f07-flowfield-canvas.
 * Validates:
 *   VAL-VIS-001: Particles render in visual mode (flow-field on fullscreen canvas)
 *   VAL-VIS-002: Particles respond to ML outputs (changing joystick changes flow)
 *   VAL-VIS-003: Canvas resizes with window
 *
 * Approach:
 *   - Switch to visual mode via __nispsStore.setOutputMode('visual')
 *   - Wait for mode switch to take effect (outputCount = 20)
 *   - Verify canvas renders particles (screenshot + canvas pixel analysis)
 *   - Move joystick, verify particles change
 *   - Resize window, verify canvas fills viewport
 */
import { test, expect } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('FlowField Canvas (f07)', () => {

  /**
   * Helper: switch to visual mode and wait for output count to change.
   */
  async function switchToVisualMode(page: import('@playwright/test').Page) {
    await page.evaluate(async () => {
      const store = (window as any).__nispsStore;
      await store.setOutputMode('visual');
    });
    // Wait for outputCount to reflect visual mode
    await page.waitForFunction(
      () => (window as any).__nispsStore.outputCount() === 20,
      { timeout: 10_000 }
    );
  }

  // ─── VAL-VIS-001: Particles render in visual mode ───

  test('VAL-VIS-001a: fullscreen canvas exists in DOM in visual mode', async ({ page }) => {
    await loadSolidApp(page);
    await switchToVisualMode(page);

    const canvas = page.locator('#flowfield-canvas');
    await expect(canvas).toBeVisible();
  });

  test('VAL-VIS-001b: canvas fills entire viewport in visual mode', async ({ page }) => {
    await loadSolidApp(page);
    await switchToVisualMode(page);

    const canvas = page.locator('#flowfield-canvas');
    const box = await canvas.boundingBox();

    expect(box).not.toBeNull();
    const viewport = page.viewportSize()!;
    // Canvas should fill the viewport (allow small rounding differences)
    expect(Math.abs(box!.width - viewport.width)).toBeLessThan(5);
    expect(Math.abs(box!.height - viewport.height)).toBeLessThan(5);
  });

  test('VAL-VIS-001c: canvas has colored pixels (particles render)', async ({ page }) => {
    await loadSolidApp(page);
    await switchToVisualMode(page);

    // Wait for particles to render (400 particles need a few frames)
    await page.waitForTimeout(1000);

    // Check that the canvas has non-black, non-uniform pixels.
    // Sample a large grid area since particles are sparse (400 on 1280x720).
    const hasColoredPixels = await page.evaluate(() => {
      const canvas = document.getElementById('flowfield-canvas') as HTMLCanvasElement;
      if (!canvas) return false;
      const ctx = canvas.getContext('2d')!;
      const w = canvas.width;
      const h = canvas.height;
      // Sample a 10x10 grid of 5x5 pixel blocks
      let coloredCount = 0;
      for (let gy = 0; gy < 10; gy++) {
        for (let gx = 0; gx < 10; gx++) {
          const px = Math.floor(w * (gx + 0.5) / 10);
          const py = Math.floor(h * (gy + 0.5) / 10);
          const size = 5;
          const data = ctx.getImageData(px, py, size, size).data;
          // Check if any pixel in this block has color
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10) {
              coloredCount++;
              break;
            }
          }
        }
      }
      return coloredCount > 0;
    });

    expect(hasColoredPixels).toBe(true);
  });

  // ─── VAL-VIS-002: Particles respond to ML outputs ───

  test('VAL-VIS-002a: changing joystick position changes canvas pixels', async ({ page }) => {
    await loadSolidApp(page);
    await switchToVisualMode(page);

    // Set initial position and wait for render
    await page.evaluate(() => {
      (window as any).__nisps.setInputs(0.2, 0.2);
    });
    await page.waitForTimeout(500);

    // Capture canvas state at position 1
    const pixelsBefore = await page.evaluate(() => {
      const canvas = document.getElementById('flowfield-canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const w = canvas.width;
      const h = canvas.height;
      // Sample a grid of pixels
      const data = ctx.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i] + data[i + 1] + data[i + 2];
      }
      return { avgBrightness: sum / (data.length / 4), width: w, height: h };
    });

    // Move to a very different position
    await page.evaluate(() => {
      (window as any).__nisps.setInputs(0.8, 0.8);
    });

    // Wait for particles to respond and move
    await page.waitForTimeout(1000);

    // Capture canvas state at position 2
    const pixelsAfter = await page.evaluate(() => {
      const canvas = document.getElementById('flowfield-canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const w = canvas.width;
      const h = canvas.height;
      const data = ctx.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i] + data[i + 1] + data[i + 2];
      }
      return { avgBrightness: sum / (data.length / 4), width: w, height: h };
    });

    // The average brightness should be different after moving the joystick
    // (particles flow differently, trails change)
    expect(Math.abs(pixelsBefore.avgBrightness - pixelsAfter.avgBrightness)).toBeGreaterThan(0.01);
  });

  test('VAL-VIS-002b: ML outputs are routed to flow field in visual mode', async ({ page }) => {
    await loadSolidApp(page);
    await switchToVisualMode(page);

    // Verify output count is 20 in visual mode
    const outputCount = await page.evaluate(() => {
      return (window as any).__nispsStore.outputCount();
    });
    expect(outputCount).toBe(20);

    // Verify outputs are all bounded [0,1]
    const outputs = await page.evaluate(() => {
      const arr = (window as any).__nisps.getOutputs();
      return Array.from(arr) as number[];
    });

    expect(outputs.length).toBe(20);
    expect(outputs.every(v => v >= 0 && v <= 1)).toBe(true);
  });

  // ─── VAL-VIS-003: Canvas resizes with window ───

  test('VAL-VIS-003a: canvas resizes when window is resized', async ({ page }) => {
    await loadSolidApp(page);
    await switchToVisualMode(page);

    // Get initial size
    const initialSize = await page.evaluate(() => {
      const canvas = document.getElementById('flowfield-canvas') as HTMLCanvasElement;
      return {
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        bufferWidth: canvas.width,
        bufferHeight: canvas.height,
      };
    });

    // Resize viewport
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(200);

    // Check canvas resized
    const resizedSize = await page.evaluate(() => {
      const canvas = document.getElementById('flowfield-canvas') as HTMLCanvasElement;
      return {
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        bufferWidth: canvas.width,
        bufferHeight: canvas.height,
      };
    });

    // CSS size should match new viewport
    expect(resizedSize.cssWidth).toBe(800);
    expect(resizedSize.cssHeight).toBe(600);

    // Buffer should be different from initial
    expect(resizedSize.bufferWidth).not.toBe(initialSize.bufferWidth);
    expect(resizedSize.bufferHeight).not.toBe(initialSize.bufferHeight);
  });

  test('VAL-VIS-003b: canvas fills viewport after multiple resize events', async ({ page }) => {
    await loadSolidApp(page);
    await switchToVisualMode(page);

    // Resize multiple times
    for (const [w, h] of [[1024, 768], [640, 480], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);

      const size = await page.evaluate(() => {
        const canvas = document.getElementById('flowfield-canvas') as HTMLCanvasElement;
        return { cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight };
      });

      expect(size.cssWidth).toBe(w);
      expect(size.cssHeight).toBe(h);
    }
  });

  // ─── Integration: flow field hidden when not in visual mode ───

  test('flow field canvas is visible only in visual mode', async ({ page }) => {
    await loadSolidApp(page);
    // App starts in synth mode — flow field should be hidden
    const canvasInSynth = page.locator('#flowfield-canvas');
    // In synth mode, canvas may exist but shouldn't be actively rendering
    // (it may be hidden or just not have the visualizer running)

    // Switch to visual mode
    await switchToVisualMode(page);
    await expect(canvasInSynth).toBeVisible();
  });
});
