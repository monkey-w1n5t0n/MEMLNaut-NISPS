/**
 * AudioCanvas — generative audio sampler driven by ML outputs.
 *
 * Port of playground/js/audio/audio-canvas.js to TypeScript.
 * Platform-agnostic: no DOM setup, no CSS injection.
 * The component (AudioCanvasVisualizer.tsx) owns the DOM.
 *
 * Output layout (dynamic, N_RANGE_OUTPUTS + getTotalLoops() * N_PARAMS_PER_LOOP):
 *   [0]  vol min     [1]  vol max
 *   [2]  pitch min   [3]  pitch max
 *   [4]  pos min     [5]  pos max
 *   [6]  filt min    [7]  filt max
 *   [8+] per-loop params packed: [vol, pitch, pos, filt] × totalLoops
 *        Loop order: clip 0 loops first, then clip 1, etc.
 *
 * 4 submodes: 'remix' | 'granular' | 'drone' | 'slicer'
 */

// ─── Constants ───────────────────────────────────────────────────────────────

export const N_RANGE_OUTPUTS = 8;
export const N_PARAMS_PER_LOOP = 4;
export const MAX_LOOPS_PER_CLIP = 4;

export const SUBMODES = ['remix', 'granular', 'drone', 'slicer'] as const;
export type Submode = typeof SUBMODES[number];

export const GROUP_COLORS = {
  volume:   '#4a90d9',
  pitch:    '#50c878',
  position: '#e88c32',
  filter:   '#9b59b6',
} as const;

export type ParamGroup = keyof typeof GROUP_COLORS;

export const RANGE_NAMES = [
  'Vol Min', 'Vol Max',
  'Pitch Min', 'Pitch Max',
  'Pos Min', 'Pos Max',
  'Filt Min', 'Filt Max',
] as const;

