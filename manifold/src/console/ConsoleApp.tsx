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
 *    per docs/redesign/rl-feedback-design.md).
 *  - AltitudeNav switches `focus` via React state (in|split|out|composite), not
 *    by navigating to separate HTML files.
 *  - `c15` is labelled "Powerful Synth Engine" (in model.ts) — "C15" never shows.
 *
 * UI-only state (params status/min/max/curve, snapshots, A/B seed, axes,
 * noiseCap, health/rev visuals) is preserved as faithful local React state.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useEngine, useEngineVersion } from '../engine';
import { MF_MODES, modeEngineId, seededGradient, shapeValues } from './model';
import type { MFParam } from './model';
import { CompositeStage } from './CompositeStage';
import { ParticleStage } from './ParticleStage';
import { SandwichStage } from './SandwichStage';
import { SplitStage } from './SplitStage';
import { OutputStage } from './OutputStage';
import { InputMini } from './InputMini';
import { Manifold } from './Manifold';
import { ReadoutStrip } from './ReadoutStrip';
import { VerdictCluster } from './VerdictCluster';
import { Dock } from './Dock';
import type {
  Axes,
  ConsoleCtx,
  DrawerDepth,
  DrawerKey,
  FeedbackMarker,
  FeedbackModeUI,
  Focus,
  OutputMode,
  Pin,
  Snapshot,
  SoloMode,
} from './types';
import type { BackendId } from '../dock/output-state';
import { buildArmMask } from '../dock/output-state';
import { FeedbackController, type ProtoFeedbackMode } from '../feedback';
import { DEFAULT_OUTPUT_MODE, OUTPUT_MODES, outputModeDescriptor } from './output-mode';
import { useSettings, resolveInputMap } from '../settings/settings-store';
import { useBackendManager } from '../backends';
import { useInputLayer } from '../inputs';

let SNAP_ID = 0;

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

export interface ConsoleAppProps {
  focus?: Focus;
}

