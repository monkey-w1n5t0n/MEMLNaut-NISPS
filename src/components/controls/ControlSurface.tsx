/**
 * ControlSurface — Floating compound-axis control bar.
 *
 * Three axes (Boldness, Memory, Precision) map single sliders to multiple
 * underlying parameters. Preset chips set all three axes at once. A gear
 * button expands a detail section showing all resolved parameter values.
 *
 * On any axis change the component pushes resolved params out to:
 *   - inputPipeline.setConfig()         (Precision → deadzone, zoom, inputCurve, smoothing, momentumZoom)
 *   - outputPipeline.updateFromControlSurface()  (globalCurve, outputSmoothing, outputSlewRate)
 *   - mlStore.setSpreadLevel()          (spread)
 *
 * Double-clicking an axis slider clears all overrides for that axis (re-links
 * all params to the derived value).
 */

import { createSignal, createEffect, For, onCleanup } from 'solid-js';
import {
  ControlSurface as ControlSurfaceCore,
  CONTROL_PRESETS,
  PARAM_RANGES,
  LOG_SCALE_PARAMS,
} from '../../core/control-surface';
import type { ControlSurfaceParams } from '../../core/control-surface';
import type { InputPipelineController } from '../../hooks/useInputPipeline';
import type { OutputPipelineController } from '../../hooks/useOutputPipeline';
import type { MLStore } from '../../stores/ml-store';
import './control-surface.css';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ControlSurfaceProps {
  inputPipeline?: InputPipelineController;
  outputPipeline?: OutputPipelineController;
  mlStore: MLStore;
}

// ─── Preset display names ─────────────────────────────────────────────────────

const PRESET_LABELS: Record<string, string> = {
  'default':     'Default',
  'first-touch': 'First Touch',
  'jazz-hands':  'Jazz Hands',
  'sculptor':    'Sculptor',
  'improviser':  'Improviser',
  'microscope':  'Microscope',
};

// ─── Param display helpers ────────────────────────────────────────────────────

/** Format a param value for display in the detail panel. */
function formatParamValue(name: keyof ControlSurfaceParams, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (LOG_SCALE_PARAMS.has(name)) {
      return value.toExponential(2);
    }
    // Round to avoid floating-point noise in display
    return value.toFixed(Math.abs(value) < 0.1 ? 4 : 2);
  }
  return String(value);
}

/** Display-friendly label for a param key. */
function paramLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// ─── Axis groups for the detail panel ─────────────────────────────────────────

