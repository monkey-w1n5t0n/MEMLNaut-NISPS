/**
 * EngineSink — the framework-neutral side-effect boundary.
 *
 * The lifted `WasmIML` (and any other engine component) used to call directly
 * into SolidJS stores (`mlStore.__setState(produce(...))`, `coreBus.emit(...)`).
 * That coupled the engine to Solid. In Manifold the engine is framework-neutral:
 * every mutation that should be visible to a consumer is routed through an
 * injected `EngineSink` instead.
 *
 * The reactive spine (spine.ts) provides the concrete sink that bumps a version
 * counter and notifies `useSyncExternalStore` subscribers; tests/headless use
 * can pass `noopSink`.
 */

/** Partial state patch — plain object, NOT a Solid `produce` mutator. */
export interface EngineStatePatch {
  inputSize?: number;
  outputSize?: number;
  exampleCount?: number;
  lastLoss?: number | null;
  lossHistory?: ReadonlyArray<number>;
  training?: boolean;
  ready?: boolean;
}

export interface EngineSink {
  /** Merge a shallow patch into engine-visible ML state. */
  setState(patch: EngineStatePatch): void;
  /** Publish a fresh output vector (already copied; caller may keep it). */
  setOutputs(out: Float32Array): void;
  /** Emit a named engine event (`ml.*`, `mode.*`, …) with an optional payload. */
  emit(event: string, payload?: unknown): void;
}

/** No-op default sink. Lets `WasmIML` run fully headless (tests, smoke use). */
export const noopSink: EngineSink = {
  setState() {},
  setOutputs() {},
  emit() {},
};
