/**
 * useInputLayer — the thin React binding over the framework-neutral
 * {@link InputLayer} + source adapters.
 *
 * The dock surfaces ONE exclusive input MODE at a time (inputs-spec):
 *   - `internal` → the on-screen XY pad / manifold (default; today's behaviour).
 *   - `gamepad`  → a physical game controller (sticks → axes, buttons → verdicts).
 *   - `midi`     → a connected MIDI device (CCs learned onto axes).
 *
 * Switching mode stops the previous source and starts the chosen one, then sets
 * the layer's composed source set to exactly that source. The XY pad is the one
 * consumers push into directly (`pushPad` from ConsoleApp.onMove) so the manifold
 * keeps working unchanged in `internal` mode.
 *
 * Per-mode config (gamepad stick mode + button verdict legend; MIDI device pick,
 * batch learn arm, learned bindings) and per-source status are surfaced for the
 * drawer. Discrete actions (gamepad buttons / MIDI notes) are fanned out via
 * `onAction` so the console can bind them to verdicts (commit/perturb/…).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EngineApi } from '../engine';
import { InputLayer } from './input-layer';
import { XYPadSource } from './xy-pad-source';
import { WebMidiInputSource, type MidiBinding } from './midi-input-source';
import { GamepadSource, type StickMode } from './gamepad-source';
import type {
  InputAction,
  InputMode,
  InputSource,
  InputSourceKind,
  InputSourceStatus,
} from './types';

export interface SourceView {
  kind: InputSourceKind;
  label: string;
  enabled: boolean;
  status: InputSourceStatus;
  axisCount: number;
}

/** Which source backs each exclusive input mode. */
const MODE_SOURCE: Record<InputMode, InputSourceKind> = {
  internal: 'xy-pad',
  gamepad: 'gamepad',
  midi: 'midi',
};

export interface UseInputLayer {
  /** Push the on-screen XY pad position (∈ [0,1]) — call from onMove. */
  pushPad: (x: number, y: number) => void;

  // ---- exclusive mode ----
  /** The active input mode (Internal / Game Controller / MIDI). */
  inputMode: InputMode;
  /** Switch the exclusive input mode. */
  setInputMode: (m: InputMode) => void;

  /** Per-source status + axis count for the dock (the active mode's source is `enabled`). */
  sources: SourceView[];
  /** Composed channel layout (per-axis source+label). */
  channelLayout: { source: string; label: string }[];
  /** Total composed axis count. */
  axisCount: number;
  /** Engine input arity (the fixed WASM head = 2). */
  engineInputSize: number;

  // ---- gamepad config ----
  gamepadStickMode: StickMode;
  setGamepadStickMode: (m: StickMode) => void;

  // ---- midi device + learn-map ----
  /** Available MIDI input ports. */
  midiInputs: { id: string; name: string }[];
  /** The selected MIDI input port (null = listen to all ports). */
  midiDeviceId: string | null;
  selectMidiDevice: (id: string | null) => void;
  /** True while batch MIDI-Learn is armed (sweep controls, then Done). */
  midiLearnArmed: boolean;
  armMidiLearn: (armed: boolean) => void;
  midiBindings: MidiBinding[];
  clearMidiBinding: (i: number) => void;
  clearMidiBindings: () => void;

  /** Subscribe to discrete actions (notes/buttons). */
  onAction: (cb: (a: InputAction) => void) => () => void;
  /** Subscribe to the reduced 2D input each frame (for the on-screen manifold). */
  onReducedInput: (cb: (x: number, y: number) => void) => () => void;
}

