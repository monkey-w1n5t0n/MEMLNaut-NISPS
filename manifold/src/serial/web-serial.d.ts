/**
 * Minimal ambient Web Serial API types — the API is not in older lib.dom, so we
 * declare just the surface memlnaut-serial.ts uses. Replace with the official
 * @types once the project's lib.dom includes Web Serial.
 *
 * Spec: https://wicg.github.io/serial/
 */

interface SerialPortOpenOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}

interface SerialPort {
  open(options: SerialPortOpenOptions): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  addEventListener?(type: 'connect' | 'disconnect', listener: () => void): void;
  removeEventListener?(type: 'connect' | 'disconnect', listener: () => void): void;
}

interface SerialPortRequestOptions {
  filters?: { usbVendorId?: number; usbProductId?: number }[];
}

interface Serial {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  readonly serial: Serial;
}
