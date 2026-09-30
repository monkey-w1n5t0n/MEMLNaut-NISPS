/**
 * The lab's knobs: every Manifold default the lab can vary, with its SHIPPED
 * value read from the one place the product reads it (never re-typed here),
 * so "compare against shipped" always means what a new session boots with.
 *
 * A knob is only listed if the product can actually run a different value —
 * the lab's job is to choose shipping defaults, and a default Manifold cannot
 * ship is not a candidate. Core-level experiments (activations, optimisers)
 * belong to the native lab (tests/cpp/ml_bench.cpp, lab/ml/).
 */
import {
  BOOT_FEEDBACK_MODE,
  BOOT_MODE_ID,
  BOOT_MODEL_INPUT_SIZE,
  BOOT_RANDOMISATION_SPREAD,
} from '../console/boot-defaults';
import { MF_MODES } from '../console/model';
import { DEFAULT_GEOMETRIC_FEEDBACK_CONFIG } from '../engine/engine-api';
import { ML_TRAIN_DEFAULTS } from '../modes/generated/ml_defaults';

export type FeedbackModeId = 'geometric-dislike' | 'explore-and-place';

export interface LabConfig {
  feedbackMode: FeedbackModeId;
  h1: number;
  h2: number;
  h3: number;
  spread: number;
  learningRate: number;
  maxIterations: number;
  geoLearningRate: number;
  geoUpdatesPerSecond: number;
  geoLifetimeMs: number;
  nudgeStddev: number;
}

export type KnobKey = keyof LabConfig;

export interface Knob {
  key: KnobKey;
  label: string;
  /** Where the shipped value lives (shown in the UI next to a recommendation). */
  source: string;
  kind: 'enum' | 'int' | 'float';
  choices?: readonly string[];
  /** Candidate values for a one-at-a-time sweep around shipped. */
  candidates: readonly (number | string)[];
  /** Only meaningful in this feedback mode (skipped in the other's sweeps). */
  onlyIn?: FeedbackModeId;
}

const bootMode = MF_MODES.find((m) => m.id === BOOT_MODE_ID) ?? MF_MODES[0]!;

/** The net's fixed boot I/O (not knobs: they follow the instrument + input). */
export const BOOT_IO = {
  inputSize: BOOT_MODEL_INPUT_SIZE as number,
  outputSize: bootMode.ml.outputSize,
  modeId: bootMode.id,
};

export const SHIPPED: Readonly<LabConfig> = {
  feedbackMode: BOOT_FEEDBACK_MODE,
  h1: bootMode.ml.hidden[0],
  h2: bootMode.ml.hidden[1],
  h3: bootMode.ml.hidden[2],
  spread: BOOT_RANDOMISATION_SPREAD,
  learningRate: ML_TRAIN_DEFAULTS.learningRate,
  maxIterations: ML_TRAIN_DEFAULTS.maxIterations,
  geoLearningRate: DEFAULT_GEOMETRIC_FEEDBACK_CONFIG.learningRate,
  geoUpdatesPerSecond: DEFAULT_GEOMETRIC_FEEDBACK_CONFIG.updatesPerSecond,
  geoLifetimeMs: DEFAULT_GEOMETRIC_FEEDBACK_CONFIG.lifetimeMs,
  // FeedbackController's default; ConsoleApp does not override it.
  nudgeStddev: 0.05,
};

export const KNOBS: readonly Knob[] = [
  { key: 'feedbackMode', label: 'Feedback mode at boot', source: 'console/boot-defaults.ts BOOT_FEEDBACK_MODE',
    kind: 'enum', choices: ['geometric-dislike', 'explore-and-place'], candidates: ['geometric-dislike', 'explore-and-place'] },
  { key: 'h1', label: 'Hidden layer 1', source: `schemas/modes/${bootMode.id}.json ml.hidden[0]`, kind: 'int', candidates: [4, 6, 10, 16, 24] },
  { key: 'h2', label: 'Hidden layer 2', source: `schemas/modes/${bootMode.id}.json ml.hidden[1]`, kind: 'int', candidates: [4, 6, 10, 16, 24] },
  { key: 'h3', label: 'Hidden layer 3', source: `schemas/modes/${bootMode.id}.json ml.hidden[2]`, kind: 'int', candidates: [6, 10, 14, 20, 32] },
  { key: 'spread', label: 'Weight-draw spread', source: 'console/boot-defaults.ts BOOT_RANDOMISATION_SPREAD',
    kind: 'float', candidates: [0, 0.3, 0.6, 1] },
  { key: 'learningRate', label: 'Like: learning rate', source: 'schemas/ml_defaults.json learning_rate',
    kind: 'float', candidates: [0.001, 0.003, 0.01, 0.1, 1] },
  { key: 'maxIterations', label: 'Like: max iterations', source: 'schemas/ml_defaults.json max_iterations',
    kind: 'int', candidates: [10, 50, 200, 1000, 3000] },
  { key: 'geoLearningRate', label: 'Dislike: learning rate', source: 'engine/engine-api.ts DEFAULT_GEOMETRIC_FEEDBACK_CONFIG',
    kind: 'float', candidates: [0.0005, 0.001, 0.003, 0.01, 0.03], onlyIn: 'geometric-dislike' },
  { key: 'geoUpdatesPerSecond', label: 'Dislike: replay rate (Hz)', source: 'engine/engine-api.ts DEFAULT_GEOMETRIC_FEEDBACK_CONFIG',
    kind: 'float', candidates: [0, 50, 100, 200, 400], onlyIn: 'geometric-dislike' },
  { key: 'geoLifetimeMs', label: 'Dislike: lifetime (ms)', source: 'engine/engine-api.ts DEFAULT_GEOMETRIC_FEEDBACK_CONFIG',
    kind: 'float', candidates: [500, 1000, 2500, 5000], onlyIn: 'geometric-dislike' },
  { key: 'nudgeStddev', label: 'Nudge size', source: 'feedback/controller.ts nudgeStddev',
    // Push-away mode's nudge pill uses a literal 0.05 (ConsoleApp nudgeNet),
    // so this knob only reaches the explore-and-place scratchpad nudge.
    kind: 'float', candidates: [0.01, 0.02, 0.05, 0.1, 0.2], onlyIn: 'explore-and-place' },
];

export function knob(key: KnobKey): Knob {
  const k = KNOBS.find((x) => x.key === key);
  if (!k) throw new Error(`unknown knob ${key}`);
  return k;
}

/** Stable, short identity for a config (for pairing and file names). */
export function configKey(c: LabConfig): string {
  return KNOBS.map((k) => `${k.key}=${c[k.key]}`).join('|');
}

/** Only the knobs that differ from shipped, e.g. "learningRate=0.1". */
export function describeDiff(c: LabConfig): string {
  const d = KNOBS.filter((k) => c[k.key] !== SHIPPED[k.key]).map((k) => `${k.key}=${c[k.key]}`);
  return d.length ? d.join(', ') : 'shipped';
}
