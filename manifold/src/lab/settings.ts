/**
 * The lab's knobs: every Manifold default the lab can vary, with its SHIPPED
 * value read from the one place the product reads it (never re-typed here),
 * so "compare against shipped" always means what a new session boots with.
 *
 * A knob is only listed if the product can actually run a different value —
 * the lab's job is to choose shipping defaults, and a default Manifold cannot
 * ship is not a candidate. Core-level experiments the browser engine cannot
 * express (activations, optimiser kind) belong to the native lab
 * (tests/cpp/ml_bench.cpp, lab/ml/).
 */
import {
  BOOT_FEEDBACK_MODE,
  BOOT_MODE_ID,
  BOOT_MODEL_INPUT_SIZE,
  BOOT_RANDOMISATION_SPREAD,
} from '../console/boot-defaults';
import { MF_MODES } from '../console/model';
import { DEFAULT_GEOMETRIC_FEEDBACK_CONFIG } from '../engine/engine-api';
import { SHIPPED_OPTIM } from '../engine/wasm-iml';
import { ML_TRAIN_DEFAULTS } from '../modes/generated/ml_defaults';

export type FeedbackModeId = 'geometric-dislike' | 'explore-and-place';
/** How likes reach the weights: retrain on the press (shipped) or drift toward them. */
export type LikeModeId = 'burst' | 'background';

export interface LabConfig {
  feedbackMode: FeedbackModeId;
  h1: number;
  h2: number;
  h3: number;
  spread: number;
  learningRate: number;
  maxIterations: number;
  /** RMSProp cap on the normalised step (nisps/ml/training.hpp kMaxAdjustedLr). */
  optimMaxAdjLr: number;
  likeMode: LikeModeId;
  /** background only: training ticks per second, per-tick lr, ms kept training after a like. */
  bgHz: number;
  bgLr: number;
  bgMs: number;
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
  /** Candidate values for a one-at-a-time sweep around a base. */
  candidates: readonly (number | string)[];
  /** Only meaningful in this feedback mode (skipped in the other's sweeps). */
  onlyIn?: FeedbackModeId;
  /** Only meaningful in this like mode. */
  onlyLike?: LikeModeId;
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
  optimMaxAdjLr: SHIPPED_OPTIM.maxAdjLr,
  // The shipped like is the synchronous retrain. The bg* values below are the
  // lab's starting points for the alternative and are inert while likeMode is
  // 'burst' (canon() pins them so they never create duplicate configs).
  likeMode: 'burst',
  bgHz: 100,
  bgLr: 0.0003,
  bgMs: 3000,
  geoLearningRate: DEFAULT_GEOMETRIC_FEEDBACK_CONFIG.learningRate,
  geoUpdatesPerSecond: DEFAULT_GEOMETRIC_FEEDBACK_CONFIG.updatesPerSecond,
  geoLifetimeMs: DEFAULT_GEOMETRIC_FEEDBACK_CONFIG.lifetimeMs,
  // FeedbackController's default; ConsoleApp does not override it.
  nudgeStddev: 0.05,
};

