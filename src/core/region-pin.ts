/**
 * Region Pin Manager — Pin rectangular input-space regions (Approach A: Example Pinning)
 *
 * Pinned regions capture training examples whose inputs fall within a rectangle
 * in the 2D input space. These pinned examples:
 *   - Are always included in training with high weight
 *   - Cannot be evicted by FIFO example rotation
 *   - Anchor behavior in that region while the user explores elsewhere
 *
 * Up to 5 pinned regions, each with a distinct color from the palette.
 *
 * Ported from playground/js/ui/region-pin.js
 */

import type { Dataset } from './dataset';

// ─── Constants ───────────────────────────────────────────────────────

export const MAX_REGIONS = 5;

/** Distinct colors for pinned region overlays (used for joy-map rendering) */
export const REGION_PIN_PALETTE: readonly string[] = [
  '#ff6a00',
  '#00d4ff',
  '#ff00cc',
  '#88ff00',
  '#ffcc00',
];

// ─── Types ───────────────────────────────────────────────────────────

export interface PinnedRegion {
  /** Unique region identifier */
  id: number;
  /** Top-left corner X [0,1] */
  x1: number;
  /** Top-left corner Y [0,1] */
  y1: number;
  /** Bottom-right corner X [0,1] */
  x2: number;
  /** Bottom-right corner Y [0,1] */
  y2: number;
  /** CSS color from palette */
  color: string;
  /** Captured training examples within this region */
  examples: Array<{ input: number[]; output: number[] }>;
}

export interface RegionPinState {
  regions: Array<Omit<PinnedRegion, 'examples'> & {
    examples: Array<{ input: number[]; output: number[] }>;
  }>;
}

export interface RegionPinManager {
  /**
   * Add a new pinned region, capturing matching examples from the dataset.
   * Returns null if at max capacity (5 regions).
   */
  addRegion(x1: number, y1: number, x2: number, y2: number, dataset?: Dataset): PinnedRegion | null;

  /** Remove a pinned region by id. Returns true if removed. */
  removeRegion(id: number): boolean;

  /** Get all pinned regions (shallow copies, safe to iterate). */
  getRegions(): PinnedRegion[];

  /**
   * Capture examples from a dataset into an existing region.
   * Replaces any previously captured examples for that region.
   */
  captureExamples(region: PinnedRegion, dataset: Dataset): void;

  /** Get all pinned examples across all regions (merged). */
  getPinnedExamples(): Array<{ input: number[]; output: number[] }>;

  /**
   * Check if a 2D input point falls within any pinned region.
   * @param inputs [x, y, ...] — only first two dimensions are used.
   */
  isInPinnedRegion(inputs: number[]): boolean;

  /** Current number of pinned regions. */
  readonly count: number;

  /** Maximum number of regions allowed. */
  readonly maxRegions: number;

  /** Serialize state for save/restore. */
  getState(): RegionPinState;

  /** Restore state from serialized form. */
  setState(saved: RegionPinState): void;
}

// ─── Implementation ──────────────────────────────────────────────────

/** Auto-incrementing region ID counter (module-level, not reset on construction) */
let _nextId = 1;

export class RegionPinManagerImpl implements RegionPinManager {
  private _regions: PinnedRegion[] = [];

  readonly maxRegions = MAX_REGIONS;

  // ---- Public API ----

  addRegion(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dataset?: Dataset,
  ): PinnedRegion | null {
    if (this._regions.length >= MAX_REGIONS) {
      console.warn(`[RegionPin] Max regions reached (${MAX_REGIONS})`);
      return null;
    }

    // Normalize bounds so x1 < x2, y1 < y2
    const nx1 = Math.min(x1, x2);
    const ny1 = Math.min(y1, y2);
    const nx2 = Math.max(x1, x2);
    const ny2 = Math.max(y1, y2);

    const id = _nextId++;
    const color = REGION_PIN_PALETTE[this._regions.length % REGION_PIN_PALETTE.length];

    const region: PinnedRegion = {
      id,
      x1: nx1,
      y1: ny1,
      x2: nx2,
      y2: ny2,
      color,
      examples: [],
    };

    // Capture matching examples from dataset if provided
    if (dataset) {
      this._captureFromDataset(region, dataset);
    }

    this._regions.push(region);
    return region;
  }

  removeRegion(id: number): boolean {
    const idx = this._regions.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this._regions.splice(idx, 1);
    return true;
  }

  getRegions(): PinnedRegion[] {
    // Return shallow copies to prevent external mutation of examples arrays
    return this._regions.map((r) => ({
      ...r,
      examples: r.examples.map((ex) => ({ input: [...ex.input], output: [...ex.output] })),
    }));
  }

  captureExamples(region: PinnedRegion, dataset: Dataset): void {
    // Find the live region by id so examples are updated in-place
    const live = this._regions.find((r) => r.id === region.id);
    if (!live) return;
    this._captureFromDataset(live, dataset);
    // Sync the passed-in reference too (caller may hold it)
    region.examples = live.examples.map((ex) => ({ ...ex }));
  }

  getPinnedExamples(): Array<{ input: number[]; output: number[] }> {
    const merged: Array<{ input: number[]; output: number[] }> = [];
    for (const region of this._regions) {
      for (const ex of region.examples) {
        merged.push({ input: [...ex.input], output: [...ex.output] });
      }
    }
    return merged;
  }

  isInPinnedRegion(inputs: number[]): boolean {
    const x = inputs[0] ?? 0;
    const y = inputs.length > 1 ? inputs[1] : 0.5;
    for (const r of this._regions) {
      if (x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2) {
        return true;
      }
    }
    return false;
  }

  get count(): number {
    return this._regions.length;
  }

  // ---- Serialization ----

  getState(): RegionPinState {
    return {
      regions: this._regions.map((r) => ({
        id: r.id,
        x1: r.x1,
        y1: r.y1,
        x2: r.x2,
        y2: r.y2,
        color: r.color,
        examples: r.examples.map((ex) => ({
          input: [...ex.input],
          output: [...ex.output],
        })),
      })),
    };
  }

  setState(saved: RegionPinState): void {
    if (!saved || !Array.isArray(saved.regions)) return;
    this._regions = saved.regions.map((r) => ({
      id: r.id ?? _nextId++,
      x1: r.x1 ?? 0,
      y1: r.y1 ?? 0,
      x2: r.x2 ?? 1,
      y2: r.y2 ?? 1,
      color: r.color ?? REGION_PIN_PALETTE[0],
      examples: (r.examples ?? []).map((ex) => ({
        input: [...ex.input],
        output: [...ex.output],
      })),
    }));
    // Advance ID counter past any restored IDs to avoid collisions
    for (const r of this._regions) {
      if (r.id >= _nextId) _nextId = r.id + 1;
    }
  }

  // ---- Internal ----

  private _captureFromDataset(region: PinnedRegion, dataset: Dataset): void {
    const captured: Array<{ input: number[]; output: number[] }> = [];
    const features = dataset.features;
    const labels = dataset.labels;
    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      // Inputs are the first 2 elements (joystick X, Y) — no bias appended yet
      const x = f[0] ?? 0;
      const y = f.length > 1 ? f[1] : 0.5;
      if (x >= region.x1 && x <= region.x2 && y >= region.y1 && y <= region.y2) {
        captured.push({
          input: [...f],
          output: [...(labels[i] ?? [])],
        });
      }
    }
    region.examples = captured;
  }
}

/** Convenience factory function */
export function createRegionPinManager(): RegionPinManager {
  return new RegionPinManagerImpl();
}
