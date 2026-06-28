/**
 * Console — the FIVE real dock drawers (operator dock restructure). Each renderer
 * takes (ctx, depth); what shows is gated by depth (peek | expand | full):
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
import { OutputControlRow } from '../dock/OutputControlRow';
import { BackendAdvanced } from '../dock/BackendAdvanced';
import { OutputsBackendConfig, BackendStatusChip } from '../dock/OutputsBackendConfig';
import { BACKENDS } from '../dock/output-state';
import { shapeValues } from './model';
import { outputModeDescriptor } from './output-mode';
import { useSettings, unfocusedIconCss } from '../settings/settings-store';
import type { UnfocusedIconColour, InputMapMode } from '../settings/settings-store';
import { EditorPanel } from '../serial/EditorPanel';
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
      {depth !== 'peek' && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          {FEEDBACK_DESC[ctx.feedbackMode]}
        </p>
      )}

      {depth !== 'peek' && (
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
          <Segmented value={ctx.soloMode} onChange={ctx.setSoloMode} options={SOLO_OPTS} />
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
            {SOLO_DESC[ctx.soloMode]} Solo only freezes the rest as far as a shared network allows.
          </p>

          <SectionLabel>Live training params</SectionLabel>
          <Slider label="noise cap" value={ctx.noiseCap} min={0} max={0.5} step={0.01} onChange={ctx.setNoiseCap} />
          <Slider label="spread" value={ctx.spreadLevel} min={0} max={1} step={0.01} onChange={ctx.setSpreadLevel} />
          <Slider label="tame · output limiter" value={ctx.tame} min={0} max={1} step={0.01} onChange={ctx.setTame} />
          <Slider
            label="learning rate"
            value={ctx.learningRate}
            min={0.000001}
            max={0.01}
            step={0.000001}
            onChange={ctx.setLearningRate}
            format={(v) => v.toExponential(1)}
          />
          <Slider label="decay" value={ctx.decay} min={0.8} max={1} step={0.001} onChange={ctx.setDecay} />
        </>
      )}

      {depth === 'full' && (
        <>
          <SectionLabel>Feedback lab</SectionLabel>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
            State machine: idle → exploring → commit / cancel. While Explore & place is exploring,
            training is paused and the joystick auditions a random scratchpad net; + commits a placed
            anchor and restores the real net.
          </p>
          <Switch checked={ctx.spread} onChange={ctx.setSpread} label="Xavier (centered) weight regime" />
          {/* TODO(dock-spec §1.3): real LossPlot / WeightHealth / LayerStats / GradientFlow need
              nisps_ml_loss_history plumbed through the C API. Diagnostics suite deferred. */}
          <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0 }}>
            Loss plot · weight-health · layer-stats · gradient-flow land here once the loss-history C API
            is plumbed (dock-spec §1.3).
          </p>
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

