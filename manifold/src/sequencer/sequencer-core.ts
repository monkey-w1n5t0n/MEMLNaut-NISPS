/**
 * Worker-independent sequencer engine: tempo clock state, generator stepping,
 * parameter smoothing and note on/off bookkeeping. The clock worker only feeds
 * it time and messages, so all of this is testable without a Worker.
 */
import { GENERATORS } from './generators';
import {
  DEFAULT_SEQUENCER_SETTINGS,
  SEQ_SLOTS,
  type GeneratorState,
  type SequencerSettings,
} from './types';

export interface NoteSink {
  noteOn(note: number, velocity: number): unknown;
  noteOff(note: number): unknown;
}

export interface StepReport {
  index: number;
  note: number | null;
  velocity: number;
  gate: number;
}

const SMOOTH_MS = 250;
const RESYNC_MS = 1000;

export class SequencerCore {
  private settings: SequencerSettings = { ...DEFAULT_SEQUENCER_SETTINGS };
  private gen: GeneratorState;
  private readonly target = new Float32Array(SEQ_SLOTS).fill(0.5);
  private readonly smooth = new Float32Array(SEQ_SLOTS).fill(0.5);
  private gotParams = false;
  private running = false;
  private index = 0;
  private nextStep = 0;
  private lastSmooth = 0;
  private held = -1;
  private offAt = Infinity;

  constructor(
    private readonly sink: NoteSink,
    private readonly report: (r: StepReport) => void = () => {},
  ) {
    this.gen = GENERATORS[this.settings.generator].create(this.settings.seed);
  }

  setSettings(next: SequencerSettings): void {
    const prev = this.settings;
    this.settings = { ...next };
    if (
      next.generator !== prev.generator ||
      next.seed !== prev.seed ||
      next.steps !== prev.steps
    ) {
      this.releaseHeld();
      this.gen = GENERATORS[next.generator].create(next.seed);
      this.index = 0;
    }
  }

  setParams(p: ArrayLike<number>): void {
    for (let i = 0; i < SEQ_SLOTS; i++) this.target[i] = i < p.length ? p[i] : 0.5;
    if (!this.gotParams) {
      this.smooth.set(this.target);
      this.gotParams = true;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  start(now: number): void {
    if (this.running) return;
    this.running = true;
    this.index = 0;
    this.nextStep = now;
    this.lastSmooth = now;
  }

  stop(): void {
    this.running = false;
    this.releaseHeld();
  }

  /**
   * Fire everything due at `now` (note-offs and steps, in time order).
   * Returns the absolute time of the next event, or Infinity when stopped.
   */
  pump(now: number): number {
    if (!this.running) return Infinity;
    if (now - this.nextStep > RESYNC_MS) this.nextStep = now; // tab was throttled
    for (let guard = 0; guard < 64; guard++) {
      if (this.offAt <= now && this.offAt <= this.nextStep) this.releaseHeld();
      else if (this.nextStep <= now) this.fireStep();
      else break;
    }
    return Math.min(this.offAt, this.nextStep);
  }

  private fireStep(): void {
    const t = this.nextStep;
    const a = 1 - Math.exp(-Math.max(0, t - this.lastSmooth) / SMOOTH_MS);
    this.lastSmooth = t;
    for (let i = 0; i < SEQ_SLOTS; i++) this.smooth[i] += (this.target[i] - this.smooth[i]) * a;

    const s = this.settings;
    const stepMs = 60000 / s.bpm / 4;
    const ev = this.gen.step(this.index, this.smooth, s);
    this.releaseHeld();
    if (ev.note !== null) {
      this.sink.noteOn(ev.note, ev.velocity);
      this.held = ev.note;
      this.offAt = t + ev.gate * stepMs;
    }
    this.report({ index: this.index, note: ev.note, velocity: ev.velocity, gate: ev.gate });
    this.index++;
    this.nextStep = t + stepMs;
  }

  private releaseHeld(): void {
    if (this.held >= 0) this.sink.noteOff(this.held);
    this.held = -1;
    this.offAt = Infinity;
  }
}
