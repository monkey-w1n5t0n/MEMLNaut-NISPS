/**
 * ParamPopup — Popup control panel for a single ML output parameter.
 *
 * Shows parameter name, current value, and controls:
 *   - Curve canvas: vertical drag adjusts response curve
 *   - Min/Max range sliders: dual range controls
 *   - Freeze toggle: locks parameter at a fixed value
 *
 * Ported from playground/js/a-app.js showParamPopup().
 */

import {
  createSignal,
  onMount,
  onCleanup,
  Show,
} from 'solid-js';
import type { MLStore } from '../../stores/ml-store';
import {
  type ParamOverride,
  createDefaultOverride,
  applyCurve,
  drawCurveOnCanvas,
} from '../../core/param-overrides';
import {
  VISUAL_PARAM_NAMES,
  VISUAL_PARAM_COLORS,
} from './HeatmapStrip';

/** Default color for synth/MIDI/audio-canvas params (generated per-index) */
function defaultParamColor(index: number): string {
  const hue = (index * 37) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

// ─── Props ──────────────────────────────────────────────────────────

export interface ParamPopupProps {
  /** ML store for reading/writing overrides */
  mlStore: MLStore;
  /** Parameter index */
  paramIndex: number;
  /** Cell rect for positioning */
  cellRect: DOMRect;
  /** Close callback */
  onClose: () => void;
}

// ─── Component ──────────────────────────────────────────────────────

export default function ParamPopup(props: ParamPopupProps) {
  const [curveValue, setCurveValue] = createSignal(0.5);
  const [minValue, setMinValue] = createSignal(0);
  const [maxValue, setMaxValue] = createSignal(1);
  const [frozen, setFrozen] = createSignal(false);
  const [fixedValue, setFixedValue] = createSignal(0.5);

  let curveCanvasRef: HTMLCanvasElement | undefined;
  let curveDragging = false;
  let curveStartY = 0;
  let curveStartVal = 0;

  // Initialize from store
  const ov = () => props.mlStore.getParamOverride(props.paramIndex);

  onMount(() => {
    const o = ov();
    setCurveValue(o.curve);
    setMinValue(o.min);
    setMaxValue(o.max);
    setFrozen(o.frozen);
    setFixedValue(o.fixedValue);

    // Draw initial curve
    if (curveCanvasRef) {
      const ctx = curveCanvasRef.getContext('2d')!;
      drawCurveOnCanvas(ctx, o.curve, getColor(), curveCanvasRef.width, curveCanvasRef.height);
    }

    // Close on Escape
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  // ─── Helpers ───

  function getColor(): string {
    const mode = props.mlStore.state.outputMode;
    if (mode === 'visual') {
      return VISUAL_PARAM_COLORS[props.paramIndex] ?? defaultParamColor(props.paramIndex);
    }
    return defaultParamColor(props.paramIndex);
  }

  function getName(): string {
    const mode = props.mlStore.state.outputMode;
    const count = props.mlStore.outputCount();
    if (mode === 'visual') return VISUAL_PARAM_NAMES[props.paramIndex] ?? `p${props.paramIndex}`;
    return `p${props.paramIndex}`;
  }

  function getCurrentValue(): number {
    const outputs = props.mlStore.outputs();
    return outputs[props.paramIndex] ?? 0;
  }

  function redrawCurve() {
    if (!curveCanvasRef) return;
    const ctx = curveCanvasRef.getContext('2d')!;
    drawCurveOnCanvas(ctx, curveValue(), getColor(), curveCanvasRef.width, curveCanvasRef.height);
  }

  // ─── Curve drag handler ───

  function onCurvePointerDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!curveCanvasRef) return;
    curveCanvasRef.setPointerCapture(e.pointerId);
    curveDragging = true;
    curveStartY = e.clientY;
    curveStartVal = curveValue();
  }

  function onCurvePointerMove(e: PointerEvent) {
    if (!curveDragging || !curveCanvasRef) return;
    e.preventDefault();
    // Drag down = higher curve, drag up = lower curve
    const dy = e.clientY - curveStartY;
    const newVal = Math.max(0, Math.min(1, curveStartVal + dy / 80));
    setCurveValue(newVal);
    props.mlStore.setParamOverride(props.paramIndex, 'curve', newVal);
    redrawCurve();
  }

  function onCurvePointerUp() {
    curveDragging = false;
  }

  function onCurvePointerCancel() {
    curveDragging = false;
  }

  // ─── Range slider handlers ───

  function onMinInput(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    setMinValue(val);
    // Enforce min <= max
    if (val > maxValue()) {
      setMaxValue(val);
      props.mlStore.setParamOverride(props.paramIndex, 'max', val);
    }
    props.mlStore.setParamOverride(props.paramIndex, 'min', val);
  }

  function onMaxInput(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    setMaxValue(val);
    // Enforce max >= min
    if (val < minValue()) {
      setMinValue(val);
      props.mlStore.setParamOverride(props.paramIndex, 'min', val);
    }
    props.mlStore.setParamOverride(props.paramIndex, 'max', val);
  }

  // ─── Freeze toggle ───

  function toggleFreeze() {
    const newFrozen = !frozen();
    setFrozen(newFrozen);
    props.mlStore.setParamOverride(props.paramIndex, 'frozen', newFrozen);

    // When freezing, capture the current output value
    if (newFrozen) {
      const currentVal = getCurrentValue();
      setFixedValue(currentVal);
      props.mlStore.setParamOverride(props.paramIndex, 'fixedValue', currentVal);
    }
  }

  function onFixedValueInput(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    setFixedValue(val);
    props.mlStore.setParamOverride(props.paramIndex, 'fixedValue', val);
  }

  // ─── Positioning ───

  const popupWidth = 260;
  const left = () => {
    const centered = props.cellRect.left + props.cellRect.width / 2 - popupWidth / 2;
    return Math.max(4, Math.min(centered, window.innerWidth - popupWidth - 4));
  };
  const top = () => props.cellRect.bottom + 4;

  // ─── Range fill positioning ───

  const rangeFillLeft = () => `${minValue() * 100}%`;
  const rangeFillWidth = () => `${(maxValue() - minValue()) * 100}%`;

  return (
    <div
      class="param-popup visible"
      id="param-popup"
      style={{
        left: `${left()}px`,
        top: `${top()}px`,
        width: `${popupWidth}px`,
      }}
    >
      {/* Header: param name + value + close */}
      <div class="pp-header">
        <span class="pp-name" style={{ color: getColor() }}>{getName()}</span>
        <span class="pp-value">{getCurrentValue().toFixed(3)}</span>
        <button class="pp-close" onClick={props.onClose}>×</button>
      </div>

      <div class="pp-body">
        {/* Curve row */}
        <div class="pp-row">
          <span class="pp-label">Curve</span>
          <canvas
            ref={curveCanvasRef}
            class="pp-curve-canvas"
            width={36}
            height={36}
            onPointerDown={onCurvePointerDown}
            onPointerMove={onCurvePointerMove}
            onPointerUp={onCurvePointerUp}
            onPointerCancel={onCurvePointerCancel}
          />
          <span class="pp-val">{curveValue().toFixed(2)}</span>
        </div>

        {/* Range row */}
        <div class="pp-row">
          <span class="pp-label">Range</span>
          <div class="pp-range-wrap">
            <div
              class="pp-range-fill"
              style={{
                left: rangeFillLeft(),
                width: rangeFillWidth(),
              }}
            />
            <input
              type="range"
              class="pp-range-input pp-range-min"
              min="0"
              max="1"
              step="0.01"
              value={minValue()}
              onInput={onMinInput}
            />
            <input
              type="range"
              class="pp-range-input pp-range-max"
              min="0"
              max="1"
              step="0.01"
              value={maxValue()}
              onInput={onMaxInput}
            />
          </div>
          <span class="pp-val">{minValue().toFixed(2)}–{maxValue().toFixed(2)}</span>
        </div>

        {/* Freeze row */}
        <div class="pp-row pp-freeze-row">
          <button
            class={`pp-freeze-btn${frozen() ? ' frozen' : ''}`}
            onClick={toggleFreeze}
            title={frozen() ? 'Unfreeze — re-enable NISPS control' : 'Freeze — lock value, disable NISPS'}
          >
            {frozen() ? 'Frozen' : 'Freeze'}
          </button>
          <Show when={frozen()}>
            <input
              type="range"
              class="pp-val-slider"
              min="0"
              max="1"
              step="0.01"
              value={fixedValue()}
              onInput={onFixedValueInput}
            />
          </Show>
          <Show when={frozen()}>
            <span class="pp-val">{fixedValue().toFixed(2)}</span>
          </Show>
        </div>
      </div>
    </div>
  );
}
