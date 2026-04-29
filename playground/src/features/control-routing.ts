/**
 * Compound-axis → store routing.
 *
 * Converts the resolved parameter map from `controlStore.resolveParams()`
 * into concrete writes against:
 *   - `inputStore` (zoom, deadzone, inputCurve, smoothing, momentumZoom)
 *   - `outputStore` (slewRate)
 *   - `explorationStore` (noiseCap, noiseGrowth, noiseDecay, learningRate, weightDecay)
 *
 * Called as a Solid `createEffect` from the mode runtime; whenever any axis
 * changes, this re-applies. Per-store setters internally clamp the values.
 *
 * Note: `inputCurve` and `slewRate` from the Precision axis intentionally
 * use the centered_power exponent and slew-rate-per-frame contracts; the
 * resolver mirrors the legacy table values.
 */

import { controlStore } from '../stores/control-store';
import { inputStore } from '../stores/input-store';
import { outputStore } from '../stores/output-store';
import { explorationStore } from '../stores/exploration-store';
import type { MomentumZoomMode } from '../input/pipeline';

let lastApplied = '';

/**
 * Apply the resolved compound-axis params. Returns true if any store was
 * modified.
 */
export function applyControlRouting(): boolean {
  const params = controlStore.resolveParams();
  // Coalesce: only re-apply if any value changed.
  const sig = JSON.stringify({
    z: params['zoom'],
    nc: params['noiseCap'],
    ng: params['noiseGrowth'],
    nd: params['noiseDecay'],
    lr: params['learningRate'],
    wd: params['weightDecay'],
    ic: params['inputCurve'],
    dz: params['deadzone'],
    sm: params['smoothing'],
    sr: params['slewRate'],
    mz: params['momentumZoom'],
  });
  if (sig === lastApplied) return false;
  lastApplied = sig;

  const num = (k: string): number | undefined =>
    typeof params[k] === 'number' ? (params[k] as number) : undefined;

  // Input pipeline
  const z = num('zoom');
  if (z !== undefined) inputStore.setZoom(z);
  const dz = num('deadzone');
  if (dz !== undefined) inputStore.setDeadzone(dz);
  const ic = num('inputCurve');
  if (ic !== undefined) inputStore.setInputCurve(ic);
  const ism = num('smoothing');
  if (ism !== undefined) inputStore.setSmoothing(ism);
  const mz = params['momentumZoom'];
  if (typeof mz === 'string') {
    const valid: MomentumZoomMode[] = ['off', 'gentle', 'strong'];
    if (valid.includes(mz as MomentumZoomMode)) {
      inputStore.setMomentumZoom(mz as MomentumZoomMode);
    }
  }

  // Output pipeline
  const sr = num('slewRate');
  if (sr !== undefined) outputStore.setSlewRate(sr);

  // Exploration / RL
  explorationStore.applyCompoundParams(params);

  return true;
}
