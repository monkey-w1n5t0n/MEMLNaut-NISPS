/**
 * ShapeSeq Clock Engine
 *
 * AudioContext-based lookahead scheduler that steps through a pattern
 * description, emitting seq.* events on the event bus with sample-accurate
 * timing.  Replaces the old setTimeout-based arpeggiator approach.
 *
 * Uses the standard Web Audio lookahead pattern:
 *   - setInterval (~25 ms) checks if events need scheduling in the next ~100 ms
 *   - Events scheduled via AudioContext.currentTime for sample-accurate timing
 *   - Visual updates decoupled from audio timing
 *
 * @module shapeseq/clock
 */

import { SEQ } from './event-bus.js';
import { validatePattern } from './pattern.js';

// ── Scheduling constants ──────────────────────────────────────────────

const LOOKAHEAD_MS   = 25;   // how often the timer fires (ms)
const SCHEDULE_AHEAD = 0.1;  // how far ahead to schedule (seconds)

const SUBDIVISION_VEL_SCALE = 0.8; // velocity multiplier for ratchet hits

// ── ClockEngine ───────────────────────────────────────────────────────

export class ClockEngine {
  /**
   * @param {AudioContext} audioContext
   * @param {import('./event-bus.js').EventBus} [eventBus]
   */
  constructor(audioContext, eventBus) {
    if (!audioContext) {
      throw new TypeError('ClockEngine requires an AudioContext');
    }

    this._ctx      = audioContext;
    this._bus      = eventBus ?? null;
    this._bpm      = 120;
    this._playing  = false;

    // Pattern state
    this._pattern      = null;  // current pattern description
    this._currentStep  = 0;
    this._nextNoteTime = 0;     // AudioContext time of the next step

    // Scheduler handle
    this._timerId = null;

    // Direct callback listeners (besides the event bus)
    this._callbacks = [];

    // Track the last scheduled noteOn so we can emit noteOff before the next
    this._lastNote = null; // { stepIndex, time, pitch, velocity }
  }

  // ── Public properties ───────────────────────────────────────────────

  get bpm()     { return this._bpm; }
  set bpm(v)    { this._bpm = Math.max(1, +v || 120); }

  get playing() { return this._playing; }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Start the clock.  Begins scheduling from step 0 (or the current step
   * if a pattern was hot-swapped while stopped).
   */
  start() {
    if (this._playing) return;
    if (!this._pattern) return; // nothing to play

    this._playing = true;
    this._currentStep  = 0;
    this._nextNoteTime = this._ctx.currentTime + 0.05; // tiny lead-in
    this._lastNote     = null;

    this._timerId = setInterval(() => this._scheduler(), LOOKAHEAD_MS);
  }

  /** Stop the clock and send a final noteOff for the last sounding note. */
  stop() {
    if (!this._playing) return;
    this._playing = false;

    if (this._timerId !== null) {
      clearInterval(this._timerId);
      this._timerId = null;
    }

    // Release lingering note
    if (this._lastNote) {
      this._emit(SEQ.NOTE_OFF, {
        stepIndex: this._lastNote.stepIndex,
        time:      this._ctx.currentTime,
        pitch:     this._lastNote.pitch,
        velocity:  0,
      });
      this._lastNote = null;
    }
  }

  /**
   * Update tempo.  Takes effect on the next scheduled step.
   * @param {number} bpm
   */
  setTempo(bpm) {
    this.bpm = bpm;
  }

  /**
   * Provide (or replace) the pattern the clock steps through.
   * Safe to call while playing — the clock picks up the new pattern
   * on the next scheduling pass.
   *
   * @param {{ steps: Array, stepCount: number, metadata: Object }} patternDesc
   */
  schedulePattern(patternDesc) {
    if (!validatePattern(patternDesc)) {
      throw new TypeError('Invalid pattern description');
    }
    this._pattern = patternDesc;

    // If the current step is beyond the new pattern's length, wrap it
    if (this._currentStep >= patternDesc.stepCount) {
      this._currentStep = 0;
    }
  }

