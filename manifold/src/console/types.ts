/**
 * Console — shared prop/context types used across the stage + dock components.
 */
import type { MFMode, MFParam } from './model';
import type { FeedbackMode } from '../engine/types';
import type { BackendStatus } from '../backends/backend';
import type { UseInputLayer } from '../inputs';

/** The two product feedback modes (dock-spec §1.1; rl-feedback-design §0). */
export type FeedbackModeUI = 'explore-and-place' | 'geometric-dislike';

/** Solo / arm gradient-mask variant (rl-feedback-design §0, §3). */
export type SoloMode = 'mask-gradients' | 'zero-loss' | 'dont-care';

export interface Pin {
  x: number;
  y: number;
  color?: string;
}

/**
 * The active OUTPUT MODE (target/backend). This is the TOP dock selector
 * (operator dock restructure). "Built-in Synth" is the synth backend — the
 * string "C15" must NEVER appear. Particle + Editor are non-audio.
 */
export type OutputMode = 'particles' | 'midi' | 'osc' | 'cv' | 'synth' | 'editor';

/** Feedback marker plotted on the 2D map at the input location it was given. */
export interface FeedbackMarker {
  /** Input-map location in [0,1]². */
  x: number;
  y: number;
  /** Polarity — positive (like / placed anchor) vs negative (dislike). */
  polarity: 'positive' | 'negative';
}

export type DrawerKey = 'learn' | 'inputs' | 'route' | 'settings' | 'help';
export type DrawerDepth = 'condensed' | 'expanded';

/**
 * The flat context the Dock + drawers read. Pruned 2026-07 (simplification
 * audit S19) to the fields Dock/Drawers/OutputsBackendConfig actually consume.
 * Deleted outright: the Axes type + axes/setAxis state, the
 * preset/setPreset/offsetActive chain (permanently 'Sculpt'/false), the
 * markers/outputBackend/setOutputBackend/cycleStatus fields (each had a zero-
 * consumer duplicate elsewhere — see ConsoleApp.tsx), and everything S16/S18/
 * L1/L20 removed (decorative sliders, snapshots, health/gradient visuals,
 * BackendAdvanced's catalogue).
 *
 * `modes` / `setModeId` are KEPT despite having no renderer today — this is
 * the exact plumbing the Phase-5 instrument-mode picker is built on (A7/A3),
 * not dead code. `busy` / `addingExample` / `onAddExample` / `onTrain` are ALSO
 * kept even though no drawer reads them either: unlike the fields above they
 * drive real engine calls (engine.addExample / engine.train), so — pending
 * confirmation either way — they read as unfinished plumbing rather than
 * confirmed-dead decoration.
 *
 * `loss` was DELETED with §6.5e (2026-07-21): it was a synthetic series (an
 * `evalLoss` sample when finite, otherwise `prev * 0.82` or a literal 0.5) that
 * no drawer read. The real per-iteration curve now comes straight from the core
 * — see `TrainingHealth.tsx` / `EngineApi.lossHistory()`.
 */
export interface ConsoleCtx {
  modes: MFMode[];
  modeId: string;
  setModeId: (id: string) => void;
  mode: MFMode;

  datasetCount: number;
  busy: boolean;
  addingExample: boolean;
  onAddExample: () => void;
  onTrain: () => void;
  onClear: () => void;

  params: MFParam[];
  /** Patch one output row in the shared store (drives stage + dock in sync). */
  setParam: (i: number, patch: Partial<MFParam>) => void;
  addOutput: (placement?: 'prepend' | 'append') => void;
  deleteOutput: (i: number) => void;
  /** Active backend outputs currently presented by the stage + routing rows. */
  displayOutputCount: number;

