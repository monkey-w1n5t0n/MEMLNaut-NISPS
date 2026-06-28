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
import { Slider } from '../primitives/Slider';
import { SlpWorkshopSchema } from './generated/slp_workshop_schema';

export const SLPWorkshopMode: Component = () => {
  const schema = SlpWorkshopSchema;
  const runtime = useModeRuntime(schema);
  const [voiceSpace, setVoiceSpace] = createSignal(0);
  const [exploreLevel, setExploreLevel] = createSignal(0);

  const setExplore = (v: number): void => {
    setExploreLevel(v);
    runtime.explore.setIntensity(v);
  };

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

          {/* Adaptive-learning gestures. */}
          <div
            style={{
              display: 'flex',
              'flex-direction': 'column',
              gap: 'var(--sp-2)',
              width: '280px',
              'margin-top': 'var(--sp-2)',
            }}
          >
            {/* Jolt — hold to morph weights live, release to freeze. */}
            <button
              type="button"
              aria-label="Jolt — hold to morph the network's weights"
              aria-pressed={runtime.jolt.active()}
              onPointerDown={(e) => {
                e.preventDefault();
                runtime.jolt.press();
              }}
              onPointerUp={() => runtime.jolt.release()}
              onPointerLeave={() => runtime.jolt.release()}
              onPointerCancel={() => runtime.jolt.release()}
              style={{
                padding: 'var(--sp-2)',
                'border-radius': 'var(--r-1)',
                border: '1px solid var(--line)',
                background: runtime.jolt.active() ? 'var(--accent, #ef9e5b)' : 'var(--bg-2)',
                color: runtime.jolt.active() ? '#000' : 'var(--fg)',
                'font-weight': 600,
                cursor: 'pointer',
                'touch-action': 'none',
                'user-select': 'none',
              }}
            >
              ⚡ Jolt {runtime.jolt.active() ? '(hold…)' : '(hold)'}
            </button>

            {/* Explore — OU random-walk exploration intensity. */}
            <Slider
              label="Explore"
              ariaLabel="Explore — exploration random-walk intensity"
              min={0}
              max={1}
              value={exploreLevel()}
              onChange={setExplore}
              decimals={2}
            />
          </div>
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
