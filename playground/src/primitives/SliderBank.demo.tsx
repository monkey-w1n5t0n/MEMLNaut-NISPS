import { Component, createSignal } from 'solid-js';
import { SliderBank, type SliderConfig } from './SliderBank';

const CFG: SliderConfig[] = [
  { id: 'cutoff', label: 'Cutoff', min: 20, max: 20000, curve: 'exp', section: 'Filter', unit: 'Hz' },
  { id: 'res',    label: 'Resonance', min: 0, max: 1, step: 0.01, section: 'Filter' },
  { id: 'attack', label: 'Attack',  min: 0, max: 5, step: 0.01, section: 'Envelope', unit: 's' },
  { id: 'decay',  label: 'Decay',   min: 0, max: 5, step: 0.01, section: 'Envelope', unit: 's' },
  { id: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01, section: 'Envelope' },
  { id: 'release', label: 'Release', min: 0, max: 5, step: 0.01, section: 'Envelope', unit: 's' },
];

export const SliderBankDemo: Component = () => {
  const [values, setValues] = createSignal<number[]>([8000, 0.3, 0.05, 0.4, 0.7, 1.0]);
  return (
    <SliderBank
      sliders={CFG}
      values={values}
      onChange={(_id, v, i) => setValues((prev) => prev.map((x, j) => (j === i ? v : x)))}
      title="Synth"
      collapsedSections={[]}
    />
  );
};
