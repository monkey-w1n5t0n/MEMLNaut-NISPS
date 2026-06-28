/**
 * Modular INPUT layer (workstream F) — public surface.
 *
 * The user picks ONE exclusive input MODE feeding the ML head (Internal XY pad /
 * Game Controller / MIDI); the InputLayer composes the active source's axes into
 * one N-dim vector at the head of the reactive spine. See input-layer.ts for the
 * arity-reduction + the documented multi-WASM reshape TODO.
 */
export type {
  InputSource,
  InputSourceKind,
  InputMode,
  InputSourceState,
  InputSourceStatus,
  InputAction,
} from './types';
export { InputLayer } from './input-layer';
export type { InputEngineSink } from './input-layer';
export { XYPadSource } from './xy-pad-source';
export { WebMidiInputSource } from './midi-input-source';
export type { MidiBinding, MidiBindingKind } from './midi-input-source';
export { GamepadSource } from './gamepad-source';
export type { StickMode } from './gamepad-source';
export { useInputLayer } from './useInputLayer';
export type { UseInputLayer, SourceView } from './useInputLayer';