export function useInputLayer(engine: EngineApi | null): UseInputLayer {
  // One layer + one of each source, created once per engine.
  const layerRef = useRef<InputLayer | null>(null);
  const padRef = useRef<XYPadSource | null>(null);
  const midiRef = useRef<WebMidiInputSource | null>(null);
  const gamepadRef = useRef<GamepadSource | null>(null);

  if (!layerRef.current) {
    layerRef.current = new InputLayer();
    padRef.current = new XYPadSource();
    midiRef.current = new WebMidiInputSource();
    gamepadRef.current = new GamepadSource();
  }
  const layer = layerRef.current!;
  const pad = padRef.current!;
  const midi = midiRef.current!;
  const gamepad = gamepadRef.current!;

  const [inputMode, setInputModeState] = useState<InputMode>('internal');
  const [statuses, setStatuses] = useState<Record<InputSourceKind, InputSourceStatus>>({
    'xy-pad': pad.status(),
    midi: midi.status(),
    gamepad: gamepad.status(),
  });
  const [layoutTick, setLayoutTick] = useState(0);
  const [gamepadStickMode, setGamepadStickModeState] = useState<StickMode>('single');
  const [midiLearnArmed, setMidiLearnArmed] = useState(false);
  const [midiBindings, setMidiBindings] = useState<MidiBinding[]>([]);
  const [midiInputs, setMidiInputs] = useState<{ id: string; name: string }[]>([]);
  const [midiDeviceId, setMidiDeviceId] = useState<string | null>(null);

  // Attach to engine; start in `internal` mode (the XY pad). Wire listeners.
  useEffect(() => {
    if (!engine) return;
    layer.attach(engine);
    pad.start();
    layer.setSources([pad]);
    layer.start();

    const unsubs: (() => void)[] = [];
    const wireStatus = (s: InputSource) =>
      unsubs.push(s.onStatusChange((st) => setStatuses((m) => ({ ...m, [s.kind]: st }))));
    wireStatus(pad);
    wireStatus(midi);
    wireStatus(gamepad);
    unsubs.push(layer.onLayoutChange(() => setLayoutTick((t) => t + 1)));
    // Refresh the device-picker list when ports come and go (hot-plug).
    unsubs.push(midi.onStatusChange(() => setMidiInputs(midi.listInputs())));
    unsubs.push(
      midi.onBindingsChange((b) => {
        setMidiBindings(b);
        setLayoutTick((t) => t + 1);
        setMidiLearnArmed(midi.isLearnArmed());
      }),
    );
    return () => {
      for (const u of unsubs) u();
      layer.dispose();
      void midi.stop();
      gamepad.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // Recompose the active source set whenever the mode changes.
  useEffect(() => {
    const kind = MODE_SOURCE[inputMode];
    const src = kind === 'xy-pad' ? pad : kind === 'gamepad' ? gamepad : midi;
    layer.setSources([src]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMode]);

  const setInputMode = useCallback(
    (mode: InputMode) => {
      setInputModeState((prev) => {
        if (prev === mode) return prev;
        // Stop the outgoing source, start the incoming one.
        if (prev === 'gamepad') gamepad.stop();
        else if (prev === 'midi') void midi.stop();
        else pad.stop();

        if (mode === 'gamepad') {
          gamepad.start();
        } else if (mode === 'midi') {
          void midi.start().then(() => {
            setMidiInputs(midi.listInputs());
            setMidiDeviceId(midi.getSelectedDeviceId());
          });
        } else {
          pad.start();
        }
        return mode;
      });
    },
    [pad, midi, gamepad],
  );

  const setGamepadStickMode = useCallback(
    (m: StickMode) => {
      gamepad.setStickMode(m);
      setGamepadStickModeState(m);
      setLayoutTick((t) => t + 1);
    },
    [gamepad],
  );

  const selectMidiDevice = useCallback(
    (id: string | null) => {
      midi.selectDevice(id);
      setMidiDeviceId(id);
      setMidiInputs(midi.listInputs());
    },
    [midi],
  );

  const armMidiLearn = useCallback(
    (armed: boolean) => {
      midi.armLearn(armed);
      setMidiLearnArmed(armed);
    },
    [midi],
  );

  const clearMidiBinding = useCallback(
    (i: number) => {
      midi.clearBinding(i);
      setMidiBindings([...midi.getBindings()]);
      setLayoutTick((t) => t + 1);
    },
    [midi],
  );
  const clearMidiBindings = useCallback(() => {
    midi.clearAllBindings();
    setMidiBindings([]);
    setLayoutTick((t) => t + 1);
  }, [midi]);

  const pushPad = useCallback((x: number, y: number) => pad.pushAxes(x, y), [pad]);
  const onAction = useCallback((cb: (a: InputAction) => void) => layer.onAction(cb), [layer]);
  const onReducedInput = useCallback(
    (cb: (x: number, y: number) => void) => layer.onReducedInput(cb),
    [layer],
  );

  const sources: SourceView[] = useMemo(
    () =>
      ([pad, midi, gamepad] as InputSource[]).map((s) => ({
        kind: s.kind,
        label: s.label,
        enabled: MODE_SOURCE[inputMode] === s.kind,
        status: statuses[s.kind],
        axisCount: MODE_SOURCE[inputMode] === s.kind ? s.axisCount() : 0,
      })),
    // layoutTick forces recompute when axis counts shift (learn-map / stick mode).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputMode, statuses, layoutTick, pad, midi, gamepad],
  );

  const channelLayout = useMemo(
    () => layer.channelLayout(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutTick, inputMode],
  );

  return {
    pushPad,
    inputMode,
    setInputMode,
    sources,
    channelLayout,
    axisCount: channelLayout.length,
    engineInputSize: engine?.architecture.inputSize ?? 2,
    gamepadStickMode,
    setGamepadStickMode,
    midiInputs,
    midiDeviceId,
    selectMidiDevice,
    midiLearnArmed,
    armMidiLearn,
    midiBindings,
    clearMidiBinding,
    clearMidiBindings,
    onAction,
    onReducedInput,
  };
}
