/**
 * SoundAnalysisMIDIMode — sound analysis → MIDI CC output (audio_in input).
 *
 * Schema declares `primary_input: 'audio_in'` and `engine_id: 'thru'` (no
 * synthesis). The full firmware pipeline feeds audio analysis features
 * (pitch / aperiodicity / energy / brightness / etc.) into the first 6
 * input channels and joystick coords into the last 4. Stream 9 ships a
 * scaffold UI; mic capture + analysis wiring is a stream-10 task.
 */

import { Component, Show } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { VirtualJoystick } from '../primitives/VirtualJoystick';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { SliderBank } from '../primitives/SliderBank';
import { LossPlot } from '../primitives/LossPlot';
import { paramsToSliderConfig, outputsToSliderValues } from './mode-helpers';
import { SoundAnalysisMidiSchema } from './generated/sound_analysis_midi_schema';

export const SoundAnalysisMIDIMode: Component = () => {
  const schema = SoundAnalysisMidiSchema;
  const runtime = useModeRuntime(schema);
  const sliderConfig = paramsToSliderConfig(schema.params);
  const sliderValues = () => outputsToSliderValues(runtime.processedOutputs(), schema.params);

  return (
    <ModeShell
      schema={schema}
      runtime={runtime}
      drawerTitle="MIDI CC routing"
      drawerContent={() => (
        <div>
          <SliderBank
            title="MIDI CC values"
            sliders={sliderConfig}
            values={sliderValues}
            onChange={() => {
              /* read-only */
            }}
          />
          <p
            style={{
              'font-size': 'var(--fs-xs)',
              color: 'var(--fg-mute)',
              'margin-top': 'var(--sp-3)',
            }}
          >
            WebMIDI routing is wired up in stream 10. For now CC values are
            visible in the live readout.
          </p>
        </div>
      )}
      primaryInput={() => (
        <>
          <Show
            when={schema.ui.primary_input === 'audio_in'}
            fallback={
              <VirtualJoystick
                size={260}
                onMove={(x, y) => runtime.setInput(x, y)}
                position={runtime.pipedInput}
                ariaLabel="Sound analysis joystick"
              />
            }
          >
            <div
              style={{
                display: 'flex',
                'flex-direction': 'column',
                'align-items': 'center',
                gap: 'var(--sp-3)',
                padding: 'var(--sp-4)',
                background: 'var(--bg-2)',
                border: '1px dashed var(--line-strong)',
                'border-radius': 'var(--r-2)',
                'min-width': '260px',
                'min-height': '200px',
                'justify-content': 'center',
                color: 'var(--fg-mute)',
                'text-align': 'center',
              }}
            >
              <strong style={{ color: 'var(--accent-2)' }}>Mic input — TODO</strong>
              <span style={{ 'font-size': 'var(--fs-xs)' }}>
                Stream 10 will request `getUserMedia` and feed audio analysis
                features into the MLP. For now you can still drive the model
                manually with the joystick below.
              </span>
              <VirtualJoystick
                size={200}
                onMove={(x, y) => runtime.setInput(x, y)}
                position={runtime.pipedInput}
                ariaLabel="Manual joystick fallback"
              />
            </div>
          </Show>
        </>
      )}
      outputArea={() => (
        <>
          <OutputDisplay
            values={runtime.processedOutputs}
            width={360}
            height={120}
            color="var(--info)"
          />
          <LossPlot history={runtime.training.lossHistory} width={360} height={70} />
        </>
      )}
    />
  );
};

export default SoundAnalysisMIDIMode;
