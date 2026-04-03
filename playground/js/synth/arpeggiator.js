// Arpeggiator — plays chord progressions through any SynthEngine.
// Delegates to a dedicated Web Worker for reliable timing.
// The worker posts noteOn/noteOff messages back to the main thread, which
// forwards them through the active SynthEngine. This keeps the arpeggiator
// decoupled from C15's SharedArrayBuffer ring buffer so any engine works.

export class Arpeggiator {
  /**
   * @param {import('./engine-interface.js').SynthEngine} engine
   */
  constructor(engine) {
    this.engine = engine;
    this._worker = null;
    this._playing = false;
    this._bpm = 120;
    this._octaves = 2;
    this._octaveOffset = 0;
    this._progression = 'Cmin7-rand';
    this._direction = 'updown';
  }

  get progressionNames() {
    return ['Cmin7-rand', 'I-vi-IV-V', 'I-IV-vi-V', 'i-VI-III-VII', 'I-V-vi-IV'];
  }

  get directionNames() {
    return ['up', 'updown'];
  }

  get playing() { return this._playing; }

  get bpm() { return this._bpm; }
  set bpm(v) {
    this._bpm = v;
    this._send('set', { bpm: v });
  }

  get octaves() { return this._octaves; }
  set octaves(v) {
    this._octaves = v;
    this._send('set', { octaves: v });
  }

  get octaveOffset() { return this._octaveOffset; }
  set octaveOffset(v) {
    this._octaveOffset = v;
    this._send('set', { octaveOffset: v });
  }

  get progression() { return this._progression; }
  set progression(v) {
    this._progression = v;
    this._send('set', { progression: v });
  }

  get direction() { return this._direction; }
  set direction(v) {
    this._direction = v;
    this._send('set', { direction: v });
  }

  _ensureWorker() {
    if (this._worker) return;

    this._worker = new Worker(
      new URL('./arpeggiator-worker.js', import.meta.url),
      { type: 'module' }
    );

    this._worker.onmessage = (e) => {
      const { type, data } = e.data;
      switch (type) {
        case 'state':
          this._playing = data.playing;
          break;
        case 'noteOn':
          this.engine.noteOn(data.note, data.velocity);
          break;
        case 'noteOff':
          this.engine.noteOff(data.note);
          break;
      }
    };

    // Sync current settings to worker
    this._send('set', {
      bpm: this._bpm,
      octaves: this._octaves,
      octaveOffset: this._octaveOffset,
      progression: this._progression,
      direction: this._direction,
    });
  }

  _send(type, data) {
    if (this._worker) {
      this._worker.postMessage({ type, data });
    }
  }

  start() {
    this._ensureWorker();
    this._send('start');
    this._playing = true; // optimistic, worker confirms
  }

  stop() {
    this._send('stop');
    this._playing = false;
  }

  /**
   * Hot-swap the engine without restarting the worker.
   * Called by setActiveEngine() in a-app.js.
   * @param {import('./engine-interface.js').SynthEngine} engine
   */
  setEngine(engine) {
    this.engine = engine;
  }
}
