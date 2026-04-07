/**
 * SynthControls — Drawer panel for synth engine controls.
 *
 * Contains:
 *   - Start/Stop button (toggles isRunning, green/red)
 *   - Volume slider [0, 1]
 *   - Arpeggiator section: enable toggle, tempo, progression, octaves, offset
 *   - Engine info (current engineId)
 *
 * Props:
 *   synthStore — the SynthStore instance
 *   visible    — whether the drawer is shown
 *   onClose    — called when the × button is clicked
 *
 * Note: AudioContext.resume() is NOT called here — that wiring lives at the
 * App level. This component only updates reactive store state.
 */

import { For, Show } from 'solid-js';
import type { SynthStore } from '../../stores/synth-store';
import '../layout/drawer.css';
import './synth-controls.css';

// ─── Progression options ──────────────────────────────────────────────────────

const PROGRESSIONS = [
  'major',
  'Cmin7-rand',
  'I-vi-IV-V',
  'I-IV-vi-V',
  'i-VI-III-VII',
  'I-V-vi-IV',
] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SynthControlsProps {
  synthStore: SynthStore;
  visible: boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SynthControls(props: SynthControlsProps) {
  const store = () => props.synthStore;
  const state = () => store().state;

  // ── Start / Stop ──

  function onToggleRunning(): void {
    if (state().isRunning) {
      store().stop();
    } else {
      store().start();
    }
  }

  // ── Volume ──

  function onVolumeChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    store().setVolume(parseFloat(input.value));
  }

  // ── Arp ──

  function onArpToggle(): void {
    store().setArpConfig({ enabled: !state().arp.enabled });
  }

  function onTempoChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    store().setArpConfig({ tempo: parseInt(input.value, 10) });
  }

  function onProgressionChange(e: Event): void {
    const select = e.currentTarget as HTMLSelectElement;
    store().setArpConfig({ progression: select.value });
  }

  function onOctavesChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    store().setArpConfig({ octaves: parseInt(input.value, 10) });
  }

  function onOffsetChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    store().setArpConfig({ offset: parseInt(input.value, 10) });
  }

  // ── Render ──

  return (
    <div
      class={`drawer${props.visible ? '' : ' hidden'}`}
      id="drawer-synth"
      data-drawer="synth"
    >
      <div class="drawer-header">
        <span>Synth</span>
        <button class="drawer-close" data-drawer="synth" onClick={props.onClose}>
          ×
        </button>
      </div>

      <div class="drawer-body synth-controls-body">

        {/* ── Start / Stop ── */}
        <div class="synth-section">
          <button
            class={`synth-run-btn ${state().isRunning ? 'running' : 'stopped'}`}
            onClick={onToggleRunning}
          >
            {state().isRunning ? 'Stop' : 'Start'}
          </button>
        </div>

        {/* ── Volume ── */}
        <div class="synth-section">
          <div class="synth-row">
            <label class="synth-label">Volume</label>
            <span class="synth-value">{state().volume.toFixed(2)}</span>
          </div>
          <input
            type="range"
            class="synth-slider"
            min="0"
            max="1"
            step="0.01"
            value={state().volume}
            onInput={onVolumeChange}
          />
        </div>

        {/* ── Arpeggiator ── */}
        <div class="synth-section">
          <div class="synth-row synth-section-header">
            <span class="synth-label">Arpeggiator</span>
            <button
              class={`synth-toggle ${state().arp.enabled ? 'on' : 'off'}`}
              onClick={onArpToggle}
            >
              {state().arp.enabled ? 'On' : 'Off'}
            </button>
          </div>

          <Show when={state().arp.enabled}>
            <div class="synth-arp-params">

              {/* Tempo */}
              <div class="synth-row">
                <label class="synth-label">Tempo</label>
                <span class="synth-value">{state().arp.tempo} BPM</span>
              </div>
              <input
                type="range"
                class="synth-slider"
                min="40"
                max="240"
                step="1"
                value={state().arp.tempo}
                onInput={onTempoChange}
              />

              {/* Progression */}
              <div class="synth-row synth-row-select">
                <label class="synth-label">Progression</label>
                <select
                  class="synth-select"
                  value={state().arp.progression}
                  onChange={onProgressionChange}
                >
                  <For each={PROGRESSIONS}>
                    {(p) => (
                      <option value={p}>{p}</option>
                    )}
                  </For>
                </select>
              </div>

              {/* Octaves */}
              <div class="synth-row">
                <label class="synth-label">Octaves</label>
                <span class="synth-value">{state().arp.octaves}</span>
              </div>
              <input
                type="range"
                class="synth-slider"
                min="1"
                max="5"
                step="1"
                value={state().arp.octaves}
                onInput={onOctavesChange}
              />

              {/* Offset */}
              <div class="synth-row">
                <label class="synth-label">Offset</label>
                <span class="synth-value">{state().arp.offset > 0 ? `+${state().arp.offset}` : state().arp.offset}</span>
              </div>
              <input
                type="range"
                class="synth-slider"
                min="-2"
                max="3"
                step="1"
                value={state().arp.offset}
                onInput={onOffsetChange}
              />

            </div>
          </Show>
        </div>

        {/* ── Engine info ── */}
        <div class="synth-section synth-engine-info">
          <span class="synth-label">Engine</span>
          <span class="synth-engine-id">
            {state().engineId || <span class="synth-engine-none">none</span>}
          </span>
        </div>

      </div>
    </div>
  );
}
