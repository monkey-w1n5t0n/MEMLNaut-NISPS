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
 *   settings — Settings : icon style + input-map shape (settings-store)
 *   help     — Help     : keymap + the loop explanation
 *
 * The TOP dock selector ("Mode") chooses the active OUTPUT backend/target; this
 * drawer renders whatever that backend needs.
 *
 * Engine wiring: the feedback-mode pill → controller.setMode; the arm flags →
 * engine.feedback.setFocus; per-output rows write the shared MFParam store.
 * Where engine support does not yet exist the UI + state are wired and a TODO
 * references the relevant spec — no faked engine behaviour.
 */
import type { ReactNode } from 'react';
import { Badge, Button, PillToggle, Slider, Switch } from '../primitives';
import type { ConsoleCtx, DrawerDepth, DrawerKey, FeedbackModeUI, SoloMode } from './types';
import type { InputMode } from '../inputs';
import { OutputControlRow } from '../dock/OutputControlRow';
import { OutputsBackendConfig, BackendStatusChip } from '../dock/OutputsBackendConfig';
import { shapeValues } from './model';
import { outputModeDescriptor } from './output-mode';
import { useSettings, unfocusedIconCss } from '../settings/settings-store';
import type { UnfocusedIconColour, InputMapMode } from '../settings/settings-store';
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
const FEEDBACK_DESC: Record<FeedbackModeUI, string> = {
  'geometric-dislike':
    'Down carves the current sound away from what you like — directed repulsion (Mode 1).',
  'explore-and-place':
    'Down re-rolls the whole net into a scratchpad you audition; + places a liked sound (Mode 2).',
};
/**
 * Solo behaviour. `mask-gradients` is the only variant the core actually
 * implements — `soloMode` has no other observable effect today (the other two
 * options need the C API's `train_masked` step). Rendered as a fixed,
 * non-selectable label rather than a picker that offers dead choices
 * (simplification audit L20).
 */
