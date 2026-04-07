// Re-exports for clean imports:
//   import { SYNTH_PARAM_MAP, SynthEngine, SYNTH_PRESETS, ... } from '@/core/synth';

export type { SynthParamDescriptor, SynthSection } from './param-map';
export {
  SYNTH_PARAM_MAP,
  SYNTH_PARAM_NAMES,
  SYNTH_PARAM_COLORS,
  SYNTH_SECTIONS,
  paramToSection,
  applyTame,
  applyCurve,
  applyGroupOverride,
} from './param-map';

export type { ParamOverride, SynthPreset, PresetTier } from './presets';
export { SYNTH_PRESETS, PRESET_TIERS } from './presets';

export type { ParamMeta } from './engine-interface';
export { SynthEngine } from './engine-interface';
