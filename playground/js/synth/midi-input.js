// MIDI Input — receives notes and CCs from external MIDI controllers
// Uses Web MIDI API, routes note on/off through a SynthEngine interface

export class MIDIInput {
  constructor(engine) {
    this.engine = engine;
    this.enabled = false;
    this.midiAccess = null;
    this.selectedInputId = null;
    this.activeInput = null;
    this._onStatusChange = null;
    this._onInputsChange = null;
    this._onCC = null;  // optional: (ccNumber, value01) => void
    this._boundOnMessage = this._onMessage.bind(this);
    this._boundOnStateChange = this._onStateChange.bind(this);
  }

  set onStatusChange(fn) { this._onStatusChange = fn; }
  set onInputsChange(fn) { this._onInputsChange = fn; }
  set onCC(fn) { this._onCC = fn; }

  /** Hot-swap the engine (e.g. when the user switches synth engines). */
  setEngine(engine) { this.engine = engine; }

  _status(msg) {
    console.log('[MIDI]', msg);
    this._onStatusChange?.(msg);
  }

  /** Request MIDI access. Returns true if available. */
  async init() {
    if (this.midiAccess) return true;

    if (!navigator.requestMIDIAccess) {
      this._status('Web MIDI not supported');
      return false;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this.midiAccess.onstatechange = this._boundOnStateChange;
      this._status('MIDI available');
      return true;
    } catch (err) {
      this._status(`MIDI access denied: ${err.message}`);
      return false;
    }
  }

  /** Get list of available MIDI inputs as [{id, name}] */
  getInputs() {
    if (!this.midiAccess) return [];
    const inputs = [];
    for (const [id, input] of this.midiAccess.inputs) {
      inputs.push({ id, name: input.name || `MIDI Input ${id}` });
    }
    return inputs;
  }

  /** Select a specific MIDI input by id, or null for all inputs */
  selectInput(inputId) {
    // Disconnect previous
    this._disconnectInput();

    this.selectedInputId = inputId;

    if (!this.enabled) return;
    this._connectInput();
  }

  /** Enable MIDI input routing to the synth */
  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this._connectInput();
    this._status('MIDI enabled');
  }

  /** Disable MIDI input routing */
  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this._disconnectInput();
    this._status('MIDI disabled');
  }

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }

  _connectInput() {
    if (!this.midiAccess || !this.enabled) return;

    if (this.selectedInputId === null) {
      // Listen on all inputs
      for (const [, input] of this.midiAccess.inputs) {
        input.onmidimessage = this._boundOnMessage;
      }
      this.activeInput = null;
    } else {
      const input = this.midiAccess.inputs.get(this.selectedInputId);
      if (input) {
        input.onmidimessage = this._boundOnMessage;
        this.activeInput = input;
      }
    }
  }

  _disconnectInput() {
    if (!this.midiAccess) return;
    for (const [, input] of this.midiAccess.inputs) {
      input.onmidimessage = null;
    }
    this.activeInput = null;
  }

  _onStateChange(e) {
    // MIDI device connected/disconnected
    this._onInputsChange?.(this.getInputs());

    if (this.enabled) {
      // Reconnect in case the selected device was re-plugged
      this._disconnectInput();
      this._connectInput();
    }
  }

  _onMessage(e) {
    const [status, data1, data2] = e.data;
    const type = status & 0xf0;

    switch (type) {
      case 0x90: // Note On
        if (data2 > 0) {
          this.engine.noteOn(data1, data2 / 127);
        } else {
          // Velocity 0 = note off
          this.engine.noteOff(data1);
        }
        break;

      case 0x80: // Note Off
        this.engine.noteOff(data1);
        break;

      case 0xb0: // Control Change
        this._onCC?.(data1, data2 / 127);
        break;
    }
  }

  destroy() {
    this.disable();
    if (this.midiAccess) {
      this.midiAccess.onstatechange = null;
    }
    this.midiAccess = null;
  }
}
