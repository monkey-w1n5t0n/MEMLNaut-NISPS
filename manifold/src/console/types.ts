/**
 * Console — shared prop/context types used across the stage + dock components.
 */
import type { MFMode, MFParam } from './model';
import type { BackendId } from '../dock/output-state';
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

export interface Snapshot {
  id: number;
  tag: string;
  noise: number;
  seed: number;
}

export type DrawerKey = 'learn' | 'inputs' | 'route' | 'settings' | 'help';
export type DrawerDepth = 'condensed' | 'expanded';
export type Focus = 'in' | 'split' | 'out' | 'composite';

export interface Axes {
  boldness: number;
  memory: number;
  precision: number;
}

/** The flat context the Dock + drawers read. */
export interface ConsoleCtx {
  modes: MFMode[];
  modeId: string;
  setModeId: (id: string) => void;
  mode: MFMode;

  axes: Axes;
  setAxis: (k: keyof Axes, v: number) => void;

  preset: string;
  setPreset: (p: string) => void;
  offsetActive: boolean;

  datasetCount: number;
  loss: number[];
  busy: boolean;
  addingExample: boolean;
  onAddExample: () => void;
  onTrain: () => void;
  onClear: () => void;

  snapshots: Snapshot[];
  onJump: (id: number) => void;

  params: MFParam[];
  cycleStatus: (i: number) => void;
  /** Patch one output row in the shared store (drives stage + dock in sync). */
  setParam: (i: number, patch: Partial<MFParam>) => void;
  outputBackend: BackendId;
  setOutputBackend: (v: BackendId) => void;

  // ---- Output backend transport (backends-spec §1–§5) ----
  /** Live status of the active output backend (MIDI/OSC connect state, etc.). */
  backendStatus: BackendStatus;
  /** Available Web MIDI output ports (for the MIDI config picker). */
  midiPorts: { id: string; name: string }[];
  refreshMidiPorts: () => void;
  /** MIDI backend settings (selected port + number of CCs mapped). */
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

  // ---- Feedback markers on the 2D map (both polarities) ----
  /** Markers plotted at the input location where each feedback was given. */
  markers: FeedbackMarker[];

  // ---- Modular input layer (workstream F; inputs-spec) ----
  /** The composed input layer: source enable/config/status + channel layout. */
  inputs: UseInputLayer;

  health: number;
  gradient: number[];
  gradientStatus: string[];
  weightsRevision: number;

  spread: boolean;
  setSpread: (v: boolean) => void;
  tame: number;
  setTame: (v: number) => void;
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

  // ---- Live training params (dock-spec §1.3) ----
  learningRate: number;
  setLearningRate: (v: number) => void;
  decay: number;
  setDecay: (v: number) => void;
  spreadLevel: number;
  setSpreadLevel: (v: number) => void;

  // ---- Synth engine (dock-spec §5) ----
  audioStarted: boolean;
  onToggleAudio: () => void;
  volume: number;
  setVolume: (v: number) => void;
  bpm: number;
  setBpm: (v: number) => void;

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
