/**
 * ModeDrawer — Drawer panel for output mode switching.
 *
 * Contains a pill toggle for switching between:
 *   visual | synth | midi-cc | audio-canvas
 *
 * Switching modes triggers MLP recreation with warm-start weight transfer.
 * A confirmation dialog appears if existing training data would be lost.
 */

import { For } from 'solid-js';
import type { MLStore, OutputMode } from '../../stores/ml-store';
import './drawer.css';

const MODE_OPTIONS: Array<{ mode: OutputMode; label: string }> = [
  { mode: 'visual', label: 'Visual' },
  { mode: 'synth', label: 'Synth' },
  { mode: 'midi-cc', label: 'MIDI CC' },
  { mode: 'audio-canvas', label: 'Audio' },
];

export interface ModeDrawerProps {
  mlStore: MLStore;
  visible: boolean;
  onClose: () => void;
}

export default function ModeDrawer(props: ModeDrawerProps) {
  function onModeSelect(mode: OutputMode): void {
    if (mode === props.mlStore.state.outputMode) return;
    props.mlStore.setOutputMode(mode);
  }

  return (
    <div
      class={`drawer${props.visible ? '' : ' hidden'}`}
      id="drawer-mode"
      data-drawer="mode"
    >
      <div class="drawer-header">
        <span>Output Mode</span>
        <button class="drawer-close" data-drawer="mode" onClick={props.onClose}>
          ×
        </button>
      </div>
      <div class="drawer-body">
        <div id="output-mode-toggle" class="pill-toggle">
          <For each={MODE_OPTIONS}>
            {(opt) => (
              <button
                class={`pill-opt${props.mlStore.state.outputMode === opt.mode ? ' active' : ''}`}
                data-mode={opt.mode}
                onClick={() => onModeSelect(opt.mode)}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>
        <div class="mode-info" style="margin-top: 10px; color: #777; font-size: 10px;">
          <div>Outputs: {props.mlStore.outputCount()}</div>
          <div style="margin-top: 4px;">Mode: {props.mlStore.state.outputMode}</div>
        </div>
      </div>
    </div>
  );
}
