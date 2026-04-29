import { Component, createSignal, onCleanup, onMount } from 'solid-js';
import { JoyMap, type TrailPoint, type RegionPin } from './JoyMap';
import { Slider } from './Slider';

export const JoyMapDemo: Component = () => {
  const [zoom, setZoom] = createSignal(0.5);
  const [pos, setPos] = createSignal<readonly [number, number]>([0.5, 0.5]);
  const [trail, setTrail] = createSignal<TrailPoint[]>([]);
  const [pins] = createSignal<RegionPin[]>([
    { id: 'p1', x: 0.6, y: 0.5, width: 0.18, height: 0.18, colorSlot: 0 },
    { id: 'p2', x: 0.18, y: 0.18, width: 0.12, height: 0.12, colorSlot: 1 },
  ]);
  const [frozen, setFrozen] = createSignal(false);

  // Simulated wandering position
  let raf = 0;
  let t0 = performance.now();
  const animate = () => {
    const t = (performance.now() - t0) / 1000;
    const x = 0.5 + 0.4 * Math.sin(t * 0.4);
    const y = 0.5 + 0.4 * Math.cos(t * 0.65);
    setPos([x, y]);
    setTrail((prev) => {
      const next = [...prev, { x, y, t: performance.now() }];
      // Cap trail length to avoid runaway growth
      return next.slice(-200);
    });
    raf = requestAnimationFrame(animate);
  };
  onMount(() => { raf = requestAnimationFrame(animate); });
  onCleanup(() => cancelAnimationFrame(raf));

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'align-items': 'flex-start' }}>
      <JoyMap
        size={220}
        zoom={zoom}
        anchor={pos}
        position={pos}
        trail={trail}
        regionPins={pins}
        noiseRings={() => [0.18, 0.06]}
        onTrailTap={(p) => setPos([p.x, p.y])}
        frozen={frozen}
      />
      <Slider value={zoom()} onChange={setZoom} min={0.01} max={1} label="zoom" />
      <button type="button" onClick={() => setFrozen((f) => !f)}>
        {frozen() ? 'Unfreeze' : 'Freeze'}
      </button>
    </div>
  );
};
