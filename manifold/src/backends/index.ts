/**
 * Output backends barrel (backends-spec). Real MIDI / OSC transports + the
 * BackendManager that consumes the engine spine and forwards routed outputs to
 * the active backend. Framework-neutral core + a thin React hook.
 */
export type {
  OutputBackend,
  BackendContext,
  BackendStatus,
  OutputMapping,
} from './backend';
export { applyCurve, mapOutput, isSilent, clamp01 } from './mapping';
export { BackendManager } from './manager';
export type { ManagerEngine } from './manager';
export { WebMidiBackend } from './midi-backend';
export type { MidiBackendConfig } from './midi-backend';
export { OscBridgeBackend } from './osc-backend';
export type { OscBackendConfig } from './osc-backend';
export { NispsOscClient } from './osc-client';
export { PassthroughBackend } from './passthrough-backend';
export { ParticleBackend } from './particle-backend';
export {
  useBackendManager,
} from './useBackendManager';
export type {
  UseBackendManager,
  MidiSettings,
  OscSettings,
} from './useBackendManager';
export {
  listPresets,
  savePreset,
  getPreset,
  deletePreset,
  renamePreset,
  applyPreset,
  rowsFromParams,
} from './presets';
export type { OutputPreset, OutputPresetRow } from './presets';
