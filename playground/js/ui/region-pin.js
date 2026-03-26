// Region Pin Manager — Pin rectangular input-space regions (Approach A: Example Pinning)
//
// Pinned regions capture training examples whose inputs fall within a rectangle
// in the 2D input space. These pinned examples:
//   - Are always included in training with high weight
//   - Cannot be evicted by FIFO example rotation
//   - Anchor behavior in that region while the user explores elsewhere
//
// Up to 5 pinned regions, each with a distinct color from the palette.
//
// Usage:
//   import { RegionPinManager } from './region-pin.js';
//   const regionPins = new RegionPinManager();
//   const id = regionPins.pin({ x1: 0.2, y1: 0.3, x2: 0.5, y2: 0.7 }, examples);
//   const pinned = regionPins.getPinnedExamples(); // { features: [...], labels: [...] }

const MAX_PINS = 5;

// Distinct colors for pinned region overlays (used for joy-map rendering)
const PIN_PALETTE = [
  'rgba(0, 188, 212, 0.15)',   // teal
  'rgba(156, 39, 176, 0.15)',  // purple
  'rgba(255, 193, 7, 0.15)',   // amber
  'rgba(233, 30, 99, 0.15)',   // rose
  'rgba(139, 195, 74, 0.15)',  // lime
];

let _nextId = 1;

export class RegionPinManager {
  constructor() {
    // Array of { id, region: {x1,y1,x2,y2}, color, examples: { features: [[]], labels: [[]] } }
    this._pins = [];
  }

  // ---- Public API ----

  /**
   * Pin a region. Captures examples whose inputs fall within the region.
   * @param {{ x1: number, y1: number, x2: number, y2: number }} region
   *   Normalized [0,1] coordinates. x1 < x2, y1 < y2.
   * @param {{ features: Array<Array<number>>, labels: Array<Array<number>> }} examples
   *   The current full training dataset to filter from.
   * @returns {number} Pin ID, or -1 if at capacity.
   */
  pin(region, examples) {
    if (this._pins.length >= MAX_PINS) {
      console.warn('[RegionPin] Max pins reached (' + MAX_PINS + ')');
      return -1;
    }

    // Normalize region bounds
    const r = {
      x1: Math.min(region.x1, region.x2),
      y1: Math.min(region.y1, region.y2),
      x2: Math.max(region.x1, region.x2),
      y2: Math.max(region.y1, region.y2),
    };

    // Filter examples whose inputs fall within the region
    const pinnedFeatures = [];
    const pinnedLabels = [];
    if (examples && examples.features) {
      for (let i = 0; i < examples.features.length; i++) {
        const f = examples.features[i];
        // Inputs are the first 2 elements (joystick X, Y) — without bias
        const x = f[0];
        const y = f.length > 1 ? f[1] : 0.5;
        if (x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2) {
          pinnedFeatures.push([...f]);
          pinnedLabels.push([...(examples.labels[i] || [])]);
        }
      }
    }

    const id = _nextId++;
    const colorIndex = this._pins.length % PIN_PALETTE.length;

    this._pins.push({
      id,
      region: r,
      color: PIN_PALETTE[colorIndex],
      examples: {
        features: pinnedFeatures,
        labels: pinnedLabels,
      },
    });

    this._dispatch('regionpin:add', {
      id,
      region: r,
      exampleCount: pinnedFeatures.length,
      total: this._pins.length,
    });

    return id;
  }

  /**
   * Remove a pinned region by ID.
   * @param {number} pinId
   * @returns {boolean} True if removed.
   */
  unpin(pinId) {
    const idx = this._pins.findIndex(p => p.id === pinId);
    if (idx < 0) return false;
    this._pins.splice(idx, 1);
    this._dispatch('regionpin:remove', { id: pinId, total: this._pins.length });
    return true;
  }

  /**
   * Get all pinned regions for joy-map overlay rendering.
   * @returns {Array<{ id: number, region: {x1,y1,x2,y2}, color: string, exampleCount: number }>}
   */
  getRegions() {
    return this._pins.map(p => ({
      id: p.id,
      region: { ...p.region },
      color: p.color,
      exampleCount: p.examples.features.length,
    }));
  }

  /**
   * Get all pinned examples merged together (for training).
   * These should always be included in the training set alongside regular examples.
   * @returns {{ features: Array<Array<number>>, labels: Array<Array<number>> }}
   */
  getPinnedExamples() {
    const features = [];
    const labels = [];
    for (const pin of this._pins) {
      for (let i = 0; i < pin.examples.features.length; i++) {
        features.push(pin.examples.features[i]);
        labels.push(pin.examples.labels[i]);
      }
    }
    return { features, labels };
  }

  /**
   * Check if a 2D input point falls within any pinned region.
   * @param {Array<number>} inputs  [x, y, ...]
   * @returns {boolean}
   */
  isInPinnedRegion(inputs) {
    const x = inputs[0];
    const y = inputs.length > 1 ? inputs[1] : 0.5;
    for (const pin of this._pins) {
      const r = pin.region;
      if (x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2) {
        return true;
      }
    }
    return false;
  }

  /**
   * Current number of pinned regions.
   * @returns {number}
   */
  get count() {
    return this._pins.length;
  }

  // ---- Serialization ----

  getState() {
    return {
      pins: this._pins.map(p => ({
        id: p.id,
        region: { ...p.region },
        color: p.color,
        examples: {
          features: p.examples.features.map(f => [...f]),
          labels: p.examples.labels.map(l => [...l]),
        },
      })),
    };
  }

  setState(saved) {
    if (!saved || !Array.isArray(saved.pins)) return;
    this._pins = saved.pins.map(p => ({
      id: p.id || _nextId++,
      region: p.region || { x1: 0, y1: 0, x2: 1, y2: 1 },
      color: p.color || PIN_PALETTE[0],
      examples: {
        features: (p.examples?.features || []).map(f => [...f]),
        labels: (p.examples?.labels || []).map(l => [...l]),
      },
    }));
    // Advance ID counter past any restored IDs
    for (const p of this._pins) {
      if (p.id >= _nextId) _nextId = p.id + 1;
    }
  }

  // ---- Internal ----

  _dispatch(type, detail) {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
