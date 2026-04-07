/**
 * HeatmapStrip — Bar chart strip at the top of the app showing per-output bars.
 *
 * Each bar width is proportional to its corresponding ML output value [0,1].
 * Bars update reactively when outputs change.
 * Drag on a bar sets the parameter value.
 * Click on a bar opens a param popup with curve/range/freeze controls.
 * Rebuilds when mode switches (output count changes).
 *
 * Transplanted behavior from playground/js/a-app.js buildHeatmap/updateHeatmap.
 */

import {
  createSignal,
  For,
  Show,
} from 'solid-js';
import type { MLStore } from '../../stores/ml-store';
import ParamPopup from './ParamPopup';
import './heatmap-strip.css';

// ─── Visual parameter names and colors ──────────────────────────────

export const VISUAL_PARAM_NAMES = [
  'Flow', 'Scale', 'Speed', 'Hue', 'Spread', 'Size', 'Trail', 'Turb',
  'Attract', 'Radius', 'DispRate', 'DispAmt', 'Lifetime', 'Respawn',
  'Advection', 'Inertia', 'Drag', 'Repulse', 'RepCnt', 'RepRate',
];

export const VISUAL_PARAM_COLORS = [
  '#ff6a00', '#00ccff', '#ff6600', '#ff00cc', '#ffcc00', '#88ff00',
  '#0088ff', '#ff3366', '#9bff5f', '#59d3ff', '#ff8f3f', '#a0b7ff',
  '#f4ff7a', '#ffa8db', '#7dffc8', '#ffd166', '#8ad4ff', '#ff5f5f',
  '#ffc15f', '#ff8a3d',
];

