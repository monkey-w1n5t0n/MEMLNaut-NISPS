import { Component, createSignal } from 'solid-js';
import { XYPad } from './XYPad';

export const XYPadDemo: Component = () => {
  const [pos, setPos] = createSignal<readonly [number, number]>([0.5, 0.5]);
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'align-items': 'center' }}>
      <XYPad size={240} position={pos} onMove={(x, y) => setPos([x, y])} />
      <code style={{ 'font-size': '11px', color: 'var(--fg-mute)' }}>
        x={pos()[0].toFixed(3)} y={pos()[1].toFixed(3)}
      </code>
    </div>
  );
};
