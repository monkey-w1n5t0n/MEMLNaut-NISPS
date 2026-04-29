/**
 * XIASRIMode — audio-reactive verb / pitch effects driven by joystick.
 *
 * Although the firmware variant historically used audio analysis as input,
 * the playground schema declares `primary_input: 'joystick'` and feeds the
 * MLP from joy_x/joy_y/joy_z/joy_w. The audio-reactive flavour is left to
 * stream 10 (mic input wiring).
 */

import { Component } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { VirtualJoystick } from '../primitives/VirtualJoystick';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { SliderBank } from '../primitives/SliderBank';
import { LossPlot } from '../primitives/LossPlot';
import { paramsToSliderConfig, outputsToSliderValues } from './mode-helpers';
import { XiasriSchema } from './generated/xiasri_schema';

export const XIASRIMode: Component = () => {
  const schema = XiasriSchema;
  const runtime = useModeRuntime(schema);
  const sliderConfig = paramsToSliderConfig(schema.params);
  const sliderValues = () => outputsToSliderValues(runtime.processedOutputs(), schema.params);

  return (
    <ModeShell
      schema={schema}
      runtime={runtime}
      drawerTitle="XIASRI params"
      drawerContent={() => (
        <SliderBank
          title="Live verb / pitch params"
          sliders={sliderConfig}
          values={sliderValues}
          onChange={() => {
            /* read-only */
          }}
        />
      )}
      primaryInput={() => (
        <>
          <VirtualJoystick
            size={260}
            ariaLabel="XIASRI joystick"
            onMove={(x, y) => runtime.setInput(x, y)}
            position={runtime.pipedInput}
          />
          <span style={{ 'font-size': 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
            Joystick → verb / pitch space. Mic input wiring is a stream-10 task.
          </span>
        </>
      )}
      outputArea={() => (
        <>
          <OutputDisplay
            values={runtime.processedOutputs}
            width={360}
            height={120}
            color="var(--accent-2)"
          />
          <LossPlot history={runtime.training.lossHistory} width={360} height={70} />
        </>
      )}
    />
  );
};

export default XIASRIMode;