function InputsDrawer(ctx: ConsoleCtx, depth: DrawerDepth) {
  const inp = ctx.inputs;
  const enabledCount = inp.sources.filter((s) => s.enabled).length;
  const reshaping = inp.axisCount > inp.engineInputSize;

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge tone="info">
          {enabledCount === 0 ? 'no source' : `${enabledCount} source${enabledCount > 1 ? 's' : ''}`}
        </Badge>
        <Chip tone="var(--accent)">{inp.axisCount} axes</Chip>
        <Chip>engine: {inp.engineInputSize}-in</Chip>
        {reshaping && <Chip tone="var(--warn)">blended → {inp.engineInputSize}</Chip>}
      </div>

      <SectionLabel>Sources</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {inp.sources.map((s) => (
          <div
            key={s.kind}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '4px 8px',
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-1)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
                {s.label}
                {s.enabled ? ` · ${s.axisCount} ax` : ''}
              </span>
              {depth !== 'peek' && (
                <span style={{ fontSize: 9, color: STATUS_TONE[s.status.state] ?? 'var(--fg-dim)' }}>
                  {s.status.message}
                </span>
              )}
            </div>
            <Switch checked={s.enabled} onChange={(v) => inp.setEnabled(s.kind, v)} label="" />
          </div>
        ))}
      </div>

      {depth !== 'peek' && (
        <>
          {/* ---- Gamepad config ---- */}
          {inp.sources.find((s) => s.kind === 'gamepad')?.enabled && (
            <>
              <SectionLabel>Gamepad · sticks</SectionLabel>
              <Segmented
                value={inp.gamepadStickMode}
                onChange={inp.setGamepadStickMode}
                options={[
                  { value: 'single', label: 'Single (2 ax)' },
                  { value: 'double', label: 'Double (4 ax)' },
                ]}
              />
            </>
          )}

          {/* ---- MIDI learn-map ---- */}
          {inp.sources.find((s) => s.kind === 'midi')?.enabled && (
            <>
              <SectionLabel>MIDI · learn-map</SectionLabel>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  variant={inp.midiLearnArmed ? 'primary' : 'secondary'}
                  onClick={() => inp.armMidiLearn(!inp.midiLearnArmed)}
                >
                  {inp.midiLearnArmed ? 'learning… (move a control)' : 'Learn axis'}
                </Button>
                {inp.midiBindings.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={inp.clearMidiBindings}>
                    Clear all
                  </Button>
                )}
              </div>
              {inp.midiBindings.length === 0 ? (
                <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0 }}>
                  No axes learned yet — arm Learn, then wiggle a knob or hit a pad. CCs map to a
                  continuous axis; notes map to a gate (1 while held).
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {inp.midiBindings.map((b, i) => (
                    <div
                      key={`${b.kind}-${b.number}-${b.channel}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 'var(--fs-xs)',
                        color: 'var(--fg-mute)',
                      }}
                    >
                      <span>
                        {b.label} · {b.value.toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => inp.clearMidiBinding(i)}
                        style={{
                          background: 'transparent',
                          border: 0,
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          fontSize: 'var(--fs-xs)',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {inp.midiInputs.length > 0 && (
                <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0 }}>
                  Listening on: {inp.midiInputs.map((p) => p.name).join(', ')}
                </p>
              )}
            </>
          )}

          {/* ---- Channel layout ---- */}
          <SectionLabel>Channel layout</SectionLabel>
          {inp.channelLayout.length === 0 ? (
            <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0 }}>
              No active axes. Enable a source above.
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {inp.channelLayout.map((c, i) => (
                <Chip key={i}>
                  {i}: {c.source}·{c.label}
                </Chip>
              ))}
            </div>
          )}

          <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
            The active sources concatenate into one input vector at the head of the spine.
            {reshaping
              ? ` The browser WASM is a fixed ${inp.engineInputSize}-input head (MLP<2,…>), so the
                 ${inp.axisCount} axes are blended down to ${inp.engineInputSize} (even→X / odd→Y mean).`
              : ''}{' '}
            {/* TODO(workstream F, docs/redesign/inputs-spec.md — "multiple WASM modules +
                warm-start"): give every axis its own genuine input dimension by (re)loading a
                WASM module whose MLP arity matches axisCount and warm-starting from the prior
                net. Deferred — the reduction lives in InputLayer.compose(). */}
            True per-axis dimensions land with the multi-WASM reshape (inputs-spec).
          </p>
        </>
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
          <Slider label="master volume" value={ctx.volume} min={0} max={1} step={0.01} onChange={ctx.setVolume} />
          {depth !== 'peek' && (
            <>
              <SectionLabel>Tempo</SectionLabel>
              <Slider label="bpm" value={ctx.bpm} min={40} max={220} step={1} onChange={ctx.setBpm} />
              <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
                The active engine follows the selected mode ({ctx.mode.label}).
                {/* TODO(dock-spec §5): arpeggiator + tiered synth presets + the
                    18-section group-override matrix are workstream E. */}
              </p>
            </>
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
      return depth !== 'peek' ? (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          Flow-field visualiser driven by the first {Math.min(20, ctx.params.length)} outputs (no audio).
          {/* TODO(backends-spec §4): port FlowFieldVisualizer + visual preset chips. */}
        </p>
      ) : null;
    case 'midi':
      // The full MIDI config (port picker, CC count, per-output CC/channel/name)
      // + preset bar render via OutputsBackendConfig in RoutingDrawer below.
      return depth !== 'peek' ? (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          Each output sends a real Web MIDI CC. Pick a port and set CC# / channel per output.
        </p>
      ) : null;
    case 'osc':
      return depth !== 'peek' ? (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
          Each output sends to an OSC path with a physical range, over the WebSocket bridge.
        </p>
      ) : null;
    default:
      return null;
  }
}

function RoutingDrawer(ctx: ConsoleCtx, depth: DrawerDepth) {
  const values = shapeValues(ctx.params, null); // bar uses shaped held/live value snapshot
  const counts = ctx.params.reduce<Record<string, number>>((a, p) => {
    a[p.status] = (a[p.status] || 0) + 1;
    return a;
  }, {});
  const mutedN = ctx.params.filter((p) => p.muted).length;
  const modeDesc = outputModeDescriptor(ctx.outputMode);
  const backend = BACKENDS.find((b) => b.id === modeDesc.backend) ?? BACKENDS[0];
  // The particle Mode names its outputs; otherwise use the param names.
  const nameFor = (idx: number, fallback: string) =>
    ctx.outputMode === 'particles' ? VISUAL_NAMES[idx] ?? fallback : fallback;

  if (depth === 'full') {
    return (
      <>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip tone="var(--accent)">{modeDesc.label}</Chip>
          <BackendStatusChip ctx={ctx} />
        </div>
        {ModeConfig(ctx, depth)}
        {/* Specialised, editable per-backend config (MIDI/OSC) + named-preset bar. */}
        <OutputsBackendConfig ctx={ctx} backend={modeDesc.backend} />
        <SectionLabel>Advanced · {modeDesc.label}</SectionLabel>
        <BackendAdvanced backend={modeDesc.backend} params={ctx.params} setParam={ctx.setParam} />
      </>
    );
  }

  const rows = depth === 'peek' ? ctx.params.slice(0, 6) : ctx.params;
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
      {/* Specialised per-backend config + named-preset bar (MIDI/OSC); hidden at peek. */}
      {depth !== 'peek' && <OutputsBackendConfig ctx={ctx} backend={modeDesc.backend} />}
      <SectionLabel>Outputs · M mute · S arm · off/fixed/live</SectionLabel>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          maxHeight: depth === 'peek' ? 220 : 460,
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
              showCurve={depth !== 'peek'}
            />
          );
        })}
      </div>
      {depth === 'peek' && ctx.params.length > 6 && (
        <span style={{ fontSize: 9, color: 'var(--fg-dim)' }}>+{ctx.params.length - 6} more — expand to edit</span>
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
      {depth !== 'peek' && (
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
      {depth !== 'peek' && (
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
      {depth !== 'peek' && (
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
  ['1–5', 'open drawers'],
  ['\\', 'full depth'],
  ['space / ↑', 'commit +'],
  ['↓', 'perturb / down −'],
  ['z', 'undo'],
  ['[ ] =', 'split (composite)'],
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
