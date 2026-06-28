/**
 * BaseSource — shared status + action plumbing for InputSource adapters.
 * Subclasses implement axisCount/axisLabels/sample/start/stop.
 */
import type {
  InputAction,
  InputSource,
  InputSourceKind,
  InputSourceStatus,
} from './types';

export abstract class BaseSource implements InputSource {
  abstract readonly kind: InputSourceKind;
  abstract readonly label: string;

  protected statusState: InputSourceStatus;
  private statusListeners = new Set<(s: InputSourceStatus) => void>();
  private actionListeners = new Set<(a: InputAction) => void>();

  constructor(initial: InputSourceStatus = { state: 'idle', message: 'idle' }) {
    this.statusState = initial;
  }

  abstract axisCount(): number;
  abstract axisLabels(): string[];
  abstract sample(out: Float32Array, offset: number): number;
  abstract start(): Promise<void> | void;
  abstract stop(): Promise<void> | void;

  status(): InputSourceStatus {
    return this.statusState;
  }

  onStatusChange(cb: (s: InputSourceStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  onAction(cb: (a: InputAction) => void): () => void {
    this.actionListeners.add(cb);
    return () => {
      this.actionListeners.delete(cb);
    };
  }

  protected setStatus(s: InputSourceStatus): void {
    this.statusState = s;
    for (const cb of this.statusListeners) cb(s);
  }

  protected emitAction(a: InputAction): void {
    for (const cb of this.actionListeners) cb(a);
  }
}
