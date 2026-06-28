/**
 * useBackendManager — the thin React binding over the framework-neutral
 * {@link BackendManager}. It:
 *
 *   - creates ONE BackendManager per engine (the manager subscribes to the
 *     spine and forwards routed → active backend);
 *   - rebuilds the BackendContext (per-output baseline mappings + names) from
 *     the live MFParam store whenever it changes, and pushes it to the manager;
 *   - switches the active backend when the dock Mode (→ BackendId) changes
 *     (which also applies the synth audio mute gate);
 *   - pushes the per-backend config (MIDI port/cc map; OSC bridge/specs) down;
 *   - surfaces the active backend's status for the Outputs panel.
 *
 * Returns the live manager + status so the Outputs drawer can render
 * specialised, editable per-backend config.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineApi } from '../engine';
import type { MFParam } from '../console/model';
import type { BackendContext, BackendStatus, OutputMapping } from './backend';
import type { BackendId, CvSpec, MidiCcSpec, OscSpec, VcvSpec } from '../dock/output-state';
import { defaultCvSpec, defaultMidiSpec, defaultOscSpec, defaultVcvSpec } from '../dock/output-state';
import { BackendManager } from './manager';

export interface MidiSettings {
  outputId: string | null;
  ccCount: number;
}

export interface OscSettings {
  url: string;
  sendRaw: boolean;
}

export interface VcvSettings {
  /** Bridge WebSocket URL (the Deno bridge relays to the module over UDP). */
  url: string;
  /** Send raw 0..1 instead of the per-output bipolar/unipolar voltage range. */
  sendRaw: boolean;
}

function toMapping(p: MFParam): OutputMapping {
  return {
    state: p.status,
    muted: p.muted ?? false,
    min: p.min,
    max: p.max,
    curve: p.curve,
    fixedValue: p.val,
  };
}

export interface UseBackendManager {
  manager: BackendManager | null;
  status: BackendStatus;
  /** Available MIDI output ports (refreshes when MIDI starts/hot-plugs). */
  midiPorts: { id: string; name: string }[];
  refreshMidiPorts: () => void;
  /** uSEQ CV backend: pick + open a serial port (user gesture). */
  cvConnect: () => void;
  /** uSEQ CV backend: flash the module LEDs to confirm the link. */
  cvIdentify: () => void;
  /** uSEQ CV backend: close the serial port. */
  cvDisconnect: () => void;
}

export function useBackendManager(
  engine: EngineApi | null,
  backendId: BackendId,
  modeId: string,
  params: MFParam[],
  midiSettings: MidiSettings,
  oscSettings: OscSettings,
  vcvSettings: VcvSettings,
): UseBackendManager {
  const managerRef = useRef<BackendManager | null>(null);
  const [status, setStatus] = useState<BackendStatus>({ state: 'idle', message: 'idle' });
  const [midiPorts, setMidiPorts] = useState<{ id: string; name: string }[]>([]);

  // One manager per engine.
  if (engine && !managerRef.current) {
    managerRef.current = new BackendManager(engine);
  }
  const manager = managerRef.current;

  useEffect(() => {
    return () => {
      managerRef.current?.dispose();
      managerRef.current = null;
    };
  }, []);

  // Status wiring.
  useEffect(() => {
    if (!manager) return;
    setStatus(manager.status());
    return manager.onStatusChange((id, s) => {
      if (id === manager.getActiveId()) setStatus(s);
    });
  }, [manager]);

  // Build the BackendContext from the live params.
  const ctx: BackendContext = useMemo(
    () => ({
      modeId,
      outputCount: params.length,
      mappings: params.map(toMapping),
      names: params.map((p) => p.name),
    }),
    [modeId, params],
  );

  useEffect(() => {
    manager?.setContext(ctx);
  }, [manager, ctx]);

  // Switch the active backend on Mode change (applies the audio gate).
  useEffect(() => {
    if (!manager) return;
    manager.setContext(ctx);
    void manager.setActive(backendId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager, backendId]);

  // Push per-output MIDI config + port/ccCount whenever they change.
  const refreshMidiPorts = () => {
    const midi = manager?.midi();
    if (midi) setMidiPorts(midi.listOutputs());
  };
  useEffect(() => {
    const midi = manager?.midi();
    if (!midi) return;
    const specs: MidiCcSpec[] = params.map((p, i) => p.midi ?? defaultMidiSpec(i));
    midi.setMidiConfig(specs, {
      outputId: midiSettings.outputId,
      ccCount: midiSettings.ccCount,
    });
    setMidiPorts(midi.listOutputs());
  }, [manager, params, midiSettings.outputId, midiSettings.ccCount, status.state]);

  // Push per-output OSC config + bridge URL/raw whenever they change.
  useEffect(() => {
    const osc = manager?.osc();
    if (!osc) return;
    const specs: OscSpec[] = params.map((p) => p.osc ?? defaultOscSpec(p.name));
    osc.setOscConfig(specs, { url: oscSettings.url, sendRaw: oscSettings.sendRaw });
  }, [manager, params, oscSettings.url, oscSettings.sendRaw]);

  // Push per-output VCV config (polarity) + bridge URL/raw whenever they change.
  useEffect(() => {
    const vcv = manager?.vcv();
    if (!vcv) return;
    const specs: VcvSpec[] = params.map((p) => p.vcv ?? defaultVcvSpec());
    vcv.setVcvConfig(specs, { url: vcvSettings.url, sendRaw: vcvSettings.sendRaw });
  }, [manager, params, vcvSettings.url, vcvSettings.sendRaw]);

  // Push per-output uSEQ CV config (channel + gate threshold) whenever it changes.
  useEffect(() => {
    const cv = manager?.cv();
    if (!cv) return;
    const specs: CvSpec[] = params.map((p, i) => (p.cv as CvSpec | undefined) ?? defaultCvSpec(i));
    cv.setCvConfig(specs);
  }, [manager, params]);

  const cvConnect = () => void manager?.cv()?.connect();
  const cvIdentify = () => manager?.cv()?.identify();
  const cvDisconnect = () => void manager?.cv()?.disconnect();

  return { manager, status, midiPorts, refreshMidiPorts, cvConnect, cvIdentify, cvDisconnect };
}
