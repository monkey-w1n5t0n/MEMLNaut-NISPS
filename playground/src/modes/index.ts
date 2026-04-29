/**
 * Mode registry — maps mode_id (and the special "c15" placeholder) to the
 * TSX component that renders it. The ModeSwitcher reads from this list to
 * populate its dropdown, and `App.tsx` looks up the active mode here.
 *
 * Order matters — the switcher renders modes in this order.
 */

import type { Component } from 'solid-js';
import { PAFSynthMode } from './PAFSynthMode';
import { ChannelStripMode } from './ChannelStripMode';
import { XIASRIMode } from './XIASRIMode';
import { VerbFXMode } from './VerbFXMode';
import { MEMLCeliumMode } from './MEMLCeliumMode';
import { BreakOrMode } from './BreakOrMode';
import { ElysiamorfMode } from './ElysiamorfMode';
import { SoundAnalysisMIDIMode } from './SoundAnalysisMIDIMode';
import { C15Mode } from './C15Mode';

export interface ModeRegistration {
  /** Stable id; matches the schema's `mode_id` for firmware modes. */
  id: string;
  /** Human-readable label for the switcher. */
  label: string;
  /** Short description for the switcher tooltip. */
  description: string;
  /** TSX component rendering the mode. */
  Component: Component;
  /** True for browser-only placeholders (currently just C15). */
  placeholder?: boolean;
}

export const MODE_REGISTRY: ReadonlyArray<ModeRegistration> = [
  {
    id: 'paf_synth',
    label: 'PAF Synth',
    description: 'Phase-aligned formant synth (XY pad).',
    Component: PAFSynthMode,
  },
  {
    id: 'channel_strip',
    label: 'Channel Strip',
    description: 'EQ + dynamics processing channel.',
    Component: ChannelStripMode,
  },
  {
    id: 'xiasri',
    label: 'XIASRI',
    description: 'Audio-reactive verb / pitch engine.',
    Component: XIASRIMode,
  },
  {
    id: 'verb_fx',
    label: 'Verb FX',
    description: 'Reverb / multi-effects unit.',
    Component: VerbFXMode,
  },
  {
    id: 'memlcelium',
    label: 'MEML Celium',
    description: 'Voice + dual-MLP CV/gate via uSEQ.',
    Component: MEMLCeliumMode,
  },
  {
    id: 'breakor',
    label: 'Breakor',
    description: 'Drum / breakbeat synthesis.',
    Component: BreakOrMode,
  },
  {
    id: 'elysiamorf',
    label: 'Elysiamorf',
    description: 'Granular morphing synth.',
    Component: ElysiamorfMode,
  },
  {
    id: 'sound_analysis_midi',
    label: 'Sound Analysis → MIDI',
    description: 'Audio features → MIDI CC routing.',
    Component: SoundAnalysisMIDIMode,
  },
  {
    id: 'c15',
    label: 'C15 (browser-only)',
    description: 'C15 WASM synth. Not yet ported.',
    Component: C15Mode,
    placeholder: true,
  },
];

/** Look up a mode by id, falling back to the first registration. */
export function getModeById(id: string | null): ModeRegistration {
  if (!id) return MODE_REGISTRY[0]!;
  return MODE_REGISTRY.find((m) => m.id === id) ?? MODE_REGISTRY[0]!;
}

export { ModeShell } from './ModeShell';
export { useModeRuntime } from './mode-runtime';
export type { ModeRuntime } from './mode-runtime';
