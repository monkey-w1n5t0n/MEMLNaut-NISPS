/**
 * SettingsDrawer — settings panel rendered inside ModeShell's drawer.
 *
 * Sections:
 *   - Input: deadzone, curve, smoothing, momentum, anchor mode, invert
 *   - Training: learning rate, weight decay
 *   - Exploration: spread, noise floor/cap/growth/decay,
 *                  auto-explore (toggle, interval, intensity)
 *   - Output: global curve, smoothing, slew rate, freeze
 *   - Per-param overrides: ParamEditor list
 *   - Advanced: weight health histogram, gradient flow, session presets
 *
 * Sections are collapsible. Per-param-override editor renders inline (also
 * accessible via double-tap on slider in the live readout — wired in
 * ModeShell). The drawer is a child of `ModeShell`'s `drawerContent` slot.
 */

import { Component, createSignal, For, Show, createMemo, createEffect } from 'solid-js';
import { ParamEditor, type ParamOverride as PrimitiveParamOverride } from '../primitives/ParamEditor';
import { Slider } from '../primitives/Slider';
import { PillToggle } from '../primitives/PillToggle';
import { WeightHealth } from '../primitives/WeightHealth';
import { GradientFlow } from '../primitives/GradientFlow';
import { Heatmap } from '../primitives/Heatmap';
import { ProgressRing } from '../primitives/ProgressRing';
import { LossPlot } from '../primitives/LossPlot';

import { inputStore } from '../stores/input-store';
import { outputStore } from '../stores/output-store';
import { explorationStore } from '../stores/exploration-store';
import { modeStore, defaultParamOverride, type ParamOverride } from '../stores/mode-store';
import { sessionStore } from '../stores/session-store';
import { mlStore } from '../stores/ml-store';
import { coreBus } from '../stores/bus';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  DEADZONE_MAX,
  INPUT_CURVE_MIN,
  INPUT_CURVE_MAX,
  SMOOTHING_MAX,
} from '../input/pipeline';
import { GLOBAL_CURVE_MIN, GLOBAL_CURVE_MAX } from '../output/pipeline';
import {
  layerNorms,
  gradientStatuses,
  weightHistogram,
  weightStatus,
  layerStatsToStatus,
  layerWeightCounts,
} from '../features/weight-health';
import { saveNamedPreset, loadNamedPreset, buildShareUrl } from '../features/session-preset';
import { captureA, toggleAB, acceptB, revertToA } from '../features/snapshots';
import type { ModeRuntime } from './mode-runtime';
import type { ModeSchema } from './generated';
import type { Param } from './generated/types';
import type { CurveName } from '../output/curves';
import type { HeatmapColorMode } from '../features/heatmap-sampler';

import styles from './SettingsDrawer.module.css';

export interface SettingsDrawerProps {
  schema: ModeSchema;
  runtime: ModeRuntime;
  /** Show advanced section (weight health, gradient flow, session presets). */
  showAdvanced?: boolean;
}

interface Section {
  id: string;
  title: string;
  defaultOpen?: boolean;
  render: () => any;
}

