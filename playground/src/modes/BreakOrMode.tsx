/**
 * BreakOrMode — drum/breakbeat synthesis (xy_pad input, 56 outputs).
 */

import { Component } from 'solid-js';
import { ModeShell } from './ModeShell';
import { useModeRuntime } from './mode-runtime';
import { XYPad } from '../primitives/XYPad';
import { OutputDisplay } from '../primitives/OutputDisplay';
import { LossPlot } from '../primitives/LossPlot';
import { BreakorSchema } from './generated/breakor_schema';

export const BreakOrMode: Component = () => {
  const schema = BreakorSchema;
  const runtime = useModeRuntime(schema);

  return (
    <ModeShell
      schema={schema}
      runtime={runtime}
      drawerTitle="Breakor settings"
      primaryInput={() => (
        <>
          <XYPad
            size={280}
            ariaLabel="Breakor pad"
            onMove={(x, y) => runtime.setInput(x, y)}
            position={runtime.pipedInput}
          />
          <span style={{ 'font-size': 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
            Drag through drum space.
          </span>
        </>
      )}
      outputArea={() => (
        <>
          <OutputDisplay
            values={runtime.paramOutputs}
            width={360}
            height={120}
            color="var(--good)"
          />
          <LossPlot history={runtime.training.lossHistory} width={360} height={70} />
        </>
      )}
    />
  );
};

export default BreakOrMode;
