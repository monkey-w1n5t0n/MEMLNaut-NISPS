/**
 * MIDICCPanel — Drawer panel for MIDI device selection and CC output mapping.
 *
 * Sections:
 *   1. Devices — input + output device selects, request-access button, status badge.
 *   2. CC Map — scrollable table of CC→param mappings. Each row exposes:
 *       CC#, MIDI channel, param index, min/max range sliders, curve, mute toggle,
 *       and a remove (×) button.
 *      An "+ Add" button appends a new row.
 *
 * Props:
 *   midiStore  — MidiStore instance (from midi-store.tsx)
 *   midiIO     — MidiIO instance (from core/audio/midi-io.ts)
 *   visible    — whether the drawer is visible
 *   onClose    — called when the × button is clicked
 *
 * The component does NOT wire sendCC to the ML output pipeline — that belongs
 * at the app level. It only configures what the store knows about device
 * selection and CC mappings.
 */

import { createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import type { MidiStore, MidiCCParam } from '../../stores/midi-store';
import type { MidiIO, MidiDeviceInfo } from '../../core/audio/midi-io';
import '../layout/drawer.css';
import './midi-panel.css';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MIDICCPanelProps {
  midiStore: MidiStore;
  midiIO: MidiIO;
  visible: boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MIDICCPanel(props: MIDICCPanelProps) {
  const store = () => props.midiStore;
  const io    = () => props.midiIO;

  // ── Device list signals ──
  const [inputDevices,  setInputDevices]  = createSignal<MidiDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = createSignal<MidiDeviceInfo[]>([]);
  const [accessStatus,  setAccessStatus]  = createSignal<'idle' | 'ok' | 'denied'>('idle');

  // Wire device-change callbacks once and clean up when panel is destroyed.
  createEffect(() => {
    io().onInputDevicesChange(setInputDevices);
    io().onOutputDevicesChange(setOutputDevices);
  });

  onCleanup(() => {
    // Clear callbacks to avoid stale references after unmount
    io().onInputDevicesChange(() => {});
    io().onOutputDevicesChange(() => {});
  });

  // ── Request access ──

  async function handleRequestAccess(): Promise<void> {
    setAccessStatus('idle');
    const ok = await io().requestAccess();
    setAccessStatus(ok ? 'ok' : 'denied');
    if (ok) {
      setInputDevices(io().getInputDevices());
      setOutputDevices(io().getOutputDevices());
    }
  }

  // ── Device selection ──

  function handleInputSelect(e: Event): void {
    const id = (e.target as HTMLSelectElement).value;
    const resolved = id === '' ? null : id;
    store().setInputDevice(resolved);
    io().selectInputDevice(resolved);
  }

  function handleOutputSelect(e: Event): void {
    const id = (e.target as HTMLSelectElement).value;
    const resolved = id === '' ? null : id;
    store().setOutputDevice(resolved);
    io().selectOutputDevice(resolved);
  }

  // ── CC param field helpers ──

  function updateParam(index: number, partial: Partial<MidiCCParam>): void {
    store().setCCParam(index, partial);
  }

  function parseIntField(raw: string, min: number, max: number): number | undefined {
    const n = parseInt(raw, 10);
    if (isNaN(n)) return undefined;
    return Math.max(min, Math.min(max, n));
  }

  // ── Render helpers ──

  function statusClass(): string {
    const s = accessStatus();
    if (s === 'ok') return 'midi-status ok';
    if (s === 'denied') return 'midi-status err';
    return 'midi-status';
  }

  function statusText(): string {
    const s = accessStatus();
    if (s === 'ok') return 'Access granted';
    if (s === 'denied') return 'Access denied';
    return 'Not requested';
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div class={`drawer${props.visible ? '' : ' hidden'}`}>
      {/* Header */}
      <div class="drawer-header">
        MIDI
        <button class="drawer-close" onClick={props.onClose} aria-label="Close">×</button>
      </div>

      <div class="drawer-body midi-body">

        {/* ── Section: Devices ── */}
        <div class="midi-section">
          <div class="midi-section-header">Devices</div>

          {/* Input device */}
          <div class="midi-device-row">
            <span class="midi-device-label">In</span>
            <select
              class="midi-select"
              value={store().state.inputDeviceId ?? ''}
              onChange={handleInputSelect}
            >
              <option value="">All inputs</option>
              <For each={inputDevices()}>
                {(dev) => <option value={dev.id}>{dev.name}</option>}
              </For>
            </select>
          </div>

          {/* Output device */}
          <div class="midi-device-row">
            <span class="midi-device-label">Out</span>
            <select
              class="midi-select"
              value={store().state.outputDeviceId ?? ''}
              onChange={handleOutputSelect}
            >
              <option value="">— none —</option>
              <For each={outputDevices()}>
                {(dev) => <option value={dev.id}>{dev.name}</option>}
              </For>
            </select>
          </div>

          {/* Request access + status */}
          <div class="action-row" style={{ "margin-top": "6px", "margin-bottom": "4px" }}>
            <button class="action-btn" onClick={handleRequestAccess}>
              Request Access
            </button>
            <span class={statusClass()}>{statusText()}</span>
          </div>
        </div>

        {/* ── Section: CC Map ── */}
        <div class="midi-section">
          <div class="midi-section-header">CC Output Map</div>

          <div class="cc-table-wrap">
            <table class="cc-table">
              <thead>
                <tr>
                  <th>CC</th>
                  <th>Ch</th>
                  <th>Idx</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th>Crv</th>
                  <th></th>{/* mute */}
                  <th></th>{/* remove */}
                </tr>
              </thead>
              <tbody>
                <For each={store().state.ccMap}>
                  {(param, index) => (
                    <tr class="cc-row">
                      {/* CC number */}
                      <td>
                        <input
                          type="number"
                          class="cc-num-input"
                          min={0}
                          max={127}
                          value={param.cc}
                          onBlur={(e) => {
                            const v = parseIntField((e.target as HTMLInputElement).value, 0, 127);
                            if (v !== undefined) updateParam(index(), { cc: v });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                        />
                      </td>

                      {/* MIDI channel */}
                      <td>
                        <input
                          type="number"
                          class="cc-num-input narrow"
                          min={1}
                          max={16}
                          value={param.channel}
                          onBlur={(e) => {
                            const v = parseIntField((e.target as HTMLInputElement).value, 1, 16);
                            if (v !== undefined) updateParam(index(), { channel: v });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                        />
                      </td>

                      {/* Param index */}
                      <td>
                        <input
                          type="number"
                          class="cc-num-input"
                          min={0}
                          max={999}
                          value={param.paramIndex}
                          onBlur={(e) => {
                            const v = parseIntField((e.target as HTMLInputElement).value, 0, 999);
                            if (v !== undefined) updateParam(index(), { paramIndex: v });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                        />
                      </td>

                      {/* Min slider */}
                      <td>
                        <input
                          type="range"
                          class="cc-range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={param.min}
                          onInput={(e) => {
                            const v = parseFloat((e.target as HTMLInputElement).value);
                            updateParam(index(), { min: v });
                          }}
                          title={`Min: ${param.min.toFixed(2)}`}
                        />
                      </td>

                      {/* Max slider */}
                      <td>
                        <input
                          type="range"
                          class="cc-range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={param.max}
                          onInput={(e) => {
                            const v = parseFloat((e.target as HTMLInputElement).value);
                            updateParam(index(), { max: v });
                          }}
                          title={`Max: ${param.max.toFixed(2)}`}
                        />
                      </td>

                      {/* Curve slider */}
                      <td>
                        <input
                          type="range"
                          class="cc-range curve-slider"
                          min={0}
                          max={1}
                          step={0.01}
                          value={param.curve}
                          onInput={(e) => {
                            const v = parseFloat((e.target as HTMLInputElement).value);
                            updateParam(index(), { curve: v });
                          }}
                          title={`Curve: ${param.curve.toFixed(2)} (0.5 = linear)`}
                        />
                      </td>

                      {/* Mute toggle */}
                      <td>
                        <button
                          class={`cc-mute-btn${param.muted ? ' muted' : ''}`}
                          onClick={() => updateParam(index(), { muted: !param.muted })}
                          title={param.muted ? 'Unmute' : 'Mute'}
                          aria-pressed={param.muted}
                        >
                          {param.muted ? 'M' : '·'}
                        </button>
                      </td>

                      {/* Remove */}
                      <td>
                        <button
                          class="cc-remove-btn"
                          onClick={() => store().removeCCParam(index())}
                          title="Remove mapping"
                          aria-label={`Remove CC ${param.cc}`}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>

          {/* Add row */}
          <button class="cc-add-btn" onClick={() => store().addCCParam()}>
            + Add CC mapping
          </button>

          {/* Save to localStorage */}
          <div class="action-row" style={{ "margin-top": "8px" }}>
            <button class="action-btn" onClick={() => store().saveCCMap()}>
              Save map
            </button>
            <button
              class="action-btn dim"
              onClick={() => store().createDefaultMap(store().state.ccMap.length || 8)}
              title="Reset to default map"
            >
              Reset
            </button>
          </div>
        </div>

        {/* ── Section: Channel name hint ── */}
        <Show when={store().state.ccMap.length > 0}>
          <div class="midi-section">
            <div class="midi-section-header">Tips</div>
            <div class="midi-status">
              Min/Max scale the [0,1] MLP output before mapping to CC 0–127.<br />
              Curve &lt; 0.5 = more time low, &gt; 0.5 = bias high.<br />
              Muted rows send the param's fixedValue instead.
            </div>
          </div>
        </Show>

      </div>
    </div>
  );
}
