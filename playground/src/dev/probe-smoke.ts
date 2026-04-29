/**
 * Tiny smoke check that exercises the debug probe API. Run from the dev
 * console after the page loads:
 *
 *   import('./dev/probe-smoke.ts').then((m) => m.smokeCheck());
 *
 * Returns a list of pass/fail results. Useful for manual verification when
 * Playwright isn't available.
 *
 * This file is NOT bundled by default — Vite only includes referenced
 * modules and `dev/probe-smoke.ts` is opt-in.
 */

export interface SmokeResult {
  name: string;
  ok: boolean;
  detail?: string;
}

export async function smokeCheck(): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const probe = (window as unknown as { __nisps?: any }).__nisps;
  if (!probe) {
    results.push({ name: 'probe installed', ok: false, detail: 'window.__nisps missing' });
    return results;
  }
  results.push({ name: 'probe installed', ok: true });

  try {
    await probe.__init();
    results.push({ name: '__init', ok: true });
  } catch (err) {
    results.push({ name: '__init', ok: false, detail: String(err) });
  }

  try {
    probe.setInputs(0.5, 0.5);
    const outs = probe.getOutputs();
    results.push({
      name: 'setInputs(0.5, 0.5)',
      ok: outs.length > 0,
      detail: `outputs.length = ${outs.length}`,
    });
  } catch (err) {
    results.push({ name: 'setInputs', ok: false, detail: String(err) });
  }

  try {
    probe.thumbsUp();
    results.push({ name: 'thumbsUp', ok: true });
  } catch (err) {
    results.push({ name: 'thumbsUp', ok: false, detail: String(err) });
  }

  try {
    probe.thumbsDown();
    results.push({ name: 'thumbsDown', ok: true });
  } catch (err) {
    results.push({ name: 'thumbsDown', ok: false, detail: String(err) });
  }

  try {
    const before = probe.getWeights();
    probe.pushSnapshot('smoke');
    probe.randomise();
    probe.popSnapshot();
    const after = probe.getWeights();
    const restored = before.length > 0 && after.length === before.length;
    results.push({ name: 'snapshot push/pop', ok: restored });
  } catch (err) {
    results.push({ name: 'snapshot push/pop', ok: false, detail: String(err) });
  }

  try {
    probe.setAxis('boldness', 0.7);
    probe.setAxis('memory', 0.3);
    probe.setAxis('precision', 0.5);
    results.push({ name: 'compound axes', ok: true });
  } catch (err) {
    results.push({ name: 'compound axes', ok: false, detail: String(err) });
  }

  try {
    const ok = probe.refreshHeatmap(true);
    const cells = probe.getHeatmapCells();
    results.push({
      name: 'heatmap',
      ok: cells.length > 0,
      detail: `took=${ok} cells=${cells.length}`,
    });
  } catch (err) {
    results.push({ name: 'heatmap', ok: false, detail: String(err) });
  }

  try {
    const hist = probe.getWeightHistogram();
    const status = probe.getWeightStatus();
    results.push({
      name: 'weight health',
      ok: hist.length === 10,
      detail: `status=${status} bins=${hist.length}`,
    });
  } catch (err) {
    results.push({ name: 'weight health', ok: false, detail: String(err) });
  }

  try {
    const url = probe.buildShareUrl();
    const ok = typeof url === 'string' && url.startsWith('?session=');
    results.push({ name: 'buildShareUrl', ok, detail: url.slice(0, 60) });
  } catch (err) {
    results.push({ name: 'buildShareUrl', ok: false, detail: String(err) });
  }

  return results;
}

if (typeof window !== 'undefined') {
  (window as unknown as { smokeCheck?: typeof smokeCheck }).smokeCheck = smokeCheck;
}
