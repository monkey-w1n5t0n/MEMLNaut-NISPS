/**
 * Console — the FIVE real dock drawers (operator dock restructure). Each renderer
 * takes (ctx, depth); what shows is gated by depth (condensed | expanded):
 *
 *   learn    — Learning : feedback-mode selector, solo/arm chooser, live params
 *   inputs   — Inputs   : input source
 *   route    — Outputs  : per-output control matrix for the ACTIVE mode/backend,
 *                         a Mode-specific config section, and (Editor mode) the
 *                         MEMLNaut serial panel. The old separate "Synth" and
 *                         "Particle/Visual" drawers are REMOVED — their config now
 *                         lives here under the active Mode (TOP dock selector).
 *   settings — Settings : icon style, input-map shape + feature flags
 *   help     — Help     : keymap + explainer link
 *
 * The TOP dock selector ("Mode") chooses the active OUTPUT backend/target; this
 * drawer renders whatever that backend needs.
 *
 * Engine wiring: the feedback-mode pill → controller.setMode; the arm flags →
 * engine.feedback.setFocus; per-output rows write the shared MFParam store.
 * Where engine support does not yet exist the UI + state are wired and a TODO
 * references the relevant spec — no faked engine behaviour.
 */
import { useState, type ReactNode } from 'react';
import { Badge, Button, PillToggle, Slider, Switch } from '../primitives';
import type { ConsoleCtx, DrawerDepth, DrawerKey, FeedbackModeUI } from './types';
import type { InputMode } from '../inputs';
import { OutputControlRow } from '../dock/OutputControlRow';
import { OutputsBackendConfig, BackendStatusChip } from '../dock/OutputsBackendConfig';
import { shapeValues, type MFParam } from './model';
import { outputModeDescriptor } from './output-mode';
import { useSettings, unfocusedIconCss } from '../settings/settings-store';
import type { UnfocusedIconColour, InputMapMode } from '../settings/settings-store';
import type { ExampleResizePolicy, NetworkResizePolicy } from '../engine/io-reshape';
import {
  useEngine,
  useEngineVersion,
  DEFAULT_GEOMETRIC_FEEDBACK_CONFIG,
} from '../engine';
import { EditorPanel } from '../serial/EditorPanel';
import { TrainingHealth } from './TrainingHealth';
import {
  LearningIcon,
  InputsIcon,
  OutputsIcon,
  SettingsIcon,
  HelpIcon,
} from './icons';

function Chip({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: tone || 'var(--fg-mute)',
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-pill)',
        padding: '2px 8px',
      }}
    >
      {children}
    </span>
  );
}
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: 'var(--fg-dim)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginTop: 'var(--sp-2)',
      }}
    >
      {children}
    </div>
  );
}

