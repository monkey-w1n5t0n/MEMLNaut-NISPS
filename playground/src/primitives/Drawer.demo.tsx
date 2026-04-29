import { Component, createSignal } from 'solid-js';
import { Drawer } from './Drawer';

export const DrawerDemo: Component = () => {
  const [openR, setOpenR] = createSignal(false);
  const [openL, setOpenL] = createSignal(false);
  return (
    <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
      <button type="button" onClick={() => setOpenL(true)}>Open Left</button>
      <button type="button" onClick={() => setOpenR(true)}>Open Right</button>
      <Drawer open={openL()} onClose={() => setOpenL(false)} side="left" title="Left drawer">
        <p>Slides in from the left.</p>
        <p>Press Escape, click outside, or click × to close.</p>
      </Drawer>
      <Drawer open={openR()} onClose={() => setOpenR(false)} side="right" title="Right drawer">
        <p>Slides in from the right.</p>
        <p>Mode-specific drawers will use this primitive.</p>
      </Drawer>
    </div>
  );
};
