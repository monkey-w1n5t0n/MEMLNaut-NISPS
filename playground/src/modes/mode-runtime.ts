/**
 * Mode runtime — shared wiring between mode TSX components and the
 * playground's stores / WASM ML / audio engine host.
 *
 * Every mode does the same dance:
 *   1. Hold a primary 2D input position (joystick / xy-pad / external feed).
 *   2. Push it through the input pipeline.
 *   3. Forward the processed (x, y) to the WASM MLP as input channels [0..N].
 *      Modes with input_size > 2 zero-pad the unused channels (or the mic
 *      analyser fills 0..3 if active).
 *   4. Pull the WASM outputs (Float32Array of 126), slice to the schema's
 *      `output_size`, and run them through the output pipeline.
 *   5. Apply per-param overrides (modeStore.activeOverrides).
 *   6. Throttle + ship the processed slice to the AudioWorklet engine.
 *
 * Stream 10 wires:
 *   - Compound axes → underlying stores (input/output/exploration).
 *   - Per-param overrides between MLP outputs and engine.
 *   - Snapshot + undo + A/B compare on RL events.
 *   - Pin mask passed to moveWeights.
 *   - Auto-explore interval timer.
 *   - Trail tracking for JoyMap.
 *   - Heatmap sampler invalidated on weight-change events.
 *   - Mic features pushed into MLP for audio-input modes.
 */

import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js';

import { mlStore, modeStore, controlStore, sessionStore, explorationStore } from '../stores';
import { inputStore } from '../stores/input-store';
import { outputStore } from '../stores/output-store';
import { coreBus } from '../stores/bus';
import { processInput, defaultInputState, type InputState } from '../input/pipeline';
import {
  processOutput,
  defaultOutputState,
  type OutputState,
} from '../output/pipeline';
import { EngineHost } from '../audio/engine-host';
import type { EngineId } from '../ml/types';
import type { ModeSchema } from './generated';