/** A 2+ segment selector pill that drives a typed value. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-pill)',
        padding: 2,
        gap: 2,
        flexWrap: 'wrap',
      }}
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              background: on ? 'var(--accent)' : 'transparent',
              color: on ? 'var(--bg)' : 'var(--fg-mute)',
              border: 0,
              borderRadius: 'var(--r-pill)',
              padding: '5px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-xs)',
              letterSpacing: '0.04em',
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ===========================================================================
// 1. LEARNING-BEHAVIOUR (dock-spec §1; rl-feedback-design)
// ===========================================================================

const FEEDBACK_OPTS: { value: FeedbackModeUI; label: string }[] = [
  { value: 'geometric-dislike', label: 'Push away' },
  { value: 'explore-and-place', label: 'Explore & place' },
];
function ModelArchitecture() {
  const engine = useEngine();
  useEngineVersion(engine);
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!engine) {
    return <p style={{ fontSize: 10, color: 'var(--fg-dim)', margin: 0 }}>engine not ready</p>;
  }

  const arch = engine.architecture;
  const hidden = arch.hidden.filter((size) => size > 0);
  const layerCount = arch.numLayers || hidden.length + 1;
  const sizes = hidden.map((size) => size.toString()).join(' → ');
  const stageStyle = (tone: string) => ({
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    minWidth: 0,
    padding: '6px 8px',
    border: `1px solid ${tone}`,
    borderRadius: 'var(--r-1)',
    background: 'var(--bg-2)',
  });
  const labelStyle = {
    fontSize: 9,
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.08em',
    color: 'var(--fg-dim)',
  };
  const valueStyle = {
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--fg)',
  };

  return (
    <div data-testid="model-architecture" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip tone="var(--accent)">
          {layerCount} layer{layerCount === 1 ? '' : 's'}
        </Chip>
        <Chip>{engine.weightCount.toLocaleString()} weights</Chip>
        <Chip>{engine.exampleCount} examples</Chip>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 4, alignItems: 'stretch' }}>
        <div style={stageStyle('var(--accent-2)')}>
          <span style={{ ...labelStyle, color: 'var(--accent-2)' }}>INPUT</span>
          <span style={valueStyle}>{arch.inputSize} units</span>
        </div>
        <div
          aria-hidden="true"
          style={{ alignSelf: 'center', color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', fontSize: 11 }}
        >
          →
        </div>
        <div style={stageStyle('var(--accent)')}>
          <span style={{ ...labelStyle, color: 'var(--accent)' }}>OUTPUT</span>
          <span style={valueStyle}>{arch.outputSize} units</span>
        </div>
      </div>
      <button
        type="button"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '5px 8px',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-1)',
          background: 'var(--bg-2)',
          color: 'var(--fg-mute)',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
        }}
      >
        <span style={{ color: 'var(--accent)' }}>{detailsOpen ? '▾' : '▸'}</span>
        <span style={{ color: 'var(--fg)' }}>HIDDEN</span>
        <span>{hidden.length} layer{hidden.length === 1 ? '' : 's'}</span>
        {!detailsOpen && <span style={{ marginLeft: 'auto' }}>{sizes || 'none'}</span>}
      </button>
      {detailsOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 12 }}>
          {hidden.length > 0 ? (
            hidden.map((size, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--fg-mute)',
                }}
              >
                <span>HIDDEN {i + 1}</span>
                <span style={{ color: 'var(--fg)' }}>{size} units</span>
              </div>
            ))
          ) : (
            <span style={{ fontSize: 10, color: 'var(--fg-dim)' }}>no hidden layers</span>
          )}
        </div>
      )}
    </div>
  );
}

function LearningDrawer(ctx: ConsoleCtx, depth: DrawerDepth) {
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip tone="var(--accent)">{FEEDBACK_OPTS.find((o) => o.value === ctx.feedbackMode)?.label}</Chip>
        <Chip>arm: {ctx.armedCount ? `${ctx.armedCount} output${ctx.armedCount > 1 ? 's' : ''}` : 'all'}</Chip>
        {ctx.exploring && <Chip tone="var(--accent-2)">exploring…</Chip>}
        {ctx.learningPaused && <Chip tone="var(--warn)">learning paused</Chip>}
      </div>

      <SectionLabel>Down action · feedback mode</SectionLabel>
      <Segmented value={ctx.feedbackMode} onChange={ctx.setFeedbackMode} options={FEEDBACK_OPTS} />

      <SectionLabel>Exploration</SectionLabel>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          size="sm"
          variant="secondary"
          active={ctx.joltActive}
          aria-label="Jolt — hold to morph the network's weights, release to freeze"
          aria-pressed={ctx.joltActive}
          onPointerDown={(e) => {
            e.preventDefault();
            ctx.onJoltPress();
          }}
          onPointerUp={ctx.onJoltRelease}
          onPointerLeave={ctx.onJoltRelease}
          onPointerCancel={ctx.onJoltRelease}
          style={{ touchAction: 'none', userSelect: 'none' }}
        >
          Jolt {ctx.joltActive ? '(morphing…)' : '(hold)'}
        </Button>
      </div>
      <Slider
        label="explore · output wander"
        value={ctx.exploreIntensity}
        min={0}
        max={1}
        step={0.01}
        onChange={ctx.setExploreIntensity}
      />
      <SectionLabel>Recorded examples</SectionLabel>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Chip>
          {ctx.datasetCount} example{ctx.datasetCount === 1 ? '' : 's'}
        </Chip>
        <Button size="sm" variant="secondary" onClick={ctx.onClear}>
          Clear
        </Button>
      </div>

      <SectionLabel>Current model</SectionLabel>
      <ModelArchitecture />

      {depth === 'expanded' && (
        <>
          <SectionLabel>Solo / arm scope</SectionLabel>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button size="sm" variant={ctx.armedCount ? 'secondary' : 'primary'} onClick={ctx.clearArmed}>
              Arm all
            </Button>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>
              {ctx.armedCount
                ? `${ctx.armedCount} armed — arm with the S button on each output row`
                : 'every live output learns'}
            </span>
          </div>
          <SectionLabel>Live training params</SectionLabel>
          {ctx.feedbackMode === 'geometric-dislike' ? (
            <>
              <Slider
                label="push · learning rate"
                value={ctx.geometricConfig.learningRate}
                min={0.0001}
                max={0.005}
                step={0.0001}
                format={(v) => v.toFixed(4)}
                onChange={(learningRate) =>
                  ctx.setGeometricConfig({ ...ctx.geometricConfig, learningRate })
                }
              />
              <Slider
                label="push · updates / second"
                value={ctx.geometricConfig.updatesPerSecond}
                min={0}
                max={400}
                step={10}
                format={(v) => `${Math.round(v)} Hz`}
                onChange={(updatesPerSecond) =>
                  ctx.setGeometricConfig({ ...ctx.geometricConfig, updatesPerSecond })
                }
              />
              <Slider
                label="push · lifetime"
                value={ctx.geometricConfig.lifetimeMs / 1000}
                min={0}
                max={5}
                step={0.1}
                format={(v) => `${v.toFixed(1)} s`}
                onChange={(seconds) =>
                  ctx.setGeometricConfig({
                    ...ctx.geometricConfig,
                    lifetimeMs: seconds * 1000,
                  })
                }
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    ctx.setGeometricConfig({ ...DEFAULT_GEOMETRIC_FEEDBACK_CONFIG })
                  }
                >
                  Upstream defaults
                </Button>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>
                  {ctx.geometricConfig.updatesPerSecond <= 0 ||
                  ctx.geometricConfig.lifetimeMs <= 0
                    ? 'one immediate update per press'
                    : `≈ ${Math.round(
                        (ctx.geometricConfig.updatesPerSecond *
                          ctx.geometricConfig.lifetimeMs) /
                          1000,
                      )} replay updates + the press`}
                </span>
              </div>
            </>
          ) : (
            <Slider
              label="noise cap"
              value={ctx.noiseCap}
              min={0}
              max={0.5}
              step={0.01}
              onChange={ctx.setNoiseCap}
            />
          )}
        </>
      )}

      {depth === 'expanded' && (
        <>
          {ctx.xavierSpreadEnabled && (
            <Switch checked={ctx.spread} onChange={ctx.setSpread} label="Xavier (centred) weight regime" />
          )}

          <SectionLabel>Training health</SectionLabel>
          <TrainingHealth />
        </>
      )}
    </>
  );
}

// ===========================================================================
// 2. INPUTS (workstream F; inputs-spec — modular input layer)
// ===========================================================================

const STATUS_TONE: Record<string, string> = {
  ready: 'var(--accent)',
  connecting: 'var(--warn)',
  unavailable: 'var(--fg-dim)',
  error: 'var(--danger)',
  idle: 'var(--fg-dim)',
};

const INPUT_MODE_OPTS: { value: InputMode; label: string }[] = [
  { value: 'internal', label: 'Internal' },
  { value: 'gamepad', label: 'Game Controller' },
  { value: 'midi', label: 'MIDI' },
];

const MODEL_INPUT_OPTS: { value: '2' | '4'; label: string }[] = [
  { value: '2', label: '2 inputs' },
  { value: '4', label: '4 inputs' },
];

/** Standard-mapping gamepad button → verdict legend (mirrors ConsoleApp). */
const GAMEPAD_LEGEND: { btn: string; action: string }[] = [
  { btn: 'RB', action: 'Up · positive feedback' },
  { btn: 'LB', action: 'Down · negative feedback' },
  { btn: 'X', action: 'Randomise' },
  { btn: 'Y', action: 'Nudge' },
  { btn: 'B', action: 'Undo' },
  { btn: 'A (hold)', action: 'Reposition — hold, move stick, release to place' },
];

