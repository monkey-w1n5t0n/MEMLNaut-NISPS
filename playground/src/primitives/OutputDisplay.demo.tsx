import { Component, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { OutputDisplay } from './OutputDisplay';

export const OutputDisplayDemo: Component = () => {
  const [tick, setTick] = createSignal(0);
  let raf = 0;
  let last = performance.now();
  const animate = (t: number) => {
    if (t - last > 80) {
      setTick((x) => x + 1);
      last = t;
    }
    raf = requestAnimationFrame(animate);
  };
  onMount(() => { raf = requestAnimationFrame(animate); });
  onCleanup(() => cancelAnimationFrame(raf));

  const values = createMemo(() => {
    const t = tick();
    const arr = new Float32Array(126);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = 0.5 + 0.5 * Math.sin(t * 0.05 + i * 0.21);
    }
    return arr;
  });

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
      <OutputDisplay values={values} width={320} height={80} />
      <OutputDisplay values={values} width={320} height={28} compact />
    </div>
  );
};