export const KNOBS: readonly Knob[] = [
  { key: 'feedbackMode', label: 'Feedback mode at boot', source: 'console/boot-defaults.ts BOOT_FEEDBACK_MODE',
    kind: 'enum', choices: ['geometric-dislike', 'explore-and-place'], candidates: ['geometric-dislike', 'explore-and-place'] },
  { key: 'likeMode', label: 'Like learning', source: 'FeedbackController.learn() (opt-in backgroundLearning)',
    kind: 'enum', choices: ['burst', 'background'], candidates: ['burst', 'background'] },
  { key: 'h1', label: 'Hidden layer 1', source: `schemas/modes/${bootMode.id}.json ml.hidden[0]`, kind: 'int', candidates: [4, 6, 10, 16, 24] },
  { key: 'h2', label: 'Hidden layer 2', source: `schemas/modes/${bootMode.id}.json ml.hidden[1]`, kind: 'int', candidates: [4, 6, 10, 16, 24] },
  { key: 'h3', label: 'Hidden layer 3', source: `schemas/modes/${bootMode.id}.json ml.hidden[2]`, kind: 'int', candidates: [6, 10, 14, 20, 32] },
  { key: 'spread', label: 'Weight-draw spread', source: 'console/boot-defaults.ts BOOT_RANDOMISATION_SPREAD',
    kind: 'float', candidates: [0, 0.3, 0.6, 1] },
  { key: 'optimMaxAdjLr', label: 'Optimiser step cap', source: 'nisps/ml/training.hpp kMaxAdjustedLr',
    kind: 'float', candidates: [1, 3, 10, 100, 1e6] },
  { key: 'learningRate', label: 'Like: learning rate', source: 'schemas/ml_defaults.json learning_rate',
    kind: 'float', candidates: [0.001, 0.003, 0.01, 0.1, 1], onlyLike: 'burst' },
  { key: 'maxIterations', label: 'Like: max iterations', source: 'schemas/ml_defaults.json max_iterations',
    kind: 'int', candidates: [10, 50, 200, 1000, 3000], onlyLike: 'burst' },
  { key: 'bgHz', label: 'Background: ticks per second', source: 'lab starting point (upstream ~100 Hz)',
    kind: 'float', candidates: [25, 50, 100, 200], onlyLike: 'background' },
  { key: 'bgLr', label: 'Background: learning rate per tick', source: 'lab starting point (upstream 1e-3 per batch step)',
    kind: 'float', candidates: [0.0001, 0.0003, 0.001, 0.003, 0.01], onlyLike: 'background' },
  { key: 'bgMs', label: 'Background: keep learning (ms)', source: 'lab starting point',
    kind: 'float', candidates: [1000, 3000, 6000, 20000], onlyLike: 'background' },
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

/** Does this knob do anything in config `c`? */
export function applies(k: Knob, c: LabConfig): boolean {
  if (k.onlyIn && k.onlyIn !== c.feedbackMode) return false;
  if (k.onlyLike && k.onlyLike !== c.likeMode) return false;
  return true;
}

/**
 * Pin every knob that does nothing in this config to its shipped value, so two
 * configs that behave identically are the SAME config (one key, one run).
 * Without this a background-mode config differs from another only in an inert
 * `learningRate`, and the sweep plays — and pairs — duplicates.
 */
export function canon(c: LabConfig): LabConfig {
  const out: LabConfig = { ...c };
  for (const k of KNOBS) if (!applies(k, c)) (out as unknown as Record<string, unknown>)[k.key] = SHIPPED[k.key];
  return out;
}

/** Stable, short identity for a config (for pairing and file names). */
export function configKey(c: LabConfig): string {
  const cc = canon(c);
  return KNOBS.map((k) => `${k.key}=${cc[k.key]}`).join('|');
}

/** Only the knobs that differ from shipped and matter, e.g. "optimMaxAdjLr=10". */
export function describeDiff(c: LabConfig): string {
  const cc = canon(c);
  const d = KNOBS.filter((k) => cc[k.key] !== SHIPPED[k.key]).map((k) => `${k.key}=${cc[k.key]}`);
  return d.length ? d.join(', ') : 'shipped';
}

// ---------------------------------------------------------------------------
// Presets: named whole configs to compare head to head.
// ---------------------------------------------------------------------------

export interface Preset {
  id: string;
  label: string;
  note: string;
  config: LabConfig;
}

const shippedCfg = SHIPPED as LabConfig;

export const PRESETS: readonly Preset[] = [
  { id: 'shipped', label: 'Shipped', note: 'What a new Manifold session boots with today.', config: { ...shippedCfg } },
  {
    id: 'cap10', label: 'Cap 10 (one constant)',
    note: 'Only the optimiser step cap raised from 1 to 10. Learning rate stays the SGD-era 1.0.',
    config: { ...shippedCfg, optimMaxAdjLr: 10 },
  },
  {
    id: 'real-rmsprop', label: 'Real RMSProp (lr 0.003)',
    note: 'Cap lifted so lr is a normalised step, lr set to a value that fits (bench: 8x lower fit error).',
    config: { ...shippedCfg, optimMaxAdjLr: 1e6, learningRate: 0.003 },
  },
  {
    id: 'upstream-like', label: 'Upstream-like (as Manifold can express it)',
    note:
      'Likes only store; ~100 Hz small normalised steps train toward them (upstream InterfaceRL). Dislike at upstream ' +
      'lr 0.001 / 100 Hz / 2.5 s. NOT expressible here: hard-sigmoid output, 10-pad-input net, batch-mean + norm-clip-5 ' +
      'gradients, nearby-like removal on dislike, reflected OU at dt 0.004.',
    config: {
      ...shippedCfg, likeMode: 'background', bgHz: 100, bgLr: 0.0001, bgMs: 60000, optimMaxAdjLr: 1e6,
      geoLearningRate: 0.001, geoUpdatesPerSecond: 100, h1: 16, h2: 16, h3: 16,
    },
  },
  {
    id: 'real-rmsprop-explore', label: 'Real RMSProp + explore & place',
    note: 'The same optimiser fix in the mode the first lab sweep preferred.',
    config: { ...shippedCfg, optimMaxAdjLr: 1e6, learningRate: 0.003, feedbackMode: 'explore-and-place' },
  },
];

export function preset(id: string): Preset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset ${id}`);
  return p;
}
