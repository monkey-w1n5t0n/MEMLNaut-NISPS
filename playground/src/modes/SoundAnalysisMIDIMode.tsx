/**
 * SoundAnalysisMIDIMode — sound analysis → MIDI CC output (audio_in input).
 *
 * Schema declares `primary_input: 'audio_in'` and `engine_id: 'thru'` (no
 * synthesis). Stream 10 wires the mic into channels 2..5 via ModeShell's
 * Mic button + the runtime's MicInput. The joystick is used as a fallback
 * for channels 0..1 and during testing without mic permissions.
 *
 * MIDI output routing is read-only here — the SettingsDrawer's per-param
 * override editor lets users tighten the active range / mute params; the
 * actual MIDI device wiring is left for the engine host to handle (or for
 * a future stream that adds WebMIDI sender). For now CC values are
 * visible in the live OutputDisplay.
 */

import { Component, Show } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { VirtualJoystick } from '../primitives/VirtualJoystick';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { LossPlot } from '../primitives/LossPlot';
import { SoundAnalysisMidiSchema } from './generated/sound_analysis_midi_schema';

export const SoundAnalysisMIDIMode: Component = () => {
  const schema = SoundAnalysisMidiSchema;
  const runtime = useModeRuntime(schema);

  return (
    <ModeShell
      schema={schema}
      runtime={runtime}
      drawerTitle="Sound analysis → MIDI settings"
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
                border: `1px ${runtime.mic.started() ? 'solid var(--accent-2)' : 'dashed var(--line-strong)'}`,
                'border-radius': 'var(--r-2)',
                'min-width': '260px',
                'min-height': '200px',
                'justify-content': 'center',
                color: 'var(--fg-mute)',
                'text-align': 'center',
              }}
            >
              <strong style={{ color: runtime.mic.started() ? 'var(--accent-2)' : 'var(--fg-mute)' }}>
                {runtime.mic.started() ? '🎤 Mic active' : 'Mic input'}
              </strong>
              <span style={{ 'font-size': 'var(--fs-xs)' }}>
                {runtime.mic.started()
                  ? 'Audio features → channels 2..5. Joystick below drives channels 0..1.'
                  : 'Tap "Mic" in the header to feed mic features into the model.'}
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
            values={runtime.paramOutputs}
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
