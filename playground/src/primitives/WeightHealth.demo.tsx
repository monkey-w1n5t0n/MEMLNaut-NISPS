import { Component, createMemo, createSignal } from 'solid-js';
import { WeightHealth, type WeightStatus } from './WeightHealth';
import { PillToggle } from './PillToggle';

export const WeightHealthDemo: Component = () => {
  const [status, setStatus] = createSignal<WeightStatus>('healthy');

  const histogram = createMemo<number[]>(() => {
    const bins = new Array(10).fill(0);
    const s = status();
    if (s === 'dead') {
      bins[0] = 80; bins[1] = 12; bins[2] = 4; bins[3] = 2;
    } else if (s === 'saturating') {
      bins[7] = 12; bins[8] = 24; bins[9] = 60;
    } else {
      // healthy bell-ish
      for (let i = 0; i < 10; i++) {
        bins[i] = 30 * Math.exp(-Math.pow((i - 4.5) / 2.5, 2));
      }
    }
    return bins;
  });

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'align-items': 'flex-start' }}>
      <WeightHealth histogram={histogram} status={status} />
      <PillToggle
        options={[
          { value: 'healthy', label: 'Healthy' },
          { value: 'dead', label: 'Dead' },
          { value: 'saturating', label: 'Saturating' },
        ]}
        value={status}
        onChange={(v) => setStatus(v as WeightStatus)}
      />
    </div>
  );
};
