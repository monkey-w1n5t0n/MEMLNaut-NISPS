// Arpeggiator — plays chord progressions through any SynthEngine.
// Delegates to a dedicated Web Worker for reliable timing.
// The worker posts noteOn/noteOff messages back to the main thread, which
// forwards them through the active SynthEngine. This keeps the arpeggiator
// decoupled from C15's SharedArrayBuffer ring buffer so any engine works.

import type { SynthEngine } from '../synth/engine-interface.js';

// ---------------------------------------------------------------------------
// Types for worker message protocol
// ---------------------------------------------------------------------------

export type ProgressionName =
  | 'Cmin7-rand'
  | 'I-vi-IV-V'
  | 'I-IV-vi-V'
  | 'i-VI-III-VII'
  | 'I-V-vi-IV';

export type Direction = 'up' | 'updown';

interface ArpConfig {
  bpm?: number;
  octaves?: number;
  octaveOffset?: number;
  progression?: ProgressionName;
  direction?: Direction;
}

// Messages sent TO the worker
type WorkerInboundMessage =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'set'; data: ArpConfig };

// Messages received FROM the worker
type WorkerOutboundMessage =
  | { type: 'state'; data: { playing: boolean } }
  | { type: 'noteOn'; data: { note: number; velocity: number } }
  | { type: 'noteOff'; data: { note: number } };

// ---------------------------------------------------------------------------
// Arpeggiator class
// ---------------------------------------------------------------------------

export class Arpeggiator {
  private engine: SynthEngine;
  private _worker: Worker | null = null;
  private _playing = false;
  private _bpm = 120;
  private _octaves = 2;
  private _octaveOffset = 0;
  private _progression: ProgressionName = 'Cmin7-rand';
  private _direction: Direction = 'updown';

  constructor(engine: SynthEngine) {
    this.engine = engine;
  }

  // ---------------------------------------------------------------------------
  // Static config lists
  // ---------------------------------------------------------------------------

  get progressionNames(): ProgressionName[] {
    return ['Cmin7-rand', 'I-vi-IV-V', 'I-IV-vi-V', 'i-VI-III-VII', 'I-V-vi-IV'];
  }

  get directionNames(): Direction[] {
    return ['up', 'updown'];
  }

  // ---------------------------------------------------------------------------
  // Observable state
  // ---------------------------------------------------------------------------

  get playing(): boolean {
    return this._playing;
  }

  // ---------------------------------------------------------------------------
  // Config properties — each setter syncs the worker immediately
  // ---------------------------------------------------------------------------

  get bpm(): number { return this._bpm; }
  set bpm(v: number) {
    this._bpm = v;
    this._send({ type: 'set', data: { bpm: v } });
  }

  get octaves(): number { return this._octaves; }
  set octaves(v: number) {
    this._octaves = v;
    this._send({ type: 'set', data: { octaves: v } });
  }

  get octaveOffset(): number { return this._octaveOffset; }
  set octaveOffset(v: number) {
    this._octaveOffset = v;
    this._send({ type: 'set', data: { octaveOffset: v } });
  }

  get progression(): ProgressionName { return this._progression; }
  set progression(v: ProgressionName) {
    this._progression = v;
    this._send({ type: 'set', data: { progression: v } });
  }

  get direction(): Direction { return this._direction; }
  set direction(v: Direction) {
    this._direction = v;
    this._send({ type: 'set', data: { direction: v } });
  }

  // ---------------------------------------------------------------------------
  // Bulk config update — set multiple properties without multiple worker messages
  // ---------------------------------------------------------------------------

  setConfig(cfg: ArpConfig): void {
    if (cfg.bpm !== undefined) this._bpm = cfg.bpm;
    if (cfg.octaves !== undefined) this._octaves = cfg.octaves;
    if (cfg.octaveOffset !== undefined) this._octaveOffset = cfg.octaveOffset;
    if (cfg.progression !== undefined) this._progression = cfg.progression;
    if (cfg.direction !== undefined) this._direction = cfg.direction;
    this._send({ type: 'set', data: cfg });
  }

  // ---------------------------------------------------------------------------
  // Worker lifecycle
  // ---------------------------------------------------------------------------

  private _ensureWorker(): void {
    if (this._worker) return;

    this._worker = new Worker(
      new URL('./arpeggiator-worker.js', import.meta.url),
      { type: 'module' }
    );

    this._worker.onmessage = (e: MessageEvent<WorkerOutboundMessage>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'state':
          this._playing = msg.data.playing;
          break;
        case 'noteOn':
          this.engine.noteOn(msg.data.note, msg.data.velocity);
          break;
        case 'noteOff':
          this.engine.noteOff(msg.data.note);
          break;
      }
    };

    // Sync current settings to worker on first creation
    this._send({
      type: 'set',
      data: {
        bpm: this._bpm,
        octaves: this._octaves,
        octaveOffset: this._octaveOffset,
        progression: this._progression,
        direction: this._direction,
      },
    });
  }

  private _send(msg: WorkerInboundMessage): void {
    if (this._worker) {
      this._worker.postMessage(msg);
    }
  }

  // ---------------------------------------------------------------------------
  // Playback control
  // ---------------------------------------------------------------------------

  start(): void {
    this._ensureWorker();
    this._send({ type: 'start' });
    this._playing = true; // optimistic — worker will confirm via 'state' message
  }

  stop(): void {
    this._send({ type: 'stop' });
    this._playing = false;
  }

  // ---------------------------------------------------------------------------
  // Engine hot-swap
  // ---------------------------------------------------------------------------

  /**
   * Replace the engine without restarting the worker.
   * Called when the user switches engines while playback is running.
   */
  setEngine(engine: SynthEngine): void {
    this.engine = engine;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Stop playback and terminate the worker. The Arpeggiator is unusable after
   * this call.
   */
  dispose(): void {
    this.stop();
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }
}
