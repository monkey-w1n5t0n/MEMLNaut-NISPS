/**
 * Helpers shared across mode TSX files. Pure functions; no Solid state.
 */

import type { Param } from './generated/types';
import type { SliderConfig } from '../primitives/SliderBank';
import type { CurveName } from '../output/curves';

/**
 * Convert a schema param list into SliderConfig entries that the SliderBank
 * primitive understands. Sliders are grouped by the schema's `group` field
 * so the bank renders collapsible sections.
 */
export function paramsToSliderConfig(params: ReadonlyArray<Param>): SliderConfig[] {
  let lastGroup: string | null = null;
  return params.map((p) => {
    const isNewGroup = p.group !== lastGroup;
    lastGroup = p.group;
    const cfg: SliderConfig = {
      id: p.name,
      label: p.label,
      min: p.min,
      max: p.max,
      curve: p.curve as CurveName,
    };
    if (isNewGroup) cfg.section = formatGroupName(p.group);
    return cfg;
  });
}

/**
 * Map a Float32Array (length = N) of normalized values [0,1] to a flat
 * array sized to match the slider config (already in min/max range).
 */
export function outputsToSliderValues(
  outputs: Float32Array,
  params: ReadonlyArray<Param>,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < params.length; ++i) {
    const v = outputs[i] ?? 0;
    const p = params[i]!;
    out.push(p.min + v * (p.max - p.min));
  }
  return out;
}

function formatGroupName(group: string): string {
  if (!group) return '';
  return group
    .split(/[_\s]+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