export function ConsoleApp({ focus: initialFocus = 'composite' }: ConsoleAppProps) {
  const engine = useEngine();
  const version = useEngineVersion(engine);
  const { settings } = useSettings();

  const [focus, setFocus] = useState<Focus>(initialFocus);
  const [modeId, setModeId] = useState('paf_synth');
  const mode = MF_MODES.find((m) => m.id === modeId) ?? MF_MODES[0];
  const [params, setParams] = useState<MFParam[]>(() => mode.params.map((p) => ({ ...p })));
  const [pos, setPos] = useState<[number, number]>([0.5, 0.5]);

  // A/B seed-snapshot model (kept as visual parity; A holds a remembered weight
  // snapshot conceptually — here we mirror the JSX's seed-based preview marker).
  const [seed, setSeed] = useState(0.4);
  const [axes, setAxes] = useState<Axes>({ boldness: 0.55, memory: 0.4, precision: 0.5 });
  const [preset, setPreset] = useState('Sculpt');
  const [noiseCap, setNoiseCap] = useState(0.12);
  const [examples, setExamples] = useState(0);
  const [addingExample, setAddingExample] = useState(false);
  const [loss, setLoss] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [ab, setAB] = useState<'A' | 'B'>('B');
  const [, setHoldingA] = useState(false);
  const aRef = useRef<{ seed: number } | null>(null);
  const [spread, setSpread] = useState(false);
  const [tame, setTame] = useState(0.85);
  const [health, setHealth] = useState(0.8);
  const [rev, setRev] = useState(1);
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
  // Explore-and-place scratchpad session state (workstream B; rl-feedback §2.2).
  const [picking, setPicking] = useState(false);
  const [anchorCount, setAnchorCount] = useState(0);
  const [undoDepth, setUndoDepth] = useState(0);
  const [learningRate, setLearningRate] = useState(0.00001);
  const [decay, setDecay] = useState(0.97);
  const [spreadLevel, setSpreadLevel] = useState(0.6);
  // Active output MODE (TOP dock selector) — default Particle System. The dock
  // backend + audio backend derive from this.
  const [outputMode, setOutputModeState] = useState<OutputMode>(DEFAULT_OUTPUT_MODE);
  const outputBackend: BackendId = outputModeDescriptor(outputMode).backend;
  // Per-backend transport settings (backends-spec §2.3/§2.4). Persisted via the
  // named-preset system; these are the live working values.
  const [midiOutputId, setMidiOutputId] = useState<string | null>(null);
  const [midiCcCount, setMidiCcCount] = useState(8);
  const [oscUrl, setOscUrl] = useState('ws://localhost:8765');
  const [oscSendRaw, setOscSendRaw] = useState(false);
  // VCV bridge: WS URL of the Deno bridge that relays to the VCV module over UDP
  // (default module UDP 7001). Independent of the OSC backend's bridge.
  const [vcvUrl, setVcvUrl] = useState('ws://localhost:8765');
  const [vcvSendRaw, setVcvSendRaw] = useState(false);
  // Feedback markers plotted on the 2D map (both polarities; session-scoped).
  const [markers, setMarkers] = useState<FeedbackMarker[]>([]);
  const [volume, setVolume] = useState(0.8);
  const [bpm, setBpm] = useState(120);
  const [audioStarted, setAudioStarted] = useState(false);
  const [follow, setFollow] = useState(false);
  const [split, setSplit] = useState(() => {
    const v = parseFloat(localStorage.getItem('mf-composite-split') ?? '');
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
  });
  useEffect(() => {
    localStorage.setItem('mf-composite-split', String(split));
  }, [split]);
  const [stripPinned, setStripPinned] = useState(true);
  const [firstSession, setFirstSession] = useState(true);
  const [pins, setPins] = useState<Pin[]>([]);

  // The framework-neutral learning-engine controller (workstream B). Owns BOTH
  // feedback modes' BEHAVIOUR on the existing engine primitives. The dock owns
  // the mode/solo SELECTOR UI; this controller implements what those selectors
  // mean. One instance per engine, created once the engine resolves.
  const controllerRef = useRef<FeedbackController | null>(null);
  if (engine && !controllerRef.current) {
    controllerRef.current = new FeedbackController(engine, {
      seed: 0xfeedbacc,
      spread: 0.6,
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

  // Push the selected solo-mode + the arm mask into the controller whenever they
  // change (dock-spec §1.2). The controller RESPECTS the arm mask at the example
  // level in BOTH modes and forwards it to engine.feedback.setFocus.
  // TODO(rl-feedback-design §3): soloMode (mask-gradients / zero-loss /
  // dont-care) selects HOW the mask is applied during training; the C API only
  // exposes set_focus today, so the controller approximates it at the example
  // level — the true gradient column-freeze (`train_masked`) is the C++ step.
  useEffect(() => {
    controllerRef.current?.setSoloMode(soloMode);
    controllerRef.current?.setArmMask(buildArmMask(params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, params, soloMode]);

  // Keep the audio backend pointed at the current mode (audio itself is gated
  // behind a user gesture — see startAudio below).
  useEffect(() => {
    if (engine) engine.audio.setBackend(modeEngineId(modeId) as Parameters<typeof engine.audio.setBackend>[0]);
  }, [engine, modeId]);

  // reset transient state on mode switch
  useEffect(() => {
    setParams(mode.params.map((p) => ({ ...p })));
    setPos([0.5, 0.5]);
    setExamples(0);
    setLoss([]);
    setSnapshots([]);
    setSeed(0.4);
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
    pushSnap('anchor');
    pushMarker([x, y], 'positive');
    syncController();
    setRev((r) => r + 1);
  };

  // Output backend transport (backends-spec). The manager consumes the engine
  // spine and forwards routed outputs to the active backend; switching Mode
  // tears down the old backend, starts the new one, and gates synth audio
  // (mute on non-synth modes). MIDI/OSC config + names ride the shared params.
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
    params,
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
      spread: spread ? 1 : 0.6,
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

  const gradient = useMemo(() => seededGradient(rev), [rev]);

  const pushSnap = (tag: string) =>
    setSnapshots((s) => [...s, { id: ++SNAP_ID, tag, noise: noiseCap, seed }].slice(-50));

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
    if (feedbackMode === 'explore-and-place') {
      if (c?.getState().exploring) {
        // Place the current candidate → next manifold tap chooses the location.
        pushSnap('place');
        c.place();
      } else {
        // Not exploring: a plain positive reinforcement of the current mapping.
        pushSnap('commit +');
        c?.like(pos, engine?.getOutputs() ?? new Float32Array(0));
        pushMarker(pos, 'positive');
      }
    } else {
      // Geometric dislike: thumbs-up = like + train.
      pushSnap('like +');
      c?.like(pos, engine?.getOutputs() ?? new Float32Array(0));
      pushMarker(pos, 'positive');
    }
    // VCV bridged mode: also train the module — thumbs-up = positive verdict.
    forwardVcvFeedback('up');
    syncController();
    setNoiseCap((n) => Math.max(0.02, n * 0.7));
    setHealth((h) => Math.min(1, h + 0.08));
    setRev((r) => r + 1);
    const l = engine?.evalLoss();
    setLoss((prev) =>
      [...prev, Number.isFinite(l) ? (l as number) : prev.length ? prev[prev.length - 1] : 0.5].slice(-120),
    );
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
        pushSnap('cancel explore');
        c.cancel();
      } else {
        pushSnap('explore');
        c?.enterExplore();
        // VCV bridged mode: entering explore re-rolls the module's net too.
        forwardVcvFeedback('rand');
      }
    } else {
      // Geometric dislike: push the current mapping away from this sound.
      pushSnap('dislike −');
      c?.dislike(pos, engine?.getOutputs() ?? new Float32Array(0), noiseCap, spread ? 1 : 0.6);
      pushMarker(pos, 'negative');
      // VCV bridged mode: thumbs-down = negative verdict.
      forwardVcvFeedback('down');
      setSeed((s) => s + (Math.random() - 0.5) * (noiseCap * 4 + 0.3));
      setNoiseCap((n) => Math.min(0.5, n + 0.06));
      setHealth((h) => Math.max(0.1, h - 0.06));
    }
    syncController();
    setRev((r) => r + 1);
  };

  /** Long-press perturb / explicit re-roll. */
  const reroll = () => {
    const c = controllerRef.current;
    setFirstSession(false);
    pushSnap('re-roll');
    if (feedbackMode === 'explore-and-place' && c?.getState().exploring) {
      // Re-roll the scratchpad net (undoable) without leaving the session.
      c.reroll();
    } else {
      // Outside a scratchpad session a re-roll randomises the real net directly.
      engine?.randomise(spread ? 1 : 0.6);
    }
    // VCV bridged mode: re-roll the module's net too.
    forwardVcvFeedback('rand');
    syncController();
    setSeed(Math.random() * 6);
    setNoiseCap(0.4);
    setHealth(0.5);
    setRev((r) => r + 1);
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
    setRev((r) => r + 1);
  };

  /**
   * Undo. While exploring (Mode 2) this pops the scratchpad undo ring (reroll /
   * nudge). Otherwise it falls back to the UI snapshot stack (visual A/B seed).
   */
  const undo = () => {
    const c = controllerRef.current;
    if (feedbackMode === 'explore-and-place' && c?.getState().exploring) {
      c.undo();
      syncController();
      setRev((r) => r + 1);
      return;
    }
    setSnapshots((s) => {
      if (!s.length) return s;
      const last = s[s.length - 1];
      setSeed(last.seed);
      setNoiseCap(last.noise);
      setRev((r) => r + 1);
      return s.slice(0, -1);
    });
  };

  // ---- Explore-and-place scratchpad ops surfaced to the dock + cluster ----
  const onExplore = () => {
    controllerRef.current?.enterExplore();
    syncController();
    setRev((r) => r + 1);
  };
  const onScratchReroll = () => {
    controllerRef.current?.reroll();
    syncController();
    setRev((r) => r + 1);
  };
  const onScratchNudge = () => {
    controllerRef.current?.nudge();
    syncController();
    setRev((r) => r + 1);
  };
  const onScratchUndo = () => {
    controllerRef.current?.undo();
    syncController();
    setRev((r) => r + 1);
  };
  const onPlace = () => {
    controllerRef.current?.place();
    syncController();
  };
  const onFinalise = () => {
    setBusy(true);
    controllerRef.current?.finalise();
    syncController();
    setRev((r) => r + 1);
    setBusy(false);
  };
  const onCancelExplore = () => {
    controllerRef.current?.cancel();
    syncController();
    setRev((r) => r + 1);
  };
  const train = () => {
    setBusy(true);
    const l = engine?.train();
    engine?.process();
    setLoss((p) =>
      [...p, Number.isFinite(l) ? (l as number) : p.length ? p[p.length - 1] * 0.82 : 0.5].slice(-120),
    );
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
    pushSnap('example');
    train();
  };

  const setParam = (i: number, patch: Partial<MFParam>) =>
    setParams((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const cycleStatus = (i: number) =>
    setParams((ps) =>
      ps.map((p, j) =>
        j === i
          ? { ...p, status: ({ off: 'fixed', fixed: 'live', live: 'off' } as const)[p.status] }
          : p,
      ),
    );

  const toggleAB = () => {
    if (ab === 'B') {
      aRef.current = { seed };
      setAB('A');
    } else {
      if (aRef.current) setSeed(aRef.current.seed);
      setAB('B');
    }
  };

  // keyboard accelerators
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const map: Record<string, DrawerKey> = {
        '1': 'learn',
        '2': 'inputs',
        '3': 'route',
        '4': 'settings',
        '5': 'help',
      };
      if (map[e.key]) {
        setActive((a) => (a === map[e.key] ? null : map[e.key]));
        setDepth('condensed');
      } else if (e.key === '\\') setDepth((d) => (d === 'expanded' ? 'condensed' : 'expanded'));
      else if (focus === 'composite' && e.key === '[') {
        e.preventDefault();
        setSplit((s) => Math.max(0, s - 0.04));
      } else if (focus === 'composite' && e.key === ']') {
        e.preventDefault();
        setSplit((s) => Math.min(1, s + 0.04));
      } else if (focus === 'composite' && (e.key === '=' || e.key === '0')) {
        e.preventDefault();
        setSplit(0.5);
      } else if (e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault();
        commit();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        perturb();
      } else if (e.key.toLowerCase() === 'z') undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- Game-controller verdict bindings (inputs-spec) ---------------------
  // The gamepad's sticks already feed the input layer (→ engine); its BUTTONS
  // drive verdicts here. Standard-mapping indices:
  //   LB(4) = down/negative · RB(5) = up/positive · X(2) = randomise ·
  //   Y(3) = nudge · B(1) = undo · A(0) hold-and-move = reposition an example
  //   (hold A, move the stick to a spot on the manifold, release to drop it).
  // MIDI note actions are surfaced too but left unbound (MIDI mode learns CCs
  // as INPUT axes; verdicts there stay on the on-screen / keyboard controls).
  // The effect has no dep array (matching the keydown handler above) so each
  // binding closes over the latest verdict functions + live `pos`.
  useEffect(() => {
    const unBtn = inputs.onAction((a) => {
      if (a.source !== 'gamepad') return;
      const phase = a.phase ?? 'press';
      if (phase === 'press') {
        switch (a.id) {
          case 'button:4': // LB → thumbs-down
            perturb();
            break;
          case 'button:5': // RB → thumbs-up
            commit();
            break;
          case 'button:2': // X → randomise / re-roll
            reroll();
            break;
          case 'button:3': // Y → nudge (scratchpad)
            onScratchNudge();
            break;
          case 'button:1': // B → undo
            undo();
            break;
          case 'button:0': // A (down) → begin repositioning an example
            onPlace();
            break;
        }
      } else if (phase === 'release' && a.id === 'button:0') {
        // A (up) → drop the example at the current (stick-driven) location.
        onPickLocation(pos[0], pos[1]);
      }
    });
    // Mirror the composed gamepad/MIDI position onto the on-screen manifold so
    // markers + readouts track the controller (the XY pad pushes its own pos).
    // The callback fires every rAF frame — only re-render when it actually moves.
    const unPos = inputs.onReducedInput((x, y) => {
      if (inputs.inputMode === 'internal') return;
      setPos((prev) => (Math.abs(prev[0] - x) < 1e-3 && Math.abs(prev[1] - y) < 1e-3 ? prev : [x, y]));
    });
    return () => {
      unBtn();
      unPos();
    };
  });

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
    axes,
    setAxis: (k, v) => setAxes((s) => ({ ...s, [k]: v })),
    preset,
    setPreset,
    offsetActive: preset !== 'Sculpt',
    datasetCount: examples,
    loss,
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
      setLoss([]);
      setMarkers([]);
      setPins([]);
    },
    snapshots,
    onJump: (id) => {
      const s = snapshots.find((x) => x.id === id);
      if (s) {
        setSeed(s.seed);
        setNoiseCap(s.noise);
        setRev((r) => r + 1);
      }
    },
    params,
    cycleStatus,
    setParam,
    outputBackend,
    setOutputBackend: (b) => {
      // Map a backend id back onto the active Mode (the Mode is the source of
      // truth; the Outputs drawer drives it via setOutputMode).
      const m = OUTPUT_MODES.find((om) => om.backend === b);
      if (m) setOutputMode(m.id);
    },
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
    markers,
    inputs,
    health,
    gradient: gradient.norms,
    gradientStatus: gradient.status,
    weightsRevision: rev,
    spread,
    setSpread,
    tame,
    setTame,
    noiseCap,
    setNoiseCap,
    // learning-behaviour
    feedbackMode,
    setFeedbackMode,
    soloMode,
    setSoloMode,
    exploring,
    learningPaused,
    armedCount: params.filter((p) => p.armed).length,
    clearArmed: () => setParams((ps) => ps.map((p) => (p.armed ? { ...p, armed: false } : p))),
    learningRate,
    setLearningRate,
    decay,
    setDecay,
    spreadLevel,
    setSpreadLevel,
    // synth
    audioStarted,
    onToggleAudio,
    volume,
    setVolume,
    bpm,
    setBpm,
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

  const healthColor =
    health > 0.66 ? 'rgba(107,194,107,' : health > 0.33 ? 'rgba(245,196,94,' : 'rgba(255,68,102,';
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

      {/* ambient health glow at the screen edge */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 25,
          boxShadow: `inset 0 0 120px ${healthColor}${0.05 + (1 - health) * 0.12})`,
          transition: 'box-shadow var(--dur-slow) var(--ease-console)',
        }}
      />

      {/* stage = manifold area (left of dock) */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 48, bottom: 0 }}>
        {focus === 'in' && (stripPinned || mode.cls !== 'Synth') && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30 }}>
            <ReadoutStrip
              params={params}
              values={values}
              onChange={setParam}
              pinned={stripPinned}
              onTogglePin={() => setStripPinned((p) => !p)}
            />
          </div>
        )}

        <div
          style={{
            position: 'absolute',
            top: focus === 'in' && stripPinned ? 76 : 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        >
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
                    layerCount={Math.min(params.length, 8)}
                    names={params.map((p) => p.name)}
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
                <OutputStage params={params} values={values} onChange={setParam} compact />
              </div>
            </div>
          ) : outputMode === 'particles' ? (
            <ParticleStage pos={pos} onMove={onMove} />
          ) : focus === 'composite' ? (
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
              params={params}
              values={values}
              onChange={setParam}
            />
          ) : focus === 'split' ? (
            <SplitStage
              pos={pos}
              onMove={onMove}
              noiseCap={noiseCap}
              pins={pins}
              markers={markers}
              variant={inputMapVariant}
              follow={follow}
              onLongPress={addPin}
              params={params}
              values={values}
              onChange={setParam}
            />
          ) : focus === 'out' ? (
            <>
              <OutputStage params={params} values={values} onChange={setParam} />
              <InputMini
                mode={mode}
                pos={pos}
                onMove={onMove}
                noiseCap={noiseCap}
                corner="bottom-left"
                variant={inputMapVariant}
              />
            </>
          ) : (
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
            canUndo={feedbackMode === 'explore-and-place' && exploring ? undoDepth > 0 : snapshots.length > 0}
            ab={ab}
            onToggleAB={toggleAB}
            onHoldA={setHoldingA}
            firstSession={firstSession}
            feedbackMode={feedbackMode}
            exploring={exploring}
            picking={picking}
          />

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

          {/* Global PICK-LOCATION capture overlay: works in any focus (composite/
              split stages don't expose picking). The directly-rendered Manifold
              (focus==='in') also handles picks + draws the reticle; this overlay
              guarantees the place→pick loop is reachable everywhere. */}
          {picking && focus !== 'in' && (
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
