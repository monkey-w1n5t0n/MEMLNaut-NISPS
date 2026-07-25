/**
 * ConsoleApp — the reactive spine + layout for the convertible Console, wired to
 * the REAL engine.
 *
 * What changed vs the window-global `ConsoleApp.jsx`:
 *  - The pseudo-inference (`MF_infer`, sin/cos) is GONE. The `values` every
 *    consumer reads now come from `engine.getOutputs()`, mapped onto the mode's
 *    params by `shapeValues` (status/min/max/curve applied here). Pad/joystick
 *    motion drives `engine.setInput(x,y)`; we subscribe to engine changes via
 *    `useEngineVersion` and re-derive `values` imperatively on render.
 *  - Verdicts wire to the engine: commit → feedback.thumbsUp(); perturb →
 *    feedback.thumbsDown(); reroll → randomise(); each followed by process().
 *  - The default feedback mode is "Explore and place" → the shared C++ core's
 *    FeedbackMode::ExploreAndPlace (set on mount; the controller forwards the
 *    Idle→Exploring→Placing lifecycle to engine.feedback.* — nisps/ml/feedback.hpp,
 *    per docs/adr/rl-feedback-design.md).
 *  - `c15` is labelled "Powerful Synth Engine" (in model.ts) — "C15" never shows.
 *
 * The dead focus/altitude system (AltitudeNav; SplitStage/ReadoutStrip/InputMini
 * stages; the `in`/`split`/`out` branches) was deleted 2026-07 (simplification
 * audit S15) — `setFocus` was never called anywhere, so `composite` was the
 * only reachable stage. The decorative A/B toggle, fake seed, snapshot stack,
 * fabricated health/gradient visuals, and the never-touched master
 * volume/bpm/learning-rate/decay/spread-level sliders were deleted alongside it
 * (S16/L1) — each was write-only, read by nothing but its own control.
 *
 * UI-only state (params status/min/max/curve, noiseCap) is preserved as
 * faithful local React state.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useEngine, useEngineVersion, ExplorationController } from '../engine';
import { MF_MODES, createOutputParam, modeEngineId, shapeValues } from './model';
import type { MFParam } from './model';
import { CompositeStage } from './CompositeStage';
import { ParticleStage } from './ParticleStage';
import { SandwichStage } from './SandwichStage';
import { OutputStage } from './OutputStage';
import { Manifold } from './Manifold';
import { VerdictCluster } from './VerdictCluster';
import { Dock } from './Dock';
import type {
  ConsoleCtx,
  DrawerDepth,
  DrawerKey,
  FeedbackMarker,
  FeedbackModeUI,
  OutputMode,
  Pin,
  SoloMode,
} from './types';
import type { BackendId } from '../dock/output-state';
import { buildArmMask } from '../dock/output-state';
import { FeedbackController, type ProtoFeedbackMode } from '../feedback';
import { DEFAULT_OUTPUT_MODE, outputDisplayCount, outputModeDescriptor } from './output-mode';
import { useSettings, resolveInputMap } from '../settings/settings-store';
import { useBackendManager } from '../backends';
import { useInputLayer } from '../inputs';
import {
  completeDimensionMap,
  resizeTarget,
  type DimensionMap,
} from '../engine/io-reshape';

/**
 * Console debug seam, installed on `window.__mf` under `?debug=1` (see the
 * effect in ConsoleApp). UI-level analogue of the engine `window.__nisps`
 * probe — lets Playwright drive instrument/output configuration and inspect
 * the resulting presentation.
 */
export interface MfDebugHook {
  setMode: (id: string) => void;
  getModeId: () => string;
  paramCount: () => number;
  modeIds: () => string[];
  setOutputMode: (mode: OutputMode) => void;
  setMidiCcCount: (count: number) => void;
  displayOutputCount: () => number;
}

declare global {
  interface Window {
    __mf?: MfDebugHook;
  }
}

/** Small pill-button style for the exploring-scratchpad banner controls. */
function pillBtn(color: string): CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--fs-xs)',
    padding: '3px 10px',
    borderRadius: 'var(--r-pill)',
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    cursor: 'pointer',
  };
}

