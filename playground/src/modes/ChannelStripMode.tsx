/**
 * ChannelStripMode — channel-strip processor controlled by joystick.
 *
 * 24 outputs feed EQ / dynamics / gain. Schema has no voice spaces so the
 * shell omits the selector. Drawer shows the live param sliders.
 */

import { Component } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { VirtualJoystick } from '../primitives/VirtualJoystick';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { SliderBank } from '../primitives/SliderBank';
import { LossPlot } from '../primitives/LossPlot';
import { paramsToSliderConfig, outputsToSliderValues } from './mode-helpers';
import { ChannelStripSchema } from './generated/channel_strip_schema';

export const ChannelStripMode: Component = () => {
  const schema = ChannelStripSchema;
  const runtime = useModeRuntime(schema);

  const sliderConfig = paramsToSliderConfig(schema.params);
  const sliderValues = () => outputsToSliderValues(runtime.processedOutputs(), schema.params);

  return (
    <ModeShell
      schema={schema}
      runtime={runtime}
      drawerTitle="Channel strip params"
      drawerContent={() => (
        <SliderBank
          title="Live parameter values"
          sliders={sliderConfig}
          values={sliderValues}
          onChange={() => {
            /* read-only for now */
          }}
        />
      )}
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
            values={runtime.processedOutputs}
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
