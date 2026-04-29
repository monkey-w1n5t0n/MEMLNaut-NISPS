import { Component, createSignal } from 'solid-js';
import { VirtualJoystick } from './VirtualJoystick';

export const VirtualJoystickDemo: Component = () => {
  const [pos, setPos] = createSignal<readonly [number, number]>([0.5, 0.5]);
  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'align-items': 'center' }}>
      <VirtualJoystick
        size={200}
        position={pos}
        onMove={(x, y) => setPos([x, y])}
      />
      <code style={{ 'font-size': '11px', color: 'var(--fg-mute)' }}>
        x={pos()[0].toFixed(3)} y={pos()[1].toFixed(3)}
      </code>
    </div>
  );
};
