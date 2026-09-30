/**
 * Virtual clock for the ML lab. Implements the FeedbackController's scheduler
 * seam (src/feedback/controller.ts `FeedbackScheduler`) so the geometric
 * replay timer — `setInterval` + wall-clock `dt` in production — runs in
 * simulated time: deterministically, and as fast as the CPU allows.
 *
 * `advance(ms)` walks time forward and fires every due interval in time
 * order, exactly as the browser would have fired them over that span.
 */
import type { FeedbackScheduler } from '../feedback/controller';

interface Timer {
  id: number;
  fn: () => void;
  every: number;
  next: number;
}

export class VirtualClock implements FeedbackScheduler {
  private t = 0;
  private seq = 1;
  private timers = new Map<number, Timer>();

  now(): number {
    return this.t;
  }

  setInterval(fn: () => void, ms: number): unknown {
    const every = Math.max(1, ms);
    const id = this.seq++;
    this.timers.set(id, { id, fn, every, next: this.t + every });
    return id;
  }

  clearInterval(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Advance simulated time by `ms`, firing due intervals in order. */
  advance(ms: number): void {
    const end = this.t + Math.max(0, ms);
    for (;;) {
      let due: Timer | null = null;
      for (const tm of this.timers.values()) {
        if (tm.next <= end && (!due || tm.next < due.next || (tm.next === due.next && tm.id < due.id))) due = tm;
      }
      if (!due) break;
      this.t = due.next;
      due.next += due.every;
      due.fn(); // may clear itself or add timers
    }
    this.t = end;
  }

  /** Number of live intervals (the replay timer stops itself when idle). */
  get pending(): number {
    return this.timers.size;
  }
}
