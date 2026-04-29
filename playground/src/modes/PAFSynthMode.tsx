/**
 * PAFSynthMode — Phase Aligned Formant synth (XY pad input, 33 outputs).
 *
 * Uses the xy_pad as primary input (as per schema). Voice spaces are
 * exposed via the shell header. A drawer renders the SliderBank for
 * monitoring (and eventually editing) per-parameter values.
 */

import { Component, createSignal } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { XYPad } from '../primitives/XYPad';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { SliderBank } from '../primitives/SliderBank';
import { LossPlot } from '../primitives/LossPlot';
import { paramsToSliderConfig, outputsToSliderValues } from './mode-helpers';
import { PafSynthSchema } from './generated/paf_synth_schema';

export const PAFSynthMode: Component = () => {
  const schema = PafSynthSchema;
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
      drawerTitle="PAF synth params"
      drawerContent={() => (
        <SliderBank
          title="Live parameter values"
          sliders={sliderConfig}
          values={sliderValues}
          onChange={() => {
            // Sliders are display-only here. Stream 10 wires the per-param
            // override editor which writes through modeStore.setOverride.
          }}
        />
      )}
      primaryInput={() => (
        <>
          <XYPad
            size={280}
            ariaLabel="PAF synth control pad"
            onMove={(x, y) => runtime.setInput(x, y)}
            position={runtime.pipedInput}
          />
          <span style={{ 'font-size': 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
            Drag to sculpt formants. Voice space:&nbsp;
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
            color="var(--accent)"
          />
          <LossPlot history={runtime.training.lossHistory} width={360} height={70} />
        </>
      )}
    />
  );
};

export default PAFSynthMode;
