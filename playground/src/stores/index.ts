/**
 * Public store entry-point.
 *
 * Re-exports the canonical singletons. Components and modes should import
 * from this module rather than reaching into individual store files; that
 * makes it easy to swap implementations later.
 */

export { coreBus, createBus, type CoreEvents, type Bus } from './bus';
export { mlStore, type MLStore, type MLStoreState } from './ml-store';
export { inputStore, type InputStore } from './input-store';
export { outputStore, type OutputStore } from './output-store';
export { modeStore, type ModeStore, type ModeStoreState, type ParamOverride, defaultParamOverride } from './mode-store';
export {
  controlStore,
  type ControlStore,
  type ControlState,
  type ControlPreset,
  type AxisName,
  CONTROL_PRESETS,
  interpolateAxis,
} from './control-store';
export {
  sessionStore,
  type SessionStore,
  type SessionState,
  type Snapshot,
  type RegionPin,
  type ParamPin,
  type ABState,
  type SessionPreset,
} from './session-store';
export {
  explorationStore,
  type ExplorationStore,
  type ExplorationState,
} from './exploration-store';
export { schedulePersist, flushPersist, loadPersisted, clearPersisted } from './persistence';