/**
 * Read-only INPUT meter — shows a learned MIDI control's live value. Deliberately
 * styled apart from the output Sliders (which are orange, interactive thumbs):
 * these are inset bars on the secondary accent with an "in" tag, so the user can
 * see at a glance that these feed the net rather than being driven by it.
 */
function MidiInputMeter({ label, value, onClear }: { label: string; value: number; onClear: () => void }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          fontSize: 9,
          fontFamily: 'var(--font-mono)',
          color: 'var(--accent-2)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          minWidth: 70,
        }}
      >
        {label}
      </span>
      <div
        style={{
          position: 'relative',
          flex: 1,
          height: 8,
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          borderLeft: '2px solid var(--accent-2)',
          borderRadius: 'var(--r-1)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${pct * 100}%`,
            background: 'var(--accent-2)',
            opacity: 0.55,
          }}
        />
      </div>
      <span
        style={{
          fontSize: 9,
          fontFamily: 'var(--font-mono)',
          color: 'var(--fg-mute)',
          minWidth: 28,
          textAlign: 'right',
        }}
      >
        {value.toFixed(2)}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove ${label}`}
        style={{ background: 'transparent', border: 0, color: 'var(--danger)', cursor: 'pointer', fontSize: 'var(--fs-xs)' }}
      >
        ✕
      </button>
    </div>
  );
}

function InputsDrawer(ctx: ConsoleCtx, depth: DrawerDepth) {
  const inp = ctx.inputs;
  // The net is runtime-shaped (P2): each active axis drives its OWN input slot
  // 1:1. A mismatch means the net is over-provisioned (axes < slots, extra slots
  // zero-padded) or over capacity (axes > slots, extras dropped) — the reshape
  // offer resolves either.
  const inputMismatch = inp.axisCount > 0 && inp.axisCount !== inp.engineInputSize;
  const active = inp.sources.find((s) => s.enabled);
  const modeLabel = INPUT_MODE_OPTS.find((o) => o.value === inp.inputMode)?.label ?? 'Internal';

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge tone="info">{modeLabel}</Badge>
        {inp.inputMode !== 'internal' && <Chip tone="var(--accent)">{inp.axisCount} axes</Chip>}
        {inputMismatch && (
          <Chip tone="var(--warn)">
            {inp.axisCount > inp.engineInputSize
              ? `${inp.axisCount} axes › ${inp.engineInputSize} slots`
              : `net: ${inp.engineInputSize}-D`}
          </Chip>
        )}
        {active && (
          <Chip tone={STATUS_TONE[active.status.state] ?? 'var(--fg-dim)'}>{active.status.state}</Chip>
        )}
      </div>

      <SectionLabel>Input source</SectionLabel>
      <Segmented value={inp.inputMode} onChange={inp.setInputMode} options={INPUT_MODE_OPTS} />
      <SectionLabel>Model inputs</SectionLabel>
      {ctx.mode.input === 'audio_in' ? (
        <span style={{ fontSize: 9, color: 'var(--fg-dim)' }}>
          {inp.engineInputSize} analysis inputs (fixed by this mode)
        </span>
      ) : (
        <div data-testid="model-input-size">
          <Segmented
            value={String(ctx.modelInputSize) as '2' | '4'}
            onChange={(value) => ctx.setModelInputSize(Number(value) as 2 | 4)}
            options={MODEL_INPUT_OPTS}
          />
        </div>
      )}
      {active && depth === 'expanded' && (
        <span style={{ fontSize: 9, color: STATUS_TONE[active.status.state] ?? 'var(--fg-dim)' }}>
          {active.status.message}
        </span>
      )}

      {/* ---- Internal (XY pad / manifold) ---- */}
      {/* ---- Game Controller ---- */}
      {inp.inputMode === 'gamepad' && depth === 'expanded' && (
        <>
          <SectionLabel>Sticks</SectionLabel>
          <Segmented
            value={inp.gamepadStickMode}
            onChange={inp.setGamepadStickMode}
            options={[
              { value: 'single', label: 'One stick (2 ax)' },
              { value: 'double', label: 'Both sticks (4 ax)' },
            ]}
          />
          <SectionLabel>Buttons</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {GAMEPAD_LEGEND.map((g) => (
              <div
                key={g.btn}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-xs)' }}
              >
                <Chip tone="var(--accent)">{g.btn}</Chip>
                <span style={{ color: 'var(--fg-mute)' }}>{g.action}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---- MIDI ---- */}
      {inp.inputMode === 'midi' && depth === 'expanded' && (
        <>
          <SectionLabel>Device</SectionLabel>
          {inp.midiInputs.length === 0 ? (
            <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0 }}>
              No MIDI inputs detected. Connect a device — it appears here automatically.
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant={inp.midiDeviceId === null ? 'primary' : 'secondary'}
                onClick={() => inp.selectMidiDevice(null)}
              >
                All ports
              </Button>
              {inp.midiInputs.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={inp.midiDeviceId === p.id ? 'primary' : 'secondary'}
                  onClick={() => inp.selectMidiDevice(p.id)}
                >
                  {p.name}
                </Button>
              ))}
            </div>
          )}

          <SectionLabel>MIDI Learn</SectionLabel>
          {inp.midiLearnArmed ? (
            <div
              style={{
                padding: '8px 10px',
                background: 'var(--bg-2)',
                border: '1px solid var(--accent-2)',
                borderRadius: 'var(--r-1)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent-2)', lineHeight: 1.5 }}>
                Move all of the controls you want to use, then click Done. Each knob or fader you
                touch becomes an input.
              </span>
              <Button size="sm" variant="primary" onClick={() => inp.armMidiLearn(false)}>
                Done ({inp.midiBindings.length} learned)
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button size="sm" variant="secondary" onClick={() => inp.armMidiLearn(true)}>
                {inp.midiBindings.length ? 'Learn more…' : 'Start MIDI Learn'}
              </Button>
              {inp.midiBindings.length > 0 && (
                <Button size="sm" variant="secondary" onClick={inp.clearMidiBindings}>
                  Clear all
                </Button>
              )}
            </div>
          )}

          {inp.midiBindings.length > 0 && (
            <>
              <SectionLabel>Learned controls</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {inp.midiBindings.map((b, i) => (
                  <MidiInputMeter
                    key={`${b.kind}-${b.number}-${b.channel}`}
                    label={b.label}
                    value={b.value}
                    onClear={() => inp.clearMidiBinding(i)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ---- Dedicated-dimensions note (only with >2 active axes) ---- */}
      {inp.axisCount > 2 && depth === 'expanded' && (
        <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          The net has {inp.engineInputSize} dedicated inputs — each active axis drives its own
          dimension 1:1 (no blending).
          {inputMismatch
            ? ` Its ${inp.engineInputSize} slots don't match the ${inp.axisCount} active axes; ` +
              `changing the layout offers a reshape to ${inp.axisCount} inputs (warm-started).`
            : ''}
        </p>
      )}
    </>
  );
}

