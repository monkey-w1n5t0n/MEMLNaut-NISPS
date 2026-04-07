/**
 * SynthVisualizer — Canvas2D bar chart for 126 synth parameter outputs.
 *
 * Ported from playground/js/a-app.js class SynthVisualizer.
 *
 * Features:
 *   - Vertical bars grouped by SYNTH_SECTIONS with per-section color
 *   - Small gap between sections
 *   - Section header labels at top (40px padding)
 *   - Smooth lerp animation — displayParams → params at 0.12/frame
 *   - Hover tooltip showing param name and current value
 *   - Drag-to-edit: pointerdown on a bar starts dragging, pointermove updates value
 *   - rebuild() adapts to different param layouts (non-C15 engines)
 */

import {
  SYNTH_SECTIONS,
  SYNTH_PARAM_MAP,
  type SynthSection,
} from '../synth/param-map';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SynthVisualizerLayout {
  W: number;
  H: number;
  n: number;
  barWidth: number;
  totalGapPx: number;
  sectionGaps: Set<number>;
  topPad: number;
  bottomPad: number;
  usableHeight: number;
  dpr: number;
  visibleIndices: number[];
}

export interface SectionLabelRegion {
  index: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  name: string;
}

export type DragCallback = (paramIndex: number, value: number) => void;

// ─── Color from group (fallback for rebuilt sections) ────────────────────────

const GROUP_COLORS: Record<string, string> = {};
for (const sec of SYNTH_SECTIONS) {
  GROUP_COLORS[sec.name] = sec.color;
}

function colorFromGroup(group: string): string {
  if (GROUP_COLORS[group]) return GROUP_COLORS[group];
  // Generate a deterministic hue from the group name hash
  let h = 0;
  for (let i = 0; i < group.length; i++) {
    h = (h * 31 + group.charCodeAt(i)) & 0xffffff;
  }
  return `hsl(${h % 360}, 60%, 55%)`;
}

// ─── Class ────────────────────────────────────────────────────────────────────

