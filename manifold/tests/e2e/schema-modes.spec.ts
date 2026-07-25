/**
 * Schema-driven per-mode dims — the one-core-engine P5 gate.
 *
 * The generated mode schemas (`src/modes/generated/`) are the SOURCE OF TRUTH:
 * `MF_MODES` derives its params from them (P5.2) and the engine reshapes to each
 * mode's `ml` config on switch (P5.3). This spec imports the schemas DIRECTLY
 * and, for a representative set of modes, drives a mode switch through the UI
 * debug seam (`window.__mf`), then asserts against the schema — never hard-coded
 * numbers — that:
 *
 *   - `describe()` reports the schema's hidden/output dims and Manifold's
 *     default 2-input working shape;
 *   - `getWeights().length` equals the schema-implied weight count;
 *   - post-ML outputs have length == output_size and stay bounded in [0,1];
 *   - the rendered UI param count equals `schema.params.length`;
 *   - training still works after a mode switch (per-mode dims flow through the
 *     async training worker — one-core-engine P2.2/P2.3 buffer sizing).
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loadProbe, getOutputs, allWithin, weightCountFromMl } from './helpers';
import type { MfDebugHook } from '../../src/console/ConsoleApp';
import type { ModeSchema } from '../../src/modes/generated/types';
import {
  PafSynthSchema,
  ChannelStripSchema,
  MemlceliumSchema,
  XiasriSchema,
} from '../../src/modes/generated';

declare global {
  interface Window {
    __mf?: MfDebugHook;
  }
}

// Representative modes: an xy synth (33 out), a joystick synth (24 out), a
// sequencer (56 out), and a browser-viable NEW mode (xiasri, 24 out) that never
// had a hand-written catalogue entry.
const CASES: ReadonlyArray<ModeSchema> = [
  PafSynthSchema,
  ChannelStripSchema,
  MemlceliumSchema,
  XiasriSchema,
];

/**
 * Switch the instrument mode via the debug seam and wait until the switch has
 * fully landed: the modeId, the rendered param count, and the reshaped net dims
 * must all reflect the target schema before we assert.
 */
async function switchToMode(page: Page, schema: ModeSchema): Promise<void> {
  const expectedInput = schema.ui.primary_input === 'audio_in' ? schema.ml.input_size : 2;
  await page.evaluate((id) => window.__mf!.setMode(id), schema.mode_id);
  await page.waitForFunction(
    (s) =>
      window.__mf?.getModeId() === s.id &&
      window.__mf?.paramCount() === s.params &&
      window.__nisps?.describe().outputSize === s.out &&
      window.__nisps?.describe().inputSize === s.in,
    { id: schema.mode_id, params: schema.params.length, out: schema.ml.output_size, in: expectedInput },
    { timeout: 10_000 },
  );
}

test.beforeEach(async ({ page }) => {
  await loadProbe(page);
});

test.describe('schema-driven per-mode dims (P5 gate)', () => {
  test('the debug seam exposes every catalogue mode id', async ({ page }) => {
    const ids = await page.evaluate(() => window.__mf!.modeIds());
    for (const schema of CASES) expect(ids).toContain(schema.mode_id);
  });

  for (const schema of CASES) {
    test(`${schema.mode_id}: engine + UI match the schema`, async ({ page }) => {
      await switchToMode(page, schema);

      // describe() reports schema hidden/output dims and the UI's effective
      // input arity (2 for normal modes, schema-fixed for audio analysis).
      const arch = await page.evaluate(() => window.__nisps!.describe());
      expect(arch.inputSize).toBe(schema.ui.primary_input === 'audio_in' ? schema.ml.input_size : 2);
      expect(arch.outputSize).toBe(schema.ml.output_size);
      expect(arch.hidden).toEqual([...schema.ml.hidden_layers]);

      // getWeights length equals the schema-implied weight count.
      const weights = await page.evaluate(() => window.__nisps!.getWeights().length);
      expect(weights).toBe(
        weightCountFromMl({
          ...schema.ml,
          input_size: schema.ui.primary_input === 'audio_in' ? schema.ml.input_size : 2,
        }),
      );

      // Outputs have length == output_size and stay bounded.
      await page.evaluate(() => window.__nisps!.setInputs(0.35, 0.65));
      const outs = await getOutputs(page);
      expect(outs).toHaveLength(schema.ml.output_size);
      expect(allWithin(outs, 0, 1)).toBe(true);

      // The rendered UI param count equals schema.params.length.
      const paramCount = await page.evaluate(() => window.__mf!.paramCount());
      expect(paramCount).toBe(schema.params.length);
    });
  }

  test('normal modes can opt into four model inputs from the Inputs dock seam', async ({ page }) => {
    await switchToMode(page, PafSynthSchema);
    await page.getByTitle('Inputs').click();
    await expect(page.getByTestId('model-input-size')).toBeVisible();
    await page.getByTestId('model-input-size').getByRole('button', { name: '4 inputs' }).click();
    await page.waitForFunction(() => window.__nisps?.describe().inputSize === 4);
    expect(await page.evaluate(() => window.__mf!.getModelInputSize())).toBe(4);

    await page.evaluate(() => window.__mf!.setModelInputSize(2));
    await page.waitForFunction(() => window.__nisps?.describe().inputSize === 2);
  });

  test('training works after a mode switch (per-mode dims flow to the worker)', async ({ page }) => {
    // Switch to a mode with distinct dims from the boot mode, then add a couple
    // of contrasting examples at the mode's output arity and train. A finite,
    // non-negative loss proves the async worker re-created its mirror net at the
    // reshaped dims (buffer sizing did not assume a fixed 126).
    await switchToMode(page, MemlceliumSchema);
    const outSize = MemlceliumSchema.ml.output_size;
    const loss = await page.evaluate(async (n) => {
      const p = window.__nisps!;
      p.addExample([0.1, 0.9], new Array(n).fill(0.1));
      p.addExample([0.9, 0.1], new Array(n).fill(0.9));
      return p.trainAsync();
    }, outSize);
    expect(typeof loss).toBe('number');
    expect(Number.isFinite(loss)).toBe(true);
    expect(loss).toBeGreaterThanOrEqual(0);
  });
});