const SOLO_OPTS: { value: SoloMode; label: string }[] = [
  { value: 'mask-gradients', label: 'Mask gradients' },
  { value: 'zero-loss', label: 'Zero loss' },
  { value: 'dont-care', label: "Don't-care mask" },
];
const SOLO_DESC: Record<SoloMode, string> = {
  'mask-gradients': 'Column-freeze (default) — only the armed output moves; the rest stay bit-identical.',
  'zero-loss': 'Expressive, but armed and unarmed outputs share hidden weights, so others can drift.',
  'dont-care': 'Each example stores a per-output mask so stale labels never pull unarmed outputs.',
};

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
      {depth === 'expanded' && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          {FEEDBACK_DESC[ctx.feedbackMode]}
        </p>
      )}

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
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>
          hold to morph the whole net live · release to freeze
        </span>
      </div>
      <Slider
        label="explore · output wander"
        value={ctx.exploreIntensity}
        min={0}
        max={1}
        step={0.01}
        onChange={ctx.setExploreIntensity}
      />
      {depth === 'expanded' && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          Explore adds a slow random walk (Ornstein-Uhlenbeck) on the outputs so the sound roams;
          likes and dislikes registered mid-wander steer the net toward what you want. 0 = off. Jolt
          (firmware TogB1) and Explore (RVX1) drive the same core gestures as the MEMLNaut hardware.
        </p>
      )}

      <SectionLabel>Recorded examples</SectionLabel>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Chip>
          {ctx.datasetCount} example{ctx.datasetCount === 1 ? '' : 's'}
        </Chip>
        <Button size="sm" variant="secondary" onClick={ctx.onClear}>
          Clear
        </Button>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>
          forget every example & wipe the on-map marks
        </span>
      </div>

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
          <SectionLabel>Solo behaviour</SectionLabel>
          <Chip tone="var(--accent)">{SOLO_OPTS.find((o) => o.value === ctx.soloMode)?.label}</Chip>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
            {SOLO_DESC[ctx.soloMode]} Solo only freezes the rest as far as a shared network allows.
            The other two behaviours need real core support (`train_masked`) and aren't selectable yet.
          </p>

          <SectionLabel>Live training params</SectionLabel>
          <Slider label="noise cap" value={ctx.noiseCap} min={0} max={0.5} step={0.01} onChange={ctx.setNoiseCap} />
        </>
      )}

      {depth === 'expanded' && (
        <>
          <SectionLabel>Feedback lab</SectionLabel>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
            State machine: idle → exploring → commit / cancel. While Explore & place is exploring,
            training is paused and the joystick auditions a random scratchpad net; + commits a placed
            anchor and restores the real net.
          </p>
          <Switch checked={ctx.spread} onChange={ctx.setSpread} label="Xavier (centered) weight regime" />

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
      {active && depth === 'expanded' && (
        <span style={{ fontSize: 9, color: STATUS_TONE[active.status.state] ?? 'var(--fg-dim)' }}>
          {active.status.message}
        </span>
      )}

      {/* ---- Internal (XY pad / manifold) ---- */}
      {inp.inputMode === 'internal' && depth === 'expanded' && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          Drag the on-screen manifold / XY pad. Two axes feed the net directly — this is the default.
        </p>
      )}

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
          <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
            Connect a controller and press any button to wake it. Sticks drive the input map;
            buttons fire the verdicts above.
          </p>
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
function ModeConfig(ctx: ConsoleCtx, depth: DrawerDepth) {
  switch (ctx.outputMode) {
    case 'synth':
      return (
        <>
          <SectionLabel>Transport</SectionLabel>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Button size="sm" variant={ctx.audioStarted ? 'secondary' : 'primary'} onClick={ctx.onToggleAudio}>
              {ctx.audioStarted ? 'pause' : 'play'}
            </Button>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>audio starts on the play gesture</span>
          </div>
          {depth === 'expanded' && (
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
              The active engine follows the selected mode ({ctx.mode.label}).
              {/* TODO(dock-spec §5): arpeggiator + tiered synth presets + the
                  18-section group-override matrix are workstream E. Master
                  volume + bpm sliders were deleted (simplification audit
                  S16) — they drove no engine parameter. */}
            </p>
          )}
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
      return depth === 'expanded' ? (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          Flow-field visualiser driven by the first {Math.min(20, ctx.params.length)} outputs (no audio).
          {/* TODO(backends-spec §4): port FlowFieldVisualizer + visual preset chips. */}
        </p>
      ) : null;
    case 'midi':
      // The full MIDI config (port picker, CC count, per-output CC/channel/name)
      // + preset bar render via OutputsBackendConfig in RoutingDrawer below.
      return depth === 'expanded' ? (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          Each output sends a real Web MIDI CC. Pick a port and set CC# / channel per output.
        </p>
      ) : null;
    case 'osc':
      return depth === 'expanded' ? (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          Each output sends to an OSC path with a physical range, over the WebSocket bridge.
        </p>
      ) : null;
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
  // The particle Mode names its outputs; otherwise use the param names.
  const nameFor = (idx: number, fallback: string) =>
    ctx.outputMode === 'particles' ? VISUAL_NAMES[idx] ?? fallback : fallback;

  const expanded = depth === 'expanded';
  const rows = expanded ? activeParams : activeParams.slice(0, 6);
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip tone="var(--accent)">{modeDesc.label}</Chip>
        <Chip tone="var(--accent)">live {counts.live || 0}</Chip>
        <Chip tone="var(--accent-2)">fixed {counts.fixed || 0}</Chip>
        <Chip>off {counts.off || 0}</Chip>
        <Chip tone="var(--danger)">muted {mutedN}</Chip>
        <BackendStatusChip ctx={ctx} />
      </div>
      {ModeConfig(ctx, depth)}
      {/* Specialised per-backend config + named-preset bar (MIDI/OSC); hidden when condensed. */}
      {expanded && <OutputsBackendConfig ctx={ctx} backend={modeDesc.backend} />}
      <SectionLabel>Outputs · M mute · S arm · off/fixed/live</SectionLabel>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          maxHeight: expanded ? 460 : 220,
          overflow: 'auto',
        }}
      >
        {rows.map((p) => {
          const i = ctx.params.indexOf(p);
          const labelled = { ...p, name: nameFor(i, p.name) };
          return (
            <OutputControlRow
              key={i}
              param={labelled}
              value={values[i] ?? 0}
              onChange={(patch) => ctx.setParam(i, patch)}
              showCurve={expanded}
            />
          );
        })}
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
          <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
            Focused / active icons are always accent orange. This sets the resting colour of unfocused
            icons (preview below).
          </p>
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
      {depth === 'expanded' && (
        <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          The 2D input surface: a rectangular XY map or a circular joystick-style disc. "Follow mode"
          uses the active mode's declared input (joystick → circular, else rectangular).
        </p>
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
      {depth === 'expanded' && (
        <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          Roundness of buttons, control rows, dock icons and panels. Pills and the circular verdict
          buttons are intentionally exempt. Default 2px.
        </p>
      )}
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
      <SectionLabel>The loop</SectionLabel>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.7 }}>
        Drag the manifold to explore. Hear something good → + to keep it. Wrong → − to push away or
        re-roll (set the behaviour in the Learning drawer). Went too far → undo. The dock reveals
        exactly as much machinery as you reach for.
      </p>
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
