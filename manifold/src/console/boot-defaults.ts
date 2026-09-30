/**
 * What a new Manifold session boots with — the ML/feedback defaults that
 * shape how learning FEELS before the user touches a setting.
 *
 * One importable home so the hidden ML lab (src/lab/, `?lab=1`) evaluates
 * exactly what ships and can say which of these to change. ConsoleApp reads
 * them as initial state. Changing a value here changes the product.
 *
 * Other shipped defaults the lab reads from their own single sources:
 *   training dose      — schemas/ml_defaults.json → ML_TRAIN_DEFAULTS
 *   geometric dislike  — DEFAULT_GEOMETRIC_FEEDBACK_CONFIG (engine/engine-api.ts)
 *   net shape          — the boot mode's schema `ml` block (console/model.ts)
 *   nudge stddev       — FeedbackController (feedback/controller.ts)
 */
import type { FeedbackModeUI, ManifoldInputSize, SoloMode } from './types';

/** Instrument mode at boot (its schema `ml` block sets hidden widths + outputs). */
export const BOOT_MODE_ID = 'paf_synth';

/** Model input arity at boot (the Inputs drawer offers 2 or 4). */
export const BOOT_MODEL_INPUT_SIZE: ManifoldInputSize = 2;

/** Feedback mode at boot: "Push away" (geometric dislike). */
export const BOOT_FEEDBACK_MODE: FeedbackModeUI = 'geometric-dislike';

export const BOOT_SOLO_MODE: SoloMode = 'mask-gradients';

/**
 * Weight-draw spread when Settings' "Xavier / spread randomisation" is off
 * (the default): 0 = full-range uniform. With it on, ConsoleApp uses the
 * mode's `defaultSpread` (or 1 with the Learning drawer's Xavier switch).
 */
export const BOOT_RANDOMISATION_SPREAD = 0;