const BOLDNESS_PARAMS: Array<keyof ControlSurfaceParams> = [
  'zoom', 'noiseCap', 'noiseGrowth', 'learningRate', 'weightDecay', 'noiseDistribution',
];
const MEMORY_PARAMS: Array<keyof ControlSurfaceParams> = [
  'maxExamples', 'exampleDecay', 'noiseDecay', 'convergenceThreshold',
];
const PRECISION_PARAMS: Array<keyof ControlSurfaceParams> = [
  'inputCurve', 'deadzone', 'smoothing', 'outputSlewRate', 'momentumZoom',
];
const OTHER_PARAMS: Array<keyof ControlSurfaceParams> = [
  'spread', 'globalCurve', 'outputSmoothing', 'noiseFloor', 'noiseDistribution',
  'layerAwareNoise', 'zoomAwareFeedback',
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function ControlSurface(props: ControlSurfaceProps) {
  // ── Core logic instance (one per component mount) ────────────────────────
  const cs = new ControlSurfaceCore();

  // ── Reactive signals ─────────────────────────────────────────────────────
  const [boldness, setBoldness] = createSignal(cs.getBoldness());
  const [memory, setMemory]     = createSignal(cs.getMemory());
  const [precision, setPrecision] = createSignal(cs.getPrecision());
  const [activePreset, setActivePreset] = createSignal<string | null>('default');
  const [detailOpen, setDetailOpen] = createSignal(false);
  const [params, setParams] = createSignal<ControlSurfaceParams>(cs.getParams());

  // ── Sync resolved params to downstream pipeline controllers ─────────────
  function syncToDownstream(resolved: ControlSurfaceParams): void {
    props.inputPipeline?.setConfig({
      deadzone:     resolved.deadzone,
      inputCurve:   resolved.inputCurve,
      smoothing:    resolved.smoothing,
      momentumZoom: resolved.momentumZoom,
    });

    props.outputPipeline?.updateFromControlSurface({
      globalCurve:    resolved.globalCurve,
      outputSmoothing: resolved.outputSmoothing,
      outputSlewRate:  resolved.outputSlewRate,
    });

    props.mlStore.setSpreadLevel(resolved.spread);
  }

  // ── Subscribe to ControlSurface changes (covers preset apply too) ────────
  const unsub = cs.onChange((resolved) => {
    setParams(resolved);
    syncToDownstream(resolved);
  });

  onCleanup(unsub);

  // ── Initial sync on mount ────────────────────────────────────────────────
  createEffect(() => {
    syncToDownstream(cs.getParams());
  });

  // ── Axis handlers ────────────────────────────────────────────────────────

  function onBoldnessInput(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    cs.setBoldness(v);
    setBoldness(v);
    setActivePreset(null); // manual override clears active preset indicator
  }

  function onMemoryInput(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    cs.setMemory(v);
    setMemory(v);
    setActivePreset(null);
  }

  function onPrecisionInput(e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    cs.setPrecision(v);
    setPrecision(v);
    setActivePreset(null);
  }

  /** Double-click on an axis slider → clear all overrides (re-link to axis). */
  function onAxisDblClick(): void {
    cs.clearAllOverrides();
    // Re-sync slider signals from core (in case overrides had shifted values)
    setBoldness(cs.getBoldness());
    setMemory(cs.getMemory());
    setPrecision(cs.getPrecision());
    setParams(cs.getParams());
  }

  // ── Preset handler ───────────────────────────────────────────────────────

  function onPresetClick(id: string): void {
    cs.applyPreset(id);
    setBoldness(cs.getBoldness());
    setMemory(cs.getMemory());
    setPrecision(cs.getPrecision());
    setActivePreset(id);
    setParams(cs.getParams());
  }

  // ── Preset ids list ──────────────────────────────────────────────────────
  const presetIds = Object.keys(CONTROL_PRESETS);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div class="cs-bar" id="control-surface">

      {/* ── Axis sliders ─────────────────────────────────────────────── */}
      <div class="cs-axes">

        {/* Boldness */}
        <div class="cs-axis">
          <span class="cs-axis-label cs-label-lo">Caution</span>
          <input
            type="range"
            class="cs-slider"
            min="0" max="1" step="0.01"
            value={boldness()}
            onInput={onBoldnessInput}
            onDblClick={onAxisDblClick}
            title="Boldness — double-click to re-link all overrides"
          />
          <span class="cs-axis-label cs-label-hi">Bold</span>
        </div>

        {/* Memory */}
        <div class="cs-axis">
          <span class="cs-axis-label cs-label-lo">Amnesia</span>
          <input
            type="range"
            class="cs-slider"
            min="0" max="1" step="0.01"
            value={memory()}
            onInput={onMemoryInput}
            onDblClick={onAxisDblClick}
            title="Memory — double-click to re-link all overrides"
          />
          <span class="cs-axis-label cs-label-hi">Elephant</span>
        </div>

        {/* Precision */}
        <div class="cs-axis">
          <span class="cs-axis-label cs-label-lo">Raw</span>
          <input
            type="range"
            class="cs-slider"
            min="0" max="1" step="0.01"
            value={precision()}
            onInput={onPrecisionInput}
            onDblClick={onAxisDblClick}
            title="Precision — double-click to re-link all overrides"
          />
          <span class="cs-axis-label cs-label-hi">Precise</span>
        </div>
      </div>

      {/* ── Preset chips ─────────────────────────────────────────────── */}
      <div class="cs-presets">
        <For each={presetIds}>
          {(id) => (
            <button
              class={`cs-chip${activePreset() === id ? ' cs-chip--active' : ''}`}
              onClick={() => onPresetClick(id)}
              title={id}
            >
              {PRESET_LABELS[id] ?? id}
            </button>
          )}
        </For>
      </div>

      {/* ── Gear button ──────────────────────────────────────────────── */}
      <button
        class={`cs-gear${detailOpen() ? ' cs-gear--open' : ''}`}
        onClick={() => setDetailOpen((v) => !v)}
        title="Show parameter details"
        aria-label="Toggle parameter details"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
      </button>

      {/* ── Detail panel ─────────────────────────────────────────────── */}
      {detailOpen() && (
        <div class="cs-detail">

          <div class="cs-detail-section">
            <div class="cs-detail-heading">Boldness</div>
            <For each={BOLDNESS_PARAMS}>
              {(name) => (
                <div class="cs-detail-row">
                  <span class="cs-detail-name">{paramLabel(name)}</span>
                  <span class="cs-detail-value">{formatParamValue(name, params()[name])}</span>
                </div>
              )}
            </For>
          </div>

          <div class="cs-detail-section">
            <div class="cs-detail-heading">Memory</div>
            <For each={MEMORY_PARAMS}>
              {(name) => (
                <div class="cs-detail-row">
                  <span class="cs-detail-name">{paramLabel(name)}</span>
                  <span class="cs-detail-value">{formatParamValue(name, params()[name])}</span>
                </div>
              )}
            </For>
          </div>

          <div class="cs-detail-section">
            <div class="cs-detail-heading">Precision</div>
            <For each={PRECISION_PARAMS}>
              {(name) => (
                <div class="cs-detail-row">
                  <span class="cs-detail-name">{paramLabel(name)}</span>
                  <span class="cs-detail-value">{formatParamValue(name, params()[name])}</span>
                </div>
              )}
            </For>
          </div>

          <div class="cs-detail-section">
            <div class="cs-detail-heading">Other</div>
            <For each={OTHER_PARAMS}>
              {(name) => (
                <div class="cs-detail-row">
                  <span class="cs-detail-name">{paramLabel(name)}</span>
                  <span class="cs-detail-value">{formatParamValue(name, params()[name])}</span>
                </div>
              )}
            </For>
          </div>

        </div>
      )}
    </div>
  );
}
