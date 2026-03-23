// Arpeggiator — plays chord progressions through the C15 engine
// Delegates to a dedicated Web Worker for reliable timing.
// The worker writes noteOn/noteOff directly to the SharedArrayBuffer
// ring buffer, bypassing main thread entirely.

export class Arpeggiator {
  constructor(bridge) {
    this.bridge = bridge;
    this._worker = null;
    this._playing = false;
    this._bpm = 120;
    this._octaves = 2;
    this._octaveOffset = 0;
    this._progression = 'I-vi-IV-V';
  }

  get progressionNames() {
    return ['I-vi-IV-V', 'I-IV-vi-V', 'i-VI-III-VII', 'I-V-vi-IV'];
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

  _ensureWorker() {
    if (this._worker) return;

    this._worker = new Worker(
      new URL('./arpeggiator-worker.js', import.meta.url),
      { type: 'module' }
    );

    this._worker.onmessage = (e) => {
      if (e.data.type === 'state') {
        this._playing = e.data.playing;
      }
    };

    // Pass the SharedArrayBuffer so the worker can write notes directly
    const sab = this.bridge.sharedBuffer;
    if (sab) {
      this._worker.postMessage({ type: 'init', data: { sharedBuffer: sab } });
    }

    // Sync current settings
    this._send('set', {
      bpm: this._bpm,
      octaves: this._octaves,
      octaveOffset: this._octaveOffset,
      progression: this._progression,
    });
  }

  _send(type, data) {
    if (this._worker) {
      this._worker.postMessage({ type, data });
    }
  }

  start() {
    this._ensureWorker();
    // If bridge wasn't ready when worker was created, send the buffer now
    const sab = this.bridge.sharedBuffer;
    if (sab) {
      this._worker.postMessage({ type: 'init', data: { sharedBuffer: sab } });
    }
    this._send('start');
    this._playing = true; // optimistic, worker confirms
  }

  stop() {
    this._send('stop');
    this._playing = false;
  }
}
