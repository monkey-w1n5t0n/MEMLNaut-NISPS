import { expect, test } from '@playwright/test';
import { loadProbe } from './helpers';
import type { MfDebugHook } from '../../src/console/ConsoleApp';

declare global {
  interface Window {
    __mf?: MfDebugHook;
  }
}

test('output cards add/delete in both drawer depths and capacity mode avoids reconstruction', async ({ page }) => {
  await loadProbe(page);

  // Drive the real UI path: output target → Outputs drawer → expanded MIDI
  // config. This deliberately does not use the debug setters; the regression
  // covers the same interaction an operator performs.
  await page.getByTitle(/^Mode:/).click();
  await page.getByRole('button', { name: 'MIDI', exact: true }).click();
  await page.getByTitle('Outputs').click();
  await page.getByTitle('Expand').click();

  // MIDI starts with eight output cards. Delete six real cards instead of
  // editing a detached numeric count.
  await expect(page.getByText('8 outputs', { exact: true })).toBeVisible();
  for (let i = 0; i < 6; ++i) {
    await page.getByRole('button', { name: /^Delete .* output$/ }).last().click();
  }
  await expect(page.getByText('2 outputs', { exact: true })).toBeVisible();
  // Default "Keep capacity" policy edits semantic mappings in place.
  expect(await page.evaluate(() => window.__nisps!.getOutputs().length)).toBe(33);

  // The count remains visible in condensed chrome after leaving the advanced
  // config. Adding in condensed depth updates that same card set.
  await page.getByTitle('Condense').click();
  await expect(page.getByText('2 outputs', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '+ output', exact: true }).click();
  await expect(page.getByText('3 outputs', { exact: true })).toBeVisible();
  await page.getByTitle('Close').click();
  await expect(page.getByTestId('output-stage')).toHaveAttribute('data-output-count', '3');

  // Backends without a configured count present the full mode output set.
  const fullCount = await page.evaluate(() => window.__mf!.paramCount());
  await page.getByTitle(/^Mode:/).click();
  await page.getByRole('button', { name: 'OSC', exact: true }).click();
  await expect(page.getByTestId('output-stage')).toHaveAttribute('data-output-count', String(fullCount));
});

test('exact I/O persists and adapts examples across a deleted output identity', async ({ page }) => {
  await loadProbe(page);

  await page.getByTitle('Settings').click();
  await page.getByRole('radio', { name: 'Exact I/O' }).click();
  await page.getByTitle('Close').click();

  await page.getByTitle(/^Mode:/).click();
  await page.getByRole('button', { name: 'MIDI', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__nisps!.getOutputs().length)).toBe(8);

  const added = await page.evaluate(() => {
    const probe = window.__nisps!;
    probe.setFeedbackMode('explore_and_place');
    return probe.addExample([0.1, 0.2, 0.3, 0.4], Array.from(probe.getOutputs()));
  });
  expect(added).toBe(true);
  expect(await page.evaluate(() => window.__nisps!.getExampleCount())).toBe(1);

  await page.getByTitle('Outputs').click();
  await page.getByRole('button', { name: /^Delete .* output$/ }).first().click();
  await expect.poll(() => page.evaluate(() => window.__nisps!.getOutputs().length)).toBe(7);
  expect(await page.evaluate(() => window.__nisps!.getExampleCount())).toBe(1);
  expect(await page.evaluate(() => window.__nisps!.getFeedbackMode())).toBe('explore_and_place');

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('mf-settings') ?? '{}'));
  expect(persisted.networkResizePolicy).toBe('exact');
  expect(persisted.exampleResizePolicy).toBe('adapt');
  expect(persisted.addedOutputExampleValue).toBe(0.5);
});
