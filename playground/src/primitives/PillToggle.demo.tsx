import { Component, createSignal } from 'solid-js';
import { PillToggle } from './PillToggle';

export const PillToggleDemo: Component = () => {
  const [mode, setMode] = createSignal('synth');
  const [size, setSize] = createSignal('m');
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px', 'align-items': 'flex-start' }}>
      <PillToggle
        options={[
          { value: 'visual', label: 'Visual' },
          { value: 'synth', label: 'Synth' },
          { value: 'midi', label: 'MIDI CC' },
        ]}
        value={mode}
        onChange={setMode}
      />
      <PillToggle
        options={[
          { value: 's', label: 'S' },
          { value: 'm', label: 'M' },
          { value: 'l', label: 'L' },
          { value: 'xl', label: 'XL' },
        ]}
        value={size}
        onChange={setSize}
      />
    </div>
  );
};
