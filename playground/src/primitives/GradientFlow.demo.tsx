import { Component, createMemo, createSignal } from 'solid-js';
import { GradientFlow, type GradientStatus } from './GradientFlow';
import { PillToggle } from './PillToggle';

export const GradientFlowDemo: Component = () => {
  const [pattern, setPattern] = createSignal<'healthy' | 'vanishing' | 'exploding'>('healthy');

  const norms = createMemo<number[]>(() => {
    const p = pattern();
    if (p === 'vanishing') return [1.0, 0.4, 0.15, 0.04];
    if (p === 'exploding') return [0.4, 0.8, 1.6, 3.2];
    return [0.6, 0.55, 0.5, 0.5];
  });

  const status = createMemo<GradientStatus[]>(() => {
    const p = pattern();
    if (p === 'vanishing') return ['healthy', 'vanishing', 'vanishing', 'vanishing'];
    if (p === 'exploding') return ['healthy', 'healthy', 'exploding', 'exploding'];
    return ['healthy', 'healthy', 'healthy', 'healthy'];
  });

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'align-items': 'flex-start' }}>
      <GradientFlow layerNorms={norms} status={status} />
      <PillToggle
        options={[
          { value: 'healthy', label: 'Healthy' },
          { value: 'vanishing', label: 'Vanishing' },
          { value: 'exploding', label: 'Exploding' },
        ]}
        value={pattern}
        onChange={(v) => setPattern(v as 'healthy' | 'vanishing' | 'exploding')}
      />
    </div>
  );
};
