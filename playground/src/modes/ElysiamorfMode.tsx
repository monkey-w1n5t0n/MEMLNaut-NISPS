/**
 * ElysiamorfMode — granular / morphing synth (xy_pad input, 40 outputs).
 */

import { Component } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { XYPad } from '../primitives/XYPad';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { LossPlot } from '../primitives/LossPlot';
import { ElysiamorfSchema } from './generated/elysiamorf_schema';

export const ElysiamorfMode: Component = () => {
  const schema = ElysiamorfSchema;
  const runtime = useModeRuntime(schema);

  return (
    <ModeShell
      schema={schema}
      runtime={runtime}
      drawerTitle="Elysiamorf settings"
      primaryInput={() => (
        <>
          <XYPad
            size={280}
            ariaLabel="Elysiamorf pad"
            onMove={(x, y) => runtime.setInput(x, y)}
            position={runtime.pipedInput}
          />
          <span style={{ 'font-size': 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
            Drag to morph through grain space.
          </span>
        </>
      )}
      outputArea={() => (
        <>
          <OutputDisplay
            values={runtime.paramOutputs}
            width={360}
            height={120}
            color="#ffb060"
          />
          <LossPlot history={runtime.training.lossHistory} width={360} height={70} />
        </>
      )}
    />
  );
};

export default ElysiamorfMode;
