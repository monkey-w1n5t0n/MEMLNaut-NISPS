/**
 * DualRig — the second MLP engine and everything around it, framework-neutral.
 *
 * Manifold's main console drives ONE engine (here: the Powerful Synth Engine's
 * parameters, left stick). The rig adds a SECOND, independent engine — its own
 * WASM MLP, weights and feedback — whose outputs steer a melodic sequencer
 * (right stick). The sequencer's clock runs in a Worker and writes notes
 * straight into the synth's shared ring buffer, so it plays the synth that the
 * first engine is shaping.
 *
 *   left stick  → main engine  → PowerfulSynthBackend → synth params ┐
 *                                                                    ├─ synth
 *   right stick → seq engine   → SequencerRunner (Worker) → notes ───┘
 *
 * The rig is "active" (dual mode) while a gamepad is present. Buttons on the
 * right side of the pad drive the sequencer engine's learning (the main console
 * keeps LB/RB/A/B/X/Y for the synth engine).
 */
import { createEngine, type EngineApi } from '../engine';
import { FeedbackController } from '../feedback';
import { GamepadSource } from '../inputs/gamepad-source';
import { PowerfulSynth } from '../synth/psynth';
import { PowerfulSynthBackend } from '../backends/psynth-backend';
import {
  DEFAULT_SEQUENCER_SETTINGS,
  GENERATORS,
  SEQ_SLOTS,
  SequencerRunner,
  type GeneratorId,
  type SequencerSettings,
} from '../sequencer';

/** Preset the synth engine boots into when dual mode engages. */
export const DEFAULT_SYNTH_PRESET = 'beginner-1';

export interface RigSnapshot {
  /** Dual mode engaged (a gamepad is present). */
  active: boolean;
  /** The sequencer engine has loaded. */
  seqReady: boolean;
  audioRunning: boolean;
  audioMessage: string;
  settings: SequencerSettings;
  /** Last step index the clock played (-1 before the first step). */
  playhead: number;
  lastNote: number | null;
  presetId: string;
}

const GENERATOR_ORDER: GeneratorId[] = ['euclid-turing', 'walker', 'steps'];

/** Sequencer engine net: 2 stick axes → SEQ_SLOTS musical parameters. */
const SEQ_NET = { inputSize: 2, outputSize: SEQ_SLOTS, hidden: [10, 14, 18] as [number, number, number] };

/** Runner → worker param pushes are capped at this rate (the worker smooths). */
const PARAM_PUSH_MS = 1000 / 30;

export class DualRig {
  readonly synth = new PowerfulSynth();
  readonly backend = new PowerfulSynthBackend(this.synth);

  seq: EngineApi | null = null;
  feedback: FeedbackController | null = null;
  runner: SequencerRunner | null = null;

  private snap: RigSnapshot = {
    active: false,
    seqReady: false,
    audioRunning: false,
    audioMessage: 'Audio off',
    settings: { ...DEFAULT_SEQUENCER_SETTINGS },
    playhead: -1,
    lastNote: null,
    presetId: DEFAULT_SYNTH_PRESET,
  };
  private listeners = new Set<() => void>();
  private pad = new GamepadSource();
  private padSamples = new Float32Array(4);
  private slotBuf = new Float32Array(SEQ_SLOTS);
  private raf = 0;
  private lastPush = 0;
  private offAction: (() => void) | null = null;
  private offStep: (() => void) | null = null;
  private disposed = false;

  constructor() {
    this.pad.setStickMode('double');
    this.synth.onStatusChange = (message) => this.patch({ audioMessage: message });
  }

