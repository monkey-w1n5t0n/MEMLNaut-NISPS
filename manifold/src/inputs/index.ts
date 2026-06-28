/**
 * Modular INPUT layer (workstream F) — public surface.
 *
 * The user picks the input SOURCE(s) feeding the ML head (XY pad / MIDI /
 * gamepad, or a combination); the InputLayer composes their axes into one
 * N-dim vector at the head of the reactive spine. See input-layer.ts for the
 * arity-reduction + the documented multi-WASM reshape TODO.
 */
export type {
  InputSource,
  InputSourceKind,
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
