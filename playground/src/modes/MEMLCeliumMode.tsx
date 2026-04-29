/**
 * MEMLCeliumMode — uSEQ-Celium dual-MLP CV/gate output (56 outputs).
 */

import { Component, createSignal } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { XYPad } from '../primitives/XYPad';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { SliderBank } from '../primitives/SliderBank';
import { LossPlot } from '../primitives/LossPlot';
import { paramsToSliderConfig, outputsToSliderValues } from './mode-helpers';
import { MemlceliumSchema } from './generated/memlcelium_schema';

export const MEMLCeliumMode: Component = () => {
  const schema = MemlceliumSchema;
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
      drawerTitle="MEMLCelium voice + CV"
      drawerContent={() => (
        <SliderBank
          title="Live voice + CV params"
          sliders={sliderConfig}
          values={sliderValues}
          onChange={() => {
            /* read-only */
          }}
        />
      )}
      primaryInput={() => (
        <>
          <XYPad
            size={280}
            ariaLabel="MEMLCelium pad"
            onMove={(x, y) => runtime.setInput(x, y)}
            position={runtime.pipedInput}
          />
          <span style={{ 'font-size': 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
            Sculpt voice + CV/gate. CV/gate streaming over USB serial requires
            firmware (browser preview only).
          </span>
        </>
      )}
      outputArea={() => (
        <>
          <OutputDisplay
            values={runtime.processedOutputs}
            width={360}
            height={120}
            color="#5b9eef"
          />
          <LossPlot history={runtime.training.lossHistory} width={360} height={70} />
        </>
      )}
    />
  );
};

export default MEMLCeliumMode;
