/**
 * Mode runtime — shared wiring between mode TSX components and the
 * playground's stores / WASM ML / audio engine host.
 *
 * Every mode does the same dance:
 *   1. Hold a primary 2D input position (joystick / xy-pad / external feed).
 *   2. Push it through the input pipeline.
 *   3. Forward the processed (x, y) to the WASM MLP as input channels [0..N].
 *      Modes with input_size > 2 zero-pad the unused channels.
 *   4. Pull the WASM outputs (Float32Array of 126), slice to the schema's
 *      `output_size`, and run them through the output pipeline.
 *   5. Throttle + ship the processed slice to the AudioWorklet engine.
 *
 * To keep mode TSX files small and consistent, this module exposes a hook
 * `useModeRuntime(schema)` that owns the lifecycle and exposes reactive
 * accessors plus the `setInput(x, y)` driver. Modes only have to render a
 * primary input that calls `runtime.setInput(x, y)` and the runtime takes
 * care of everything downstream.
 */

import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

import { mlStore, modeStore, controlStore } from '../stores';
import { inputStore } from '../stores/input-store';
import { outputStore } from '../stores/output-store';
import { processInput, defaultInputState, type InputState } from '../input/pipeline';
import {
  processOutput,
  defaultOutputState,
  type OutputState,
} from '../output/pipeline';
import { EngineHost } from '../audio/engine-host';
import type { EngineId } from '../ml/types';
import type { ModeSchema } from './generated';

/**
 * Throttle interval for engine param updates (ms). 50ms ≈ 20fps which
 * matches the legacy playground's C15 update cadence.
 */
const ENGINE_PARAM_THROTTLE_MS = 50;

/** A single shared EngineHost. Audio only starts on user gesture. */
let engineHost: EngineHost | null = null;
function getEngineHost(): EngineHost {
  if (!engineHost) engineHost = new EngineHost();
  return engineHost;
}

export interface ModeRuntime {
  /** Driver — call from joystick/xy-pad/etc. */
  setInput: (x: number, y: number) => void;

  /** Most recent processed input (after pipeline). */
  pipedInput: () => readonly [number, number];

  /** Whether the input is currently frozen by zoom. */
  frozen: () => boolean;

  /** Raw 126-output ML vector (live). */
  rawOutputs: () => Float32Array;

  /** Output-sliced + pipeline-processed vector (length = schema.output_size). */
  processedOutputs: () => Float32Array;

  /** True iff WASM has loaded and the MLP is ready. */
  ready: () => boolean;

  /** Audio host control. */
  audio: {
    started: () => boolean;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    setMuted: (muted: boolean) => void;
  };

  /** Loss / training plumbing surfaced from mlStore. */
  training: {
    busy: () => boolean;
    examples: () => number;
    lastLoss: () => number | null;
    lossHistory: () => ReadonlyArray<number>;
  };

  /** Trigger a sync train + push the current pipeline-processed sample. */
  trainOnCurrent: () => void;

  /** RL callbacks. */
  thumbsUp: () => void;
  thumbsDown: () => void;
  randomize: () => void;
}

interface RuntimeOptions {
  /** Override the engine id (defaults to schema.engine_id). */
  engineOverride?: EngineId;
  /** Skip starting the audio engine even on user gesture. */
  audioDisabled?: boolean;
}

/**
 * Create the runtime for a given mode schema. Call from inside a Solid
 * component (uses createSignal/onCleanup).
 */
