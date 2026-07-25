/**
 * Engine layer barrel — the framework-neutral NISPS engine + its React binding.
 *
 * Skins import from here (or the specific hook files). The engine itself
 * (everything except EngineProvider/useEngine) imports NO React.
 */

export {
  EngineApi,
  createEngine,
  DEFAULT_GEOMETRIC_FEEDBACK_CONFIG,
} from './engine-api';
export type {
  EngineApiOptions,
  EngineAudioApi,
  EngineFeedbackApi,
  EngineExploreApi,
  GeometricFeedbackConfig,
} from './engine-api';

export { Spine } from './spine';
export type { SpineState, BackendSend } from './spine';

// Exploration gestures (Jolt weight-morph + OU explore) — now backed by the
// shared C++/WASM core (nisps/ml/{jolt,ou_noise}.hpp) via engine.explore.
export { ExplorationController } from './exploration';

export { WasmIML } from './wasm-iml';
export type { WasmIMLOptions } from './wasm-iml';

export { EngineHost } from './engine-host';
export { Dataset } from './dataset';
export {
  completeDimensionMap,
  remapFlatWeights,
  remapVector,
  resizeTarget,
} from './io-reshape';
export type {
  DimensionMap,
  ExampleResizePolicy,
  IoMigration,
  NetworkResizePolicy,
} from './io-reshape';

export { noopSink } from './sink';
export type { EngineSink, EngineStatePatch } from './sink';

export type {
  EngineId,
  FeedbackMode,
  LayerStats,
  MLArchitecture,
} from './types';

export { EngineProvider, EngineContext } from './EngineProvider';
export type { EngineProviderProps } from './EngineProvider';
export { useEngine, useEngineOrThrow, useEngineVersion } from './useEngine';

// Pipeline config types + defaults. The PROCESSING lives in the C++/WASM core
// (one-core-engine P4); configure via EngineApi.setInputConfig / setOutputConfig.
export {
  defaultInputConfig,
  defaultOutputConfig,
  anchorModeToInt,
  momentumModeToInt,
} from './pipeline-types';
export type {
  InputConfig,
  OutputConfig,
  AnchorMode,
  MomentumZoomMode,
  InputProcessResult,
} from './pipeline-types';

// Curve catalog NAME↔id contract (maths lives in the core; sample via
// EngineApi.curveApply / curveApplyBatch).
export { CURVE_ID, CURVE_NAMES, CURVE_DEFAULT_PARAMS } from './curve-catalog';
export type { CurveName } from './curve-catalog';