// ===========================================================================
// 3. OUTPUTS / ROUTING (dock-spec §3, §4)
// ===========================================================================

const VISUAL_NAMES = [
  'Flow', 'Scale', 'Speed', 'Hue', 'Spread', 'Size', 'Trail', 'Turb', 'Attract', 'Radius',
  'DispRate', 'DispAmt', 'Lifetime', 'Respawn', 'Advection', 'Inertia', 'Drag', 'Repulse',
  'RepCnt', 'RepRate',
];

/**
 * Per-Mode config section shown ABOVE the per-output rows. The synth Mode shows
 * transport + tempo; the particle Mode names the outputs; MIDI/OSC/Editor show
 * their own affordances. Replaces the removed Synth + Visual drawers.
 */
function ModeConfig(ctx: ConsoleCtx) {
  switch (ctx.outputMode) {
    case 'synth':
      return (
        <>
          <SectionLabel>Transport</SectionLabel>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Button size="sm" variant={ctx.audioStarted ? 'secondary' : 'primary'} onClick={ctx.onToggleAudio}>
              {ctx.audioStarted ? 'pause' : 'play'}
            </Button>
          </div>
        </>
      );
    case 'editor':
      return (
        <>
          <SectionLabel>MEMLNaut · USB serial</SectionLabel>
          <EditorPanel />
        </>
      );
    case 'particles':
      return null;
    case 'midi':
      // The full MIDI config (port picker, CC count, per-output CC/channel/name)
      // + preset bar render via OutputsBackendConfig in RoutingDrawer below.
      return null;
    case 'osc':
      return null;
    default:
      return null;
  }
}

