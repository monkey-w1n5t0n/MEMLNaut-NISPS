/**
 * Modular INPUT layer — adapter interface (workstream F).
 *
 * The redesign calls for the user to choose the input SOURCE(s) feeding the ML
 * head: the XY pad, a MIDI controller (CCs / notes learned onto axes), or a
 * gamepad (single-stick = 2 axes, double-stick = 4). Sources are composable —
 * the active sources are concatenated into one N-dim input vector at the head of
 * the reactive spine (engine.setInput / setInputs).
 *
 * Design intent (the canonical spec was `docs/redesign/inputs-spec.md`, which is
 * NOT present in this tree — see TODO refs below):
 *
 *  - **Pull-based.** The InputLayer owns a single rAF loop and pulls every
 *    active source's current state once per frame via `sample(out, offset)`.
 *    Event-driven sources (MIDI, gamepad) latch their latest state into internal
 *    fields between frames; the pad pushes directly (`pushAxes`) but still reads
 *    back through the same path. No source schedules its own engine writes.
 *  - **N axes + discrete actions.** Each source declares an axis COUNT (its
 *    dimensionality) and writes its axes into a slice of the shared vector. It
 *    may also surface momentary discrete ACTIONS (e.g. a MIDI note, a gamepad
 *    button) that the layer fans out to listeners (used for verdict
 *    commit/perturb without a keyboard).
 *  - **Graceful degrade.** A source that the platform can't provide
 *    (`navigator.requestMIDIAccess` missing, no gamepad connected) reports an
 *    `unavailable` status and contributes zero axes rather than throwing.
 *
 * Axis values are normalised to [0,1] (the ML head's input domain); the spine's
 * input-pipeline then applies deadzone/zoom/curve/etc.
 */

/** Lifecycle / availability of a source, surfaced to the dock UI. */
export type InputSourceState =
  | 'idle' // constructed, not yet started
  | 'connecting' // async permission / device handshake in flight
  | 'ready' // live, producing axes
  | 'unavailable' // platform/feature not present (graceful degrade)
  | 'error'; // start failed

export interface InputSourceStatus {
  state: InputSourceState;
  message: string;
}

/** Stable identity of a source kind. */
export type InputSourceKind = 'xy-pad' | 'midi' | 'gamepad';

/**
 * A momentary discrete action surfaced by a source (e.g. a MIDI note-on or a
 * gamepad face-button press). Fanned out to InputLayer action listeners so the
 * console can bind them to commit / perturb / reroll without the keyboard.
 */
export interface InputAction {
  source: InputSourceKind;
  /** Stable per-source action id ("note:36", "button:0", …). */
  id: string;
  /** Human label for the learn-map UI. */
  label: string;
  /** 0..1 velocity / analogue value where meaningful (else 1 for a press). */
  value: number;
}

/**
 * Pull-based input source adapter.
 *
 * Sources are framework-neutral (NO React). The InputLayer composes them; the
 * dock store wraps the layer for React.
 */
export interface InputSource {
  readonly kind: InputSourceKind;
  /** Short human label for the dock ("XY pad", "MIDI", "Gamepad"). */
  readonly label: string;

  /**
   * Number of axes this source currently contributes to the input vector.
   * MAY change at runtime (e.g. gamepad single↔double stick, MIDI learn-map
   * growing). The layer re-reads this each composition.
   */
  axisCount(): number;

  /** Per-axis labels for the channel-layout view (length === axisCount()). */
  axisLabels(): string[];

  /**
   * Write this source's current axes (each ∈ [0,1]) into `out` starting at
   * `offset`. Returns the number of axes written (=== axisCount()). Pull-based:
   * reads latched internal state, performs NO IO. Hot path — no allocation.
   */
  sample(out: Float32Array, offset: number): number;

  /** Begin producing (request permissions, attach listeners). Idempotent. */
  start(): Promise<void> | void;

  /** Stop producing + release resources. Idempotent. */
  stop(): Promise<void> | void;

  status(): InputSourceStatus;
  onStatusChange(cb: (s: InputSourceStatus) => void): () => void;

  /** Subscribe to discrete actions (notes / buttons). Returns unsubscribe. */
  onAction(cb: (a: InputAction) => void): () => void;
}
