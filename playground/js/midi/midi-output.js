// MIDI Output — sends CC messages to external MIDI devices
// Uses Web MIDI API, complementary to midi-input.js

export class MIDIOutput {
  constructor() {
    this.enabled = false;
    this.midiAccess = null;
    this.selectedOutputId = null;
    this.activeOutput = null;
    this._onStatusChange = null;
    this._onOutputsChange = null;
    this._boundOnStateChange = this._onStateChange.bind(this);

    // Throttling
    this._lastSentCC = new Map(); // key: `${channel}-${cc}` -> value
    this._lastSendTime = 0;
    this.sendInterval = 50; // ms — max ~20 sends/sec
    this.deadZone = 1; // skip if CC value hasn't changed by at least 1
  }

  set onStatusChange(fn) { this._onStatusChange = fn; }
  set onOutputsChange(fn) { this._onOutputsChange = fn; }

  _status(msg) {
    console.log('[MIDI Out]', msg);
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
      this._status('MIDI output available');
      return true;
    } catch (err) {
      this._status(`MIDI access denied: ${err.message}`);
      return false;
    }
  }

  /** Get list of available MIDI outputs as [{id, name}] */
  getOutputs() {
    if (!this.midiAccess) return [];
    const outputs = [];
    for (const [id, output] of this.midiAccess.outputs) {
      outputs.push({ id, name: output.name || `MIDI Output ${id}` });
    }
    return outputs;
  }

  /** Select a specific MIDI output by id */
  selectOutput(outputId) {
    this.selectedOutputId = outputId;
    this.activeOutput = null;
    this._lastSentCC.clear();

    if (!this.midiAccess || !outputId) return;
    const output = this.midiAccess.outputs.get(outputId);
    if (output) {
      this.activeOutput = output;
      this._status(`Selected: ${output.name}`);
    }
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this._status('MIDI output enabled');
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this._status('MIDI output disabled');
  }

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  }

  /**
   * Send a CC message. channel is 1-16, cc is 0-127, value is 0-127.
   * Applies dead-zone filtering (skips if value unchanged).
   */
  sendCC(channel, cc, value) {
    if (!this.enabled || !this.activeOutput) return;

    const ch = Math.max(0, Math.min(15, (channel - 1) | 0));
    const ccNum = Math.max(0, Math.min(127, cc | 0));
    const val = Math.max(0, Math.min(127, value | 0));

    // Dead-zone filter
    const key = `${ch}-${ccNum}`;
    const lastVal = this._lastSentCC.get(key);
    if (lastVal !== undefined && Math.abs(val - lastVal) < this.deadZone) return;

    this._lastSentCC.set(key, val);
    this.activeOutput.send([0xB0 | ch, ccNum, val]);
  }

  /**
   * Send multiple CC values at once (throttled).
   * @param {Array<{channel: number, cc: number, value: number}>} messages
   */
  sendBatch(messages) {
    if (!this.enabled || !this.activeOutput) return;

    const now = performance.now();
    if (now - this._lastSendTime < this.sendInterval) return;
    this._lastSendTime = now;

    for (const msg of messages) {
      this.sendCC(msg.channel, msg.cc, msg.value);
    }
  }

  _onStateChange(e) {
    this._onOutputsChange?.(this.getOutputs());
    // Reconnect if selected device was re-plugged
    if (this.selectedOutputId && this.enabled) {
      const output = this.midiAccess.outputs.get(this.selectedOutputId);
      if (output) {
        this.activeOutput = output;
      } else {
        this.activeOutput = null;
      }
    }
  }

  destroy() {
    this.disable();
    if (this.midiAccess) {
      this.midiAccess.onstatechange = null;
    }
    this.midiAccess = null;
    this.activeOutput = null;
  }
}
