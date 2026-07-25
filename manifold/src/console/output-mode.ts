/**
 * output-mode.ts — the TOP dock selector catalogue (operator dock restructure).
 *
 * "Mode" here = the active OUTPUT BACKEND/target. Six options, in order, the
 * first the default:
 *   • Particle System (visual)  — DEFAULT
 *   • MIDI
 *   • OSC
 *   • CV / uSEQ                  — uSEQ CV/gate over USB Web Serial (cvgate backend)
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
    id: 'cv',
    label: 'CV / uSEQ',
    description: 'uSEQ CV/gate over USB serial — 11 CV + 3 gate.',
    audio: false,
    backend: 'cvgate',
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

/**
 * Number of output controls the active backend presents.
 *
 * The model may expose more parameters than a backend currently maps (MIDI is
 * the live example: its CC count is adjustable). Keep that presentation
 * boundary separate from the model arity so changing a backend count does not
 * silently reshape the net and clear its examples.
 */
export function outputDisplayCount(
  id: OutputMode,
  availableCount: number,
  configuredCounts: Partial<Record<OutputMode, number>> = {},
): number {
  const available = Math.max(0, Math.floor(availableCount));
  const configured = configuredCounts[id];
  if (configured === undefined || !Number.isFinite(configured)) return available;
  return Math.max(0, Math.min(available, Math.floor(configured)));
}
