/**
 * Engine layer barrel — the framework-neutral NISPS engine + its React binding.
 *
 * Skins import from here (or the specific hook files). The engine itself
 * (everything except EngineProvider/useEngine) imports NO React.
 */

export { EngineApi, createEngine } from './engine-api';
export type {
  EngineApiOptions,
  EngineAudioApi,
  EngineFeedbackApi,
} from './engine-api';

export { Spine } from './spine';
export type { SpineState, BackendSend } from './spine';

export { WasmIML } from './wasm-iml';
export type { WasmIMLOptions } from './wasm-iml';

export { EngineHost } from './engine-host';
export { Dataset } from './dataset';

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

// Pure pipelines (re-exported for consumers that need to configure them).
export {
  processInput,
  defaultInputConfig,
  defaultInputState,
} from './input-pipeline';
export type { InputConfig, InputState } from './input-pipeline';
export {
  processOutput,
  defaultOutputConfig,
  defaultOutputState,
} from './output-pipeline';
export type { OutputConfig, OutputState } from './output-pipeline';
export * as curves from './curves';