function RoutingDrawer(ctx: ConsoleCtx, depth: DrawerDepth) {
  const activeParams = ctx.params.slice(0, ctx.displayOutputCount);
  const values = shapeValues(activeParams, null); // bar uses shaped held/live value snapshot
  const counts = activeParams.reduce<Record<string, number>>((a, p) => {
    a[p.status] = (a[p.status] || 0) + 1;
    return a;
  }, {});
  const mutedN = activeParams.filter((p) => p.muted).length;
  const modeDesc = outputModeDescriptor(ctx.outputMode);
  // Particle labels belong to semantic cards, not their current array slots.
  // A deletion compacts the active prefix, so deriving the label from `idx`
  // would make the deleted name reappear on its successor.
  const particleNamesById = new Map(
    ctx.mode.params.map((param, index) => [param.id, VISUAL_NAMES[index] ?? param.name]),
  );
  const nameFor = (param: MFParam) =>
    ctx.outputMode === 'particles'
      ? particleNamesById.get(param.id) ?? param.name
      : param.name;

  const expanded = depth === 'expanded';
  const rows = expanded ? activeParams : activeParams.slice(0, 6);
  const addButton = (placement: 'prepend' | 'append') => (
    <button
      type="button"
      aria-label={placement === 'append' ? '+ output' : '+ output (prepend)'}
      title={placement === 'append' ? 'Add parameter after the last card' : 'Add parameter before the first card'}
      onClick={() => ctx.addOutput(placement)}
      style={{
        alignSelf: 'center',
        width: 30,
        height: 26,
        margin: '4px 0 2px',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-1)',
        background: 'var(--bg-2)',
        color: 'var(--accent)',
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 18,
        lineHeight: 1,
      }}
    >
      +
    </button>
  );
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip tone="var(--accent)">{modeDesc.label}</Chip>
        <Chip>{activeParams.length} output{activeParams.length === 1 ? '' : 's'}</Chip>
        <Chip tone="var(--accent)">live {counts.live || 0}</Chip>
        <Chip tone="var(--accent-2)">fixed {counts.fixed || 0}</Chip>
        <Chip>off {counts.off || 0}</Chip>
        <Chip tone="var(--danger)">muted {mutedN}</Chip>
        <BackendStatusChip ctx={ctx} />
      </div>
      {ModeConfig(ctx)}
      {/* Specialised per-backend config + named-preset bar (MIDI/OSC); hidden when condensed. */}
      {expanded && <OutputsBackendConfig ctx={ctx} backend={modeDesc.backend} />}
      <SectionLabel>Outputs</SectionLabel>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          flex: 1,
          minHeight: 0,
          boxSizing: 'border-box',
          padding: expanded ? '8px 10px' : '6px 10px',
          overflow: 'auto',
        }}
      >
        {addButton('prepend')}
        {rows.map((p) => {
          const i = ctx.params.indexOf(p);
          const labelled = { ...p, name: nameFor(p) };
          return (
            <OutputControlRow
              key={p.id}
              param={labelled}
              value={values[i] ?? 0}
              onChange={(patch) => ctx.setParam(i, patch)}
              onDelete={activeParams.length > 1 ? () => ctx.deleteOutput(i) : undefined}
              showCurve={expanded}
              showMidi={ctx.outputMode === 'midi'}
            />
          );
        })}
        {addButton('append')}
      </div>
      {!expanded && activeParams.length > 6 && (
        <span style={{ fontSize: 9, color: 'var(--fg-dim)' }}>+{activeParams.length - 6} more — expand to edit</span>
      )}
    </>
  );
}

