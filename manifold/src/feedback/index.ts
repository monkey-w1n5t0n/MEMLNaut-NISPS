/**
 * The learning-engine behaviour module (workstream B) — the two feedback modes
 * plus solo. As of one-core-engine P3 the algorithms (geometric dislike, the
 * scratchpad/undo lifecycle, the seeded RNG) live in the shared C++/WASM core;
 * the FeedbackController is a thin driver over those primitives.
 *
 * See docs/adr/rl-feedback-design.md for the authoritative design.
 */
export {
  FeedbackController,
  type ProtoFeedbackMode,
  type ProtoSoloMode,
  type Anchor,
  type ControllerEngine,
  type FeedbackControllerState,
  type FeedbackControllerOptions,
} from './controller';
