/**
 * WebSerial driver for uSEQ hardware communication.
 * Sends binary output frames at 100Hz and receives input readings.
 * Pure browser APIs, no external dependencies.
 */

const SYNC_TX = 0xaa;
const SYNC_RX = 0xbb;
const MSG_OUTPUT_VALUES = 0x01;
const MSG_CONFIG = 0x02;
const MSG_INPUT_READINGS = 0x01;

const NUM_OUTPUTS = 14;
const OUTPUT_MAX = 2047; // 11-bit PWM
const INPUT_MAX = 4095; // 12-bit ADC
const TX_FRAME_SIZE = 31;
const CONFIG_FRAME_SIZE = 5;
const RX_FRAME_SIZE = 11;
const STREAM_INTERVAL_MS = 10; // 100Hz

function xorChecksum(buffer, start, end) {
  let xor = 0;
  for (let i = start; i <= end; i++) {
    xor ^= buffer[i];
  }
  return xor;
}

export class UseqSerialDriver {
  #port = null;
  #reader = null;
  #writer = null;
  #readLoopPromise = null;
  #streamInterval = null;
  #connected = false;
  #inputCallbacks = [];
  #connectionCallbacks = [];

  // Double buffer for output values to avoid tearing
  #outputBufferA = new Uint16Array(NUM_OUTPUTS);
  #outputBufferB = new Uint16Array(NUM_OUTPUTS);
  #activeBuffer = 'A'; // sendFrame reads from this
  #disconnectController = null;

  constructor() {}

  get connected() {
    return this.#connected;
  }

