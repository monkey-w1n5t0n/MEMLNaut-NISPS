/**
 * SLPWorkshopMode — the Synth Library Portland workshop instrument.
 *
 * Reuses the MEMLCelium engine and MLP shape verbatim (so the synth voice is
 * identical), but foregrounds the adaptive-learning gestures ported from
 * upstream InterfaceRL and now living in the shared core:
 *   - Jolt: hold to continuously morph the network's weights live, release to
 *     freeze (nisps/ml/jolt.hpp).
 *   - Explore: an Ornstein-Uhlenbeck random walk on the output that makes the
 *     sound slowly roam so likes/dislikes can steer it (nisps/ml/ou_noise.hpp).
 */

import { Component, createSignal } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { XYPad } from '../primitives/XYPad';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { LossPlot } from '../primitives/LossPlot';
import { SlpWorkshopSchema } from './generated/slp_workshop_schema';

export const SLPWorkshopMode: Component = () => {
  const schema = SlpWorkshopSchema;
  const runtime = useModeRuntime(schema);
  const [voiceSpace, setVoiceSpace] = createSignal(0);

  return (
    <ModeShell
      schema={schema}
      runtime={runtime}
      activeVoiceSpace={voiceSpace}
      onVoiceSpaceChange={setVoiceSpace}
      drawerTitle="SLP-Workshop settings"
      primaryInput={() => (
        <>
          <XYPad
            size={280}
            ariaLabel="SLP-Workshop pad"
            onMove={(x, y) => runtime.setInput(x, y)}
            position={runtime.pipedInput}
          />
          <span style={{ 'font-size': 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
            Synth Library Portland workshop instrument — MEMLCelium voice with
            live Jolt + Explore learning controls.
          </span>
        </>
      )}
      outputArea={() => (
        <>
          <OutputDisplay
            values={runtime.paramOutputs}
            width={360}
            height={120}
            color="#ef9e5b"
          />
          <LossPlot history={runtime.training.lossHistory} width={360} height={70} />
        </>
      )}
    />
  );
};

export default SLPWorkshopMode;
