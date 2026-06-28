/**
 * The learning-engine behaviour module (workstream B) — the two feedback modes
 * plus solo, prototyped in TS on the existing engine primitives.
 *
 * See docs/redesign/rl-feedback-design.md for the authoritative design and the
 * C++ integration plan. Everything here is the TS-prototype-first layer; the
 * controller comments mark each place that becomes a C++ core primitive.
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
export { SeededRng } from './rng';
