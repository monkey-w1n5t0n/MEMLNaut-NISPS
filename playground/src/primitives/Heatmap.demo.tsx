import { Component, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Heatmap, type HeatmapColorMode } from './Heatmap';
import { PillToggle } from './PillToggle';

const N = 16;

function generateField(seed: number): Float32Array {
  const arr = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const fx = (x - N / 2) / (N / 2);
      const fy = (y - N / 2) / (N / 2);
      const r = Math.sqrt(fx * fx + fy * fy);
      const v = 0.5 + 0.5 * Math.sin(r * 3 + seed * 0.5) * Math.cos(fx * 4 + seed);
      arr[y * N + x] = Math.max(0, Math.min(1, v));
    }
  }
  return arr;
}

export const HeatmapDemo: Component = () => {
  const [mode, setMode] = createSignal<HeatmapColorMode>('luminance');
  const [tick, setTick] = createSignal(0);
  let timer: ReturnType<typeof setInterval>;
  onMount(() => {
    timer = setInterval(() => setTick((t) => t + 1), 200);
  });
  onCleanup(() => clearInterval(timer));

  const samples = createMemo(() => generateField(tick()));

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px', 'align-items': 'center' }}>
      <Heatmap samples={samples} resolution={N} colorMode={mode()} size={240} showGrid={false} />
      <PillToggle
        options={[
          { value: 'luminance', label: 'Luminance' },
          { value: 'variance', label: 'Variance' },
          { value: 'divergence', label: 'Divergence' },
        ]}
        value={mode}
        onChange={(v) => setMode(v as HeatmapColorMode)}
      />
    </div>
  );
};