// ===========================================================================
// 4. SETTINGS (operator dock restructure — settings-store)
// ===========================================================================

const ICON_COLOUR_OPTS: { value: UnfocusedIconColour; label: string }[] = [
  { value: 'off-white', label: 'Off-white' },
  { value: 'white', label: 'White' },
  { value: 'orange', label: 'Orange' },
];
const INPUT_MAP_OPTS: { value: InputMapMode; label: string }[] = [
  { value: 'follow-mode', label: 'Follow mode' },
  { value: 'rectangular', label: 'Rectangular' },
  { value: 'circular', label: 'Circular' },
];
const NETWORK_RESIZE_OPTS: { value: NetworkResizePolicy; label: string }[] = [
  { value: 'capacity', label: 'Keep capacity' },
  { value: 'exact', label: 'Exact I/O' },
];
const EXAMPLE_RESIZE_OPTS: { value: ExampleResizePolicy; label: string }[] = [
  { value: 'adapt', label: 'Adapt' },
  { value: 'clear', label: 'Clear' },
];

function SettingsDrawer({ depth }: { ctx: ConsoleCtx; depth: DrawerDepth }) {
  const { settings, set } = useSettings();
  return (
    <>
      <SectionLabel>Icons</SectionLabel>
      <Switch
        checked={settings.monochromeIcons}
        onChange={(v) => set('monochromeIcons', v)}
        label="Monochrome icons"
      />
      {depth === 'expanded' && (
        <>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>Unfocused icon colour</div>
          <PillToggle
            value={settings.unfocusedIconColour}
            onChange={(v) => set('unfocusedIconColour', v as UnfocusedIconColour)}
            options={ICON_COLOUR_OPTS}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ color: unfocusedIconCss(settings.unfocusedIconColour), display: 'inline-flex' }}>
              <SettingsIcon size={20} />
            </span>
            <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>
              <SettingsIcon size={20} />
            </span>
          </div>
        </>
      )}

      <SectionLabel>Input map</SectionLabel>
      <PillToggle
        value={settings.inputMap}
        onChange={(v) => set('inputMap', v as InputMapMode)}
        options={INPUT_MAP_OPTS}
      />
      <SectionLabel>I/O editing</SectionLabel>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>Network size</div>
      <PillToggle
        value={settings.networkResizePolicy}
        onChange={(v) => set('networkResizePolicy', v as NetworkResizePolicy)}
        options={NETWORK_RESIZE_OPTS}
        ariaLabel="Network resize policy"
      />
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>Existing examples</div>
      <PillToggle
        value={settings.exampleResizePolicy}
        onChange={(v) => set('exampleResizePolicy', v as ExampleResizePolicy)}
        options={EXAMPLE_RESIZE_OPTS}
        ariaLabel="Example resize policy"
      />
      {depth === 'expanded' && (
        <>
          <Slider
            label="New input example value"
            value={settings.addedInputExampleValue}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set('addedInputExampleValue', v)}
          />
          <Slider
            label="New output example value"
            value={settings.addedOutputExampleValue}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set('addedOutputExampleValue', v)}
          />
        </>
      )}

      <SectionLabel>Chrome</SectionLabel>
      <Slider
        label="Corner radius"
        value={settings.cornerRadius}
        min={0}
        max={14}
        step={1}
        unit="px"
        onChange={(v) => set('cornerRadius', Math.round(v))}
      />
      <SectionLabel>Experimental features</SectionLabel>
      <Switch
        checked={settings.xavierSpreadEnabled}
        onChange={(v) => set('xavierSpreadEnabled', v)}
        label="Xavier / spread randomisation"
      />
    </>
  );
}