  async connect(baudRate = 115200) {
    if (this.#connected) return true;

    try {
      this.#port = await navigator.serial.requestPort();
      await this.#port.open({ baudRate });

      this.#writer = this.#port.writable.getWriter();
      this.#connected = true;
      this.#notifyConnectionChange(true);

      // Start read loop
      this.#disconnectController = new AbortController();
      this.#readLoopPromise = this.#readLoop();

      // Listen for USB disconnect
      navigator.serial.addEventListener('disconnect', this.#handleDisconnect);

      return true;
    } catch (err) {
      console.error('[UseqSerialDriver] connect failed:', err);
      this.#connected = false;
      this.#notifyConnectionChange(false);
      return false;
    }
  }

  async disconnect() {
    if (!this.#connected) return;

    this.stopStreaming();
    this.#connected = false;

    // Abort the read loop
    if (this.#disconnectController) {
      this.#disconnectController.abort();
    }

    try {
      if (this.#reader) {
        await this.#reader.cancel();
        this.#reader.releaseLock();
        this.#reader = null;
      }
    } catch (_) {}

    try {
      if (this.#writer) {
        this.#writer.releaseLock();
        this.#writer = null;
      }
    } catch (_) {}

    try {
      if (this.#port) {
        await this.#port.close();
        this.#port = null;
      }
    } catch (_) {}

    navigator.serial.removeEventListener('disconnect', this.#handleDisconnect);
    this.#notifyConnectionChange(false);
  }

  startStreaming() {
    if (this.#streamInterval !== null) return;
    this.#streamInterval = setInterval(() => this.#sendFrame(), STREAM_INTERVAL_MS);
  }

  stopStreaming() {
    if (this.#streamInterval !== null) {
      clearInterval(this.#streamInterval);
      this.#streamInterval = null;
    }
  }

  /**
   * Set output values. Called by the output router before each frame.
   * @param {Float32Array|number[]} values - 14 floats normalized 0-1
   */
  setOutputValues(values) {
    // Write to the inactive buffer, then swap
    const target = this.#activeBuffer === 'A' ? this.#outputBufferB : this.#outputBufferA;
    for (let i = 0; i < NUM_OUTPUTS; i++) {
      const clamped = Math.max(0, Math.min(1, values[i] || 0));
      target[i] = Math.round(clamped * OUTPUT_MAX);
    }
    // Swap active buffer
    this.#activeBuffer = this.#activeBuffer === 'A' ? 'B' : 'A';
  }

  /**
   * Send config frame with output mode bitmask.
   * @param {number} modeBitmask - 14-bit number, bit=1 means gate
   */
  async sendConfig(modeBitmask) {
    if (!this.#connected || !this.#writer) return;

    const frame = new Uint8Array(CONFIG_FRAME_SIZE);
    frame[0] = SYNC_TX;
    frame[1] = MSG_CONFIG;
    frame[2] = modeBitmask & 0xff;
    frame[3] = (modeBitmask >> 8) & 0xff;
    frame[4] = xorChecksum(frame, 1, 3);

    try {
      await this.#writer.write(frame);
    } catch (err) {
      console.error('[UseqSerialDriver] sendConfig failed:', err);
    }
  }

  /**
   * Register callback for input readings.
   * @param {function} callback - Called with { i1, i2, ai1, ai2 } normalized 0-1
   */
  onInputs(callback) {
    this.#inputCallbacks.push(callback);
  }

  /**
   * Register callback for connection state changes.
   * @param {function} callback - Called with boolean connected state
   */
  onConnectionChange(callback) {
    this.#connectionCallbacks.push(callback);
  }

  // --- Private methods ---

  #sendFrame() {
    if (!this.#connected || !this.#writer) return;

    const buffer = this.#activeBuffer === 'A' ? this.#outputBufferA : this.#outputBufferB;
    const frame = new Uint8Array(TX_FRAME_SIZE);

    frame[0] = SYNC_TX;
    frame[1] = MSG_OUTPUT_VALUES;

    for (let i = 0; i < NUM_OUTPUTS; i++) {
      const offset = 2 + i * 2;
      frame[offset] = buffer[i] & 0xff;
      frame[offset + 1] = (buffer[i] >> 8) & 0xff;
    }

    frame[30] = xorChecksum(frame, 1, 29);

    this.#writer.write(frame).catch((err) => {
      console.error('[UseqSerialDriver] sendFrame failed:', err);
    });
  }

  async #readLoop() {
    const signal = this.#disconnectController?.signal;

    while (this.#connected) {
      try {
        this.#reader = this.#port.readable.getReader();
        const parseState = { state: 'SYNC', buffer: new Uint8Array(RX_FRAME_SIZE), pos: 0 };

        while (this.#connected) {
          if (signal?.aborted) return;

          const { value, done } = await this.#reader.read();
          if (done) break;

          this.#parseBytes(value, parseState);
        }
      } catch (err) {
        if (signal?.aborted) return;
        console.error('[UseqSerialDriver] read error:', err);
      } finally {
        try {
          this.#reader?.releaseLock();
        } catch (_) {}
        this.#reader = null;
      }

      // Small delay before retry if still connected
      if (this.#connected) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  #parseBytes(chunk, ctx) {
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];

      switch (ctx.state) {
        case 'SYNC':
          if (byte === SYNC_RX) {
            ctx.buffer[0] = byte;
            ctx.pos = 1;
            ctx.state = 'PAYLOAD';
          }
          break;

        case 'PAYLOAD':
          ctx.buffer[ctx.pos++] = byte;

          if (ctx.pos === RX_FRAME_SIZE) {
            // Validate message type
            if (ctx.buffer[1] === MSG_INPUT_READINGS) {
              const checksum = xorChecksum(ctx.buffer, 1, 9);
              if (checksum === ctx.buffer[10]) {
                this.#dispatchInputs(ctx.buffer);
              }
            }
            ctx.state = 'SYNC';
            ctx.pos = 0;
          }
          break;
      }
    }
  }

  #dispatchInputs(frame) {
    const i1 = (frame[2] | (frame[3] << 8)) / INPUT_MAX;
    const i2 = (frame[4] | (frame[5] << 8)) / INPUT_MAX;
    const ai1 = (frame[6] | (frame[7] << 8)) / INPUT_MAX;
    const ai2 = (frame[8] | (frame[9] << 8)) / INPUT_MAX;

    const inputs = { i1, i2, ai1, ai2 };

    for (const cb of this.#inputCallbacks) {
      try {
        cb(inputs);
      } catch (err) {
        console.error('[UseqSerialDriver] input callback error:', err);
      }
    }
  }

  #handleDisconnect = (event) => {
    if (event.port === this.#port) {
      this.#connected = false;
      this.stopStreaming();
      this.#notifyConnectionChange(false);
    }
  };

  #notifyConnectionChange(state) {
    for (const cb of this.#connectionCallbacks) {
      try {
        cb(state);
      } catch (err) {
        console.error('[UseqSerialDriver] connection callback error:', err);
      }
    }
  }
}

export default UseqSerialDriver;
