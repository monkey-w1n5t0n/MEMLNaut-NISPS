/**
 * ChannelStripMode — channel-strip processor controlled by joystick.
 *
 * 24 outputs feed EQ / dynamics / gain. Settings drawer is the default
 * SettingsDrawer (input/training/exploration/output/overrides/advanced).
 */

import { Component } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { VirtualJoystick } from '../primitives/VirtualJoystick';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { LossPlot } from '../primitives/LossPlot';
import { ChannelStripSchema } from './generated/channel_strip_schema';

export const ChannelStripMode: Component = () => {
  const schema = ChannelStripSchema;
  const runtime = useModeRuntime(schema);

  return (
    <ModeShell
      schema={schema}
      runtime={runtime}
      drawerTitle="Channel strip settings"
      primaryInput={() => (
        <>
          <VirtualJoystick
            size={260}
            ariaLabel="Channel strip joystick"
            onMove={(x, y) => runtime.setInput(x, y)}
            position={runtime.pipedInput}
          />
          <span style={{ 'font-size': 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
            Mix EQ + dynamics by moving the joystick.
          </span>
        </>
      )}
      outputArea={() => (
        <>
          <OutputDisplay
            values={runtime.paramOutputs}
            width={360}
            height={120}
            color="var(--accent-3)"
          />
          <LossPlot history={runtime.training.lossHistory} width={360} height={70} />
        </>
      )}
    />
  );
};

export default ChannelStripMode;