// ===========================================================================
// 5. HELP
// ===========================================================================

const KEYS: [string, string][] = [
  ['1', 'down − / explore'],
  ['2', 'commit +'],
  ['space / ↑', 'commit +'],
  ['↓', 'down − / explore'],
  ['3–5', 'open drawers'],
  ['\\', 'expand drawer'],
  ['z', 'undo'],
  ['[ ] =', 'split (composite)'],
  ['dbl-click mark', 'follow mouse (Esc exits)'],
];
function HelpDrawer() {
  return (
    <>
      <SectionLabel>Keyboard</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {KEYS.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)' }}>
            <kbd
              style={{
                background: 'var(--bg-2)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-1)',
                padding: '1px 6px',
                color: 'var(--accent)',
              }}
            >
              {k}
            </kbd>
            <span style={{ color: 'var(--fg-mute)' }}>{v}</span>
          </div>
        ))}
      </div>
      <SectionLabel>Learn more</SectionLabel>
      <a
        href="animations/"
        target="_blank"
        rel="noopener"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 'var(--fs-xs)',
          color: 'var(--accent-2)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-1)',
          padding: '5px 10px',
          width: 'fit-content',
          textDecoration: 'none',
        }}
      >
        ▶ Watch the explainers + interactive demos
      </a>
    </>
  );
}

export interface DrawerSection {
  /** Monochrome inline-SVG icon (currentColor-driven by the dock button). */
  icon: ReactNode;
  /** Prior colour-emoji glyph, used when monochrome icons are OFF. */
  glyph: string;
  label: string;
  render: (ctx: ConsoleCtx, depth: DrawerDepth) => ReactNode;
}

export const DRAWERS: Record<DrawerKey, DrawerSection> = {
  learn: { icon: <LearningIcon />, glyph: '🧠', label: 'Learning', render: LearningDrawer },
  inputs: { icon: <InputsIcon />, glyph: '🎚', label: 'Inputs', render: InputsDrawer },
  route: { icon: <OutputsIcon />, glyph: '🔀', label: 'Outputs', render: RoutingDrawer },
  settings: { icon: <SettingsIcon />, glyph: '⚙', label: 'Settings', render: (c, d) => <SettingsDrawer ctx={c} depth={d} /> },
  help: { icon: <HelpIcon />, glyph: '?', label: 'Help', render: HelpDrawer },
};