  /**
   * Register a direct callback that fires for every scheduled event.
   * @param {function} callback — receives (eventName, data)
   */
  onEvent(callback) {
    if (typeof callback === 'function') {
      this._callbacks.push(callback);
    }
  }

  /**
   * Return the current step index (useful for visualization sync).
   * @returns {number}
   */
  getCurrentStep() {
    return this._currentStep;
  }

  // ── Internals ───────────────────────────────────────────────────────

  /**
   * The core lookahead scheduler.  Called every LOOKAHEAD_MS, it walks
   * forward through the pattern scheduling any steps whose time falls
   * within the lookahead window.
   */
  _scheduler() {
    if (!this._pattern) return;

    const deadline = this._ctx.currentTime + SCHEDULE_AHEAD;

    while (this._nextNoteTime < deadline) {
      this._scheduleStep(this._currentStep, this._nextNoteTime);
      this._advance();
    }
  }

  /**
   * Schedule all events for a single step (including subdivisions).
   *
   * @param {number} stepIndex
   * @param {number} baseTime - AudioContext time for this step
   */
  _scheduleStep(stepIndex, baseTime) {
    const step = this._pattern.steps[stepIndex];
    const stepDuration = this._stepDuration();

    // Apply swing / timeOffset: shift the step forward or back within
    // [-0.5, 0.5] of one step's duration.
    const offsetTime = baseTime + step.timeOffset * stepDuration;

    // Detect loop wraparound
    if (stepIndex === 0) {
      this._emit(SEQ.LOOP_START, { stepIndex: 0, time: offsetTime });
    }

    // Visual step event (always fires, even for rests)
    this._emit(SEQ.STEP, { stepIndex, time: offsetTime });

    // If this step has no trigger, we're done (rest)
    if (!step.trigger) return;

    const subs = step.subdivisions;

    if (subs <= 1) {
      // Single hit
      this._scheduleNote(stepIndex, offsetTime, step.pitch, step.velocity, step.accent, false);
    } else {
      // Ratchet: evenly divide this step's duration
      const subDur = stepDuration / subs;
      for (let s = 0; s < subs; s++) {
        const t   = offsetTime + s * subDur;
        const vel = s === 0 ? step.velocity : step.velocity * SUBDIVISION_VEL_SCALE;
        this._scheduleNote(stepIndex, t, step.pitch, vel, step.accent, s > 0);
      }
    }
  }

  /**
   * Schedule a single noteOn (with preceding noteOff for the previous note).
   */
  _scheduleNote(stepIndex, time, pitch, velocity, accent, isSubdivision) {
    // NoteOff for previous note
    if (this._lastNote) {
      this._emit(SEQ.NOTE_OFF, {
        stepIndex: this._lastNote.stepIndex,
        time,
        pitch:     this._lastNote.pitch,
        velocity:  0,
      });
    }

    const noteData = { stepIndex, time, pitch, velocity, accent, isSubdivision };
    this._emit(SEQ.NOTE_ON, noteData);
    this._lastNote = { stepIndex, time, pitch, velocity };
  }

  /**
   * Advance the current step and compute the time for the next step.
   */
  _advance() {
    this._nextNoteTime += this._stepDuration();
    this._currentStep  += 1;

    if (this._currentStep >= this._pattern.stepCount) {
      this._currentStep = 0;
    }
  }

  /**
   * Duration of one step in seconds at the current BPM.
   * One step = one 16th note (4 steps per beat).
   * At 120 BPM: one step = 0.125s, 8 steps = 1 second.
   * @returns {number}
   */
  _stepDuration() {
    return 60 / this._bpm / 4;
  }

  // ── Event emission ──────────────────────────────────────────────────

  /**
   * Emit an event to both the event bus and any direct callbacks.
   * @param {string} eventName
   * @param {Object} data
   */
  _emit(eventName, data) {
    if (this._bus) {
      this._bus.emit(eventName, data);
    }
    for (let i = 0; i < this._callbacks.length; i++) {
      this._callbacks[i](eventName, data);
    }
  }
}