export const RANGE_COLORS: string[] = [
  GROUP_COLORS.volume, GROUP_COLORS.volume,
  GROUP_COLORS.pitch, GROUP_COLORS.pitch,
  GROUP_COLORS.position, GROUP_COLORS.position,
  GROUP_COLORS.filter, GROUP_COLORS.filter,
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParamRange {
  min: number;
  max: number;
}

export interface ParamRanges {
  volume:   ParamRange;
  pitch:    ParamRange;
  position: ParamRange;
  filter:   ParamRange;
}

export interface LoopLengthOverride {
  unit: 'bars' | 'beats';
  value: number;
}

/** Per-clip audio clip data */
export interface AudioClip {
  id: string;
  name: string;
  buffer: AudioBuffer;
  duration: number;
  waveformData: Float32Array;
}

/** Per-loop player state */
export interface LoopPlayer {
  clip: AudioClip;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  filterNode: BiquadFilterNode | null;
  playing: boolean;
  loopStart: number;
  loopEnd: number;
}

/** Snapshot of visualizer state emitted each tick. */
export interface AudioCanvasVisualState {
  clips: ReadonlyArray<{
    name: string;
    duration: number;
    waveformData: Float32Array;
    loopStart: number; // normalized 0-1
    loopEnd: number;   // normalized 0-1
    playhead: number | null; // normalized 0-1 or null
    label: string;
    level: number;     // 0-1 current volume
    loopCount: number;
    activeColor: string;
  }>;
  running: boolean;
  submode: Submode;
  paramRanges: ParamRanges;
}

export type VisualStateCallback = (state: AudioCanvasVisualState) => void;
export type OutputCountCallback = (count: number) => void;

// ─── AudioCanvas class ───────────────────────────────────────────────────────

export class AudioCanvas {
  // Audio graph
  private _audioCtx: AudioContext | null = null;
  private _masterGain: GainNode | null = null;

  // Clip state
  private _clips: AudioClip[] = [];
  private _loopCounts: number[] = [];
  private _loopPlayers: LoopPlayer[][] = [];

  // Granular / slicer timers
  private _granularTimers: (ReturnType<typeof setInterval> | null)[] = [];
  private _slicerTimer: ReturnType<typeof setTimeout> | null = null;
  private _slicerStep = 0;
  private _loopUpdateTimer: ReturnType<typeof setInterval> | null = null;

  // Playback config
  private _submode: Submode = 'remix';
  private _beatSync = false;
  private _bpm = 120;
  private _loopLengthUnit: 'bars' | 'beats' = 'bars';
  private _loopLengthValue = 4;
  private _perLoopLengthOverrides = new Map<number, LoopLengthOverride>();
  private _lockPitch = false;
  private _running = false;

  // ML output state
  private _outputs: Float32Array;
  private _loopOutputs: number[] = [];
  private _paramRanges: ParamRanges = {
    volume:   { min: 0, max: 1 },
    pitch:    { min: 0, max: 1 },
    position: { min: 0, max: 1 },
    filter:   { min: 0, max: 1 },
  };
  private _rangeOverrides: Record<ParamGroup, boolean> = {
    volume: false, pitch: false, position: false, filter: false,
  };

  // Undo support
  private _lastLoopCountChange: { clipIdx: number; oldCount: number } | null = null;

  // Callbacks for external consumers (the SolidJS component)
  private _onVisualState: VisualStateCallback | null = null;
  private _onOutputCountChanged: OutputCountCallback | null = null;

  constructor() {
    this._outputs = new Float32Array(this.getOutputCount()).fill(0.5);
  }

  // ── Callback wiring ─────────────────────────────────────────────────────────

  /** Register a callback to receive visual state updates each audio tick. */
  onVisualState(fn: VisualStateCallback): void {
    this._onVisualState = fn;
  }

  /** Register a callback fired when the output count changes (clips added/loops changed). */
  onOutputCountChanged(fn: OutputCountCallback): void {
    this._onOutputCountChanged = fn;
  }

  // ── Audio init ──────────────────────────────────────────────────────────────

  /**
   * Lazily initialise the AudioContext and master gain.
   * Must be called inside a user-gesture handler for browsers that block
   * autoplay (the first call to start() or _handleDrop() triggers this).
   *
   * Accepts an optional pre-created AudioContext (from useAudioContext) so
   * the app can share a single context across output modes.
   */
  async initAudio(ctx?: AudioContext): Promise<void> {
    if (this._audioCtx) return;
    this._audioCtx = ctx ?? new AudioContext();
    this._masterGain = this._audioCtx.createGain();
    this._masterGain.gain.value = 0.75;
    this._masterGain.connect(this._audioCtx.destination);
  }

  // ── File loading ─────────────────────────────────────────────────────────────

  async loadFiles(files: FileList | File[]): Promise<void> {
    if (!this._audioCtx) await this.initAudio();
    const valid = Array.from(files).filter(f =>
      f.type.startsWith('audio/') ||
      /\.(mp3|wav|flac|ogg|m4a|aac|opus|webm|mp4|wma|aif|aiff)$/i.test(f.name),
    );
    for (const file of valid) await this._loadFile(file);
  }

  private async _loadFile(file: File): Promise<string | undefined> {
    if (!this._audioCtx) return undefined;
    let buffer: AudioBuffer;
    try {
      const ab = await file.arrayBuffer();
      buffer = await this._audioCtx.decodeAudioData(ab);
    } catch (err) {
      console.warn('[AudioCanvas] decode failed:', file.name, err);
      return undefined;
    }

    const id = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const clip: AudioClip = {
      id,
      name: file.name.replace(/\.[^.]+$/, ''),
      buffer,
      duration: buffer.duration,
      waveformData: this._extractWaveform(buffer),
    };

    this._clips.push(clip);
    this._loopCounts.push(1);
    this._loopPlayers.push([this._makePlayer(clip)]);
    this._resizeOutputs();
    this._emitOutputCountChanged();
    this._emitVisualState();

    return id;
  }

  private _extractWaveform(buffer: AudioBuffer, resolution = 500): Float32Array {
    const ch = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / resolution));
    const data = new Float32Array(resolution);
    for (let i = 0; i < resolution; i++) {
      let peak = 0;
      for (let j = 0; j < step; j++) {
        peak = Math.max(peak, Math.abs(ch[i * step + j] ?? 0));
      }
      data[i] = peak;
    }
    return data;
  }

  private _makePlayer(clip: AudioClip): LoopPlayer {
    return {
      clip, source: null, gainNode: null, filterNode: null,
      playing: false, loopStart: 0, loopEnd: clip.duration,
    };
  }

  // ── Playback ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._running) return;
    if (!this._audioCtx) await this.initAudio();
    if (this._audioCtx!.state === 'suspended') await this._audioCtx!.resume();
    this._running = true;
    this._startPlayback();
  }

  stop(): void {
    if (!this._running) return;
    this._running = false;
    this._stopAll();
    this._emitVisualState();
  }

  private _stopAll(): void {
    if (this._loopUpdateTimer !== null) {
      clearInterval(this._loopUpdateTimer);
      this._loopUpdateTimer = null;
    }
    if (this._slicerTimer !== null) {
      clearTimeout(this._slicerTimer);
      this._slicerTimer = null;
    }
    this._granularTimers.forEach((t) => { if (t !== null) clearInterval(t); });
    this._granularTimers = [];

    for (const loopArr of this._loopPlayers) {
      for (const p of loopArr) {
        if (p.source) {
          try { p.source.stop(); } catch (_) { /* ignore */ }
          p.source = null;
        }
        if (p.gainNode) { p.gainNode.disconnect(); p.gainNode = null; }
        if (p.filterNode) { p.filterNode.disconnect(); p.filterNode = null; }
        p.playing = false;
      }
    }
  }

  private _startPlayback(): void {
    if (this._clips.length === 0 || this.getTotalLoops() === 0) return;

    if (this._submode === 'remix' || this._submode === 'drone') {
      this._startLooping();
    } else if (this._submode === 'granular') {
      this._startGranular();
    } else if (this._submode === 'slicer') {
      this._slicerStep = 0;
      this._scheduleSlicer();
    }
  }

  // ── Remix / Drone ────────────────────────────────────────────────────────────

  private _startLooping(): void {
    for (let ci = 0; ci < this._clips.length; ci++) {
      for (let li = 0; li < this._loopCounts[ci]; li++) {
        this._startOneLoop(ci, li);
      }
    }
    this._loopUpdateTimer = setInterval(() => this._tickLooping(), 60);
  }

  private _startOneLoop(clipIdx: number, loopIdx: number): void {
    const clip = this._clips[clipIdx];
    const player = this._loopPlayers[clipIdx]?.[loopIdx];
    if (!clip || !player || !this._audioCtx || !this._masterGain) return;

    const filterNode = this._audioCtx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = 4000;
    filterNode.Q.value = 0.7;

    const gainNode = this._audioCtx.createGain();
    gainNode.gain.value = 0.5;

    filterNode.connect(gainNode);
    gainNode.connect(this._masterGain);

    const source = this._audioCtx.createBufferSource();
    source.buffer = clip.buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = clip.duration;
    source.playbackRate.value = this._submode === 'drone' ? 0.05 : 1.0;
    source.connect(filterNode);
    source.start();

    player.source = source;
    player.gainNode = gainNode;
    player.filterNode = filterNode;
    player.playing = true;
  }

  private _tickLooping(): void {
    if (!this._running || !this._audioCtx) return;
    const now = this._audioCtx.currentTime;
    const isDrone = this._submode === 'drone';

    let flatIdx = 0;
    const clipVisuals: AudioCanvasVisualState['clips'][0][] = [];

    for (let ci = 0; ci < this._clips.length; ci++) {
      const clip = this._clips[ci];
      let clipMaxVol = 0;
      let clipLoopStart = 0;
      let clipLoopEnd = 1;

      for (let li = 0; li < this._loopCounts[ci]; li++) {
        const player = this._loopPlayers[ci]?.[li];
        if (!player || !player.playing) { flatIdx++; continue; }

        const volPos   = this._getLoopParam(flatIdx, 0);
        const pitchPos = this._getLoopParam(flatIdx, 1);
        const posPos   = this._getLoopParam(flatIdx, 2);
        const filtPos  = this._getLoopParam(flatIdx, 3);

        const vol       = this._resolveLoopParam('volume',   volPos);
        const pitchNorm = this._resolveLoopParam('pitch',    pitchPos);
        const loopNorm  = this._resolveLoopParam('position', posPos);
        const filtNorm  = this._resolveLoopParam('filter',   filtPos);

        const speed = this._lockPitch
          ? (isDrone ? 0.05 : 1.0)
          : isDrone
            ? 0.005 + pitchNorm * 0.095
            : 0.5 + pitchNorm * 1.5;

        const winSecs = this._beatSync
          ? this._getLoopDuration(ci)
          : (isDrone ? 120 : 15);

        const loopStart = loopNorm * Math.max(0, clip.duration - winSecs);
        const loopEnd   = Math.min(loopStart + winSecs, clip.duration);
        // 200 Hz to 8000 Hz log scale
        const filterHz  = 200 * Math.pow(40, filtNorm);

        player.source!.playbackRate.setTargetAtTime(speed, now, 0.08);
        player.source!.loopStart = loopStart;
        player.source!.loopEnd   = loopEnd;
        player.gainNode!.gain.setTargetAtTime(isDrone ? vol * 0.7 : vol, now, 0.06);
        player.filterNode!.frequency.setTargetAtTime(filterHz, now, 0.06);

        if (vol > clipMaxVol) clipMaxVol = vol;
        clipLoopStart = loopStart / clip.duration;
        clipLoopEnd   = loopEnd   / clip.duration;

        flatIdx++;
      }

      if (this._loopCounts[ci] > 0) {
        clipVisuals.push({
          name:         clip.name,
          duration:     clip.duration,
          waveformData: clip.waveformData,
          loopStart:    clipLoopStart,
          loopEnd:      clipLoopEnd,
          playhead:     null,
          label:        isDrone ? 'drone' : 'remix',
          level:        clipMaxVol,
          loopCount:    this._loopCounts[ci],
          activeColor:  isDrone ? '#8040c0' : '#4a90d9',
        });
      }
    }

    this._emitVisualStateWith(clipVisuals);
  }

  // ── Granular ─────────────────────────────────────────────────────────────────

  private _startGranular(): void {
    this._granularTimers = [];
    let flatIdx = 0;
    for (let ci = 0; ci < this._clips.length; ci++) {
      for (let li = 0; li < this._loopCounts[ci]; li++) {
        const fi = flatIdx;
        const ciCapture = ci;
        const timer = setInterval(() => {
          if (!this._running) { clearInterval(timer); return; }
          this._spawnGrain(ciCapture, fi);
        }, 35);
        this._granularTimers.push(timer);
        flatIdx++;
      }
    }
    this._loopUpdateTimer = setInterval(() => this._tickGranularVisuals(), 60);
  }

  private _tickGranularVisuals(): void {
    if (!this._running) return;
    let flatIdx = 0;
    const clipVisuals: AudioCanvasVisualState['clips'][0][] = [];

    for (let ci = 0; ci < this._clips.length; ci++) {
      const clip = this._clips[ci];
      if (this._loopCounts[ci] === 0) continue;

      let posSum = 0;
      let densityMax = 0;
      for (let li = 0; li < this._loopCounts[ci]; li++) {
        const posNorm  = this._resolveLoopParam('position', this._getLoopParam(flatIdx, 2));
        const density  = this._resolveLoopParam('volume',   this._getLoopParam(flatIdx, 0));
        posSum += posNorm;
        if (density > densityMax) densityMax = density;
        flatIdx++;
      }
      const avgPos = posSum / this._loopCounts[ci];

      clipVisuals.push({
        name:         clip.name,
        duration:     clip.duration,
        waveformData: clip.waveformData,
        loopStart:    Math.max(0, avgPos - 0.03),
        loopEnd:      Math.min(1, avgPos + 0.03),
        playhead:     null,
        label:        'granular',
        level:        densityMax,
        loopCount:    this._loopCounts[ci],
        activeColor:  '#7040c0',
      });
    }

    this._emitVisualStateWith(clipVisuals);
  }

  private _spawnGrain(clipIdx: number, flatLoopIdx: number): void {
    const clip = this._clips[clipIdx];
    if (!clip || !this._audioCtx || !this._masterGain) return;

    const density   = this._resolveLoopParam('volume',   this._getLoopParam(flatLoopIdx, 0));
    const pitchNorm = this._resolveLoopParam('pitch',    this._getLoopParam(flatLoopIdx, 1));
    const posNorm   = this._resolveLoopParam('position', this._getLoopParam(flatLoopIdx, 2));
    const sizeNorm  = this._resolveLoopParam('filter',   this._getLoopParam(flatLoopIdx, 3));

    if (Math.random() > density) return;

    const grainDur = 0.02 + sizeNorm * 0.38;
    const pitch    = this._lockPitch ? 1.0 : 0.5 + pitchNorm * 1.5;
    const scatter  = 0.04;
    const pos      = Math.max(0, Math.min(1, posNorm + (Math.random() - 0.5) * scatter * 2));

    let startOff: number;
    if (this._beatSync) {
      const loopDur    = this._getLoopDuration(clipIdx);
      const loopWindow = Math.min(loopDur, clip.duration);
      startOff = pos * Math.max(0, loopWindow - grainDur);
    } else {
      startOff = pos * Math.max(0, clip.duration - grainDur);
    }

    const gain = this._audioCtx.createGain();
    const t    = this._audioCtx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.4 * density, t + grainDur * 0.15);
    gain.gain.linearRampToValueAtTime(0.4 * density, t + grainDur * 0.85);
    gain.gain.linearRampToValueAtTime(0, t + grainDur);
    gain.connect(this._masterGain);

    const src = this._audioCtx.createBufferSource();
    src.buffer = clip.buffer;
    src.playbackRate.value = pitch;
    src.connect(gain);
    src.start(t, startOff, grainDur);
    src.onended = () => gain.disconnect();
  }

  // ── Slicer ───────────────────────────────────────────────────────────────────

  private _scheduleSlicer(): void {
    if (!this._running) return;
    const stepMs = this._beatSync
      ? (this._getLoopDuration(0) * 1000 / 8)
      : (60000 / this._bpm);

    this._slicerTimer = setTimeout(() => {
      this._fireSlice();
      this._scheduleSlicer();
    }, stepMs);
  }

  private _fireSlice(): void {
    const totalLoops = this.getTotalLoops();
    if (totalLoops === 0 || !this._audioCtx || !this._masterGain) return;

    const step = this._slicerStep % Math.max(1, totalLoops);
    this._slicerStep++;

    // Find which clip/loop this flat step maps to
    let flatIdx = 0;
    let targetClipIdx = 0;
    for (let ci = 0; ci < this._clips.length; ci++) {
      for (let li = 0; li < this._loopCounts[ci]; li++) {
        if (flatIdx === step) targetClipIdx = ci;
        flatIdx++;
      }
    }

    const clip = this._clips[targetClipIdx];
    if (!clip) return;

    const clipNorm  = this._resolveLoopParam('volume',   this._getLoopParam(step, 0));
    const posNorm   = this._resolveLoopParam('pitch',    this._getLoopParam(step, 1));
    const speedNorm = this._resolveLoopParam('position', this._getLoopParam(step, 2));
    const sliceDur  = Math.min(1.2, this._beatSync ? 60 / this._bpm / 2 : 60 / this._bpm);
    const speed     = this._lockPitch ? 1.0 : 0.5 + speedNorm * 1.5;
    const startOff  = posNorm * Math.max(0, clip.duration - sliceDur);

    const gain = this._audioCtx.createGain();
    const t    = this._audioCtx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.7, t + 0.004);
    gain.gain.linearRampToValueAtTime(0.7, t + sliceDur * 0.75);
    gain.gain.linearRampToValueAtTime(0, t + sliceDur);
    gain.connect(this._masterGain);

    const src = this._audioCtx.createBufferSource();
    src.buffer = clip.buffer;
    src.playbackRate.value = speed;
    src.connect(gain);
    src.start(t, startOff, sliceDur / speed);
    src.onended = () => gain.disconnect();

    // Build visual state: flash target cell, idle others
    const clipVisuals: AudioCanvasVisualState['clips'][0][] = this._clips.map((c, i) => ({
      name:         c.name,
      duration:     c.duration,
      waveformData: c.waveformData,
      loopStart:    i === targetClipIdx ? Math.max(0, posNorm - 0.02) : 0,
      loopEnd:      i === targetClipIdx ? Math.min(1, posNorm + 0.02) : 1,
      playhead:     null,
      label:        i === targetClipIdx ? `slice ${step}` : 'idle',
      level:        i === targetClipIdx ? speedNorm : 0,
      loopCount:    this._loopCounts[i],
      activeColor:  '#ff3b30',
    }));

    this._emitVisualStateWith(clipVisuals);
  }

  // ── Loop management ─────────────────────────────────────────────────────────

  setClipLoopCount(clipIdx: number, count: number): boolean {
    count = Math.max(0, Math.min(MAX_LOOPS_PER_CLIP, count));
    const old = this._loopCounts[clipIdx];
    if (count === old) return false;

    this._lastLoopCountChange = { clipIdx, oldCount: old };

    const wasRunning = this._running;
    if (wasRunning) this.stop();

    const clip    = this._clips[clipIdx];
    const players = this._loopPlayers[clipIdx];

    if (count > old) {
      for (let i = old; i < count; i++) {
        players.push(this._makePlayer(clip));
      }
    } else {
      const removed = players.splice(count);
      for (const p of removed) {
        if (p.source) { try { p.source.stop(); } catch (_) { /* ignore */ } }
        if (p.gainNode) p.gainNode.disconnect();
        if (p.filterNode) p.filterNode.disconnect();
      }
    }

    this._loopCounts[clipIdx] = count;
    this._resizeOutputs();
    this._emitOutputCountChanged();

    if (wasRunning) void this.start();
    return true;
  }

  revertLastLoopChange(): void {
    if (!this._lastLoopCountChange) return;
    const { clipIdx, oldCount } = this._lastLoopCountChange;
    this._lastLoopCountChange = null;
    this.setClipLoopCount(clipIdx, oldCount);
  }

  private _resizeOutputs(): void {
    const count = this.getOutputCount();
    if (this._outputs.length !== count) {
      const old = this._outputs;
      this._outputs = new Float32Array(count).fill(0.5);
      const preserve = Math.min(old.length, count);
      for (let i = 0; i < preserve; i++) this._outputs[i] = old[i];
    }
    this._loopOutputs = Array.from(this._outputs).slice(N_RANGE_OUTPUTS);
  }

  // ── Beat-sync loop length ────────────────────────────────────────────────────

  private _getLoopDuration(clipIndex: number): number {
    const override = this._perLoopLengthOverrides.get(clipIndex);
    const unit  = override?.unit  ?? this._loopLengthUnit;
    const value = override?.value ?? this._loopLengthValue;
    const beatDuration = 60 / this._bpm; // seconds per beat
    return unit === 'bars'
      ? beatDuration * 4 * value   // 4 beats per bar
      : beatDuration * value;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Feed ML outputs into the engine. Called each frame from the bus subscriber.
   * First 8 outputs are global param ranges (unless manually overridden).
   * Remaining outputs are per-loop params packed as [vol, pitch, pos, filt] × loops.
   */
  setOutputs(outputs: Float32Array | number[]): void {
    const count = this.getOutputCount();
    if (this._outputs.length !== count) this._resizeOutputs();

    const len = Math.min(outputs.length, count);
    for (let i = 0; i < len; i++) this._outputs[i] = outputs[i];

    // Range outputs 0-7 (skip if user has manually overridden)
    if (!this._rangeOverrides.volume) {
      this._paramRanges.volume.min = outputs[0] ?? 0;
      this._paramRanges.volume.max = outputs[1] ?? 1;
    }
    if (!this._rangeOverrides.pitch) {
      this._paramRanges.pitch.min = outputs[2] ?? 0;
      this._paramRanges.pitch.max = outputs[3] ?? 1;
    }
    if (!this._rangeOverrides.position) {
      this._paramRanges.position.min = outputs[4] ?? 0;
      this._paramRanges.position.max = outputs[5] ?? 1;
    }
    if (!this._rangeOverrides.filter) {
      this._paramRanges.filter.min = outputs[6] ?? 0;
      this._paramRanges.filter.max = outputs[7] ?? 1;
    }

    this._loopOutputs = Array.from(this._outputs).slice(N_RANGE_OUTPUTS);
  }

  setSubmode(mode: Submode): void {
    if (!SUBMODES.includes(mode)) return;
    const wasRunning = this._running;
    if (wasRunning) this.stop();
    this._submode = mode;
    if (wasRunning) void this.start();
  }

  setBeatSync(enabled: boolean): void { this._beatSync = enabled; }
  setBpm(bpm: number): void { this._bpm = Math.max(40, Math.min(240, bpm)); }
  setLoopLengthUnit(unit: 'bars' | 'beats'): void { this._loopLengthUnit = unit; }
  setLoopLengthValue(value: number): void { this._loopLengthValue = value; }
  setLockPitch(lock: boolean): void { this._lockPitch = lock; }

  setLoopLengthOverride(clipIdx: number, override: LoopLengthOverride | null): void {
    if (override === null) {
      this._perLoopLengthOverrides.delete(clipIdx);
    } else {
      this._perLoopLengthOverrides.set(clipIdx, override);
    }
  }

  clearLoopLengthOverrides(): void { this._perLoopLengthOverrides.clear(); }

  setParamRangeOverride(group: ParamGroup, min: number, max: number): void {
    this._paramRanges[group] = { min, max };
    this._rangeOverrides[group] = true;
  }

  clearParamRangeOverride(group: ParamGroup): void {
    this._rangeOverrides[group] = false;
  }

  getOutputCount(): number { return N_RANGE_OUTPUTS + this.getTotalLoops() * N_PARAMS_PER_LOOP; }
  getTotalLoops(): number  { return this._loopCounts.reduce((s, c) => s + c, 0); }
  isRunning(): boolean     { return this._running; }

  getSubmode(): Submode        { return this._submode; }
  getBpm(): number             { return this._bpm; }
  isBeatSync(): boolean        { return this._beatSync; }
  isLockPitch(): boolean       { return this._lockPitch; }
  getLoopLengthUnit(): string  { return this._loopLengthUnit; }
  getLoopLengthValue(): number { return this._loopLengthValue; }

  getClipCount(): number { return this._clips.length; }

  getParamRanges(): Readonly<ParamRanges> { return this._paramRanges; }
  getRangeOverrides(): Readonly<Record<ParamGroup, boolean>> { return this._rangeOverrides; }

  getLoopCountForClip(clipIdx: number): number { return this._loopCounts[clipIdx] ?? 0; }
  getLoopLengthOverride(clipIdx: number): LoopLengthOverride | undefined {
    return this._perLoopLengthOverrides.get(clipIdx);
  }
  hasLoopLengthOverrides(): boolean { return this._perLoopLengthOverrides.size > 0; }

  /** Dynamic param names for heatmap strip. */
  getAudioParamNames(): string[] {
    const names: string[] = [...RANGE_NAMES];
    for (let ci = 0; ci < this._clips.length; ci++) {
      for (let li = 0; li < this._loopCounts[ci]; li++) {
        const tag = `L${ci + 1}.${li + 1}`;
        names.push(`${tag} Vol`, `${tag} Pitch`, `${tag} Pos`, `${tag} Filt`);
      }
    }
    return names;
  }

  /** Dynamic param colors for heatmap strip. */
  getAudioParamColors(): string[] {
    const colors: string[] = [...RANGE_COLORS];
    for (let ci = 0; ci < this._clips.length; ci++) {
      for (let li = 0; li < this._loopCounts[ci]; li++) {
        colors.push(GROUP_COLORS.volume, GROUP_COLORS.pitch, GROUP_COLORS.position, GROUP_COLORS.filter);
      }
    }
    return colors;
  }

  // ── State persistence ────────────────────────────────────────────────────────

  getState() {
    return {
      submode:              this._submode,
      beatSync:             this._beatSync,
      bpm:                  this._bpm,
      loopCounts:           [...this._loopCounts],
      loopLengthUnit:       this._loopLengthUnit,
      loopLengthValue:      this._loopLengthValue,
      perLoopLengthOverrides: Object.fromEntries(this._perLoopLengthOverrides),
      paramRanges:          JSON.parse(JSON.stringify(this._paramRanges)) as ParamRanges,
      rangeOverrides:       { ...this._rangeOverrides },
      lockPitch:            this._lockPitch,
    };
  }

  setState(s: Partial<ReturnType<AudioCanvas['getState']>>): void {
    if (s.submode && SUBMODES.includes(s.submode as Submode)) this._submode = s.submode as Submode;
    if (s.beatSync !== undefined) this._beatSync = s.beatSync;
    if (s.bpm) this._bpm = s.bpm;
    if (Array.isArray(s.loopCounts)) {
      for (let i = 0; i < s.loopCounts.length && i < this._loopCounts.length; i++) {
        if (s.loopCounts[i] !== this._loopCounts[i]) {
          this.setClipLoopCount(i, s.loopCounts[i]);
        }
      }
    }
    if (s.loopLengthUnit) this._loopLengthUnit = s.loopLengthUnit as 'bars' | 'beats';
    if (s.loopLengthValue) this._loopLengthValue = s.loopLengthValue;
    if (s.perLoopLengthOverrides) {
      this._perLoopLengthOverrides = new Map(
        Object.entries(s.perLoopLengthOverrides).map(([k, v]) => [parseInt(k), v as LoopLengthOverride]),
      );
    }
    if (s.paramRanges) {
      for (const group of ['volume', 'pitch', 'position', 'filter'] as ParamGroup[]) {
        if (s.paramRanges[group]) {
          this._paramRanges[group].min = s.paramRanges[group].min ?? 0;
          this._paramRanges[group].max = s.paramRanges[group].max ?? 1;
        }
      }
    }
    if (s.rangeOverrides) {
      for (const group of ['volume', 'pitch', 'position', 'filter'] as ParamGroup[]) {
        if (s.rangeOverrides[group] !== undefined) {
          this._rangeOverrides[group] = s.rangeOverrides[group];
        }
      }
    }
    if (s.lockPitch !== undefined) this._lockPitch = s.lockPitch;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  destroy(): void {
    this.stop();
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => { /* ignore */ });
      this._audioCtx = null;
    }
    this._clips = [];
    this._loopCounts = [];
    this._loopPlayers = [];
    this._onVisualState = null;
    this._onOutputCountChanged = null;
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  /** Map a per-loop position value through its global param range. */
  private _resolveLoopParam(group: ParamGroup, positionValue: number): number {
    const r  = this._paramRanges[group];
    const lo = Math.min(r.min, r.max);
    const hi = Math.max(r.min, r.max);
    return Math.max(0, Math.min(1, lo + positionValue * (hi - lo)));
  }

  /** Read a per-loop param from _loopOutputs by flat loop index + param offset. */
  private _getLoopParam(flatLoopIdx: number, paramOffset: number): number {
    const base = flatLoopIdx * N_PARAMS_PER_LOOP;
    return this._loopOutputs[base + paramOffset] ?? 0.5;
  }

  private _emitOutputCountChanged(): void {
    this._onOutputCountChanged?.(this.getOutputCount());
  }

  /** Emit current visual state, built from idle clip data (used after stop / load). */
  private _emitVisualState(): void {
    const clipVisuals: AudioCanvasVisualState['clips'][0][] = this._clips.map((clip, i) => ({
      name:         clip.name,
      duration:     clip.duration,
      waveformData: clip.waveformData,
      loopStart:    0,
      loopEnd:      1,
      playhead:     null,
      label:        'idle',
      level:        0,
      loopCount:    this._loopCounts[i],
      activeColor:  '#4a90d9',
    }));
    this._emitVisualStateWith(clipVisuals);
  }

  private _emitVisualStateWith(clips: AudioCanvasVisualState['clips'][0][]): void {
    this._onVisualState?.({
      clips,
      running:     this._running,
      submode:     this._submode,
      paramRanges: this._paramRanges,
    });
  }
}
