/**
 * useSynthRouting — final link in the ML output → synth engine pipeline.
 *
 * Subscribes to the 'output.synth' bus topic (throttled to 20fps by
 * useOutputRouting) and forwards processed outputs to the active SynthEngine
 * via engine.setParams(). When no engine is set or the synth is not running,
 * emissions are silently discarded.
 *
 * Also subscribes to arpeggiator noteOn/noteOff bus topics so the arpeggiator
 * can be decoupled from a concrete engine reference. When arp is enabled and
 * the events arrive on the bus, they are forwarded to the active engine.
 *
 * Architecture:
 *   useOutputRouting → bus('output.synth') → useSynthRouting → engine.setParams()
 *   Arpeggiator      → bus('arp.noteOn')   → useSynthRouting → engine.noteOn()
 *   Arpeggiator      → bus('arp.noteOff')  → useSynthRouting → engine.noteOff()
 *
 * Called once at the app root — registers subscriptions and wires onCleanup.
 * Returns void; all side-effects go through the engine interface.
 */

import { onCleanup } from 'solid-js';
import type { SynthStore } from '../stores/synth-store';
import type { SignalBus } from '../bus/signal-bus';

// ─── Bus payload types ────────────────────────────────────────────────────────

/** Payload emitted on 'arp.noteOn' */
export interface ArpNoteOnPayload {
  note: number;
  velocity: number;
}

/** Payload emitted on 'arp.noteOff' */
export interface ArpNoteOffPayload {
  note: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSynthRouting(
  synthStore: SynthStore,
  bus: SignalBus,
): void {
  // ─── Ensure topics exist before subscribing ───────────────────────────────

  const synthTopic    = bus.createTopic<Float32Array>('output.synth');
  const arpNoteOnTopic  = bus.createTopic<ArpNoteOnPayload>('arp.noteOn');
  const arpNoteOffTopic = bus.createTopic<ArpNoteOffPayload>('arp.noteOff');

  // ─── output.synth → engine.setParams() ───────────────────────────────────

  const unsubSynth = synthTopic.subscribe((processedOutputs: Float32Array) => {
    // Guard: skip if the synth isn't running or no engine is attached.
    if (!synthStore.state.isRunning) return;

    const engine = synthStore.getEngine();
    if (!engine) return;

    // Forward the full processed output vector. Engines accept values in [0, 1]
    // and handle their own internal mapping — no transformation needed here.
    // The default setParams() in SynthEngine iterates and calls setParam() for
    // each index; concrete engines may override for batched efficiency.
    engine.setParams(Array.from(processedOutputs));
  });

  // ─── arp.noteOn → engine.noteOn() ────────────────────────────────────────

  const unsubArpNoteOn = arpNoteOnTopic.subscribe((payload: ArpNoteOnPayload) => {
    // Only route when arp is enabled and synth is running.
    if (!synthStore.state.arp.enabled) return;
    if (!synthStore.state.isRunning) return;

    const engine = synthStore.getEngine();
    if (!engine) return;

    engine.noteOn(payload.note, payload.velocity);
  });

  // ─── arp.noteOff → engine.noteOff() ──────────────────────────────────────

  const unsubArpNoteOff = arpNoteOffTopic.subscribe((payload: ArpNoteOffPayload) => {
    // Only route when arp is enabled and synth is running.
    if (!synthStore.state.arp.enabled) return;
    if (!synthStore.state.isRunning) return;

    const engine = synthStore.getEngine();
    if (!engine) return;

    engine.noteOff(payload.note);
  });

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  onCleanup(() => {
    unsubSynth();
    unsubArpNoteOn();
    unsubArpNoteOff();
  });
}