export function useModeRuntime(
  schema: ModeSchema,
  opts: RuntimeOptions = {},
): ModeRuntime {
  // ----- WASM init ---------------------------------------------------------
  const [ready, setReady] = createSignal(mlStore.state.ready);

  // Lazy initialise WASM. Idempotent across remounts.
  void mlStore
    .initialize(schema.ml.input_size, schema.ml.output_size)
    .then(() => setReady(true))
    .catch((err) => {
      // Best-effort; UI keeps running without ML.
      // eslint-disable-next-line no-console
      console.error('[mode-runtime] mlStore.initialize failed:', err);
    });

  // ----- Mode-store side effects ------------------------------------------
  // Make sure the active mode in the store matches what's actually rendered.
  if (modeStore.state.activeModeId !== schema.mode_id) {
    modeStore.switchMode(schema.mode_id);
  }

  // ----- Input pipeline state --------------------------------------------
  const [pipedInput, setPipedInput] = createSignal<readonly [number, number]>([0.5, 0.5]);
  const [frozen, setFrozen] = createSignal(false);
  let inputState: InputState = defaultInputState();
  let lastFrameMs = performance.now();

  const setInput = (rawX: number, rawY: number): void => {
    const now = performance.now();
    const dt = Math.max(0.001, (now - lastFrameMs) / 1000);
    lastFrameMs = now;

    const result = processInput([rawX, rawY], inputStore.config, inputState, dt);
    inputState = result.state;
    inputStore.__setLiveState(result.state);
    setPipedInput([result.x, result.y]);
    setFrozen(result.frozen);

    if (!ready()) return;
    // Push input to the MLP. Channels beyond [x,y] are zeroed out — modes
    // with input_size > 2 currently aren't fed extra inputs (audio analysis
    // wiring is a stream-10 task).
    const inSz = schema.ml.input_size;
    mlStore.setInput(0, result.x);
    if (inSz > 1) mlStore.setInput(1, result.y);
    for (let i = 2; i < inSz; ++i) mlStore.setInput(i, 0);
    mlStore.process();
  };

  // ----- Output pipeline state -------------------------------------------
  let outputState: OutputState = defaultOutputState();
  const sliceLen = schema.ml.output_size;
  const [processedOutputs, setProcessedOutputs] = createSignal<Float32Array>(
    new Float32Array(sliceLen),
    { equals: false }, // always notify even when buffer is reused in-place
  );

  // Run the output pipeline whenever raw outputs change.
  const rawOutputsAccessor = mlStore.outputs;
  let lastOutFrameMs = performance.now();

  const recomputeOutputs = () => {
    const raw = rawOutputsAccessor();
    if (raw.length === 0) return;
    const now = performance.now();
    const dtMs = Math.max(1, now - lastOutFrameMs);
    lastOutFrameMs = now;
    // Slice to mode's output_size up front.
    const slice = raw.length === sliceLen ? raw : raw.subarray(0, sliceLen);
    const result = processOutput(slice as Float32Array, outputStore.config, outputState, dtMs);
    outputState = result.state;
    setProcessedOutputs(result.processed);
  };

  // Trigger recompute on any raw-output change.
  createEffect(() => {
    rawOutputsAccessor();
    recomputeOutputs();
  });

  // ----- Engine wiring (audio) -------------------------------------------
  const host = getEngineHost();
  const [audioStarted, setAudioStarted] = createSignal(host.isStarted);
  let pendingParams: Float32Array | null = null;
  let throttleTimer: number | null = null;

  const flushParams = () => {
    throttleTimer = null;
    if (!pendingParams || !host.isStarted) {
      pendingParams = null;
      return;
    }
    // Copy because EngineHost transfers the buffer.
    const copy = new Float32Array(pendingParams);
    pendingParams = null;
    try {
      host.setParams(copy);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[mode-runtime] setParams failed:', err);
    }
  };

  const scheduleParamFlush = (params: Float32Array) => {
    pendingParams = params;
    if (throttleTimer === null) {
      throttleTimer = window.setTimeout(flushParams, ENGINE_PARAM_THROTTLE_MS);
    }
  };

  // Pipe processedOutputs into the engine host whenever they change.
  createEffect(() => {
    const out = processedOutputs();
    if (out.length === 0) return;
    if (!host.isStarted) return;
    scheduleParamFlush(out);
  });

  const engineId = (opts.engineOverride ?? (schema.engine_id as EngineId));

  const startAudio = async (): Promise<void> => {
    if (opts.audioDisabled) return;
    try {
      await host.start(engineId);
      setAudioStarted(true);
      // Push the current outputs immediately on start.
      const out = processedOutputs();
      if (out.length > 0) host.setParams(new Float32Array(out));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[mode-runtime] audio start failed:', err);
    }
  };

  const stopAudio = async (): Promise<void> => {
    try {
      await host.stop();
    } finally {
      setAudioStarted(false);
    }
  };

  // Switch engine if mode changes engine_id (e.g. on remount).
  onMount(() => {
    if (host.isStarted) host.setEngine(engineId);
  });

  onCleanup(() => {
    if (throttleTimer !== null) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    pendingParams = null;
  });

  // ----- Training helpers -------------------------------------------------
  const trainOnCurrent = () => {
    if (!ready()) return;
    const lr = controlStore.resolveParams()['learningRate'];
    const lrNum = typeof lr === 'number' ? lr : schema.ml.default_learning_rate;
    mlStore.train(lrNum, schema.ml.default_max_iterations, 0.001);
  };

  const thumbsUp = () => {
    if (!ready()) return;
    // Push a label = current pipeline-processed slice as the target at the
    // current input. This matches the legacy "thumbs up = remember the
    // current sound at this position" semantics.
    const [x, y] = pipedInput();
    const out = processedOutputs();
    if (out.length === 0) return;
    const features = new Array(schema.ml.input_size).fill(0);
    features[0] = x;
    if (features.length > 1) features[1] = y;
    const labels = Array.from(out);
    mlStore.addExample(features, labels);
    trainOnCurrent();
  };

  const thumbsDown = () => {
    if (!ready()) return;
    const params = controlStore.resolveParams();
    const cap = typeof params['noiseCap'] === 'number'
      ? (params['noiseCap'] as number)
      : 0.12;
    const spread = schema.ml.default_spread;
    mlStore.moveWeights(cap, spread);
    // Re-run inference at current input so the visual updates.
    const [x, y] = pipedInput();
    setInput(x, y);
  };

  const randomize = () => {
    if (!ready()) return;
    mlStore.drawWeights(schema.ml.default_spread);
    const [x, y] = pipedInput();
    setInput(x, y);
  };

  return {
    setInput,
    pipedInput,
    frozen,
    rawOutputs: rawOutputsAccessor,
    processedOutputs,
    ready,
    audio: {
      started: audioStarted,
      start: startAudio,
      stop: stopAudio,
      setMuted: (muted) => host.setMuted(muted),
    },
    training: {
      busy: () => mlStore.state.training,
      examples: () => mlStore.state.exampleCount,
      lastLoss: () => mlStore.state.lastLoss,
      lossHistory: () => mlStore.state.lossHistory,
    },
    trainOnCurrent,
    thumbsUp,
    thumbsDown,
    randomize,
  };
}

/**
 * Disposes the shared EngineHost. Test helper — production never calls this.
 */
export function __disposeEngineHost(): void {
  if (engineHost) {
    engineHost.dispose();
    engineHost = null;
  }
}
