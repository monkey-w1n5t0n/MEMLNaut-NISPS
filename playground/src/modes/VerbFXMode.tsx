/**
 * VerbFXMode — verb / fx unit (joystick input, ~47 outputs).
 */

import { Component, createSignal } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { VirtualJoystick } from '../primitives/VirtualJoystick';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { LossPlot } from '../primitives/LossPlot';
import { VerbFxSchema } from './generated/verb_fx_schema';

export const VerbFXMode: Component = () => {
  const schema = VerbFxSchema;
  const runtime = useModeRuntime(schema);
  const [voiceSpace, setVoiceSpace] = createSignal(0);

  return (
    <ModeShell
      schema={schema}
      runtime={runtime}
      activeVoiceSpace={voiceSpace}
      onVoiceSpaceChange={setVoiceSpace}
      drawerTitle="Verb / FX settings"
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
            values={runtime.paramOutputs}
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
