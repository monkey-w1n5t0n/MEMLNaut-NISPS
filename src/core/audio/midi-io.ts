/**
 * midi-io.ts — Merged MIDI I/O module.
 *
 * Wraps the Web MIDI API to provide:
 *   - Device enumeration (inputs + outputs)
 *   - Input device selection with note-on / CC callbacks
 *   - Output device selection with CC send (dead-zone filtered, throttled)
 *   - Single `requestAccess()` call shared between both directions
 *
 * Usage:
 *   const io = createMidiIO();
 *   const ok = await io.requestAccess();
 *   if (ok) {
 *     io.selectOutputDevice(io.getOutputDevices()[0].id);
 *     io.onNoteOn((note, vel) => synth.noteOn(note, vel));
 *     io.onCC((cc, val) => handleCC(cc, val));
 *     io.sendCC(1, 7, 100);
 *   }
 *   // Later:
 *   io.dispose();
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MidiDeviceInfo {
  id: string;
  name: string;
}

export interface MidiIO {
  /** Request Web MIDI access. Returns true if granted. Safe to call multiple times. */
  requestAccess(): Promise<boolean>;

  /** List all currently available MIDI input devices. */
  getInputDevices(): MidiDeviceInfo[];

  /** List all currently available MIDI output devices. */
  getOutputDevices(): MidiDeviceInfo[];

  /**
   * Select the MIDI input device to listen on.
   * Pass null to listen on ALL available inputs.
   */
  selectInputDevice(id: string | null): void;

  /**
   * Select the MIDI output device for sendCC.
   * Pass null to deselect (sendCC becomes a no-op).
   */
  selectOutputDevice(id: string | null): void;

  /**
   * Send a single CC message.
   * channel is 1–16, cc is 0–127, value is 0–127 (integer, clamped).
   * No-op if no output device is selected or MIDI access was not granted.
   * Applies dead-zone filtering (skips if value unchanged by < deadZone).
   */
  sendCC(channel: number, cc: number, value: number): void;

  /**
   * Register a callback for Note On events from the selected input.
   * note is 0–127, velocity is 0–1 (normalised).
   * Only one callback is active at a time; calling again replaces the previous.
   */
  onNoteOn(callback: (note: number, velocity: number) => void): void;

  /**
   * Register a callback for Control Change events from the selected input.
   * cc is 0–127, value is 0–1 (normalised, i.e. raw MIDI / 127).
   * Only one callback is active at a time; calling again replaces the previous.
   */
  onCC(callback: (cc: number, value: number) => void): void;

  /**
   * Register a callback fired whenever the set of available input devices changes
   * (device plugged in or unplugged). Receives the updated device list.
   */
  onInputDevicesChange(callback: (devices: MidiDeviceInfo[]) => void): void;

  /**
   * Register a callback fired whenever the set of available output devices changes.
   */
  onOutputDevicesChange(callback: (devices: MidiDeviceInfo[]) => void): void;

  /** Release all Web MIDI listeners and clear internal state. */
  dispose(): void;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/** How many raw MIDI integer steps must change before we send again. */
const DEFAULT_DEAD_ZONE = 1;

