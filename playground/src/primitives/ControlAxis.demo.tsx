import { Component, createSignal } from 'solid-js';
import { ControlAxis } from './ControlAxis';

export const ControlAxisDemo: Component = () => {
  const [boldness, setBoldness] = createSignal(0.5);
  const [memory, setMemory] = createSignal(0.7);
  const [precision, setPrecision] = createSignal(0.3);
  const [preset, setPreset] = createSignal<string | null>('default');

  const onAny = () => setPreset(null);

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px', 'min-width': '320px' }}>
      <ControlAxis
        label="Boldness"
        value={boldness}
        onChange={(v) => { setBoldness(v); onAny(); }}
        preset={preset}
        endpoints={['Caution', 'Bold']}
        accentColor="var(--accent)"
        onDoubleTap={() => setBoldness(0.5)}
      />
      <ControlAxis
        label="Memory"
        value={memory}
        onChange={(v) => { setMemory(v); onAny(); }}
        preset={preset}
        endpoints={['Amnesia', 'Elephant']}
        accentColor="var(--accent-2)"
        onDoubleTap={() => setMemory(0.5)}
      />
      <ControlAxis
        label="Precision"
        value={precision}
        onChange={(v) => { setPrecision(v); onAny(); }}
        preset={preset}
        endpoints={['Raw', 'Precise']}
        accentColor="var(--good)"
        onDoubleTap={() => setPrecision(0.3)}
      />
    </div>
  );
};
