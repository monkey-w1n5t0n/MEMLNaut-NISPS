/**
 * Microphone input — captures user audio and emits audio analysis features
 * for modes that take audio_in as primary input (XIASRI, SoundAnalysisMIDI).
 *
 * Uses an `AudioWorkletNode` for the analysis. Keeps things simple by
 * computing four lightweight features in the main thread via AnalyserNode:
 *
 *   - energy:    RMS amplitude (0..1)
 *   - brightness: spectral centroid normalised to 0..1
 *   - pitch:     dominant peak frequency normalised log scale
 *   - aperiodicity: 1 - peak_strength (0..1)
 *
 * Stream 10 doesn't ship a fully featured DSP analyser — this is a
 * pragmatic pipeline that gets values into the MLP. Firmware-equivalent
 * XIASRI analysis is a deeper port (out of scope here).
 *
 * Usage: call `start()` from a user gesture; subscribe via `getFeatures()`
 * (Float32Array of length 4). `stop()` releases the mic.
 */

const MIN_FREQ = 80;
const MAX_FREQ = 1200;
const FFT_SIZE = 1024;

export interface MicFeatures {
  energy: number;
  brightness: number;
  pitch: number;
  aperiodicity: number;
}

export interface MicInputOptions {
  /** Optional shared AudioContext. If absent, creates one. */
  audioContext?: AudioContext;
}

export class MicInput {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private freqBuf: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(FFT_SIZE / 2 * 4));
  private timeBuf: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(FFT_SIZE * 4));
  private features: MicFeatures = { energy: 0, brightness: 0, pitch: 0, aperiodicity: 1 };
  private running = false;

  constructor(private opts: MicInputOptions = {}) {}

  /** Start mic capture. Resolves once audio is flowing. */
  async start(): Promise<void> {
    if (this.running) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      throw new Error('[mic-input] navigator.mediaDevices unavailable');
    }
    this.ctx = this.opts.audioContext ?? new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.6;
    src.connect(this.analyser);
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.ctx && !this.opts.audioContext) {
      try { await this.ctx.close(); } catch { /* ignore */ }
    }
    this.ctx = null;
    this.analyser = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Compute and return the latest feature vector. */
  getFeatures(): MicFeatures {
    if (!this.running || !this.analyser || !this.ctx) return this.features;
    const sr = this.ctx.sampleRate;
    const a = this.analyser;
    a.getFloatFrequencyData(this.freqBuf);
    a.getFloatTimeDomainData(this.timeBuf);

    // RMS energy
    let sumSq = 0;
    for (let i = 0; i < this.timeBuf.length; ++i) {
      const s = this.timeBuf[i]!;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / this.timeBuf.length);
    const energy = Math.min(1, rms * 4);

    // Convert dB → linear, find spectral centroid + peak
    let sumMag = 0;
    let sumWeighted = 0;
    let peakBin = 0;
    let peakMag = -Infinity;
    const binHz = sr / FFT_SIZE;
    const minBin = Math.floor(MIN_FREQ / binHz);
    const maxBin = Math.min(this.freqBuf.length - 1, Math.ceil(MAX_FREQ / binHz));
    for (let i = 0; i < this.freqBuf.length; ++i) {
      const db = this.freqBuf[i]!;
      const lin = Math.pow(10, db / 20);
      sumMag += lin;
      sumWeighted += i * binHz * lin;
      if (i >= minBin && i <= maxBin && db > peakMag) {
        peakMag = db;
        peakBin = i;
      }
    }
    const centroidHz = sumMag > 1e-12 ? sumWeighted / sumMag : 0;
    const brightness = Math.min(1, centroidHz / (sr * 0.25));

    // Pitch (log scale 80–1200 Hz)
    const pitchHz = peakBin * binHz;
    const pitchNorm = pitchHz <= MIN_FREQ
      ? 0
      : pitchHz >= MAX_FREQ
        ? 1
        : (Math.log(pitchHz / MIN_FREQ) / Math.log(MAX_FREQ / MIN_FREQ));

    // Aperiodicity: 1 - relative peak height (vs spectral mean)
    const meanLin = sumMag / this.freqBuf.length;
    const peakLin = Math.pow(10, peakMag / 20);
    const ratio = meanLin > 1e-12 ? peakLin / meanLin : 0;
    const aperiodicity = Math.max(0, Math.min(1, 1 - Math.min(1, ratio / 30)));

    this.features = { energy, brightness, pitch: pitchNorm, aperiodicity };
    return this.features;
  }
}
