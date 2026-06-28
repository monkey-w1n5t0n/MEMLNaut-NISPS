/**
 * output-mode.ts — the TOP dock selector catalogue (operator dock restructure).
 *
 * "Mode" here = the active OUTPUT BACKEND/target. Five options, in order, the
 * first the default:
 *   • Particle System (visual)  — DEFAULT
 *   • MIDI
 *   • OSC
 *   • Built-in Synth             — the synth backend; NEVER the string "C15"
 *   • MEMLNaut Editor            — hardware-connection mode (Web Serial)
 *
 * Selecting a Mode sets the active backend: where audio applies it maps to the
 * dock's BackendId (output-state.ts) and, for the synth, engine.audio.setBackend;
 * Particle + Editor are non-audio.
 *
 * British spelling in copy.
 */
import type { OutputMode } from './types';
import type { BackendId } from '../dock/output-state';
import type {
  ParticleIcon,
  MidiIcon,
  OscIcon,
  SynthIcon,
  EditorIcon,
} from './icons';

export interface OutputModeDescriptor {
  id: OutputMode;
  label: string;
  description: string;
  /** True when this mode drives the audio engine (synth). */
  audio: boolean;
  /** The dock BackendId this mode selects (drives the Outputs per-output rows). */
  backend: BackendId;
}

/** The five Modes, in operator order; index 0 is the default. */
export const OUTPUT_MODES: readonly OutputModeDescriptor[] = [
  {
    id: 'particles',
    label: 'Particle System',
    description: 'Flow-field visualiser driven by the model outputs (no audio).',
    audio: false,
    backend: 'particles',
  },
  {
    id: 'midi',
    label: 'MIDI',
    description: 'Web MIDI CC out — per-output CC#/channel.',
    audio: false,
    backend: 'midi',
  },
  {
    id: 'osc',
    label: 'OSC',
    description: 'OSC bridge — named paths + physical ranges.',
    audio: false,
    backend: 'osc',
  },
  {
    id: 'synth',
    label: 'Built-in Synth',
    description: 'Firmware-parity built-in audio engine.',
    audio: true,
    backend: 'synth',
  },
  {
    id: 'editor',
    label: 'MEMLNaut Editor',
    description: 'Connect to the MEMLNaut hardware over USB serial (configure / save / restore).',
    audio: false,
    backend: 'synth',
  },
] as const;

export const DEFAULT_OUTPUT_MODE: OutputMode = OUTPUT_MODES[0].id;

export function outputModeDescriptor(id: OutputMode): OutputModeDescriptor {
  return OUTPUT_MODES.find((m) => m.id === id) ?? OUTPUT_MODES[0];
}

/** The monochrome icon component for a Mode (resolved by the dock). */
export type ModeIconComponent =
  | typeof ParticleIcon
  | typeof MidiIcon
  | typeof OscIcon
  | typeof SynthIcon
  | typeof EditorIcon;
