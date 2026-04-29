/**
 * Trail tracking — fixed-size ring of recent input positions for the JoyMap
 * vanishing trail and tap-to-return.
 *
 * Uses `performance.now()` for timestamps. The JoyMap primitive filters by
 * age internally (5-second window), so the buffer can be larger than the
 * displayed window.
 */

import { createSignal, type Accessor } from 'solid-js';

export interface TrailPoint {
  x: number;
  y: number;
  t: number; // performance.now()
}

const MAX_POINTS = 300;
const MIN_DELTA_PX = 0.005; // skip near-duplicate points (in 0..1 space)

export interface TrailRing {
  /** Reactive accessor for current points. */
  points: Accessor<ReadonlyArray<TrailPoint>>;
  push(x: number, y: number): void;
  clear(): void;
}

export function createTrailRing(): TrailRing {
  const [points, setPoints] = createSignal<ReadonlyArray<TrailPoint>>([], { equals: false });

  let buf: TrailPoint[] = [];

  return {
    points,
    push(x, y) {
      const now = performance.now();
      // Skip if too close to last point.
      const last = buf.length > 0 ? buf[buf.length - 1] : null;
      if (last) {
        const dx = x - last.x;
        const dy = y - last.y;
        if (dx * dx + dy * dy < MIN_DELTA_PX * MIN_DELTA_PX && now - last.t < 50) {
          return;
        }
      }
      buf.push({ x, y, t: now });
      if (buf.length > MAX_POINTS) buf.shift();
      setPoints(buf.slice());
    },
    clear() {
      buf = [];
      setPoints([]);
    },
  };
}