/** Default color for synth/MIDI/audio-canvas bars (generated per-index) */
function defaultParamColor(_index: number): string {
  const hue = (_index * 37) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

// ─── Props ──────────────────────────────────────────────────────────

export interface HeatmapStripProps {
  mlStore: MLStore;
}

// ─── Param Popup State ──────────────────────────────────────────────

interface PopupState {
  paramIndex: number;
  cellRect: DOMRect;
}

// ─── Component ──────────────────────────────────────────────────────

export default function HeatmapStrip(props: HeatmapStripProps) {
  // Tooltip state
  const [tooltipText, setTooltipText] = createSignal('');
  const [tooltipVisible, setTooltipVisible] = createSignal(false);
  const [tooltipLeft, setTooltipLeft] = createSignal(0);

  // Param popup state
  const [popup, setPopup] = createSignal<PopupState | null>(null);

  // ─── Helpers ───

  function getParamNames(): string[] {
    const mode = props.mlStore.state.outputMode;
    const count = props.mlStore.outputCount();
    if (mode === 'visual') return VISUAL_PARAM_NAMES;
    return Array.from({ length: count }, (_, i) => `p${i}`);
  }

  function getParamColors(): string[] {
    const mode = props.mlStore.state.outputMode;
    const count = props.mlStore.outputCount();
    if (mode === 'visual') return VISUAL_PARAM_COLORS;
    return Array.from({ length: count }, (_, i) => defaultParamColor(i));
  }

  function getTooltipContent(paramIndex: number): string {
    const names = getParamNames();
    const outputs = props.mlStore.outputs();
    const name = names[paramIndex] ?? `p${paramIndex}`;
    const value = outputs[paramIndex]?.toFixed(3) ?? '—';
    return `${name}: ${value}`;
  }

  // ─── Apply drag value ───

  function applyDragValue(paramIndex: number, clientX: number, cellEl: HTMLElement) {
    const rect = cellEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

    // Directly set the output in the IML (bypass inference, set output directly)
    const iml = props.mlStore.getActiveIml();
    if (iml) {
      iml.setOutput(paramIndex, x);
      const newOutputs = new Float32Array(iml.getOutputs());
      (props.mlStore as any)._updateOutputs(newOutputs);
    }

    // Update tooltip
    const names = getParamNames();
    const name = names[paramIndex] ?? `p${paramIndex}`;
    setTooltipText(`${name}: ${x.toFixed(3)}`);
    setTooltipVisible(true);
    setTooltipLeft(rect.left);
  }

  // ─── Per-cell event handlers (matching old app's pattern) ───

  function createCellHandlers(paramIndex: number) {
    let downX = 0;
    let downY = 0;
    let didDrag = false;
    let isDragging = false;
    // Capture cell element reference for use in move/up where e.currentTarget may be null
    // (e.g. when events are dispatched programmatically)
    let cellEl: HTMLElement | null = null;

    function onPointerDown(e: PointerEvent) {
      e.preventDefault();
      cellEl = (e.currentTarget as HTMLElement) || cellEl;
      if (cellEl) cellEl.setPointerCapture(e.pointerId);
      downX = e.clientX;
      downY = e.clientY;
      didDrag = false;
      isDragging = true;
      if (cellEl) cellEl.classList.add('dragging');
    }

    function onPointerMove(e: PointerEvent) {
      if (!isDragging || !cellEl) return;
      const dx = Math.abs(e.clientX - downX);
      const dy = Math.abs(e.clientY - downY);
      if (dx > 3 || dy > 3) didDrag = true;
      if (didDrag) {
        applyDragValue(paramIndex, e.clientX, cellEl);
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (!isDragging || !cellEl) return;
      cellEl.classList.remove('dragging');
      isDragging = false;

      if (!didDrag) {
        // Short click — open param popup
        const rect = cellEl.getBoundingClientRect();
        setPopup({ paramIndex, cellRect: rect });
      }
    }

    function onPointerCancel() {
      if (isDragging && cellEl) {
        cellEl.classList.remove('dragging');
      }
      isDragging = false;
    }

    function onPointerEnter(e: PointerEvent) {
      if (isDragging) return;
      const el = (e.currentTarget as HTMLElement) || cellEl;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setTooltipText(getTooltipContent(paramIndex));
      setTooltipVisible(true);
      setTooltipLeft(rect.left);
    }

    function onPointerLeave() {
      if (!isDragging) {
        setTooltipVisible(false);
      }
    }

    function setRef(el: HTMLElement) {
      cellEl = el;
    }

    return {
      setRef,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerEnter,
      onPointerLeave,
    };
  }

  // ─── Close popup ───

  function closePopup() {
    setPopup(null);
  }

  // ─── Render ───

  // Derive cell data reactively from outputCount + outputs
  const cellData = () => {
    const count = props.mlStore.outputCount();
    const outputs = props.mlStore.outputs();
    const names = getParamNames();
    const colors = getParamColors();
    const items: Array<{ index: number; value: number; name: string; color: string }> = [];
    for (let i = 0; i < count; i++) {
      items.push({
        index: i,
        value: outputs[i] ?? 0,
        name: names[i] ?? `p${i}`,
        color: colors[i] ?? defaultParamColor(i),
      });
    }
    return items;
  };

  return (
    <div class="heatmap-strip" id="heatmap-strip">
      <div class="heatmap-cells" id="heatmap-cells">
        <For each={cellData()}>
          {(item) => {
            const barWidth = () => `${Math.max(2, Math.round(item.value * 100))}%`;
            const handlers = createCellHandlers(item.index);
            return (
              <div
                class="heatmap-cell"
                ref={handlers.setRef}
                data-index={item.index}
                onPointerDown={handlers.onPointerDown}
                onPointerMove={handlers.onPointerMove}
                onPointerUp={handlers.onPointerUp}
                onPointerCancel={handlers.onPointerCancel}
                onPointerEnter={handlers.onPointerEnter}
                onPointerLeave={handlers.onPointerLeave}
              >
                <div
                  class="heatmap-cell-bar"
                  style={{
                    background: item.color,
                    width: barWidth(),
                    height: '100%',
                  }}
                />
              </div>
            );
          }}
        </For>
      </div>
      <div
        class={`heatmap-tooltip${tooltipVisible() ? ' visible' : ''}`}
        id="heatmap-tooltip"
        style={{ left: `${tooltipLeft()}px` }}
      >
        {tooltipText()}
      </div>
      <Show when={popup()}>
        {(p) => (
          <ParamPopup
            mlStore={props.mlStore}
            paramIndex={p().paramIndex}
            cellRect={p().cellRect}
            onClose={closePopup}
          />
        )}
      </Show>
    </div>
  );
}