  // ---- store ---------------------------------------------------------

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): RigSnapshot => this.snap;

  private patch(partial: Partial<RigSnapshot>): void {
    this.snap = { ...this.snap, ...partial };
    for (const l of this.listeners) l();
  }

  // ---- lifecycle -----------------------------------------------------

  /** Load the sequencer's MLP engine. Independent weights, no audio host. */
  async init(): Promise<void> {
    if (this.seq || this.disposed) return;
    const seq = await createEngine({ storageKey: 'manifold-seq-engine', persist: false });
    if (this.disposed) {
      seq.dispose();
      return;
    }
    seq.reshape(SEQ_NET);
    seq.setInputs([0.5, 0.5]);
    this.seq = seq;
    this.feedback = new FeedbackController(seq);
    this.feedback.setMode('geometric-dislike');
    this.patch({ seqReady: true });
  }

  /** Engage / release dual mode (called when a gamepad appears or leaves). */
  setActive(active: boolean): void {
    if (this.snap.active === active || this.disposed) return;
    this.patch({ active });
    if (active) {
      this.pad.start();
      this.offAction = this.pad.onAction((a) => {
        if (a.phase === 'release') return;
        this.onButton(a.id);
      });
      this.loop();
    } else {
      cancelAnimationFrame(this.raf);
      this.offAction?.();
      this.offAction = null;
      this.pad.stop();
      this.runner?.stop();
      this.patch({ settings: { ...this.snap.settings, running: false } });
    }
  }

  /** Start the synth and the sequencer (needs a user gesture). */
  async startAudio(): Promise<void> {
    await this.synth.start();
    const ring = this.synth.ring;
    if (!ring || this.runner) {
      this.patch({ audioRunning: this.synth.isRunning });
      return;
    }
    const runner = new SequencerRunner(ring);
    runner.setSettings({ ...this.snap.settings, running: false });
    this.offStep = runner.onStep((s) => this.patch({ playhead: s.index, lastNote: s.note }));
    this.runner = runner;
    this.backend.setPreset(this.snap.presetId); // writes the held (non-MLP) values now the synth is up
    this.patch({ audioRunning: this.synth.isRunning });
    this.updateSettings({ running: true });
  }

  async stopAudio(): Promise<void> {
    this.runner?.stop();
    this.synth.panic();
    await this.synth.stop();
    this.patch({
      audioRunning: false,
      settings: { ...this.snap.settings, running: false },
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.offAction?.();
    this.offStep?.();
    this.pad.stop();
    this.runner?.dispose();
    this.runner = null;
    this.synth.dispose();
    this.seq?.dispose();
    this.seq = null;
    this.listeners.clear();
  }

  // ---- sequencer settings -------------------------------------------

  updateSettings(partial: Partial<SequencerSettings>): void {
    const settings = { ...this.snap.settings, ...partial };
    this.patch({ settings });
    this.runner?.setSettings(partial);
  }

  setPreset(presetId: string): void {
    this.patch({ presetId });
    this.backend.setPreset(presetId);
  }

  /** Latest MLP output for each generator slot (live, reused buffer). */
  slotValues(): Float32Array | null {
    const out = this.seq?.routedOutput() ?? this.seq?.getOutputs() ?? null;
    if (!out) return null;
    this.slotBuf.set(out.subarray(0, SEQ_SLOTS));
    return this.slotBuf;
  }

  // ---- sequencer engine feedback ------------------------------------

  like(): void {
    const seq = this.seq;
    const out = this.slotValues();
    if (!seq || !this.feedback || !out) return;
    this.feedback.like([seq.spine.lastRawX, seq.spine.lastRawY], out);
  }

  dislike(): void {
    const out = this.slotValues();
    if (!this.feedback || !out) return;
    this.feedback.dislike(out);
  }

  // ---- gamepad -------------------------------------------------------

  private onButton(id: string): void {
    const s = this.snap.settings;
    switch (id) {
      case 'button:7': // RT → like the melody
        this.like();
        break;
      case 'button:6': // LT → push the melody away
        this.dislike();
        break;
      case 'button:9': // Start → play / pause the sequencer
        this.updateSettings({ running: !s.running });
        break;
      case 'button:14': // D-left → previous generator
      case 'button:15': {
        // D-right → next generator
        const i = GENERATOR_ORDER.indexOf(s.generator);
        const n = GENERATOR_ORDER.length;
        const next = GENERATOR_ORDER[(i + (id === 'button:15' ? 1 : n - 1)) % n];
        this.updateSettings({ generator: next });
        break;
      }
      case 'button:12': // D-up → faster
        this.updateSettings({ bpm: Math.min(240, s.bpm + 5) });
        break;
      case 'button:13': // D-down → slower
        this.updateSettings({ bpm: Math.max(40, s.bpm - 5) });
        break;
    }
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.pad.poll();
    const seq = this.seq;
    if (!seq) return;
    this.pad.sample(this.padSamples, 0);
    // Right stick (axes 2,3) steers the sequencer engine.
    seq.setInputs([this.padSamples[2], this.padSamples[3]]);
    const now = performance.now();
    if (this.runner && now - this.lastPush >= PARAM_PUSH_MS) {
      this.lastPush = now;
      const p = this.slotValues();
      if (p) this.runner.setParams(p);
    }
  };
}

/** Human label for a generator id. */
export function generatorLabel(id: GeneratorId): string {
  return GENERATORS[id].label;
}
