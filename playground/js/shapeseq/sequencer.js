/**
 * ShapeSeq Engine — central orchestrator
 *
 * Wires together the sequence MLP, param mapping, primitive chain,
 * projection layer, clock engine, and C15 bridge.
 *
 * Main loop (triggered by setSequenceInputs):
 *   1. Forward inputs to sequenceIML
 *   2. Run MLP inference to get 16 outputs
 *   3. Map 16 outputs to N primitive params via param-map
 *   4. Evaluate the chain to produce a pattern description
 *   5. Apply projection transforms
 *   6. Schedule the pattern on the clock
 *
 * Bridge integration:
 *   - Subscribes to seq.noteOn / seq.noteOff on the event bus
 *   - Forwards to C15Bridge.noteOn / noteOff
 *   - Tracks active notes to avoid orphans
 *
 * @module shapeseq/sequencer
 */

import { createSequenceIML, SEQ_DEFAULT_OUTPUT_COUNT } from './seq-iml.js';
import { Chain } from './chain.js';
import { ClockEngine } from './clock.js';
import { map } from './param-map.js';
import { createProjection, applyProjection } from './projection.js';
import { SEQ } from './event-bus.js';
import {
  EuclideanRhythm,
  ProbabilityGate,
  PitchWalker,
  IntervalLock,
  VelocityShaper,
} from './primitives.js';

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_BPM = 120;
const DEFAULT_STEP_COUNT = 8;
const DEFAULT_MASTER_SEED = 42;
const DEFAULT_SPREAD = 0.6;

// ── ShapeSeqEngine ───────────────────────────────────────────────────