  // ---- Output backend transport (backends-spec §1–§5) ----
  /** Live status of the active output backend (MIDI/OSC connect state, etc.). */
  backendStatus: BackendStatus;
  /** Available Web MIDI output ports (for the MIDI config picker). */
  midiPorts: { id: string; name: string }[];
  refreshMidiPorts: () => void;
  /** MIDI backend settings (selected port + active output-card count). */
  midiOutputId: string | null;
  setMidiOutputId: (id: string | null) => void;
  midiCcCount: number;
  setMidiCcCount: (n: number) => void;
  /** OSC backend settings (bridge URL + send-raw toggle). */
  oscUrl: string;
  setOscUrl: (u: string) => void;
  oscSendRaw: boolean;
  setOscSendRaw: (v: boolean) => void;
  /** VCV backend settings (bridge URL + send-raw toggle). The Deno bridge
   * relays to the VCV module over UDP (default module port 7001). */
  vcvUrl: string;
  setVcvUrl: (u: string) => void;
  vcvSendRaw: boolean;
  setVcvSendRaw: (v: boolean) => void;
  /** uSEQ CV backend (USB serial): connect a port / flash LEDs / disconnect. */
  cvConnect: () => void;
  cvIdentify: () => void;
  cvDisconnect: () => void;
  /** Replace the whole params array (used when restoring a named preset). */
  setParams: (next: MFParam[]) => void;

  // ---- Active output MODE / target (TOP dock selector) ----
  outputMode: OutputMode;
  setOutputMode: (m: OutputMode) => void;

  // ---- Modular input layer (workstream F; inputs-spec) ----
  /** The composed input layer: source enable/config/status + channel layout. */
  inputs: UseInputLayer;

  spread: boolean;
  setSpread: (v: boolean) => void;
  /** Settings feature flag: expose and apply the legacy Xavier/spread regime. */
  xavierSpreadEnabled: boolean;
  noiseCap: number;
  setNoiseCap: (v: number) => void;

  // ---- Learning-behaviour (dock-spec §1; rl-feedback-design) ----
  feedbackMode: FeedbackModeUI;
  setFeedbackMode: (m: FeedbackModeUI) => void;
  soloMode: SoloMode;
  setSoloMode: (m: SoloMode) => void;
  /** True while the feedback controller is exploring (engine.feedback.exploring). */
  exploring: boolean;
  /** True while learning is paused (engine.feedback.learningPaused). */
  learningPaused: boolean;
  /** Count of currently-armed (soloed) outputs. */
  armedCount: number;
  /** Clear all arm flags ("Arm all"). */
  clearArmed: () => void;

  // ---- Exploration gestures (one-core-engine §P1; interim TS shells) ----
  /** True while the Jolt press-and-hold weight-morph is engaged. */
  joltActive: boolean;
  /** Begin the Jolt morph (button press). */
  onJoltPress: () => void;
  /** Freeze the Jolt morph where it landed (button release). */
  onJoltRelease: () => void;
  /** OU exploration amount on the output vector, [0,1]; 0 = off. */
  exploreIntensity: number;
  setExploreIntensity: (v: number) => void;

  // ---- Synth engine (dock-spec §5) ----
  audioStarted: boolean;
  onToggleAudio: () => void;

  // ---- Explore-and-place scratchpad session (workstream B; rl-feedback §2.2) ----
  /** True while awaiting a manifold location pick after pressing "place". */
  picking: boolean;
  /** Anchors placed in the current (not-yet-finalised) explore session. */
  anchorCount: number;
  /** Scratchpad undo-stack depth (rerolls + nudges that can be undone). */
  undoDepth: number;
  /** Enter the scratchpad / re-roll the whole net (Mode-2 explore). */
  onExplore: () => void;
  /** Re-roll the scratchpad net ("meh, randomise…"). */
  onScratchReroll: () => void;
  /** Small bounded weight nudge on the scratchpad (undoable). */
  onScratchNudge: () => void;
  /** Begin placing the current candidate → pick a manifold location next. */
  onPlace: () => void;
  /** Undo the last scratchpad op (reroll / nudge). */
  onScratchUndo: () => void;
  /** Finalise: restore the real net + warm-start to interpolate all anchors. */
  onFinalise: () => void;
  /** Cancel the whole explore session (discard scratchpad + anchors). */
  onCancelExplore: () => void;
}
