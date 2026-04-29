/**
 * VerbFXMode — verb / fx unit (joystick input, ~47 outputs).
 */

import { Component, createSignal } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { VirtualJoystick } from '../primitives/VirtualJoystick';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { SliderBank } from '../primitives/SliderBank';
import { LossPlot } from '../primitives/LossPlot';
import { paramsToSliderConfig, outputsToSliderValues } from './mode-helpers';
import { VerbFxSchema } from './generated/verb_fx_schema';

export const VerbFXMode: Component = () => {
  const schema = VerbFxSchema;
  const runtime = useModeRuntime(schema);
  const [voiceSpace, setVoiceSpace] = createSignal(0);
  const sliderConfig = paramsToSliderConfig(schema.params);
  const sliderValues = () => outputsToSliderValues(runtime.processedOutputs(), schema.params);

  return (
    <ModeShell
      schema={schema}
      runtime={runtime}
      activeVoiceSpace={voiceSpace}
      onVoiceSpaceChange={setVoiceSpace}
      drawerTitle="Verb / FX params"
      drawerContent={() => (
        <SliderBank
          title="Live FX params"
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
            ariaLabel="Verb FX joystick"
            onMove={(x, y) => runtime.setInput(x, y)}
            position={runtime.pipedInput}
          />
          <span style={{ 'font-size': 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
            Sweep through verb space. Voice space:&nbsp;
            <strong>{schema.voice_spaces[voiceSpace()] ?? 'Default'}</strong>
          </span>
        </>
      )}
      outputArea={() => (
        <>
          <OutputDisplay
            values={runtime.processedOutputs}
            width={360}
            height={120}
            color="#b464ff"
          />
          <LossPlot history={runtime.training.lossHistory} width={360} height={70} />
        </>
      )}
    />
  );
};

export default VerbFXMode;