export function createMidiIO(): MidiIO {
  let midiAccess: MIDIAccess | null = null;

  // Input state
  let selectedInputId: string | null = null;
  let _noteOnCb: ((note: number, velocity: number) => void) | null = null;
  let _ccCb: ((cc: number, value: number) => void) | null = null;
  let _inputsChangeCb: ((devices: MidiDeviceInfo[]) => void) | null = null;

  // Output state
  let selectedOutputId: string | null = null;
  let activeOutput: MIDIOutput | null = null;
  let _outputsChangeCb: ((devices: MidiDeviceInfo[]) => void) | null = null;

  // Dead-zone map: `${channel}-${cc}` → last sent integer value
  const lastSentCC = new Map<string, number>();

  // ── Helpers ──

  function listInputDevices(): MidiDeviceInfo[] {
    if (!midiAccess) return [];
    const out: MidiDeviceInfo[] = [];
    for (const [id, input] of midiAccess.inputs) {
      out.push({ id, name: input.name || `MIDI Input ${id}` });
    }
    return out;
  }

  function listOutputDevices(): MidiDeviceInfo[] {
    if (!midiAccess) return [];
    const out: MidiDeviceInfo[] = [];
    for (const [id, output] of midiAccess.outputs) {
      out.push({ id, name: output.name || `MIDI Output ${id}` });
    }
    return out;
  }

  function onMessage(e: MIDIMessageEvent): void {
    const [status, data1, data2] = e.data as unknown as [number, number, number];
    const type = status & 0xf0;

    switch (type) {
      case 0x90: // Note On
        if (data2 > 0) {
          _noteOnCb?.(data1, data2 / 127);
        }
        // Velocity-0 Note On = Note Off — we don't expose onNoteOff here
        break;

      case 0x80: // Note Off
        // No onNoteOff callback in this interface; ignored
        break;

      case 0xb0: // Control Change
        _ccCb?.(data1, data2 / 127);
        break;
    }
  }

  function disconnectAllInputs(): void {
    if (!midiAccess) return;
    for (const [, input] of midiAccess.inputs) {
      input.onmidimessage = null;
    }
  }

  function connectInputs(): void {
    if (!midiAccess) return;
    disconnectAllInputs();

    if (selectedInputId === null) {
      // Listen on all devices
      for (const [, input] of midiAccess.inputs) {
        input.onmidimessage = onMessage;
      }
    } else {
      const input = midiAccess.inputs.get(selectedInputId);
      if (input) input.onmidimessage = onMessage;
    }
  }

  function resolveOutputDevice(): void {
    activeOutput = null;
    if (!midiAccess || !selectedOutputId) return;
    activeOutput = midiAccess.outputs.get(selectedOutputId) ?? null;
  }

  function onStateChange(_e: MIDIConnectionEvent): void {
    // Notify listeners of device list changes
    _inputsChangeCb?.(listInputDevices());
    _outputsChangeCb?.(listOutputDevices());

    // Reconnect inputs (handles device re-plug)
    connectInputs();

    // Reconnect output if re-plugged
    resolveOutputDevice();
  }

  // ── Public API ──

  async function requestAccess(): Promise<boolean> {
    if (midiAccess) return true;

    if (!navigator.requestMIDIAccess) {
      console.warn('[MidiIO] Web MIDI not supported in this browser.');
      return false;
    }

    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      midiAccess.onstatechange = onStateChange;
      console.log('[MidiIO] MIDI access granted.');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MidiIO] MIDI access denied: ${msg}`);
      return false;
    }
  }

  function getInputDevices(): MidiDeviceInfo[] {
    return listInputDevices();
  }

  function getOutputDevices(): MidiDeviceInfo[] {
    return listOutputDevices();
  }

  function selectInputDevice(id: string | null): void {
    selectedInputId = id;
    connectInputs();
  }

  function selectOutputDevice(id: string | null): void {
    selectedOutputId = id;
    lastSentCC.clear();
    resolveOutputDevice();
    if (activeOutput) {
      console.log(`[MidiIO] Output selected: ${activeOutput.name}`);
    }
  }

  function sendCC(channel: number, cc: number, value: number): void {
    if (!activeOutput) return;

    const ch  = Math.max(0, Math.min(15, ((channel - 1) | 0)));
    const ccN = Math.max(0, Math.min(127, cc | 0));
    const val = Math.max(0, Math.min(127, value | 0));

    const key = `${ch}-${ccN}`;
    const last = lastSentCC.get(key);
    if (last !== undefined && Math.abs(val - last) < DEFAULT_DEAD_ZONE) return;

    lastSentCC.set(key, val);
    activeOutput.send([0xb0 | ch, ccN, val]);
  }

  function onNoteOn(callback: (note: number, velocity: number) => void): void {
    _noteOnCb = callback;
  }

  function onCC(callback: (cc: number, value: number) => void): void {
    _ccCb = callback;
  }

  function onInputDevicesChange(callback: (devices: MidiDeviceInfo[]) => void): void {
    _inputsChangeCb = callback;
  }

  function onOutputDevicesChange(callback: (devices: MidiDeviceInfo[]) => void): void {
    _outputsChangeCb = callback;
  }

  function dispose(): void {
    disconnectAllInputs();
    if (midiAccess) {
      midiAccess.onstatechange = null;
    }
    midiAccess = null;
    activeOutput = null;
    _noteOnCb = null;
    _ccCb = null;
    _inputsChangeCb = null;
    _outputsChangeCb = null;
    lastSentCC.clear();
  }

  return {
    requestAccess,
    getInputDevices,
    getOutputDevices,
    selectInputDevice,
    selectOutputDevice,
    sendCC,
    onNoteOn,
    onCC,
    onInputDevicesChange,
    onOutputDevicesChange,
    dispose,
  };
}