export class ShapeSeqEngine {
  /**
   * @param {{ audioContext: AudioContext, eventBus: import('./event-bus.js').EventBus, c15Bridge: import('../synth/c15-bridge.js').C15Bridge }} opts
   */
  constructor({ audioContext, eventBus, c15Bridge }) {
    if (!audioContext) throw new TypeError('ShapeSeqEngine requires an audioContext');
    if (!eventBus) throw new TypeError('ShapeSeqEngine requires an eventBus');
    if (!c15Bridge) throw new TypeError('ShapeSeqEngine requires a c15Bridge');

    /** @private */ this._audioCtx = audioContext;
    /** @private */ this._bus = eventBus;
    /** @private */ this._c15 = c15Bridge;

    /** @private */ this._sequenceIML = null;
    /** @private */ this._chain = null;
    /** @private */ this._clock = null;
    /** @private */ this._projectionChain = null;

    /** @private */ this._outputCount = SEQ_DEFAULT_OUTPUT_COUNT;
    /** @private */ this._stepCount = DEFAULT_STEP_COUNT;
    /** @private */ this._masterSeed = DEFAULT_MASTER_SEED;
    /** @private */ this._playing = false;
    /** @private */ this._initialized = false;

    // Dirty-check: skip re-evaluation when inputs haven't changed
    /** @private */ this._lastInputs = [NaN, NaN];

    // Track active notes for orphan prevention
    /** @private @type {Set<number>} */
    this._activeNotes = new Set();

    // Bound handlers for event bus (stored for cleanup)
    /** @private */
    this._onNoteOn = (data) => this._handleNoteOn(data);
    /** @private */
    this._onNoteOff = (data) => this._handleNoteOff(data);
    /** @private */
    this._onLoopStart = () => this._handleLoopStart();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Initialize all subsystems: create sequence IML, default chain,
   * clock, and projection chain. Must be called before start().
   */
  async init() {
    // 1. Create the sequence MLP
    this._sequenceIML = await createSequenceIML({ outputCount: this._outputCount });

    // Randomize weights with default spread
    this._sequenceIML.randomiseWeights(DEFAULT_SPREAD);

    // 2. Create the default primitive chain
    this._chain = new Chain();
    this._chain.addPrimitive(new EuclideanRhythm());
    this._chain.addPrimitive(new ProbabilityGate());
    this._chain.addPrimitive(new PitchWalker());
    this._chain.addPrimitive(new IntervalLock());
    this._chain.addPrimitive(new VelocityShaper());
    this._chain.setMasterSeed(this._masterSeed);

    // 3. Set up the clock
    this._clock = new ClockEngine(this._audioCtx, this._bus);
    this._clock.bpm = DEFAULT_BPM;

    // 4. Create default projection
    this._projectionChain = createProjection();

    // 5. Subscribe to event bus for C15 bridge integration
    this._bus.on(SEQ.NOTE_ON, this._onNoteOn);
    this._bus.on(SEQ.NOTE_OFF, this._onNoteOff);

    // 6. Subscribe to loop start for stateful primitive re-evaluation
    this._bus.on(SEQ.LOOP_START, this._onLoopStart);

    this._initialized = true;
  }

  /**
   * Start the clock. Requires init() to have been called.
   */
  start() {
    if (!this._initialized) {
      throw new Error('ShapeSeqEngine.start() called before init()');
    }
    if (this._playing) return;

    this._playing = true;
    this._clock.start();
  }

  /**
   * Stop the clock and release all active notes.
   */
  stop() {
    if (!this._playing) return;

    this._playing = false;
    this._clock.stop();
    this._releaseAllNotes();
  }

  /**
   * Full cleanup: stop playback, unsubscribe from events, destroy IML.
   */
  destroy() {
    this.stop();

    // Unsubscribe from event bus
    this._bus.off(SEQ.NOTE_ON, this._onNoteOn);
    this._bus.off(SEQ.NOTE_OFF, this._onNoteOff);
    this._bus.off(SEQ.LOOP_START, this._onLoopStart);

    // Destroy the sequence IML instance
    if (this._sequenceIML) {
      this._sequenceIML.destroy();
      this._sequenceIML = null;
    }

    this._chain = null;
    this._clock = null;
    this._projectionChain = null;
    this._initialized = false;
  }

  // ── Configuration ──────────────────────────────────────────────────

  /**
   * Update the clock tempo.
   * @param {number} bpm
   */
  setTempo(bpm) {
    if (this._clock) {
      this._clock.setTempo(bpm);
    }
  }

  /**
   * Set the number of steps in the generated pattern.
   * @param {number} count
   */
  setStepCount(count) {
    const c = Math.max(1, count | 0);
    this._stepCount = c;
  }

  /**
   * Update the projection config. Accepts partial options merged with current.
   * @param {Object} opts - Partial projection config
   */
  setProjection(opts) {
    const cur = this._projectionChain;
    this._projectionChain = createProjection({
      velocityCurve: opts.velocityCurve ?? cur.velocityCurve,
      gateThreshold: opts.gateThreshold ?? cur.gateThreshold,
      pitchRange: {
        low: opts.pitchRange?.low ?? cur.pitchRange.low,
        high: opts.pitchRange?.high ?? cur.pitchRange.high,
      },
    });
  }

  /**
   * Get the current projection config.
   * @returns {{ velocityCurve: string, gateThreshold: number, pitchRange: { low: number, high: number } }}
   */
  getProjection() {
    return this._projectionChain;
  }

  /**
   * Change the MLP output count. Destroys and recreates the sequence IML
   * with a new architecture scaled to the requested count, then randomizes
   * weights. Training examples are lost — callers should snapshot first if
   * needed.
   *
   * @param {number} count - desired output count (e.g. 8, 16, 32)
   * @returns {Promise<void>}
   */
  async setOutputCount(count) {
    if (!this._initialized) {
      throw new Error('setOutputCount() called before init()');
    }

    this._outputCount = count;

    // Tear down old instance
    if (this._sequenceIML) {
      this._sequenceIML.destroy();
      this._sequenceIML = null;
    }

    // Create new instance with updated architecture
    this._sequenceIML = await createSequenceIML({ outputCount: count });
    this._sequenceIML.randomiseWeights(DEFAULT_SPREAD);
  }

  // ── Chain access (for UI binding) ──────────────────────────────────

  /** @returns {Chain} */
  getChain() { return this._chain; }

  /** @returns {ClockEngine} */
  getClock() { return this._clock; }

  /** @returns {WasmIML} */
  getSequenceIML() { return this._sequenceIML; }

  // ── Input routing ──────────────────────────────────────────────────

  /**
   * Feed new input values to the sequence MLP and run the full pipeline:
   * MLP inference -> param mapping -> chain evaluation -> projection -> clock scheduling.
   *
   * Call this each frame with the routed input values (e.g., [x, y]).
   *
   * @param {number[]} values - input array (typically [x, y])
   */
  setSequenceInputs(values) {
    if (!this._initialized || !this._sequenceIML) return;

    // Dirty-check: skip re-evaluation if inputs haven't changed
    const EPS = 1e-5;
    if (Math.abs(values[0] - this._lastInputs[0]) < EPS &&
        Math.abs(values[1] - this._lastInputs[1]) < EPS) {
      return;
    }
    this._lastInputs[0] = values[0];
    this._lastInputs[1] = values[1];

    // 1. Forward inputs to the sequence IML
    this._sequenceIML.setInputs(values);

    // 2. Run MLP inference
    this._sequenceIML.process();

    // 3. Get the 16 MLP outputs
    const mlpOutputs = this._sequenceIML.getOutputs();

    // 4. Map 16 outputs to N primitive params
    const paramCount = this._chain.totalParamCount;
    const mappedParams = map(mlpOutputs, paramCount);

    // 5. Evaluate the chain to produce a pattern description
    const patternDesc = this._chain.evaluate(mappedParams, this._stepCount, this._masterSeed);

    // 6. Apply projection transforms
    const projectedPattern = applyProjection(this._projectionChain, patternDesc);

    // 7. Schedule the pattern on the clock
    this._clock.schedulePattern(projectedPattern);
  }

  // ── ML control ─────────────────────────────────────────────────────

  /** @returns {boolean} */
  get isPlaying() {
    return this._playing;
  }

  // ── Loop re-evaluation (private) ──────────────────────────────────

  /**
   * Handle seq.loopStart events. If the chain contains stateful primitives
   * with reEvalOnLoop === true, force a pipeline re-evaluation using the
   * last known inputs. This lets stateful generators (e.g. PitchWalker)
   * produce evolving patterns across loops even when inputs stay still.
   *
   * @private
   */
  _handleLoopStart() {
    if (!this._initialized || !this._chain || !this._sequenceIML) return;
    if (!this._chain.hasReEvalPrimitives()) return;

    // If we have cached inputs, force an immediate re-evaluation now
    if (!isNaN(this._lastInputs[0]) && !isNaN(this._lastInputs[1])) {
      const savedInputs = [this._lastInputs[0], this._lastInputs[1]];
      // Reset dirty-check so setSequenceInputs re-runs the pipeline
      this._lastInputs[0] = NaN;
      this._lastInputs[1] = NaN;
      this.setSequenceInputs(savedInputs);
    }
  }

  // ── Bridge integration (private) ───────────────────────────────────

  /**
   * Handle seq.noteOn events from the event bus.
   * Converts [0,1] pitch to MIDI note number and forwards to C15.
   *
   * @private
   * @param {Object} data - { pitch, velocity, stepIndex, time, accent, isSubdivision }
   */
  _handleNoteOn(data) {
    // Use integer midiNote if set (post-IntervalLock), otherwise fall back
    // to the old pitch*127 encoding for backward compatibility.
    const midiNote = data.midiNote != null ? data.midiNote : (Math.round(data.pitch * 127) | 0);
    const velocity = data.velocity;

    // Clamp to valid MIDI range
    const note = midiNote < 0 ? 0 : midiNote > 127 ? 127 : midiNote;
    const vel = velocity < 0 ? 0 : velocity > 1 ? 1 : velocity;

    this._c15.noteOn(note, vel);
    this._activeNotes.add(note);
  }

  /**
   * Handle seq.noteOff events from the event bus.
   *
   * @private
   * @param {Object} data - { pitch, velocity, stepIndex, time }
   */
  _handleNoteOff(data) {
    const midiNote = data.midiNote != null ? data.midiNote : (Math.round(data.pitch * 127) | 0);
    const note = midiNote < 0 ? 0 : midiNote > 127 ? 127 : midiNote;

    this._c15.noteOff(note);
    this._activeNotes.delete(note);
  }

  /**
   * Release all currently active notes to avoid orphaned noteOns.
   * @private
   */
  _releaseAllNotes() {
    for (const note of this._activeNotes) {
      this._c15.noteOff(note);
    }
    this._activeNotes.clear();
  }
}
