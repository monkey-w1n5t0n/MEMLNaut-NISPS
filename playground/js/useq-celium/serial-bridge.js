// UseqSerialBridge — WebSerial transport wrapper for uSEQ-Celium.
//
// Responsibilities:
//   - Open/close the USB CDC serial port to the uSEQ main firmware (115200 baud).
//   - Own a persistent writer so upstream packet producers can just `writePacket(bytes)`.
//   - Emit `connectionchange` events (EventTarget) so the adapter / UI can sync status.
//   - Handle graceful shutdown if the underlying port goes away unexpectedly.
//
// This file deliberately knows nothing about the packet format or the state
// producer cadence — those live in protocol.js and state-producer.js respectively.

export class UseqSerialBridge extends EventTarget {
  constructor() {
    super();
    this._port = null;
    this._writer = null;
    this._connected = false;
    // Tracks the most recent in-flight writePacket promise so callers (notably
    // adapter.panic()) can await drain via flush().
    this._currentWrite = null;
    // EXTENSION POINT (opus47): read-path is not wired yet. Later agents who
    // want FwHello / Ack / Reset need to add a reader loop here and emit
    // `packet` events with the parsed payload.
  }

  /**
   * Feature-detection. Called by the adapter/UI at construction time so the
   * Connect button can be disabled on browsers without WebSerial.
   * @returns {boolean}
   */
  static isSupported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  get connected() {
    return this._connected;
  }

  /**
   * Prompt the user to pick a port, then open it at 115200 baud.
   * Rejects if the user cancels the picker or the open fails.
   */
  async connect() {
    if (this._connected) return;
    if (!UseqSerialBridge.isSupported()) {
      throw new Error('WebSerial not supported in this browser');
    }

    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200, bufferSize: 4096 });

    this._port = port;
    this._writer = port.writable.getWriter();
    this._connected = true;

    // Watch for unexpected port close (e.g. cable unplugged). Chrome resolves
    // port.closed when the underlying device goes away.
    if (port.closed && typeof port.closed.then === 'function') {
      port.closed
        .then(() => this._handleUnexpectedClose(null))
        .catch((err) => this._handleUnexpectedClose(err));
    }

    this._emitConnectionChange(true);
  }

  /**
   * Stop writing, release the writer, and close the port. Idempotent.
   */
  async disconnect() {
    if (!this._connected) return;

    const port = this._port;
    const writer = this._writer;

    this._writer = null;
    this._port = null;
    this._connected = false;

    if (writer) {
      try {
        await writer.close();
      } catch (err) {
        // Port may already be closing from the other side — log and continue.
        console.warn('[UseqSerialBridge] writer.close() failed:', err);
      }
      try {
        writer.releaseLock();
      } catch (_) {
        /* already released */
      }
    }

    if (port) {
      try {
        await port.close();
      } catch (err) {
        console.warn('[UseqSerialBridge] port.close() failed:', err);
      }
    }

    this._emitConnectionChange(false);
  }

  /**
   * Write a raw byte packet to the port. Awaits the writer so backpressure
   * propagates naturally — callers that want to drop on overflow should
   * manage their own cadence.
   *
   * Throws if the port is not connected so the caller (StateProducer)
   * can count failures and back off.
   *
   * @param {Uint8Array} bytes
   * @returns {Promise<void>}
   */
  async writePacket(bytes) {
    if (!this._connected || !this._writer) {
      throw new Error('UseqSerialBridge: not connected');
    }
    const p = this._writer.write(bytes);
    this._currentWrite = p;
    try {
      await p;
    } finally {
      // Only clear if we're still the latest write; otherwise a newer write
      // already overwrote _currentWrite and we shouldn't stomp on it.
      if (this._currentWrite === p) this._currentWrite = null;
    }
  }

  /**
   * Resolve when no writePacket is currently in flight. Used by the adapter's
   * panic path to ensure no producer-issued packet lands AFTER a panic-issued
   * zero packet. Resolves immediately when nothing is pending.
   *
   * @returns {Promise<void>}
   */
  async flush() {
    const pending = this._currentWrite;
    if (!pending) return;
    try { await pending; } catch { /* swallow — caller cares about ordering, not result */ }
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  _emitConnectionChange(connected) {
    this.dispatchEvent(new CustomEvent('connectionchange', {
      detail: { connected },
    }));
  }

  _handleUnexpectedClose(err) {
    if (!this._connected) return; // we closed on purpose
    console.warn('[UseqSerialBridge] port closed unexpectedly:', err);
    this._writer = null;
    this._port = null;
    this._connected = false;
    this._emitConnectionChange(false);
  }
}