export const SettingsDrawer: Component<SettingsDrawerProps> = (props) => {
  const [open, setOpen] = createSignal<Record<string, boolean>>({
    input: false,
    training: false,
    exploration: false,
    output: false,
    overrides: false,
    advanced: false,
    snapshots: false,
  });
  const toggle = (id: string) => setOpen((s) => ({ ...s, [id]: !s[id] }));

  // ----- Per-param overrides UI ----------------------------------------
  const overrides = () => modeStore.state.overrides[props.schema.mode_id] ?? {};

  const getOverride = (param: Param): PrimitiveParamOverride => {
    const cur = overrides()[param.name];
    if (cur) {
      return {
        min: cur.min,
        max: cur.max,
        curve: cur.curve as CurveName,
        curveParam: cur.curveParam,
        muted: cur.muted,
        pinned: cur.pinned,
        fixedValue: cur.fixedValue,
      };
    }
    return {
      min: param.min,
      max: param.max,
      curve: param.curve as CurveName,
      muted: false,
      pinned: false,
      fixedValue: param.default,
    };
  };

  const writeOverride = (param: Param, next: PrimitiveParamOverride) => {
    const stored: ParamOverride = {
      min: next.min,
      max: next.max,
      curve: next.curve,
      curveParam: next.curveParam,
      muted: next.muted,
      pinned: next.pinned,
      fixedValue: next.fixedValue,
      // Frozen flag is local to the runtime (set via output-store freezeMask)
      // — keep it false in the persistent override unless the user explicitly
      // toggles it.
      frozen: overrides()[param.name]?.frozen ?? false,
    };
    modeStore.setOverride(props.schema.mode_id, param.name, stored);
  };

  // ----- Per-output health (advanced section) -----------------------------
  const [advancedExpanded, setAdvancedExpanded] = createSignal(props.showAdvanced ?? false);
  const histogram = createMemo<number[]>(() => {
    const w = mlStore.weights();
    return weightHistogram(w);
  });
  const status = createMemo(() => weightStatus(mlStore.weights()));

  // Gradient flow: capture before/after weights on training events.
  const [normHistory, setNormHistory] = createSignal<number[]>([]);
  const [gradStatuses, setGradStatuses] = createSignal<ReturnType<typeof gradientStatuses>>([]);
  let lastBeforeWeights: Float32Array | null = null;

  const offTrainStart = coreBus.on('snap.push', (e) => {
    if (e.tag === 'before train' && mlStore.iml) {
      lastBeforeWeights = mlStore.getWeights();
    }
  });
  const offTrainEnd = coreBus.on('ml.trained', () => {
    if (lastBeforeWeights && mlStore.iml) {
      const after = mlStore.getWeights();
      const arch = mlStore.iml.architecture;
      const sizes = layerWeightCounts({
        inputSize: arch.inputSize,
        hidden: arch.hidden,
        outputSize: arch.outputSize,
      });
      const norms = layerNorms(lastBeforeWeights, after, sizes);
      setNormHistory(norms);
      setGradStatuses(gradientStatuses(norms));
      lastBeforeWeights = null;
    }
  });

  // Session-preset save / share UI state
  const [presetName, setPresetName] = createSignal('');
  const [shareUrl, setShareUrl] = createSignal('');

  // Snapshot list (long-press-undo equivalent)
  const snapshots = () => sessionStore.listSnapshots();

  // Cleanup on unmount (Solid handles via owner; we only need to detach bus
  // subs explicitly because they live across renders).
  // We can't use onCleanup here because this component is recreated per-mode,
  // but bus.on returns an unsubscribe. Defer cleanup to when the component
  // unmounts via createEffect cleanup function:
  createEffect(() => {
    return () => { offTrainStart(); offTrainEnd(); };
  });

  // ----- A/B compare visibility ------------------------------------------
  const ab = () => sessionStore.state.ab;
  const live = () => ab().live;

  // ---------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------

  const SectionHeader = (h: { id: string; title: string; count?: number }) => (
    <button
      type="button"
      class={styles.sectionHeader}
      onClick={() => toggle(h.id)}
      aria-expanded={!!open()[h.id]}
    >
      <span class={styles.caret}>{open()[h.id] ? '▾' : '▸'}</span>
      <span>{h.title}</span>
      <Show when={h.count !== undefined}><span class={styles.badge}>{h.count}</span></Show>
    </button>
  );

  return (
    <div class={styles.wrap}>
      {/* Snapshots / undo / A/B */}
      <section class={styles.section}>
        <SectionHeader id="snapshots" title="History (snapshots, A/B)" count={snapshots().length} />
        <Show when={open().snapshots}>
          <div class={styles.body}>
            <div class={styles.row}>
              <button
                type="button"
                class={styles.btnAlt}
                disabled={!props.runtime.canUndo()}
                onClick={() => props.runtime.undo()}
              >Undo last</button>
              <button
                type="button"
                class={styles.btnAlt}
                onClick={() => sessionStore.clearSnapshots()}
              >Clear stack</button>
            </div>
            <Show when={snapshots().length > 0}>
              <ul class={styles.snapshotList}>
                <For each={snapshots().slice().reverse()}>{(s) => (
                  <li>
                    <button
                      type="button"
                      class={styles.snapshotBtn}
                      onClick={() => {
                        const ok = props.runtime.undo();
                        if (!ok) {
                          // Restore by id instead.
                          const map = sessionStore.state.snapshots;
                          const idx = map.findIndex((m) => m.id === s.id);
                          if (idx >= 0) {
                            // walk back N times to make it the top of the stack
                            for (let i = map.length - 1; i > idx; i--) sessionStore.popSnapshot();
                            props.runtime.undo();
                          }
                        }
                      }}
                    >
                      <span class={styles.snapshotTag}>{s.tag}</span>
                      <span class={styles.snapshotMeta}>
                        noise {s.noiseLevel.toFixed(3)}
                        {s.zoomLevel !== null ? ` · zoom ${s.zoomLevel.toFixed(2)}` : ''}
                      </span>
                    </button>
                  </li>
                )}</For>
              </ul>
            </Show>
            <hr class={styles.hr} />
            <h4 class={styles.subhead}>A / B compare</h4>
            <div class={styles.row}>
              <Show when={!ab().a} fallback={
                <span class={styles.muted}>active: <strong>{live()}</strong></span>
              }>
                <span class={styles.muted}>no capture yet</span>
              </Show>
            </div>
            <div class={styles.row}>
              <button
                type="button"
                class={styles.btnAlt}
                onClick={() => captureA()}
              >Capture A</button>
              <button
                type="button"
                class={styles.btnAlt}
                disabled={!ab().a}
                onClick={() => toggleAB()}
              >Toggle A/B</button>
              <button
                type="button"
                class={styles.btnAlt}
                disabled={!ab().a}
                onClick={() => acceptB()}
              >Accept B</button>
              <button
                type="button"
                class={styles.btnAlt}
                disabled={!ab().a}
                onClick={() => revertToA()}
              >Revert to A</button>
            </div>
          </div>
        </Show>
      </section>

      {/* Input pipeline */}
      <section class={styles.section}>
        <SectionHeader id="input" title="Input pipeline" />
        <Show when={open().input}>
          <div class={styles.body}>
            <Slider
              label="Zoom" min={ZOOM_MIN} max={ZOOM_MAX}
              value={inputStore.config.zoom}
              onChange={(v) => inputStore.setZoom(v)}
            />
            <Slider
              label="Deadzone" min={0} max={DEADZONE_MAX}
              value={inputStore.config.deadzone}
              onChange={(v) => inputStore.setDeadzone(v)}
            />
            <Slider
              label="Input curve" min={INPUT_CURVE_MIN} max={INPUT_CURVE_MAX}
              value={inputStore.config.inputCurve}
              onChange={(v) => inputStore.setInputCurve(v)}
            />
            <Slider
              label="Smoothing" min={0} max={SMOOTHING_MAX}
              value={inputStore.config.smoothing}
              onChange={(v) => inputStore.setSmoothing(v)}
            />
            <div class={styles.row}>
              <label class={styles.fieldLabel}>Anchor mode</label>
              <PillToggle
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'sticky', label: 'Sticky' },
                  { value: 'center', label: 'Center' },
                ]}
                value={() => inputStore.config.anchorMode}
                onChange={(v) => inputStore.setAnchorMode(v as 'auto' | 'sticky' | 'center')}
                ariaLabel="Anchor mode"
              />
            </div>
            <div class={styles.row}>
              <label class={styles.fieldLabel}>Momentum zoom</label>
              <PillToggle
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'gentle', label: 'Gentle' },
                  { value: 'strong', label: 'Strong' },
                ]}
                value={() => inputStore.config.momentumZoom}
                onChange={(v) => inputStore.setMomentumZoom(v as 'off' | 'gentle' | 'strong')}
                ariaLabel="Momentum zoom"
              />
            </div>
            <div class={styles.row}>
              <label class={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={inputStore.config.invertX}
                  onChange={(e) => inputStore.setInvert(e.currentTarget.checked, inputStore.config.invertY)}
                />
                Invert X
              </label>
              <label class={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={inputStore.config.invertY}
                  onChange={(e) => inputStore.setInvert(inputStore.config.invertX, e.currentTarget.checked)}
                />
                Invert Y
              </label>
            </div>
          </div>
        </Show>
      </section>

      {/* Training */}
      <section class={styles.section}>
        <SectionHeader id="training" title="Training" />
        <Show when={open().training}>
          <div class={styles.body}>
            <Slider
              label="Learning rate" min={0.01} max={5}
              value={explorationStore.state.learningRate}
              onChange={(v) => explorationStore.setLearningRate(v)}
            />
            <Slider
              label="Weight decay" min={0} max={0.3}
              value={explorationStore.state.weightDecay}
              onChange={(v) => explorationStore.setWeightDecay(v)}
            />
            <LossPlot history={() => mlStore.state.lossHistory} width={320} height={70} />
          </div>
        </Show>
      </section>

      {/* Exploration */}
      <section class={styles.section}>
        <SectionHeader id="exploration" title="Exploration / RL" />
        <Show when={open().exploration}>
          <div class={styles.body}>
            <Slider
              label="Spread" min={0} max={1}
              value={explorationStore.state.spread}
              onChange={(v) => explorationStore.setSpread(v)}
            />
            <Slider
              label="Noise floor" min={0} max={0.5}
              value={explorationStore.state.noiseFloor}
              onChange={(v) => explorationStore.setNoiseFloor(v)}
            />
            <Slider
              label="Noise cap" min={explorationStore.state.noiseFloor} max={1}
              value={explorationStore.state.noiseCap}
              onChange={(v) => explorationStore.setNoiseCap(v)}
            />
            <Slider
              label="Noise growth" min={1} max={3}
              value={explorationStore.state.noiseGrowth}
              onChange={(v) => explorationStore.setNoiseGrowth(v)}
            />
            <Slider
              label="Noise decay" min={0.7} max={1}
              value={explorationStore.state.noiseDecay}
              onChange={(v) => explorationStore.setNoiseDecay(v)}
            />
            <hr class={styles.hr} />
            <h4 class={styles.subhead}>Auto-explore</h4>
            <div class={styles.row}>
              <label class={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={explorationStore.state.autoExploreEnabled}
                  onChange={(e) => explorationStore.setAutoExplore(e.currentTarget.checked)}
                />
                Enable auto-explore
              </label>
              <Show when={explorationStore.state.autoExploreEnabled}>
                <ProgressRing
                  size={28}
                  showLabel={false}
                  progress={() => 1}
                  ariaLabel="Auto-explore active"
                />
              </Show>
            </div>
            <Slider
              label="Interval (ms)" min={500} max={10000} step={100}
              value={explorationStore.state.autoExploreIntervalMs}
              onChange={(v) => explorationStore.setAutoExploreInterval(v)}
            />
            <Slider
              label="Intensity" min={0.1} max={1}
              value={explorationStore.state.autoExploreIntensity}
              onChange={(v) => explorationStore.setAutoExploreIntensity(v)}
            />
          </div>
        </Show>
      </section>

      {/* Output */}
      <section class={styles.section}>
        <SectionHeader id="output" title="Output pipeline" />
        <Show when={open().output}>
          <div class={styles.body}>
            <Slider
              label="Global curve" min={GLOBAL_CURVE_MIN} max={GLOBAL_CURVE_MAX}
              value={outputStore.config.globalCurve}
              onChange={(v) => outputStore.setGlobalCurve(v)}
            />
            <Slider
              label="Output smoothing" min={0} max={0.95}
              value={outputStore.config.smoothing}
              onChange={(v) => outputStore.setSmoothing(v)}
            />
            <Slider
              label="Slew rate (per sec)" min={0.005} max={1} step={0.005}
              value={isFinite(outputStore.config.slewRate) ? outputStore.config.slewRate : 1}
              onChange={(v) => outputStore.setSlewRate(v)}
            />
            <label class={styles.checkbox}>
              <input
                type="checkbox"
                checked={outputStore.config.freezeOutput}
                onChange={(e) => outputStore.setFreezeOutput(e.currentTarget.checked)}
              />
              Freeze output
            </label>
          </div>
        </Show>
      </section>

      {/* Per-param overrides */}
      <section class={styles.section}>
        <SectionHeader
          id="overrides"
          title="Parameter overrides"
          count={Object.keys(overrides()).length}
        />
        <Show when={open().overrides}>
          <div class={styles.body}>
            <div class={styles.row}>
              <button
                type="button"
                class={styles.btnAlt}
                onClick={() => modeStore.clearAllOverrides(props.schema.mode_id)}
              >Clear all</button>
            </div>
            <div class={styles.paramList}>
              <For each={props.schema.params}>{(p) => (
                <ParamEditor
                  param={{
                    name: p.name,
                    label: p.label,
                    hardMin: p.min,
                    hardMax: p.max,
                    default: p.default,
                    curve: p.curve as CurveName,
                    group: p.group,
                  }}
                  override={() => getOverride(p)}
                  onChange={(next) => writeOverride(p, next)}
                  compact
                />
              )}</For>
            </div>
          </div>
        </Show>
      </section>

      {/* Advanced: weight health, gradient flow, heatmap */}
      <section class={styles.section}>
        <SectionHeader id="advanced" title="Advanced" />
        <Show when={open().advanced}>
          <div class={styles.body}>
            <button
              type="button"
              class={styles.btnAlt}
              onClick={() => setAdvancedExpanded((b) => !b)}
            >{advancedExpanded() ? 'Hide diagnostics' : 'Show diagnostics'}</button>
            <Show when={advancedExpanded()}>
              <h4 class={styles.subhead}>Weight health</h4>
              <WeightHealth
                histogram={histogram}
                status={status}
                width={300}
                height={60}
              />
              <h4 class={styles.subhead}>Gradient flow (last train)</h4>
              <Show
                when={normHistory().length > 0}
                fallback={<p class={styles.muted}>No training run yet.</p>}
              >
                <GradientFlow
                  layerNorms={normHistory}
                  status={gradStatuses}
                  width={300}
                  height={70}
                />
              </Show>
              <h4 class={styles.subhead}>Per-layer stats</h4>
              <div class={styles.layerStats}>
                <For each={mlStore.getLayerStatsRecords()}>{(stats, idx) => (
                  <div class={styles.layerStatRow}>
                    <span class={styles.layerStatLabel}>L{idx()}</span>
                    <span class={styles.layerStatValue}>
                      mean|w| {stats.meanAbs.toFixed(3)}
                      · max|w| {stats.maxAbs.toFixed(3)}
                      · {(stats.deadFrac * 100).toFixed(0)}% dead
                      · {(stats.saturatingFrac * 100).toFixed(0)}% sat
                    </span>
                    <span
                      class={styles.layerStatStatus}
                      data-status={layerStatsToStatus(stats)}
                    >{layerStatsToStatus(stats)}</span>
                  </div>
                )}</For>
              </div>
              <h4 class={styles.subhead}>Input heatmap</h4>
              <div class={styles.row}>
                <label class={styles.fieldLabel}>Color</label>
                <PillToggle
                  options={[
                    { value: 'luminance', label: 'Lumi' },
                    { value: 'variance', label: 'Var' },
                    { value: 'divergence', label: 'Div' },
                  ]}
                  value={() => props.runtime.heatmap.colorMode()}
                  onChange={(v) => props.runtime.heatmap.setColorMode(v as HeatmapColorMode)}
                  ariaLabel="Heatmap color mode"
                />
                <button
                  type="button"
                  class={styles.btnAlt}
                  onClick={() => props.runtime.heatmap.refresh(true)}
                >Refresh</button>
              </div>
              <Heatmap
                samples={props.runtime.heatmap.cells}
                resolution={props.runtime.heatmap.resolution()}
                colorMode={props.runtime.heatmap.colorMode() as 'luminance' | 'variance' | 'divergence'}
                size={240}
              />
            </Show>
            <hr class={styles.hr} />
            <h4 class={styles.subhead}>Session preset</h4>
            <div class={styles.row}>
              <input
                class={styles.textInput}
                placeholder="preset name"
                value={presetName()}
                onInput={(e) => setPresetName(e.currentTarget.value)}
              />
              <button
                type="button"
                class={styles.btnAlt}
                disabled={!presetName().trim()}
                onClick={() => {
                  const n = presetName().trim();
                  if (!n) return;
                  saveNamedPreset(n, false);
                  setPresetName('');
                }}
              >Save</button>
            </div>
            <Show when={sessionStore.state.presets.length > 0}>
              <ul class={styles.presetList}>
                <For each={sessionStore.state.presets}>{(p) => (
                  <li class={styles.presetRow}>
                    <span>{p.name}</span>
                    <button
                      type="button"
                      class={styles.btnTiny}
                      onClick={() => loadNamedPreset(p.id)}
                    >Load</button>
                    <button
                      type="button"
                      class={styles.btnTiny}
                      onClick={() => sessionStore.removePreset(p.id)}
                    >Del</button>
                  </li>
                )}</For>
              </ul>
            </Show>
            <div class={styles.row}>
              <button
                type="button"
                class={styles.btnAlt}
                onClick={() => {
                  setShareUrl(window.location.origin + window.location.pathname + buildShareUrl());
                }}
              >Build share URL</button>
              <Show when={shareUrl()}>
                <input
                  class={styles.textInput}
                  readOnly
                  value={shareUrl()}
                  onClick={(e) => e.currentTarget.select()}
                />
              </Show>
            </div>
          </div>
        </Show>
      </section>
    </div>
  );
};

export default SettingsDrawer;