export function ConsoleApp() {
  const engine = useEngine();
  const version = useEngineVersion(engine);
  const { settings } = useSettings();

  const [modeId, setModeId] = useState('paf_synth');
  const mode = MF_MODES.find((m) => m.id === modeId) ?? MF_MODES[0];
  const [params, setParams] = useState<MFParam[]>(() => mode.params.map((p) => ({ ...p })));
  const [paramsModeId, setParamsModeId] = useState(mode.id);
  const [pos, setPos] = useState<[number, number]>([0.5, 0.5]);

  const [noiseCap, setNoiseCap] = useState(0.12);
  const [examples, setExamples] = useState(0);
  const [addingExample, setAddingExample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [spread, setSpread] = useState(false);
  // Manifold's normal regime is a full-range uniform draw. The per-mode legacy
  // spread remains available only when explicitly enabled in Settings.
  const randomisationSpread = settings.xavierSpreadEnabled
    ? (spread ? 1 : mode.ml.defaultSpread)
    : 0;
  const [active, setActive] = useState<DrawerKey | null>(null);
  const [depth, setDepth] = useState<DrawerDepth>('condensed');
  // Sandwich (parameter-landscape) centre-stage toggle — dock-bottom layers icon.
  const [sandwich, setSandwich] = useState(false);

  // Learning-behaviour store (dock-spec §1; rl-feedback-design). Default
  // feedback mode = "Push away" (geometric); default solo = "Mask gradients".
  // (Explore-and-place is selectable but the geometric push is the better default.)
  const [feedbackMode, setFeedbackModeState] = useState<FeedbackModeUI>('geometric-dislike');
  const [soloMode, setSoloMode] = useState<SoloMode>('mask-gradients');
  const [exploring, setExploring] = useState(false);
  const [learningPaused, setLearningPaused] = useState(false);
  // One-time cold-start prompt for geometric dislike: set when a dislike runs
  // before any likes exist (core returns GeometricColdStart=15). Dismissed on the
  // next like or an explicit dismiss (rl-feedback-design §7). British spelling.
  const [coldStart, setColdStart] = useState(false);
  // Explore-and-place scratchpad session state (workstream B; rl-feedback §2.2).
  const [picking, setPicking] = useState(false);
  const [anchorCount, setAnchorCount] = useState(0);
  const [undoDepth, setUndoDepth] = useState(0);
  // Exploration gestures (Jolt held weight-morph + OU explore-intensity). The
  // maths lives in the ExplorationController (engine/exploration.ts); these are
  // the React-visible reflections the Learning drawer renders.
  const [joltActive, setJoltActive] = useState(false);
  const [exploreIntensity, setExploreIntensityState] = useState(0);
  // Active output MODE (TOP dock selector) — default Particle System. The dock
  // backend + audio backend derive from this.
  const [outputMode, setOutputModeState] = useState<OutputMode>(DEFAULT_OUTPUT_MODE);
  const outputBackend: BackendId = outputModeDescriptor(outputMode).backend;
  // Per-backend transport settings (backends-spec §2.3/§2.4). Persisted via the
  // named-preset system; these are the live working values.
  const [midiOutputId, setMidiOutputId] = useState<string | null>(null);
  const [outputCounts, setOutputCounts] = useState<Partial<Record<OutputMode, number>>>({
    midi: 8,
  });
  const midiCcCount = outputDisplayCount('midi', params.length, outputCounts);
  const setMidiCcCount = (n: number) =>
    setOutputCounts((counts) => ({ ...counts, midi: Math.max(1, Math.floor(n)) }));
  const displayOutputCount = outputDisplayCount(outputMode, params.length, outputCounts);
  const [oscUrl, setOscUrl] = useState('ws://localhost:8765');
  const [oscSendRaw, setOscSendRaw] = useState(false);
  // VCV bridge: WS URL of the Deno bridge that relays to the VCV module over UDP
  // (default module UDP 7001). Independent of the OSC backend's bridge.
  const [vcvUrl, setVcvUrl] = useState('ws://localhost:8765');
  const [vcvSendRaw, setVcvSendRaw] = useState(false);
  // Feedback markers plotted on the 2D map (both polarities; session-scoped).
  const [markers, setMarkers] = useState<FeedbackMarker[]>([]);
  const [audioStarted, setAudioStarted] = useState(false);
  const [follow, setFollow] = useState(false);
  const [split, setSplit] = useState(() => {
    const v = parseFloat(localStorage.getItem('mf-composite-split') ?? '');
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
  });
  useEffect(() => {
    localStorage.setItem('mf-composite-split', String(split));
  }, [split]);
  const [firstSession, setFirstSession] = useState(true);
  const [pins, setPins] = useState<Pin[]>([]);

  // The framework-neutral learning-engine controller (workstream B). Owns BOTH
  // feedback modes' BEHAVIOUR on the existing engine primitives. The dock owns
  // the mode/solo SELECTOR UI; this controller implements what those selectors
  // mean. One instance per engine, created once the engine resolves.
  const controllerRef = useRef<FeedbackController | null>(null);
  if (engine && !controllerRef.current) {
    controllerRef.current = new FeedbackController(engine, {
      spread: randomisationSpread,
    });
  }

  // Pull the controller's observable state into React after any action.
  const syncController = () => {
    const c = controllerRef.current;
    if (!c) return;
    const s = c.getState();
    setExploring(s.exploring);
    setLearningPaused(s.exploring); // Mode-2 pauses learning while scratchpad-ing
    setPicking(s.picking);
    setAnchorCount(s.anchorCount);
    setUndoDepth(s.undoDepth);
  };

  // The exploration controller (Jolt weight-morph + OU explore-intensity). Same
  // lazy-once-per-engine pattern as the feedback controller; its interim TS
  // maths becomes WASM calls in P3 (engine/exploration.ts P3 SWAP POINT).
  const explorationRef = useRef<ExplorationController | null>(null);
  if (engine && !explorationRef.current) {
    explorationRef.current = new ExplorationController(engine);
  }
  useEffect(
    () => () => {
      explorationRef.current?.dispose();
      explorationRef.current = null;
    },
    [],
  );

  const onJoltPress = () => {
    explorationRef.current?.joltPress();
    setJoltActive(explorationRef.current?.joltActive() ?? false);
  };
  const onJoltRelease = () => {
    explorationRef.current?.joltRelease();
    setJoltActive(false);
  };
  const setExploreIntensity = (v: number) => {
    explorationRef.current?.setExploreIntensity(v);
    setExploreIntensityState(explorationRef.current?.exploreIntensity() ?? v);
  };

  const setFeedbackMode = (m: FeedbackModeUI) => {
    setFeedbackModeState(m);
    controllerRef.current?.setMode(m as ProtoFeedbackMode);
    syncController();
  };

  // Push the active UI feedback mode to the controller on mount + on change.
  useEffect(() => {
    controllerRef.current?.setMode(feedbackMode as ProtoFeedbackMode);
    syncController();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, feedbackMode]);

  // Settings changes affect future randomise/explore gestures without
  // destructively re-drawing the currently audible network.
  useEffect(() => {
    controllerRef.current?.setSpread(randomisationSpread);
  }, [engine, randomisationSpread]);

  // Push the selected solo-mode + the arm mask into the controller whenever they
  // change (dock-spec §1.2). The controller RESPECTS the arm mask at the example
  // level in BOTH modes and forwards it to engine.feedback.setFocus.
  // TODO(rl-feedback-design §3): soloMode (mask-gradients / zero-loss /
  // dont-care) selects HOW the mask is applied during training; the C API only
  // exposes set_focus today, so the controller approximates it at the example
  // level — the true gradient column-freeze (`train_masked`) is the C++ step.
  useEffect(() => {
    controllerRef.current?.setSoloMode(soloMode);
    controllerRef.current?.setArmMask(buildArmMask(params.slice(0, displayOutputCount)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, params, displayOutputCount, soloMode]);

  // Keep the audio backend pointed at the current mode (audio itself is gated
  // behind a user gesture — see startAudio below).
  useEffect(() => {
    if (engine) engine.audio.setBackend(modeEngineId(modeId) as Parameters<typeof engine.audio.setBackend>[0]);
  }, [engine, modeId]);

  // Per-mode net dims (one-core-engine P5.3). On mode switch — and once WASM is
  // ready on boot (this effect depends on `engine`, so it fires when the engine
  // transitions null→ready with the boot mode) — reshape the runtime-shaped MLP
  // to the active mode's schema `ml` config (warm-started; the C-side dataset +
  // feedback reset, which the transient reset below also clears). NO confirm
  // modal: switching instrument is already a deliberate act. The P2.3 axis-count
  // modal stays for input-LAYOUT changes only (see the reshape-offer effect).
  useEffect(() => {
    if (!engine) return;
    const { inputSize, outputSize, hidden } = mode.ml;
    engine.reshape({ inputSize, outputSize, hidden }, randomisationSpread);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, modeId]);

  // reset transient state on mode switch
  useEffect(() => {
    setParams(mode.params.map((p) => ({ ...p })));
    setParamsModeId(modeId);
    setPos([0.5, 0.5]);
    setExamples(0);
    setFollow(false);
    setPins([]);
    setMarkers([]);
    setActive(null);
    setDepth('condensed');
    if (engine) engine.setInput(0.5, 0.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeId]);

  // Select the active output MODE (TOP dock selector). For the audio (synth)
  // mode we keep the audio backend pointed at the current instrument mode (the
  // existing effect handles engine.audio.setBackend). The BackendManager (via
  // useBackendManager, below) reacts to the derived BackendId: it switches the
  // active output backend, gates synth audio (mutes on non-synth modes), and
  // drives the real MIDI / OSC transports. Particle reads the spine in its own
  // rAF loop; the Editor serial protocol remains its own panel.
  const setOutputMode = (m: OutputMode) => setOutputModeState(m);

  // Modular input layer (workstream F): composes the active input SOURCE(s)
  // (XY pad / MIDI / gamepad) into the engine. The XY pad is push-driven via
  // `pushPad`; MIDI + gamepad are pulled by the layer's own rAF loop.
  const inputs = useInputLayer(engine);

  // ---- Identity-aware input-card migration -----------------------------------
  // Input sources already expose add/remove cards (MIDI learns, gamepad axes).
  // Preserve their semantic coordinates by source+label when those rows change.
  const inputSlotsRef = useRef<Map<string, number> | null>(null);
  const inputLayoutKey = inputs.channelLayout
    .map((channel) => `${channel.source}\u0000${channel.label}`)
    .join('\u0001');
  useEffect(() => {
    if (!engine) return;
    const keys = inputLayoutKey ? inputLayoutKey.split('\u0001') : [];
    if (keys.length < 1) return;
    const inSize = inputs.engineInputSize;
    const previous = inputSlotsRef.current;
    if (previous === null) {
      inputSlotsRef.current = new Map(keys.map((key, i) => [key, i]));
      return;
    }
    const activeMap: DimensionMap = keys.map((key) => previous.get(key) ?? null);
    const target =
      resizeTarget(keys.length, inSize, settings.networkResizePolicy) ?? inSize;
    const inputMap = completeDimensionMap(activeMap, target, inSize);
    const needsMigration =
      target !== inSize || inputMap.some((oldIndex, newIndex) => oldIndex !== newIndex);
    if (needsMigration) {
      engine.reshape(
        { inputSize: target },
        randomisationSpread,
        {
          inputMap,
          examples: settings.exampleResizePolicy,
          addedInputValue: settings.addedInputExampleValue,
          addedOutputValue: settings.addedOutputExampleValue,
        },
      );
      controllerRef.current?.resetAfterIoChange();
      syncController();
      setExamples(engine.getState().exampleCount);
    }
    inputSlotsRef.current = new Map(keys.map((key, i) => [key, i]));
  }, [
    engine,
    inputLayoutKey,
    inputs.engineInputSize,
    randomisationSpread,
    settings.networkResizePolicy,
    settings.exampleResizePolicy,
    settings.addedInputExampleValue,
    settings.addedOutputExampleValue,
  ]);

  // ---- Console debug seam (`?debug=1`) ----------------------------------------
  // There is no instrument-mode picker in the UI yet (ctx.modes/setModeId are
  // plumbed but unrendered), so Playwright drives instrument/output changes
  // through this window hook — the UI-level analogue of the engine
  // `window.__nisps` probe.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    if (q.get('debug') !== '1') return;
    window.__mf = {
      setMode: (id: string) => setModeId(id),
      getModeId: () => modeId,
      paramCount: () => params.length,
      modeIds: () => MF_MODES.map((m) => m.id),
      setOutputMode,
      setMidiCcCount,
      displayOutputCount: () => displayOutputCount,
    };
    return () => {
      if (window.__mf) delete window.__mf;
    };
  }, [modeId, params, displayOutputCount]);

  // Drive a pad/joystick/manifold move through the input layer's XY-pad source,
  // then mirror the raw position into React state for readouts. The layer's loop
  // composes it with any other active sources and writes to the engine; we still
  // do a direct setInput so the pad feels instant even when it's the sole source.
  const onMove = (x: number, y: number) => {
    inputs.pushPad(x, y);
    engine?.setInput(x, y);
    setPos([x, y]);
  };

  // PICK-LOCATION: when "place" is pending, the next manifold pointer-down picks
  // the anchor location → commit the positive anchor there (rl-feedback §2.2 §3).
  // The Manifold calls this on pointer-down while `picking` is true; it moves the
  // scratchpad input there, captures the output, and stores the anchor.
  const onPickLocation = (x: number, y: number) => {
    const c = controllerRef.current;
    if (!c || !c.isPicking()) return;
    c.placeCommit(x, y);
    setPos([x, y]);
    pushMarker([x, y], 'positive');
    syncController();
  };

  // Output backend transport (backends-spec). The manager consumes the engine
  // spine and forwards routed outputs to the active backend; switching Mode
  // tears down the old backend, starts the new one, and gates synth audio
  // (mute on non-synth modes). MIDI/OSC config + names ride the shared params.
  const backendParams = useMemo(
    () => params.slice(0, displayOutputCount),
    [params, displayOutputCount],
  );
  const {
    manager: backendManager,
    status: backendStatus,
    midiPorts,
    refreshMidiPorts,
    cvConnect,
    cvIdentify,
    cvDisconnect,
  } = useBackendManager(
    engine,
    outputBackend,
    modeId,
    backendParams,
    { outputId: midiOutputId, ccCount: midiCcCount },
    { url: oscUrl, sendRaw: oscSendRaw },
    { url: vcvUrl, sendRaw: vcvSendRaw },
  );

  // VCV bridge: forward a verdict op to the module's embedded learner. No-op
  // unless Mode = VCV (the manager gates on the active backend). This is how
  // thumbs-up/down + explore-and-place TRAIN the module across the bridge.
  const forwardVcvFeedback = (op: 'up' | 'down' | 'rand' | 'clear') => {
    backendManager?.forwardFeedback({
      op,
      spread: randomisationSpread,
      input: [pos[0], pos[1]],
      output: Array.from(engine?.getOutputs() ?? new Float32Array(0)),
    });
  };

  // values come from the REAL engine output, shaped per-param. Recomputed when
  // the engine version bumps (new inference / weights) or params change.
  const values = useMemo(
    () => shapeValues(params, engine?.getOutputs() ?? null),
    // version drives re-read of the live (reused) output buffer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, version, engine],
  );
  const displayedParams = useMemo(
    () => params.slice(0, displayOutputCount),
    [params, displayOutputCount],
  );
  const displayedValues = useMemo(
    () => values.slice(0, displayOutputCount),
    [values, displayOutputCount],
  );

  /** Plot a feedback marker at the input location it was given (session-scoped). */
  const pushMarker = (at: [number, number], polarity: 'positive' | 'negative') =>
    setMarkers((m) => [...m, { x: at[0], y: at[1], polarity }].slice(-200));

  // -------------------------------------------------------------------
  // Verdict actions — routed per active feedback mode (rl-feedback-design §0).
  //
  //   Explore & place (Mode 2, default): thumbs-DOWN = enter/cancel explore;
  //     thumbs-UP = place (when exploring) / commit. The scratchpad is never
  //     trained — it only generates candidate sounds to audition.
  //   Geometric dislike (Mode 1): thumbs-DOWN = dislike (push away);
  //     thumbs-UP = like + train.
  //
  // VerdictCluster reads `feedbackMode` from ctx and relabels itself; the same
  // onCommit / onPerturb handlers below dispatch on the active mode.
  // -------------------------------------------------------------------

  /** thumbs-UP. */
  const commit = () => {
    const c = controllerRef.current;
    setFirstSession(false);
    setBusy(true);
    // A like teaches the system what to move away from → dismiss the cold-start prompt.
    setColdStart(false);
    if (feedbackMode === 'explore-and-place') {
      if (c?.getState().exploring) {
        // Place the current candidate → next manifold tap chooses the location.
        c.place();
      } else {
        // Not exploring: a plain positive reinforcement of the current mapping.
        c?.like(pos, engine?.getOutputs() ?? new Float32Array(0));
        pushMarker(pos, 'positive');
      }
    } else {
      // Geometric dislike: thumbs-up = like + train.
      c?.like(pos, engine?.getOutputs() ?? new Float32Array(0));
      pushMarker(pos, 'positive');
    }
    // VCV bridged mode: also train the module — thumbs-up = positive verdict.
    forwardVcvFeedback('up');
    syncController();
    setNoiseCap((n) => Math.max(0.02, n * 0.7));
    setBusy(false);
  };

  /** thumbs-DOWN. */
  const perturb = () => {
    const c = controllerRef.current;
    setFirstSession(false);
    if (feedbackMode === 'explore-and-place') {
      // Enter the scratchpad (or, if already exploring, cancel back to the real
      // net). NEVER a dislike — Mode 2 is positive-only.
      if (c?.getState().exploring) {
        c.cancel();
      } else {
        c?.enterExplore();
        // VCV bridged mode: entering explore re-rolls the module's net too.
        forwardVcvFeedback('rand');
      }
    } else {
      // Geometric dislike: push the current mapping away from this sound. Pass the
      // HEARD (post-pipeline, routed) vector — NOT the raw MLP output — so the
      // core has a non-zero MSE derivative (see engine.feedback.dislikeGeometric).
      const action = c?.dislike(engine?.routedOutput() ?? new Float32Array(0));
      // GeometricColdStart (15): no positives yet → show the one-time prompt.
      if (action === 15) setColdStart(true);
      pushMarker(pos, 'negative');
      // VCV bridged mode: thumbs-down = negative verdict.
      forwardVcvFeedback('down');
      setNoiseCap((n) => Math.min(0.5, n + 0.06));
    }
    syncController();
  };

  /** Long-press perturb / explicit re-roll. */
  const reroll = () => {
    const c = controllerRef.current;
    setFirstSession(false);
    if (feedbackMode === 'explore-and-place' && c?.getState().exploring) {
      // Re-roll the scratchpad net (undoable) without leaving the session.
      c.reroll();
    } else {
      // Outside a scratchpad session a re-roll randomises the real net directly.
      engine?.randomise(randomisationSpread);
    }
    // VCV bridged mode: re-roll the module's net too.
    forwardVcvFeedback('rand');
    syncController();
    setNoiseCap(0.4);
  };

  /**
   * Nudge — a small bounded weight perturbation of the current net (the left
   * half of the secondary pill). Routes to the scratchpad while exploring,
   * otherwise nudges the real net directly.
   */
  const nudgeNet = () => {
    const c = controllerRef.current;
    if (feedbackMode === 'explore-and-place' && c?.getState().exploring) {
      c.nudge();
    } else {
      engine?.feedback.nudge(0.05);
      engine?.process();
    }
    syncController();
  };

  /**
   * Undo. Only meaningful while exploring (Mode 2) — pops the scratchpad undo
   * ring (reroll / nudge), which is real, engine-backed undo. Geometric dislike
   * (Mode 1) and the non-exploring case have no real undo in the core, so the
   * button is simply inactive there (the prior "undo" outside a scratchpad
   * session only reverted a decorative UI snapshot stack — deleted 2026-07,
   * simplification audit S16).
   */
  const undo = () => {
    const c = controllerRef.current;
    if (feedbackMode === 'explore-and-place' && c?.getState().exploring) {
      c.undo();
      syncController();
    }
  };

  // ---- Explore-and-place scratchpad ops surfaced to the dock + cluster ----
  const onExplore = () => {
    controllerRef.current?.enterExplore();
    syncController();
  };
  const onScratchReroll = () => {
    controllerRef.current?.reroll();
    syncController();
  };
  const onScratchNudge = () => {
    controllerRef.current?.nudge();
    syncController();
  };
  const onScratchUndo = () => {
    controllerRef.current?.undo();
    syncController();
  };
  const onPlace = () => {
    controllerRef.current?.place();
    syncController();
  };
  const onFinalise = () => {
    setBusy(true);
    controllerRef.current?.finalise();
    syncController();
    setBusy(false);
  };
  const onCancelExplore = () => {
    controllerRef.current?.cancel();
    syncController();
  };
  const train = () => {
    setBusy(true);
    engine?.train();
    engine?.process();
    setBusy(false);
  };
  const addExample = () => {
    if (!addingExample) {
      setAddingExample(true);
      return;
    }
    setAddingExample(false);
    // Snapshot the current input → current (shaped) output as a training example.
    engine?.addExample([pos[0], pos[1]], Array.from(values));
    setExamples((e) => e + 1);
    train();
  };

  const setParam = (i: number, patch: Partial<MFParam>) =>
    setParams((ps) =>
      ps.map((p, j) => {
        if (j !== i) return p;
        const next = { ...p, ...patch };
        // Any explicit edit other than the main-view gesture cancels the
        // transient override, so normal dock/editor controls remain authoritative.
        if (!Object.prototype.hasOwnProperty.call(patch, 'manualOverride')) {
          next.manualOverride = undefined;
        }
        return next;
      }),
    );

  // A direct slider gesture is only an audition value. Keep it visible while
  // the input is stable; the next actual input change returns that param to
  // the live MLP.
  const lastInputRef = useRef<number[] | null>(null);
  useEffect(() => {
    if (!engine) return;
    const nextInput = Array.from(engine.inputVector());
    const previousInput = lastInputRef.current;
    lastInputRef.current = nextInput;
    const inputChanged =
      previousInput !== null &&
      (previousInput.length !== nextInput.length ||
        nextInput.some((value, index) => value !== previousInput[index]));
    if (!inputChanged) return;

    setParams((ps) => {
      let changed = false;
      const next = ps.map((p) => {
        if (!p.manualOverride) return p;
        changed = true;
        return { ...p, status: 'live' as const, manualOverride: undefined };
      });
      return changed ? next : ps;
    });
  }, [engine, version]);

  /**
   * The single output-card mutation seam. Callers provide the desired active
   * cards; this module decides whether to keep capacity, permute in place, or
   * reconstruct, then makes card order and MLP coordinates agree again.
   */
  const applyOutputCards = (activeCards: MFParam[], spareCards: MFParam[]) => {
    if (activeCards.length < 1) return;
    const oldCapacity = engine?.architecture.outputSize ?? mode.ml.outputSize;
    const target =
      resizeTarget(activeCards.length, oldCapacity, settings.networkResizePolicy) ??
      oldCapacity;
    const activeMap: DimensionMap = activeCards.map((param) => {
      const index = param.engineIndex;
      return index !== undefined && index >= 0 && index < oldCapacity ? index : null;
    });
    const outputMap = completeDimensionMap(activeMap, target, oldCapacity);
    const oldByIndex = new Map<number, MFParam>();
    for (const param of params) {
      if (param.engineIndex !== undefined) oldByIndex.set(param.engineIndex, param);
    }
    const placed = new Set(activeCards.map((param) => param.id));
    const ordered: MFParam[] = [...activeCards];
    for (const oldIndex of outputMap.slice(activeCards.length)) {
      if (oldIndex === null) continue;
      const param = oldByIndex.get(oldIndex);
      if (param && !placed.has(param.id)) {
        ordered.push(param);
        placed.add(param.id);
      }
    }
    for (const param of [...spareCards, ...params]) {
      if (!placed.has(param.id)) {
        ordered.push(param);
        placed.add(param.id);
      }
    }

    const needsMigration =
      target !== oldCapacity ||
      outputMap.some((oldIndex, newIndex) => oldIndex !== newIndex);
    if (engine && needsMigration) {
      engine.reshape(
        { outputSize: target },
        randomisationSpread,
        {
          outputMap,
          examples: settings.exampleResizePolicy,
          addedInputValue: settings.addedInputExampleValue,
          addedOutputValue: settings.addedOutputExampleValue,
        },
      );
      controllerRef.current?.resetAfterIoChange();
      syncController();
      setExamples(engine.getState().exampleCount);
    }
    setParams(
      ordered.map((param, index) => ({
        ...param,
        engineIndex: index < target ? index : undefined,
      })),
    );
    setOutputCounts((counts) => ({ ...counts, [outputMode]: activeCards.length }));
  };

  const addOutput = () => {
    const active = params.slice(0, displayOutputCount);
    const next = params[displayOutputCount] ?? createOutputParam(params.length);
    const spares = params
      .slice(displayOutputCount + (params[displayOutputCount] ? 1 : 0))
      .filter((param) => param.id !== next.id);
    applyOutputCards([...active, next], spares);
  };

  const deleteOutput = (index: number) => {
    if (displayOutputCount <= 1 || index < 0 || index >= displayOutputCount) return;
    const active = params.slice(0, displayOutputCount);
    const [removed] = active.splice(index, 1);
    applyOutputCards(active, [removed, ...params.slice(displayOutputCount)]);
  };

  // Switching output targets (or changing the saved resize policy) reconciles
  // the network to that target's persisted active-card count.
  useEffect(() => {
    if (paramsModeId !== modeId) return;
    const count = outputDisplayCount(outputMode, params.length, outputCounts);
    applyOutputCards(params.slice(0, count), params.slice(count));
    // `params` is deliberately read as the current card catalogue but omitted:
    // applyOutputCards itself replaces it, so including it would self-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    engine,
    modeId,
    paramsModeId,
    outputMode,
    outputCounts[outputMode],
    settings.networkResizePolicy,
  ]);

  // Ref-mirror of everything the two global-listener effects below close over
  // that is NOT already React-stable (verdict/navigation handlers are plain
  // consts re-created every render; `pos`/`inputs.inputMode` are per-render
  // values). Assigned directly in the render body — same technique as
  // `onMoveRef` in Manifold.tsx — so both effects can install their
  // subscriptions ONCE ([] deps) instead of tearing down + re-subscribing on
  // EVERY render (previously: no dep array at all, so both effects re-ran on
  // every render — including every pointer frame `onReducedInput`/`setPos`
  // drive; simplification audit L24). `setActive`/`setDepth`/`setSplit`/
  // `setPos` are `useState` setters, which React guarantees are stable, so
  // they're read directly and don't need mirroring here.
  const liveRef = useRef({
    perturb,
    commit,
    undo,
    reroll,
    onScratchNudge,
    onPlace,
    onPickLocation,
    pos,
    inputMode: inputs.inputMode,
  });
  liveRef.current = {
    perturb,
    commit,
    undo,
    reroll,
    onScratchNudge,
    onPlace,
    onPickLocation,
    pos,
    inputMode: inputs.inputMode,
  };

  // keyboard accelerators
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      // Verdict accelerators: 1 = thumbs-down / explore, 2 = thumbs-up. These
      // work everywhere, including while the manifold is in follow-mouse mode
      // (the knob tracks the cursor; the keys still land the verdict).
      const map: Record<string, DrawerKey> = {
        '3': 'route',
        '4': 'settings',
        '5': 'help',
      };
      if (e.key === '1') {
        e.preventDefault();
        liveRef.current.perturb();
      } else if (e.key === '2') {
        e.preventDefault();
        liveRef.current.commit();
      } else if (map[e.key]) {
        setActive((a) => (a === map[e.key] ? null : map[e.key]));
        setDepth('condensed');
      } else if (e.key === '\\') setDepth((d) => (d === 'expanded' ? 'condensed' : 'expanded'));
      else if (e.key === '[') {
        e.preventDefault();
        setSplit((s) => Math.max(0, s - 0.04));
      } else if (e.key === ']') {
        e.preventDefault();
        setSplit((s) => Math.min(1, s + 0.04));
      } else if (e.key === '=' || e.key === '0') {
        e.preventDefault();
        setSplit(0.5);
      } else if (e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault();
        liveRef.current.commit();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        liveRef.current.perturb();
      } else if (e.key.toLowerCase() === 'z') liveRef.current.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Game-controller verdict bindings (inputs-spec) ---------------------
  // The gamepad's sticks already feed the input layer (→ engine); its BUTTONS
  // drive verdicts here. Standard-mapping indices:
  //   LB(4) = down/negative · RB(5) = up/positive · X(2) = randomise ·
  //   Y(3) = nudge · B(1) = undo · A(0) hold-and-move = reposition an example
  //   (hold A, move the stick to a spot on the manifold, release to drop it).
  // MIDI note actions are surfaced too but left unbound (MIDI mode learns CCs
  // as INPUT axes; verdicts there stay on the on-screen / keyboard controls).
  // Deps are the two subscribe methods, not `inputs` itself: `inputs` is a
  // fresh object literal every render (useInputLayer doesn't memoize its
  // return value), so depending on the whole object would reintroduce the
  // exact per-render resubscribe churn this fix removes. `onAction`/
  // `onReducedInput` ARE stable (useCallback over a ref-held layer created
  // once), so this genuinely installs once; everything that DOES vary
  // per-render is read fresh through `liveRef` above.
  useEffect(() => {
    const unBtn = inputs.onAction((a) => {
      if (a.source !== 'gamepad') return;
      const phase = a.phase ?? 'press';
      const live = liveRef.current;
      if (phase === 'press') {
        switch (a.id) {
          case 'button:4': // LB → thumbs-down
            live.perturb();
            break;
          case 'button:5': // RB → thumbs-up
            live.commit();
            break;
          case 'button:2': // X → randomise / re-roll
            live.reroll();
            break;
          case 'button:3': // Y → nudge (scratchpad)
            live.onScratchNudge();
            break;
          case 'button:1': // B → undo
            live.undo();
            break;
          case 'button:0': // A (down) → begin repositioning an example
            live.onPlace();
            break;
        }
      } else if (phase === 'release' && a.id === 'button:0') {
        // A (up) → drop the example at the current (stick-driven) location.
        live.onPickLocation(live.pos[0], live.pos[1]);
      }
    });
    // Mirror the composed gamepad/MIDI position onto the on-screen manifold so
    // markers + readouts track the controller (the XY pad pushes its own pos).
    // The callback fires every rAF frame — only re-render when it actually moves.
    const unPos = inputs.onReducedInput((x, y) => {
      if (liveRef.current.inputMode === 'internal') return;
      setPos((prev) => (Math.abs(prev[0] - x) < 1e-3 && Math.abs(prev[1] - y) < 1e-3 ? prev : [x, y]));
    });
    return () => {
      unBtn();
      unPos();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs.onAction, inputs.onReducedInput]);

  const onToggleAudio = () => {
    if (!engine) return;
    if (engine.audio.isStarted) {
      void engine.audio.stop();
      setAudioStarted(false);
    } else {
      void engine.audio.start().then(() => setAudioStarted(true));
    }
  };

  const ctx: ConsoleCtx = {
    modes: MF_MODES,
    modeId,
    setModeId,
    mode,
    datasetCount: examples,
    busy,
    addingExample,
    onAddExample: addExample,
    onTrain: train,
    onClear: () => {
      // Drop the recorded training examples AND every on-map visual that
      // represents them (feedback markers + placed-anchor pins). The cursor
      // trail is ephemeral and self-decays, so it needs no explicit reset.
      engine?.clearExamples();
      setExamples(0);
      setMarkers([]);
      setPins([]);
    },
    params,
    setParam,
    addOutput,
    deleteOutput,
    displayOutputCount,
    outputMode,
    setOutputMode,
    // ---- output backend transport ----
    backendStatus,
    midiPorts,
    refreshMidiPorts,
    midiOutputId,
    setMidiOutputId,
    midiCcCount,
    setMidiCcCount,
    oscUrl,
    setOscUrl,
    oscSendRaw,
    setOscSendRaw,
    vcvUrl,
    setVcvUrl,
    vcvSendRaw,
    setVcvSendRaw,
    cvConnect,
    cvIdentify,
    cvDisconnect,
    setParams: (next: MFParam[]) => setParams(next),
    inputs,
    spread,
    setSpread,
    xavierSpreadEnabled: settings.xavierSpreadEnabled,
    noiseCap,
    setNoiseCap,
    // learning-behaviour
    feedbackMode,
    setFeedbackMode,
    soloMode,
    setSoloMode,
    exploring,
    learningPaused,
    armedCount: params.slice(0, displayOutputCount).filter((p) => p.armed).length,
    clearArmed: () =>
      setParams((ps) =>
        ps.map((p, i) => (i < displayOutputCount && p.armed ? { ...p, armed: false } : p)),
      ),
    // exploration gestures (Jolt + OU explore)
    joltActive,
    onJoltPress,
    onJoltRelease,
    exploreIntensity,
    setExploreIntensity,
    // synth
    audioStarted,
    onToggleAudio,
    // explore-and-place scratchpad session (workstream B)
    picking,
    anchorCount,
    undoDepth,
    onExplore,
    onScratchReroll,
    onScratchNudge,
    onPlace,
    onScratchUndo,
    onFinalise,
    onCancelExplore,
  };

  // Resolve the effective input-map shape from Settings + the mode's declared input.
  const inputMapVariant = resolveInputMap(settings.inputMap, mode.input);

  const addPin = (p: [number, number]) =>
    setPins((ps) => [...ps, { x: p[0], y: p[1], color: 'rgba(255,106,0,0.16)' }]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg)',
        overflow: 'hidden',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <style>{`@keyframes mfDrawerIn{from{transform:translateX(16px)}to{transform:translateX(0)}}`}</style>

      {/* stage = manifold area (left of dock) */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 48, bottom: 0 }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          {sandwich ? (
            // Sandwich centre-stage: shrunken input (left) · landscape stack
            // (centre, fills) · compact outputs (right). Replaces the Mode stage.
            <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
              <div
                style={{
                  width: 'clamp(200px, 24%, 320px)',
                  flex: '0 0 auto',
                  position: 'relative',
                  borderRight: '1px solid var(--line)',
                }}
              >
                <Manifold
                  pos={pos}
                  onMove={onMove}
                  noiseCap={noiseCap}
                  pins={pins}
                  markers={markers}
                  variant={inputMapVariant}
                  frozen={false}
                  follow={follow}
                  onLongPress={addPin}
                  picking={picking}
                  onPickLocation={onPickLocation}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                {engine && (
                  <SandwichStage
                    engine={engine}
                    version={version}
                    pos={pos}
                    layerCount={Math.min(displayedParams.length, 8)}
                    names={displayedParams.map((p) => p.name)}
                  />
                )}
              </div>
              <div
                style={{
                  width: 'clamp(200px, 24%, 320px)',
                  flex: '0 0 auto',
                  position: 'relative',
                  borderLeft: '1px solid var(--line)',
                }}
              >
                <OutputStage params={displayedParams} values={displayedValues} onChange={setParam} compact />
              </div>
            </div>
          ) : outputMode === 'particles' ? (
            <ParticleStage
              pos={pos}
              onMove={onMove}
              params={displayedParams}
              values={displayedValues}
              onChange={setParam}
            />
          ) : (
            <CompositeStage
              split={split}
              onSplit={setSplit}
              mode={mode}
              pos={pos}
              onMove={onMove}
              noiseCap={noiseCap}
              pins={pins}
              markers={markers}
              variant={inputMapVariant}
              follow={follow}
              onLongPress={addPin}
              params={displayedParams}
              values={displayedValues}
              onChange={setParam}
            />
          )}

          {/* corner overlay — hidden in Particle mode (top axis bar owns that row) */}
          {outputMode !== 'particles' && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: 14,
                zIndex: 20,
                pointerEvents: 'none',
              }}
            >
              <strong style={{ color: 'var(--accent)', fontSize: 'var(--fs-md)' }}>MEMLNaut</strong>
            </div>
          )}

          <VerdictCluster
            onPerturb={perturb}
            onUndo={undo}
            onCommit={commit}
            onReroll={reroll}
            onNudge={nudgeNet}
            onRandomise={reroll}
            canUndo={feedbackMode === 'explore-and-place' && exploring && undoDepth > 0}
            firstSession={firstSession}
            feedbackMode={feedbackMode}
            exploring={exploring}
            picking={picking}
          />

          {/* Cold-start prompt (geometric dislike, no positives yet; rl-feedback
              §7). One-time; dismissed on the next like or the dismiss button. */}
          {coldStart && feedbackMode === 'geometric-dislike' && !exploring && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 31,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                background: 'var(--glass)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--r-pill)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--accent)',
              }}
            >
              <span style={{ fontWeight: 600 }}>
                Like a few sounds first so the system knows what to move away from.
              </span>
              <button
                type="button"
                onClick={() => setColdStart(false)}
                title="Dismiss"
                style={pillBtn('var(--fg-mute)')}
              >
                dismiss
              </button>
            </div>
          )}

          {/* Exploring-scratchpad banner (workstream B; rl-feedback §2.2 §7). */}
          {exploring && (
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 30,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                background: 'var(--glass)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                border: '1px solid var(--accent-2)',
                borderRadius: 'var(--r-pill)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--accent-2)',
              }}
            >
              <span style={{ fontWeight: 600 }}>
                {picking ? 'tap the manifold to place' : 'exploring (scratchpad)'}
              </span>
              <span style={{ color: 'var(--fg-mute)' }}>
                {anchorCount} anchor{anchorCount === 1 ? '' : 's'} placed · undo {undoDepth}
              </span>
              <button
                type="button"
                onClick={onScratchNudge}
                title="Nudge — small bounded weight perturbation (undoable)"
                style={pillBtn('var(--fg-mute)')}
              >
                nudge
              </button>
              <button
                type="button"
                onClick={onScratchReroll}
                title="Re-roll the scratchpad net (undoable)"
                style={pillBtn('var(--fg-mute)')}
              >
                re-roll
              </button>
              <button
                type="button"
                onClick={onFinalise}
                title="Done — restore the real net + warm-start to interpolate all anchors"
                style={pillBtn('var(--accent)')}
                disabled={anchorCount === 0}
              >
                done ({anchorCount})
              </button>
              <button
                type="button"
                onClick={onCancelExplore}
                title="Cancel — discard scratchpad + anchors, restore the real net"
                style={pillBtn('var(--danger)')}
              >
                cancel
              </button>
            </div>
          )}

          {/* Global PICK-LOCATION capture overlay: the CompositeStage/ParticleStage
              don't expose picking directly, so this transparent overlay captures
              the pointer-down and routes it to onPickLocation everywhere. */}
          {picking && (
            <div
              onPointerDown={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
                const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
                onPickLocation(x, y);
              }}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 35,
                cursor: 'cell',
                background: 'rgba(0,204,255,0.04)',
              }}
            />
          )}
        </div>
      </div>

      <Dock
        ctx={ctx}
        active={active}
        setActive={setActive}
        depth={depth}
        setDepth={setDepth}
        sandwich={sandwich}
        setSandwich={(v) => {
          setSandwich(v);
          // reveal the full 3-zone layout: a drawer would overlay the output zone
          if (v) setActive(null);
        }}
      />

    </div>
  );
}
