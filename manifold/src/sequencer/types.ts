/**
 * Sequencer contract — shared by the generators, the clock worker, the dock
 * drawer and the dual-engine rig. The sequencer is driven by its OWN MLP
 * engine: that engine's outputs (0..1, SEQ_SLOTS of them) are the generator's
 * musical parameters; the dock menu holds the fixed "musician" settings.
 */

export type GeneratorId = 'euclid-turing' | 'walker' | 'steps';

/** Number of MLP output slots every generator is given (unused slots ignored). */
export const SEQ_SLOTS = 8;

/** User-facing fixed settings (dock Sequencer drawer). Never MLP-controlled. */
export interface SequencerSettings {
  generator: GeneratorId;
  /** Key of SCALES (see scales.ts). */
  scale: string;
  /** Root pitch class 0..11 (0 = C). */
  root: number;
  /** Pattern length in steps, 2..16. */
  steps: number;
  /** Octaves spanned by the note pool, 1..4. */
  octaveRange: number;
  /** Whole octaves added to the pool, -3..+3 (C3 = MIDI 48 is octave 0). */
  octaveOffset: number;
  /** Tempo, 40..240 BPM. Step = one 16th note. */
  bpm: number;
  /** Base gate length as a fraction of a step, 0.05..1. */
  gate: number;
  running: boolean;
  /** Seeds every generator's deterministic RNG (same seed ⇒ same melody). */
  seed: number;
}

export const DEFAULT_SEQUENCER_SETTINGS: SequencerSettings = {
  generator: 'euclid-turing',
  scale: 'minor-pentatonic',
  root: 0,
  steps: 16,
  octaveRange: 2,
  octaveOffset: 0,
  bpm: 110,
  gate: 0.6,
  running: false,
  seed: 1,
};

/** One MLP output slot's meaning for a generator. */
export interface GeneratorSlot {
  /** Stable semantic id (used for output-card identity). */
  id: string;
  /** Short display label. */
  label: string;
  /** One-line beginner explanation. */
  hint: string;
}

/** What a generator decides for one step. `note: null` = rest. */
export interface StepEvent {
  /** MIDI note number or null for a rest. */
  note: number | null;
  /** 0..1. */
  velocity: number;
  /** Gate length as a fraction of the step, 0.05..1. */
  gate: number;
}

/** Per-instance mutable generator state. Must be deterministic given the seed. */
export interface GeneratorState {
  /**
   * Decide step `index` (0-based, monotonically increasing across loops; the
   * pattern position is `index % settings.steps`). `p` = latest MLP outputs
   * (length SEQ_SLOTS, each 0..1). MUST NOT allocate in the common path.
   */
  step(index: number, p: Float32Array, s: SequencerSettings): StepEvent;
  reset(seed: number): void;
}

export interface Generator {
  id: GeneratorId;
  label: string;
  /** One-line beginner description. */
  blurb: string;
  /** Meaning of MLP output slots 0..slots.length-1 (length ≤ SEQ_SLOTS). */
  slots: readonly GeneratorSlot[];
  create(seed: number): GeneratorState;
}
