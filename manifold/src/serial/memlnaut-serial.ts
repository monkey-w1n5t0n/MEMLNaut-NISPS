/**
 * memlnaut-serial.ts — Web Serial API scaffold for the MEMLNaut Editor mode.
 *
 * STUB FOR NOW. This wires the browser ⇄ MEMLNaut-over-USB connection lifecycle
 * (feature-detect, user-gated connect, disconnect) but the on-the-wire PROTOCOL
 * is not implemented — saveModel / restoreModel / getSettings are clearly-marked
 * TODOs returning placeholders. Do NOT auto-connect; `connect()` must be called
 * from a user gesture (browser requirement for `navigator.serial.requestPort`).
 *
 * British spelling in copy. ES-module only; no React.
 *
 * The minimal Web Serial ambient types live in ./web-serial.d.ts (the API is not
 * in older lib.dom). We feature-detect at runtime regardless.
 */

export type SerialConnectionStatus =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface SerialState {
  status: SerialConnectionStatus;
  /** Last human-readable status / error message (British spelling). */
  message: string;
}

/** Feature-detect the Web Serial API in this browser. */
export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * MemlnautSerial — owns one serial port lifecycle. Framework-neutral: emits a
 * state object on every change; the React panel subscribes.
 */
export class MemlnautSerial {
  private port: SerialPort | null = null;
  private state: SerialState;
  private listeners = new Set<(s: SerialState) => void>();

  constructor() {
    this.state = isWebSerialSupported()
      ? { status: 'disconnected', message: 'Not connected.' }
      : { status: 'unsupported', message: 'Web Serial is not available in this browser.' };
  }

  getState(): SerialState {
    return this.state;
  }

  subscribe(cb: (s: SerialState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setState(patch: Partial<SerialState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /**
   * Request + open a serial port. MUST be invoked from a user click (browser
   * gates `requestPort` behind a user gesture). Does NOT auto-connect.
   */
  async connect(): Promise<void> {
    if (!isWebSerialSupported()) {
      this.setState({ status: 'unsupported', message: 'Web Serial is not available in this browser.' });
      return;
    }
    if (this.state.status === 'connecting' || this.state.status === 'connected') return;
    try {
      this.setState({ status: 'connecting', message: 'Requesting a serial port…' });
      const port = await navigator.serial.requestPort();
      // TODO(memlnaut-serial): negotiate the real baud rate / handshake once the
      // firmware USB-serial protocol is defined. 115200 8N1 is a placeholder.
      await port.open({ baudRate: 115200 });
      this.port = port;
      this.setState({ status: 'connected', message: 'Connected to MEMLNaut over USB serial.' });
    } catch (err) {
      // A user cancelling the port picker also lands here (NotFoundError).
      const msg = err instanceof Error ? err.message : 'Connection failed.';
      this.setState({
        status: this.port ? 'connected' : 'disconnected',
        message: msg.includes('No port selected') ? 'No port selected.' : msg,
      });
    }
  }

  /** Close the serial port and return to disconnected. */
  async disconnect(): Promise<void> {
    try {
      if (this.port) await this.port.close();
    } catch {
      /* ignore close errors */
    }
    this.port = null;
    this.setState({ status: 'disconnected', message: 'Disconnected.' });
  }

  // ---- Protocol stubs — TODO: implement the real MEMLNaut USB protocol -----

  /**
   * Save the current in-browser model TO the MEMLNaut hardware.
   * TODO(memlnaut-serial): frame + write the weight blob over the serial port
   * once the firmware command protocol exists. No-op placeholder for now.
   */
  async saveModel(_weights: Float32Array): Promise<boolean> {
    // TODO: real protocol. Returns false to signal "not yet wired".
    return false;
  }

  /**
   * Restore a model FROM the MEMLNaut hardware into the browser.
   * TODO(memlnaut-serial): request + read the weight blob over serial. Returns
   * null until the protocol is implemented.
   */
  async restoreModel(): Promise<Float32Array | null> {
    // TODO: real protocol.
    return null;
  }

  /**
   * Read device settings from the MEMLNaut.
   * TODO(memlnaut-serial): query firmware config over serial. Returns an empty
   * record until the protocol is implemented.
   */
  async getSettings(): Promise<Record<string, unknown>> {
    // TODO: real protocol.
    return {};
  }
}

/** Lazily-created shared instance (one editor connection per session). */
let shared: MemlnautSerial | null = null;
export function getMemlnautSerial(): MemlnautSerial {
  if (!shared) shared = new MemlnautSerial();
  return shared;
}
