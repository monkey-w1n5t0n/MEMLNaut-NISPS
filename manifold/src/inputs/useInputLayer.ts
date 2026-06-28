/**
 * useInputLayer — the thin React binding over the framework-neutral
 * {@link InputLayer} + source adapters.
 *
 * Owns:
 *   - ONE InputLayer + one instance of each source (XY pad / MIDI / gamepad),
 *     created per engine and attached to it.
 *   - Which sources are ENABLED (the dock toggles these); enabling starts a
 *     source (async for MIDI) and adds it to the layer's composed set.
 *   - Per-source config (gamepad stick mode; MIDI learn arm + bindings).
 *   - The composed channel layout + per-source status, surfaced for the drawer.
 *
 * The XY pad source is the one consumers push into directly: `pushPad(x,y)` is
 * called from ConsoleApp.onMove so the existing pad keeps working unchanged
 * while still composing with the other sources.
 *
 * Discrete actions (MIDI notes / gamepad buttons) are fanned out via
 * `onAction` so the console can later bind them to verdicts (commit/perturb).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EngineApi } from '../engine';
import { InputLayer } from './input-layer';
import { XYPadSource } from './xy-pad-source';
import { WebMidiInputSource, type MidiBinding } from './midi-input-source';
import { GamepadSource, type StickMode } from './gamepad-source';
import type { InputAction, InputSource, InputSourceKind, InputSourceStatus } from './types';

export interface SourceView {
  kind: InputSourceKind;
  label: string;
  enabled: boolean;
  status: InputSourceStatus;
  axisCount: number;
}

export interface UseInputLayer {
  /** Push the on-screen XY pad position (∈ [0,1]) — call from onMove. */
  pushPad: (x: number, y: number) => void;
  /** Per-source enable + status + axis count for the dock. */
  sources: SourceView[];
  /** Toggle a source on/off. */
  setEnabled: (kind: InputSourceKind, enabled: boolean) => void;
  /** Composed channel layout (per-axis source+label). */
  channelLayout: { source: string; label: string }[];
  /** Total composed axis count. */
  axisCount: number;
  /** Engine input arity (the fixed WASM head = 2). */
  engineInputSize: number;

  // ---- gamepad config ----
  gamepadStickMode: StickMode;
  setGamepadStickMode: (m: StickMode) => void;

  // ---- midi learn-map ----
  midiLearnArmed: boolean;
  armMidiLearn: (armed: boolean) => void;
  midiBindings: MidiBinding[];
  clearMidiBinding: (i: number) => void;
  clearMidiBindings: () => void;
  midiInputs: { id: string; name: string }[];

  /** Subscribe to discrete actions (notes/buttons). */
  onAction: (cb: (a: InputAction) => void) => () => void;
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

  // Enabled set — pad on by default (parity with today's behaviour).
  const [enabled, setEnabledSet] = useState<Record<InputSourceKind, boolean>>({
    'xy-pad': true,
    midi: false,
    gamepad: false,
  });
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

  // Attach to engine; start the pad immediately. Wire status/binding listeners.
  useEffect(() => {
    if (!engine) return;
    layer.attach(engine);
    pad.start();
    layer.setSources([pad]);
    layer.start();

    const unsubs: (() => void)[] = [];
    const wireStatus = (s: InputSource) =>
      unsubs.push(
        s.onStatusChange((st) => setStatuses((m) => ({ ...m, [s.kind]: st }))),
      );
    wireStatus(pad);
    wireStatus(midi);
    wireStatus(gamepad);
    unsubs.push(layer.onLayoutChange(() => setLayoutTick((t) => t + 1)));
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

  // Recompose the active source set whenever the enabled set changes.
  useEffect(() => {
    const active: InputSource[] = [];
    if (enabled['xy-pad']) active.push(pad);
    if (enabled.midi) active.push(midi);
    if (enabled.gamepad) active.push(gamepad);
    layer.setSources(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const setEnabled = useCallback(
    (kind: InputSourceKind, on: boolean) => {
      setEnabledSet((m) => ({ ...m, [kind]: on }));
      if (kind === 'midi') {
        if (on) {
          void midi.start().then(() => setMidiInputs(midi.listInputs()));
        } else {
          void midi.stop();
        }
      } else if (kind === 'gamepad') {
        if (on) gamepad.start();
        else gamepad.stop();
      } else if (kind === 'xy-pad') {
        if (on) pad.start();
        else pad.stop();
      }
    },
    [midi, gamepad, pad],
  );

  const setGamepadStickMode = useCallback(
    (m: StickMode) => {
      gamepad.setStickMode(m);
      setGamepadStickModeState(m);
      setLayoutTick((t) => t + 1);
    },
    [gamepad],
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

  const sources: SourceView[] = useMemo(
    () =>
      ([pad, midi, gamepad] as InputSource[]).map((s) => ({
        kind: s.kind,
        label: s.label,
        enabled: enabled[s.kind],
        status: statuses[s.kind],
        axisCount: enabled[s.kind] ? s.axisCount() : 0,
      })),
    // layoutTick forces recompute when axis counts shift (learn-map / stick mode).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, statuses, layoutTick, pad, midi, gamepad],
  );

  const channelLayout = useMemo(
    () => layer.channelLayout(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutTick, enabled],
  );

  return {
    pushPad,
    sources,
    setEnabled,
    channelLayout,
    axisCount: channelLayout.length,
    engineInputSize: engine?.architecture.inputSize ?? 2,
    gamepadStickMode,
    setGamepadStickMode,
    midiLearnArmed,
    armMidiLearn,
    midiBindings,
    clearMidiBinding,
    clearMidiBindings,
    midiInputs,
    onAction,
  };
}
