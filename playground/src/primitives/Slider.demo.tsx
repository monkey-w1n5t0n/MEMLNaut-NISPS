import { Component, createSignal } from 'solid-js';
import { Slider } from './Slider';

export const SliderDemo: Component = () => {
  const [linear, setLinear] = createSignal(0.5);
  const [exp, setExp] = createSignal(20);
  const [neg, setNeg] = createSignal(0);
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px', 'min-width': '280px' }}>
      <Slider value={linear()} onChange={setLinear} min={0} max={1} step={0.01} label="linear" />
      <Slider value={exp()} onChange={setExp} min={1} max={1000} curve="exp" label="exp (1..1000)" unit="hz" />
      <Slider value={neg()} onChange={setNeg} min={-50} max={50} step={1} label="bipolar (-50..50)" />
    </div>
  );
};
