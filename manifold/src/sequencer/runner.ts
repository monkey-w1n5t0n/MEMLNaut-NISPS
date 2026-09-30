/**
 * Main-thread handle for the sequencer clock worker. Degrades to a settings
 * holder with no audio in environments without Worker (bun test, SSR).
 */
import type { ClockMessage, ClockReply } from './clock-worker';
import {
  DEFAULT_SEQUENCER_SETTINGS,
  SEQ_SLOTS,
  type SequencerSettings,
} from './types';

export type StepListener = (step: Omit<ClockReply, 'type'>) => void;

export class SequencerRunner {
  private worker: Worker | null = null;
  private settings: SequencerSettings = { ...DEFAULT_SEQUENCER_SETTINGS };
  private readonly listeners = new Set<StepListener>();

  constructor(ring: SharedArrayBuffer) {
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./clock-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<ClockReply>) => {
        const { type: _t, ...step } = e.data;
        for (const cb of this.listeners) cb(step);
      };
      this.post({ type: 'init', ring });
      this.post({ type: 'settings', settings: this.settings });
    }
  }

  private post(m: ClockMessage): void {
    this.worker?.postMessage(m);
  }

  getSettings(): SequencerSettings {
    return { ...this.settings };
  }

  setSettings(partial: Partial<SequencerSettings>): void {
    const wasRunning = this.settings.running;
    this.settings = { ...this.settings, ...partial };
    this.post({ type: 'settings', settings: this.settings });
    if (this.settings.running !== wasRunning) this.post({ type: this.settings.running ? 'start' : 'stop' });
  }

  setParams(p: Float32Array): void {
    const copy = new Float32Array(SEQ_SLOTS).fill(0.5);
    copy.set(p.subarray(0, SEQ_SLOTS));
    this.post({ type: 'params', p: copy });
  }

  start(): void {
    this.setSettings({ running: true });
  }

  stop(): void {
    this.setSettings({ running: false });
  }

  onStep(cb: StepListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.post({ type: 'dispose' });
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
  }
}
