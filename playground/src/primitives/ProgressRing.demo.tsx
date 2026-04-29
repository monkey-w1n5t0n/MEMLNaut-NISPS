import { Component, createSignal, onCleanup, onMount } from 'solid-js';
import { ProgressRing } from './ProgressRing';

export const ProgressRingDemo: Component = () => {
  const [p, setP] = createSignal(0);
  let timer: ReturnType<typeof setInterval>;
  onMount(() => {
    timer = setInterval(() => {
      setP((q) => (q + 0.02) % 1);
    }, 50);
  });
  onCleanup(() => clearInterval(timer));
  return (
    <div style={{ display: 'flex', gap: '12px', 'align-items': 'center' }}>
      <ProgressRing progress={p} size={32} />
      <ProgressRing progress={p} size={48} color="var(--accent-2)" />
      <ProgressRing progress={p} size={64} color="var(--good)" showLabel />
    </div>
  );
};
