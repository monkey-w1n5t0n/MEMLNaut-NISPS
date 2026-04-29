/**
 * XIASRIMode — audio-reactive verb / pitch effects.
 *
 * Schema declares `primary_input: 'joystick'` and feeds the MLP from
 * joy_x/joy_y plus optional mic features. ModeShell exposes a Mic toggle
 * that opt-in feeds analysis features into channels 2..5.
 */

import { Component } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { VirtualJoystick } from '../primitives/VirtualJoystick';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { LossPlot } from '../primitives/LossPlot';
import { XiasriSchema } from './generated/xiasri_schema';

export const XIASRIMode: Component = () => {
  const schema = XiasriSchema;
  const runtime = useModeRuntime(schema);

  return (
    <ModeShell
      schema={schema}
      runtime={runtime}
      drawerTitle="XIASRI settings"
      primaryInput={() => (
        <>
          <VirtualJoystick
            size={260}
            ariaLabel="XIASRI joystick"
            onMove={(x, y) => runtime.setInput(x, y)}
            position={runtime.pipedInput}
          />
          <span style={{ 'font-size': 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
            Joystick → verb / pitch space. Enable mic for audio-reactive features.
          </span>
        </>
      )}
      outputArea={() => (
        <>
          <OutputDisplay
            values={runtime.paramOutputs}
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