import { applyOverrides, buildPinMask } from '../features/overrides';
import { applyControlRouting } from '../features/control-routing';
import { Jolt } from '../ml/jolt';
import { OUExplore } from '../output/ou-explore';
import { createTrailRing, type TrailPoint } from '../features/trail';
import { autoSnapshot, undoLastSnapshot } from '../features/snapshots';
import { HeatmapSampler, type HeatmapColorMode } from '../features/heatmap-sampler';
import { MicInput } from '../features/mic-input';

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

  /**
   * Final per-param values after override application (length = params.length).
   * These are what get shipped to the engine and visualised in sliders.
   */
  paramOutputs: () => Float32Array;

  /** True iff WASM has loaded and the MLP is ready. */
  ready: () => boolean;

  /** Audio host control. */
  audio: {
    started: () => boolean;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    setMuted: (muted: boolean) => void;
  };

  /** Mic input control (for audio_in modes; safe to call on others — no-op). */
  mic: {
    started: () => boolean;
    start: () => Promise<void>;
    stop: () => Promise<void>;
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
  /** Pop snapshot stack and restore weights. Returns true on success. */
  undo: () => boolean;

  /** Whether the snapshot stack has anything to undo. */
  canUndo: () => boolean;

  /** Trail ring for JoyMap binding. */
  trail: () => ReadonlyArray<TrailPoint>;
  /** Snap input back to a trail point. */
  snapToTrail: (p: { x: number; y: number }) => void;

  /** Heatmap sampler. Returns the underlying cells; modes pass to <Heatmap>. */
  heatmap: {
    cells: () => Float32Array;
    setColorMode: (m: HeatmapColorMode) => void;
    colorMode: () => HeatmapColorMode;
    refresh: (force?: boolean) => void;
    resolution: () => number;
  };

  /** Region pin: pin the current zoom window (long-press handler). */
  pinCurrentRegion: () => void;

  /**
   * Jolt — held-button continuous weight morph (port of nisps/ml/jolt.hpp).
   * `press()` starts morphing the network's weights; a control-rate timer
   * glides them while held; `release()` freezes them in place. Inert until
   * pressed; modes that never call `press()` are unaffected.
   */
  jolt: {
    /** Begin the jolt (button press / toggle on). */
    press: () => void;
    /** Freeze the jolt (button release / toggle off). */
    release: () => void;
    /** Whether the jolt is currently active. */
    active: () => boolean;
  };

  /**
   * Explore — OU random-walk exploration intensity in [0,1] (port of
   * nisps/ml/ou_noise.hpp). Added to the mode's output vector before audio.
   * Intensity 0 = disabled passthrough; modes that never set it are
   * unaffected.
   */
  explore: {
    setIntensity: (level: number) => void;
    intensity: () => number;
  };
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

  // ----- Compound axis routing -------------------------------------------
  // Whenever any axis or offset changes, re-derive the underlying store
  // values. Track axis reads explicitly; do the writes inside untrack so
  // we don't pick up stale dependencies on write-targets (input/output/
  // exploration stores).
  createEffect(() => {
    void controlStore.state.boldness;
    void controlStore.state.memory;
    void controlStore.state.precision;
    void controlStore.state.offsets.boldness;
    void controlStore.state.offsets.memory;
    void controlStore.state.offsets.precision;
    untrack(() => applyControlRouting());
  });

  // ----- Input pipeline state --------------------------------------------
  const [pipedInput, setPipedInput] = createSignal<readonly [number, number]>([0.5, 0.5]);
  const [frozen, setFrozen] = createSignal(false);
  let inputState: InputState = defaultInputState();
  let lastFrameMs = performance.now();

  // Trail ring
  const trailRing = createTrailRing();

  // Pressure tracking (set externally via setPressure on touch).
  let pressDownAt: number | null = null;

  const setInput = (rawX: number, rawY: number): void => {
    const now = performance.now();
    const dt = Math.max(0.001, (now - lastFrameMs) / 1000);
    lastFrameMs = now;

    const result = processInput([rawX, rawY], inputStore.config, inputState, dt);
    inputState = result.state;
    inputStore.__setLiveState(result.state);
    setPipedInput([result.x, result.y]);
    setFrozen(result.frozen);
    trailRing.push(result.x, result.y);

    if (!ready()) return;
    // Push input to the MLP. Channels beyond [x,y] are zeroed out (or
    // overridden with mic features in audio-input modes).
    const inSz = schema.ml.input_size;
    mlStore.setInput(0, result.x);
    if (inSz > 1) mlStore.setInput(1, result.y);
    // Mic features (if active) take channels 2..5.
    if (mic.isRunning() && inSz > 2) {
      const f = mic.getFeatures();
      const fv = [f.energy, f.brightness, f.pitch, f.aperiodicity];
      for (let i = 2; i < inSz; ++i) {
        mlStore.setInput(i, fv[i - 2] ?? 0);
      }
    } else {
      for (let i = 2; i < inSz; ++i) mlStore.setInput(i, 0);
    }
    mlStore.process();

    // Update pressure-feedback hold timer.
    if (pressDownAt !== null) {
      explorationStore.setPressure(
        explorationStore.state.pressureForce,
        now - pressDownAt,
      );
    }
  };

  // ----- Output pipeline + override application --------------------------
  let outputState: OutputState = defaultOutputState();
  const sliceLen = schema.ml.output_size;
  const [processedOutputs, setProcessedOutputs] = createSignal<Float32Array>(
    new Float32Array(sliceLen),
    { equals: false },
  );
  const paramCount = schema.params.length;
  let prevParamOutputs: Float32Array | null = null;
  const [paramOutputs, setParamOutputs] = createSignal<Float32Array>(
    new Float32Array(paramCount),
    { equals: false },
  );

  // ----- Explore (OU exploration noise) ----------------------------------
  // Inert by default (intensity 0). Applied to the processed slice below,
  // after the output pipeline and before override application, so it rides
  // on top of the mode's mapping output. Modes that never set an intensity
  // leave the output untouched (parity-safe).
  const ouExplore = new OUExplore();
  const [exploreIntensity, setExploreIntensitySig] = createSignal(0);

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
    // Explore (OU) noise: temporally-correlated random walk added on top of
    // the processed output, clamped to [0,1]. No-op when intensity is 0.
    ouExplore.apply(result.processed);
    setProcessedOutputs(result.processed);

    // Apply per-param overrides for the per-param consumer (engine, sliders).
    // Only the first `params.length` outputs are user-visible parameters; the
    // remainder is reserved for engine internals (none right now).
    const paramSlice = result.processed.length === paramCount
      ? result.processed
      : result.processed.subarray(0, paramCount);
    const overrides = modeStore.state.overrides[schema.mode_id] ?? {};
    const applied = applyOverrides(
      paramSlice as Float32Array,
      prevParamOutputs,
      schema.params,
      overrides,
    );
    prevParamOutputs = applied.values;
    setParamOutputs(applied.values);
  };

  // Trigger recompute on any raw-output change. Wrap in untrack so reading
  // outputStore.config inside processOutput doesn't add a tracked dep here.
  createEffect(() => {
    rawOutputsAccessor();
    untrack(recomputeOutputs);
  });

  // Re-run override application when overrides change (no new ML output).
  createEffect(() => {
    void modeStore.state.overrides[schema.mode_id];
    untrack(() => {
      const raw = rawOutputsAccessor();
      if (raw.length > 0) recomputeOutputs();
    });
  });

  // Push the freeze mask into outputStore whenever overrides change.
  createEffect(() => {
    const ovs = modeStore.state.overrides[schema.mode_id] ?? {};
    let mask: Uint8Array | null = null;
    for (let i = 0; i < schema.params.length; ++i) {
      const ov = ovs[schema.params[i]!.name];
      if (ov && ov.frozen) {
        if (!mask) mask = new Uint8Array(schema.params.length);
        mask[i] = 1;
      }
    }
    untrack(() => outputStore.setFreezeMask(mask));
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

  // Pipe paramOutputs into the engine host whenever they change.
  createEffect(() => {
    const out = paramOutputs();
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
      const out = paramOutputs();
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

  // ----- Mic input -------------------------------------------------------
  const mic = new MicInput();
  const [micStarted, setMicStarted] = createSignal(false);
  const startMic = async () => {
    try {
      await mic.start();
      setMicStarted(true);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[mode-runtime] mic start failed:', err);
    }
  };
  const stopMic = async () => {
    try {
      await mic.stop();
    } finally {
      setMicStarted(false);
    }
  };
  onCleanup(() => { void stopMic(); });

  // ----- Snapshot stack helpers ------------------------------------------
  const canUndoMemo = createMemo(() => sessionStore.state.snapshots.length > 0);

  // ----- Heatmap sampler -------------------------------------------------
  const sampler = new HeatmapSampler({ resolution: 16 });
  const [heatmapColorMode, setHeatmapColorMode] = createSignal<HeatmapColorMode>('luminance');
  const [heatmapCells, setHeatmapCells] = createSignal<Float32Array>(sampler.getCells(), { equals: false });
  const refreshHeatmap = (force = false): void => {
    untrack(() => {
      if (!ready()) return;
      const cfg = inputStore.config;
      const z = cfg.zoom;
      const cx = cfg.anchorMode === 'center' ? 0.5 : cfg.anchorX;
      const cy = cfg.anchorMode === 'center' ? 0.5 : cfg.anchorY;
      const took = sampler.update({ cx, cy, zoom: z }, force);
      if (took) {
        setHeatmapCells(new Float32Array(sampler.getCells()));
      }
    });
  };

  // Refresh heatmap on weight changes (training, RL feedback, randomize).
  const offTrained = coreBus.on('ml.trained', () => refreshHeatmap());
  const offDelta = coreBus.on('ml.delta_update', () => refreshHeatmap());
  onCleanup(() => { offTrained(); offDelta(); });

  // Initial heatmap refresh once WASM is ready.
  createEffect(() => {
    if (ready()) refreshHeatmap(true);
  });

  // ----- Auto-explore loop -----------------------------------------------
  let autoExploreTimer: number | null = null;
  const tickAutoExplore = () => {
    untrack(() => {
      if (!ready()) return;
      if (!explorationStore.state.autoExploreEnabled) return;
      const intensity = explorationStore.state.autoExploreIntensity;
      // Zoom-scaled intensity: smaller zoom = gentler.
      const zoom = inputStore.config.zoom;
      const scaledIntensity = intensity * (0.3 + 0.7 * zoom);
      const cap = explorationStore.state.noiseCap * scaledIntensity;
      autoSnapshot('before auto-explore');
      const spread = explorationStore.state.spread;
      const overrides = modeStore.state.overrides[schema.mode_id] ?? {};
      const pinMask = buildPinMask(
        mlStore.state.outputSize,
        schema.mode_id,
        schema.params,
        overrides,
        sessionStore.state.paramPins,
      );
      mlStore.moveWeights(cap, spread, pinMask);
      explorationStore.growNoise(0.5);
      // Re-run inference to update the heatmap and visuals.
      const [x, y] = pipedInput();
      setInput(x, y);
    });
  };
  createEffect(() => {
    const enabled = explorationStore.state.autoExploreEnabled;
    const interval = explorationStore.state.autoExploreIntervalMs;
    if (autoExploreTimer !== null) {
      window.clearInterval(autoExploreTimer);
      autoExploreTimer = null;
    }
    if (enabled) {
      autoExploreTimer = window.setInterval(tickAutoExplore, interval);
    }
  });
  onCleanup(() => {
    if (autoExploreTimer !== null) {
      window.clearInterval(autoExploreTimer);
      autoExploreTimer = null;
    }
  });

  // ----- Jolt (held-button continuous weight morph) ----------------------
  // Inert until press(). While active, a ~200Hz control-rate timer glides a
  // scatter of the network's weights toward random targets (port of
  // nisps/ml/jolt.hpp). release() freezes them where they landed.
  const jolt = new Jolt();
  let joltTimer: number | null = null;
  // ~200Hz to match the upstream firmware control rate the constants assume.
  const JOLT_TICK_MS = 5;

  const tickJolt = () => {
    if (!ready() || !jolt.active()) return;
    const w = mlStore.getWeights();
    if (w.length === 0) return;
    jolt.step(w);
    mlStore.setWeights(w);
    coreBus.emit('ml.delta_update', { reason: 'jolt' });
    // Re-run inference so the audio + visuals reflect the morphed weights.
    const [x, y] = pipedInput();
    setInput(x, y);
  };

  const joltPress = () => {
    if (!ready()) return;
    autoSnapshot('before jolt');
    jolt.press(mlStore.iml?.weightCount ?? mlStore.getWeights().length);
    if (joltTimer === null) {
      joltTimer = window.setInterval(tickJolt, JOLT_TICK_MS);
    }
  };

  const joltRelease = () => {
    jolt.release();
    if (joltTimer !== null) {
      window.clearInterval(joltTimer);
      joltTimer = null;
    }
  };
  onCleanup(() => {
    if (joltTimer !== null) {
      window.clearInterval(joltTimer);
      joltTimer = null;
    }
  });

  // ----- Explore (OU) control-rate driver --------------------------------
  // The OU walk advances inside recomputeOutputs (driven by setInput). When
  // the input is static the walk would stall, so while Explore is active we
  // keep ticking so the sound keeps roaming. Inert when intensity is 0.
  let exploreTimer: number | null = null;
  const EXPLORE_TICK_MS = 30;
  const setExploreIntensity = (level: number) => {
    ouExplore.setIntensity(level);
    setExploreIntensitySig(ouExplore.intensity());
    if (ouExplore.enabled() && exploreTimer === null) {
      exploreTimer = window.setInterval(() => {
        untrack(() => {
          if (!ready()) return;
          // Re-run the output pipeline (advances the OU state) and reship.
          recomputeOutputs();
        });
      }, EXPLORE_TICK_MS);
    } else if (!ouExplore.enabled() && exploreTimer !== null) {
      window.clearInterval(exploreTimer);
      exploreTimer = null;
      ouExplore.reset();
    }
  };
  onCleanup(() => {
    if (exploreTimer !== null) {
      window.clearInterval(exploreTimer);
      exploreTimer = null;
    }
  });

  // ----- Touch / pressure feedback ---------------------------------------
  const onPointerDown = (e: PointerEvent) => {
    pressDownAt = performance.now();
    explorationStore.setPressure(
      // Force is 0..1 on supported devices; default 0.5 elsewhere.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e as any).pressure ?? 0.5,
      0,
    );
  };
  const onPointerUp = () => {
    pressDownAt = null;
    explorationStore.setPressure(0, 0);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    onCleanup(() => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    });
  }

  // ----- Training helpers -------------------------------------------------
  const trainOnCurrent = () => {
    if (!ready()) return;
    autoSnapshot('before train');
    const lr = explorationStore.state.learningRate;
    mlStore.train(lr, schema.ml.default_max_iterations, 0.001);
  };

  const thumbsUp = () => {
    if (!ready()) return;
    const [x, y] = pipedInput();
    const out = paramOutputs();
    if (out.length === 0) return;
    const features = new Array(schema.ml.input_size).fill(0);
    features[0] = x;
    if (features.length > 1) features[1] = y;
    // Mic features into the example too, if active.
    if (mic.isRunning() && schema.ml.input_size > 2) {
      const f = mic.getFeatures();
      const fv = [f.energy, f.brightness, f.pitch, f.aperiodicity];
      for (let i = 2; i < schema.ml.input_size; ++i) {
        features[i] = fv[i - 2] ?? 0;
      }
    }
    // Labels: the raw 126-vector targets (not the override-applied; the MLP
    // doesn't know about overrides).
    const labels = Array.from(processedOutputs());
    autoSnapshot('before thumbs-up');
    mlStore.addExample(features, labels);
    explorationStore.decayNoise(explorationStore.state.pressureForce);
    trainOnCurrent();
  };

  const thumbsDown = () => {
    if (!ready()) return;
    autoSnapshot('before thumbs-down');
    const cap = explorationStore.state.noiseCap;
    const spread = explorationStore.state.spread;
    const overrides = modeStore.state.overrides[schema.mode_id] ?? {};
    const pinMask = buildPinMask(
      mlStore.state.outputSize,
      schema.mode_id,
      schema.params,
      overrides,
      sessionStore.state.paramPins,
    );
    mlStore.moveWeights(cap, spread, pinMask);
    explorationStore.growNoise(explorationStore.state.pressureForce);
    const [x, y] = pipedInput();
    setInput(x, y);
  };

  const randomize = () => {
    if (!ready()) return;
    autoSnapshot('before randomize');
    mlStore.drawWeights(explorationStore.state.spread);
    const [x, y] = pipedInput();
    setInput(x, y);
  };

  const undo = (): boolean => {
    const ok = undoLastSnapshot();
    if (ok) {
      const [x, y] = pipedInput();
      setInput(x, y);
    }
    return ok;
  };

  // ----- Region pins ------------------------------------------------------
  const pinCurrentRegion = () => {
    const cfg = inputStore.config;
    const z = cfg.zoom;
    const cx = cfg.anchorMode === 'center' ? 0.5 : cfg.anchorX;
    const cy = cfg.anchorMode === 'center' ? 0.5 : cfg.anchorY;
    const halfZ = z * 0.5;
    sessionStore.addRegionPin({
      x: Math.max(0, cx - halfZ),
      y: Math.max(0, cy - halfZ),
      width: Math.min(z, 1),
      height: Math.min(z, 1),
    });
    autoSnapshot('pinned baseline');
  };

  // Snap-to-trail
  const snapToTrail = (p: { x: number; y: number }) => {
    batch(() => {
      setInput(p.x, p.y);
    });
  };

  return {
    setInput,
    pipedInput,
    frozen,
    rawOutputs: rawOutputsAccessor,
    processedOutputs,
    paramOutputs,
    ready,
    audio: {
      started: audioStarted,
      start: startAudio,
      stop: stopAudio,
      setMuted: (muted) => host.setMuted(muted),
    },
    mic: {
      started: micStarted,
      start: startMic,
      stop: stopMic,
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
    undo,
    canUndo: () => canUndoMemo(),
    trail: trailRing.points,
    snapToTrail,
    heatmap: {
      cells: heatmapCells,
      setColorMode: (m) => {
        sampler.setColorMode(m);
        setHeatmapColorMode(m);
        refreshHeatmap(true);
      },
      colorMode: heatmapColorMode,
      refresh: refreshHeatmap,
      resolution: () => sampler.resolution,
    },
    pinCurrentRegion,
    jolt: {
      press: joltPress,
      release: joltRelease,
      active: () => jolt.active(),
    },
    explore: {
      setIntensity: setExploreIntensity,
      intensity: exploreIntensity,
    },
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