export class SynthVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Target values (from ML outputs)
  private params: number[];
  // Lerped display values
  private displayParams: number[];

  private lerpSpeed = 0.12;
  private topPadding = 40;
  private bottomPadding = 100;

  // Section map — one entry per param index
  private sectionMap: SynthSection[];
  // Param labels — one per param index
  private paramLabels: string[];

  // Interaction state
  private _dragging = false;
  private _dragBarIndex = -1;
  private _interactionEnabled = false;

  // Hover tooltip
  private _hoveredBar = -1;
  private _mouseCanvasX = 0;
  private _mouseCanvasY = 0;

  // Hit-test data populated each draw()
  private _layout: SynthVisualizerLayout | null = null;
  private _barXPositions: number[] = [];
  private _barWidths: number[] = [];
  private _sectionLabelRegions: SectionLabelRegion[] = [];

  // Pointer event handlers (stored for removeEventListener)
  private _onPointerMove: ((e: PointerEvent) => void) | null = null;
  private _onPointerDown: ((e: PointerEvent) => void) | null = null;
  private _onPointerUp: ((e: PointerEvent) => void) | null = null;

  // External callback fired when user drags a bar
  private _onDragValue: DragCallback | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('SynthVisualizer: could not get 2d context');
    this.ctx = ctx;

    const n = SYNTH_PARAM_MAP.length;
    this.params = new Array(n).fill(0.5);
    this.displayParams = new Array(n).fill(0.5);

    // Build section map from SYNTH_SECTIONS
    this.sectionMap = [];
    this.paramLabels = [];
    let idx = 0;
    for (const sec of SYNTH_SECTIONS) {
      for (let i = 0; i < sec.count && idx < n; i++, idx++) {
        this.sectionMap.push(sec);
        this.paramLabels.push(SYNTH_PARAM_MAP[idx]?.label ?? `p${idx}`);
      }
    }
    // Fill any remainder
    while (this.sectionMap.length < n) {
      this.sectionMap.push({ name: 'Other', count: 1, color: '#666666', startIndex: this.sectionMap.length });
      this.paramLabels.push(`p${this.sectionMap.length - 1}`);
    }

    // Always-on hover tracking for tooltip
    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (this._dragging) return;
      const i = this.hitTest(e.clientX, e.clientY);
      this._hoveredBar = i;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this._mouseCanvasX = (e.clientX - rect.left) * dpr;
      this._mouseCanvasY = (e.clientY - rect.top) * dpr;
    });
    canvas.addEventListener('pointerleave', () => {
      this._hoveredBar = -1;
    });

    this.resize();
  }

  // ─── rebuild: adapt to non-C15 engine param layout ─────────────────────────

  /**
   * Rebuild the visualizer for a different engine's param layout.
   * Derives sections from paramMeta's `group` field.
   */
  rebuild(paramMeta: Array<{ group?: string; label?: string; name?: string }>): void {
    if (!paramMeta || paramMeta.length === 0) return;

    // Derive sections from paramMeta groups
    const sections: Array<{ name: string; count: number; color: string }> = [];
    let currentGroup: string | null = null;
    let currentCount = 0;
    for (const pm of paramMeta) {
      const group = pm.group ?? 'Other';
      if (group !== currentGroup) {
        if (currentGroup !== null) {
          sections.push({ name: currentGroup, count: currentCount, color: colorFromGroup(currentGroup) });
        }
        currentGroup = group;
        currentCount = 0;
      }
      currentCount++;
    }
    if (currentGroup !== null) {
      sections.push({ name: currentGroup, count: currentCount, color: colorFromGroup(currentGroup) });
    }

    // Rebuild sectionMap
    this.sectionMap = [];
    this.paramLabels = [];
    let si = 0;
    for (const sec of sections) {
      for (let i = 0; i < sec.count; i++) {
        const pm = paramMeta[si + i];
        this.sectionMap.push({ ...sec, startIndex: si });
        this.paramLabels.push(pm?.label ?? pm?.name ?? `p${si + i}`);
      }
      si += sec.count;
    }

    const n = paramMeta.length;
    this.params = new Array(n).fill(0.5);
    this.displayParams = new Array(n).fill(0.5);
  }

  // ─── resize ──────────────────────────────────────────────────────────────────

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.offsetWidth * dpr;
    this.canvas.height = this.canvas.offsetHeight * dpr;
  }

  // ─── setParams ───────────────────────────────────────────────────────────────

  setParams(outputs: Float32Array | number[]): void {
    const n = this.params.length;
    for (let i = 0; i < n && i < outputs.length; i++) {
      this.params[i] = outputs[i];
    }
  }

  // ─── draw ────────────────────────────────────────────────────────────────────

  draw(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const n = this.params.length;

    // Lerp display values toward targets
    for (let i = 0; i < n; i++) {
      this.displayParams[i] += (this.params[i] - this.displayParams[i]) * this.lerpSpeed;
    }

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    // All params are visible (no muted concept in this port — the store already
    // handles overrides/freeze, so we show all bars)
    const visibleIndices: number[] = [];
    for (let i = 0; i < n; i++) visibleIndices.push(i);
    const nVisible = visibleIndices.length || 1;

    // Calculate section gap positions
    const sectionGaps = new Set<number>();
    let prevSecName: string | null = null;
    for (const vi of visibleIndices) {
      const secName = this.sectionMap[vi]?.name ?? 'Other';
      if (prevSecName !== null && secName !== prevSecName) {
        sectionGaps.add(vi);
      }
      prevSecName = secName;
    }

    const topPad = this.topPadding * dpr;
    const bottomPad = this.bottomPadding * dpr;
    const totalGapPx = sectionGaps.size * 2 * dpr;
    const barAreaWidth = W - totalGapPx;
    const barWidth = barAreaWidth / nVisible;
    const usableHeight = H - topPad - bottomPad;
    const maxBarHeight = usableHeight;

    this._layout = {
      W, H, n, barWidth, totalGapPx, sectionGaps, topPad, bottomPad, usableHeight, dpr, visibleIndices,
    };

    this._barXPositions = new Array(n).fill(-1);
    this._barWidths = new Array(n).fill(0);
    this._sectionLabelRegions = [];

    let x = 0;
    let prevSec: SynthSection | null = null;
    let sectionStartX = 0;
    let sectionIndex = -1;

    for (let vi = 0; vi < visibleIndices.length; vi++) {
      const i = visibleIndices[vi];
      const sec: SynthSection = this.sectionMap[i] ?? { name: 'Other', count: 1, color: '#666666', startIndex: i };
      const curSi = SYNTH_SECTIONS.indexOf(sec);

      // Section divider gap
      if (sectionGaps.has(i)) {
        if (prevSec) {
          this._drawSectionLabel(ctx, prevSec.name, sectionStartX, x, topPad, prevSec.color);
          this._sectionLabelRegions.push({
            index: sectionIndex,
            left: sectionStartX / dpr,
            right: x / dpr,
            top: 0,
            bottom: topPad / dpr,
            name: prevSec.name,
          });
        }
        sectionIndex = curSi;
        x += 2 * dpr;
        sectionStartX = x;
        prevSec = sec;
      }

      if (vi === 0) {
        sectionStartX = x;
        prevSec = sec;
        sectionIndex = curSi;
      }

      this._barXPositions[i] = x;
      this._barWidths[i] = barWidth;

      const val = this.displayParams[i];
      const barH = val * maxBarHeight;
      const barY = topPad + usableHeight - barH;

      // Bar with slight transparency
      ctx.fillStyle = sec.color + 'cc';
      ctx.fillRect(x, barY, Math.max(barWidth - 0.5, 1), barH);

      // Bright top edge
      ctx.fillStyle = sec.color;
      ctx.fillRect(x, barY, Math.max(barWidth - 0.5, 1), Math.min(2 * dpr, barH));

      x += barWidth;
    }

    // Draw final section label
    if (prevSec) {
      this._drawSectionLabel(ctx, prevSec.name, sectionStartX, x, topPad, prevSec.color);
      this._sectionLabelRegions.push({
        index: sectionIndex,
        left: sectionStartX / dpr,
        right: x / dpr,
        top: 0,
        bottom: topPad / dpr,
        name: prevSec.name,
      });
    }

    // Draw tooltip for hovered bar
    this._drawTooltip(ctx, dpr);
  }

  // ─── _drawSectionLabel ───────────────────────────────────────────────────────

  private _drawSectionLabel(
    ctx: CanvasRenderingContext2D,
    name: string,
    startX: number,
    endX: number,
    topPad: number,
    color: string,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const fontSize = 9 * dpr;
    ctx.save();
    ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = color + '88';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const cx = (startX + endX) / 2;
    ctx.fillText(name, cx, topPad - 4 * dpr);
    ctx.restore();
  }

  // ─── _drawTooltip ────────────────────────────────────────────────────────────

  private _drawTooltip(ctx: CanvasRenderingContext2D, dpr: number): void {
    const i = this._hoveredBar;
    if (i < 0 || !this._layout) return;
    if (this._barXPositions[i] < 0) return;

    const label = this.paramLabels[i] ?? `p${i}`;
    const val = this.displayParams[i];
    const lines = [label, `Val: ${val.toFixed(2)}`];

    const fontSize = 10 * dpr;
    const lineHeight = fontSize * 1.4;
    const padX = 8 * dpr;
    const padY = 6 * dpr;

    ctx.save();
    ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;

    // Measure text
    let maxW = 0;
    for (const line of lines) {
      const m = ctx.measureText(line);
      if (m.width > maxW) maxW = m.width;
    }
    const boxW = maxW + padX * 2;
    const boxH = lines.length * lineHeight + padY * 2;

    // Position near the mouse cursor
    const mx = this._mouseCanvasX;
    const my = this._mouseCanvasY;
    const offset = 12 * dpr;
    let tx = mx + offset;
    let ty = my - boxH - offset;
    // Clamp to canvas
    if (tx + boxW > this._layout.W - 2 * dpr) tx = mx - boxW - offset;
    if (ty < 2 * dpr) ty = my + offset;
    if (tx < 2 * dpr) tx = 2 * dpr;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    const r = 4 * dpr;
    ctx.beginPath();
    (ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect?.(tx, ty, boxW, boxH, r);
    ctx.fill();
    ctx.stroke();

    // Text
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let li = 0; li < lines.length; li++) {
      ctx.fillStyle = li === 0 ? '#ffffff' : 'rgba(255,255,255,0.6)';
      ctx.font = li === 0
        ? `bold ${fontSize}px 'JetBrains Mono', monospace`
        : `${fontSize}px 'JetBrains Mono', monospace`;
      ctx.fillText(lines[li], tx + padX, ty + padY + li * lineHeight);
    }
    ctx.restore();
  }

  // ─── Hit testing ─────────────────────────────────────────────────────────────

  /** Returns param index at client coordinates, or -1 */
  hitTest(clientX: number, clientY: number): number {
    if (!this._barXPositions.length || !this._layout) return -1;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this._layout.dpr;
    const px = (clientX - rect.left) * dpr;
    const n = this._layout.n;
    for (let i = 0; i < n; i++) {
      const bx = this._barXPositions[i];
      if (bx < 0) continue;
      const bw = this._barWidths[i] || this._layout.barWidth;
      if (px >= bx && px < bx + bw) return i;
    }
    return -1;
  }

  /** Returns section label region at client coordinates, or null */
  hitTestSection(clientX: number, clientY: number): SectionLabelRegion | null {
    if (!this._sectionLabelRegions) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    for (const region of this._sectionLabelRegions) {
      if (px >= region.left && px <= region.right && py >= region.top && py <= region.bottom) {
        return region;
      }
    }
    return null;
  }

  /** Returns 0-1 value from clientY (top of bar area = 1, bottom = 0) */
  yToValue(clientY: number): number {
    if (!this._layout) return 0.5;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this._layout.dpr;
    const py = (clientY - rect.top) * dpr;
    const { topPad, usableHeight } = this._layout;
    const val = 1 - (py - topPad) / usableHeight;
    return Math.max(0, Math.min(1, val));
  }

  // ─── Interaction ──────────────────────────────────────────────────────────────

  /** Register a callback invoked when the user drags a bar. */
  setDragCallback(cb: DragCallback | null): void {
    this._onDragValue = cb;
  }

  enableInteraction(enabled: boolean): void {
    if (enabled && !this._interactionEnabled) {
      this._interactionEnabled = true;
      this.canvas.style.cursor = 'crosshair';

      this._onPointerDown = (e: PointerEvent) => {
        const idx = this.hitTest(e.clientX, e.clientY);
        if (idx < 0) return;
        e.preventDefault();
        this._dragging = true;
        this._dragBarIndex = idx;
        this.canvas.setPointerCapture(e.pointerId);
        const val = this.yToValue(e.clientY);
        this.params[idx] = val;
        this._onDragValue?.(idx, val);
      };

      this._onPointerMove = (e: PointerEvent) => {
        if (!this._dragging) return;
        e.preventDefault();
        // Allow sliding to adjacent bars
        let idx = this.hitTest(e.clientX, e.clientY);
        if (idx < 0) idx = this._dragBarIndex;
        this._dragBarIndex = idx;
        const val = this.yToValue(e.clientY);
        this.params[idx] = val;
        this._onDragValue?.(idx, val);
      };

      this._onPointerUp = (_e: PointerEvent) => {
        this._dragging = false;
        this._dragBarIndex = -1;
      };

      this.canvas.addEventListener('pointerdown', this._onPointerDown);
      this.canvas.addEventListener('pointermove', this._onPointerMove);
      this.canvas.addEventListener('pointerup', this._onPointerUp);
      this.canvas.addEventListener('pointercancel', this._onPointerUp);

    } else if (!enabled && this._interactionEnabled) {
      this._interactionEnabled = false;
      this.canvas.style.cursor = '';
      this._dragging = false;
      this._dragBarIndex = -1;
      this._hoveredBar = -1;

      if (this._onPointerDown) {
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove!);
        this.canvas.removeEventListener('pointerup', this._onPointerUp!);
        this.canvas.removeEventListener('pointercancel', this._onPointerUp!);
        this._onPointerDown = null;
        this._onPointerMove = null;
        this._onPointerUp = null;
      }
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  dispose(): void {
    this.enableInteraction(false);
  }
}
