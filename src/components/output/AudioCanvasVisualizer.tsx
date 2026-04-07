/**
 * AudioCanvasVisualizer Component — audio-canvas output mode UI.
 *
 * Active when outputMode === 'audio-canvas'.
 * Wraps the AudioCanvas engine (src/core/audio/audio-canvas.ts) and renders:
 *   - A Canvas2D waveform display for each loaded clip
 *   - A drag-and-drop zone for audio file import
 *   - A control bar (submode, beat-sync, BPM, lock-pitch, play/stop)
 *   - A param range panel (dual-thumb sliders for vol/pitch/pos/filter ranges)
 *
 * Architecture:
 *   - Lazy AudioContext init: engine.initAudio() is called on first user interaction
 *     (play click or file drop), delegating context acquisition to useAudioContext().
 *   - ML outputs arrive via 'output.audiocanvas' bus topic and are forwarded to
 *     engine.setOutputs() on each emission.
 *   - Visual state (waveform + playback positions) is pushed back from the engine
 *     via engine.onVisualState() callback and redrawn each rAF frame.
 *   - Canvas waveform rendering is done manually (no external deps).
 */

import {
  onMount,
  onCleanup,
  createEffect,
  createSignal,
  For,
  Show,
} from 'solid-js';
import type { MLStore } from '../../stores/ml-store';
import type { SignalBus } from '../../bus/signal-bus';
import { useAudioContext } from '../../hooks/useAudioContext';
import {
  AudioCanvas,
  type AudioCanvasVisualState,
  type Submode,
  type ParamGroup,
  SUBMODES,
  GROUP_COLORS,
} from '../../core/audio/audio-canvas';
import './audio-canvas.css';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AudioCanvasVisualizerProps {
  mlStore: MLStore;
  bus: SignalBus;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDur(s: number): string {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function truncateName(name: string, max = 18): string {
  return name.length > max ? name.slice(0, max) + '\u2026' : name;
}

/**
 * Draw a waveform on a canvas element using Float32Array peak data.
 * loopStart / loopEnd are normalized 0-1 positions for the highlighted loop window.
 * playhead is a normalized 0-1 position for the playback cursor, or null.
 * color is the fill stroke color.
 */
function drawWaveform(
  canvas: HTMLCanvasElement,
  waveformData: Float32Array,
  loopStart: number,
  loopEnd: number,
  playhead: number | null,
  color: string,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const d = waveformData;

  // Background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#f0f4ff';
  ctx.fillRect(0, 0, w, h);

  // Waveform shape
  ctx.beginPath();
  for (let i = 0; i < d.length; i++) {
    const x = (i / d.length) * w;
    const a = d[i] * h * 0.44;
    i === 0 ? ctx.moveTo(x, h / 2 - a) : ctx.lineTo(x, h / 2 - a);
  }
  for (let i = d.length - 1; i >= 0; i--) {
    ctx.lineTo((i / d.length) * w, h / 2 + d[i] * h * 0.44);
  }
  ctx.closePath();
  ctx.fillStyle = `${color}40`; // 25% opacity
  ctx.fill();
  ctx.strokeStyle = `${color}b3`; // 70% opacity
  ctx.lineWidth = 1;
  ctx.stroke();

  // Loop window highlight
  if (loopEnd > loopStart) {
    const sx = loopStart * w;
    const ex = loopEnd   * w;
    ctx.fillStyle = 'rgba(0, 122, 255, 0.12)';
    ctx.fillRect(sx, 0, ex - sx, h);
    ctx.strokeStyle = 'rgba(0, 122, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    ctx.moveTo(ex, 0); ctx.lineTo(ex, h);
    ctx.stroke();
  }

  // Playhead
  if (playhead !== null) {
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playhead * w, 0);
    ctx.lineTo(playhead * w, h);
    ctx.stroke();
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AudioCanvasVisualizer(props: AudioCanvasVisualizerProps) {
  // ── Audio ──────────────────────────────────────────────────────────────────

  const audioMgr = useAudioContext();
  const engine   = new AudioCanvas();

  // ── DOM refs ───────────────────────────────────────────────────────────────

  let rootRef!: HTMLDivElement;
  let fileInputRef!: HTMLInputElement;

  // Canvas refs keyed by clip index — populated by For loop
  const waveCanvasRefs: HTMLCanvasElement[] = [];

  // ── Reactive state ─────────────────────────────────────────────────────────

  const [visualState, setVisualState] = createSignal<AudioCanvasVisualState>({
    clips: [],
    running: false,
    submode: 'remix',
    paramRanges: {
      volume:   { min: 0, max: 1 },
      pitch:    { min: 0, max: 1 },
      position: { min: 0, max: 1 },
      filter:   { min: 0, max: 1 },
    },
  });

  const [submode, setSubmode] = createSignal<Submode>('remix');
  const [beatSync, setBeatSync] = createSignal(false);
  const [bpm, setBpm] = createSignal(120);
  const [lockPitch, setLockPitch] = createSignal(false);
  const [running, setRunning] = createSignal(false);
  const [clipCount, setClipCount] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);

  // Range panel: local mirror of engine state for UI reactivity
  const [paramRanges, setParamRanges] = createSignal(engine.getParamRanges());
  const [rangeOverrides, setRangeOverrides] = createSignal(engine.getRangeOverrides());

  // ── rAF render loop ────────────────────────────────────────────────────────

  let rafId = 0;

  function renderFrame(): void {
    const state = visualState();
    state.clips.forEach((clip, i) => {
      const canvas = waveCanvasRefs[i];
      if (!canvas) return;
      drawWaveform(
        canvas,
        clip.waveformData,
        clip.loopStart,
        clip.loopEnd,
        clip.playhead,
        clip.activeColor,
      );
    });
    rafId = requestAnimationFrame(renderFrame);
  }

  function startRaf(): void {
    stopRaf();
    rafId = requestAnimationFrame(renderFrame);
  }

  function stopRaf(): void {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  // ── Engine wiring ──────────────────────────────────────────────────────────

  engine.onVisualState((state) => {
    setVisualState(state);
    setRunning(state.running);
    setSubmode(state.submode);
    setParamRanges({ ...state.paramRanges });
    setRangeOverrides({ ...engine.getRangeOverrides() });
  });

  engine.onOutputCountChanged((count) => {
    setClipCount(engine.getClipCount());
    // No-op for now — heatmap could be wired here if desired
    void count;
  });

  // ── Bus subscription ───────────────────────────────────────────────────────

  onMount(() => {
    // Subscribe to ML outputs on the audiocanvas bus topic
    const topic = props.bus.createTopic<Float32Array>('output.audiocanvas');
    const unsub = topic.subscribe((outputs) => {
      engine.setOutputs(outputs);
    });
    onCleanup(unsub);

    // Start rAF loop when mode is active
    startRaf();
    onCleanup(stopRaf);
  });

  // ── React to output mode ───────────────────────────────────────────────────

  createEffect(() => {
    const mode = props.mlStore.state.outputMode;
    if (mode === 'audio-canvas') {
      startRaf();
    } else {
      stopRaf();
    }
  });

  // ── File drop handling ─────────────────────────────────────────────────────

  async function handleFiles(files: FileList | File[]): Promise<void> {
    // Lazy AudioContext init on first file drop
    if (!audioMgr.isReady()) {
      await audioMgr.resume();
      const ctx = audioMgr.getOrCreateContext();
      await engine.initAudio(ctx);
    }
    await engine.loadFiles(files);
    setClipCount(engine.getClipCount());
  }

  // ── Control bar handlers ───────────────────────────────────────────────────

  async function handlePlayPause(): Promise<void> {
    if (running()) {
      engine.stop();
    } else {
      // Lazy AudioContext init on first play
      if (!audioMgr.isReady()) {
        await audioMgr.resume();
        const ctx = audioMgr.getOrCreateContext();
        await engine.initAudio(ctx);
      }
      await engine.start();
    }
    setRunning(engine.isRunning());
  }

  function handleSubmodeChange(mode: Submode): void {
    engine.setSubmode(mode);
    setSubmode(mode);
  }

  function handleBeatSyncChange(enabled: boolean): void {
    engine.setBeatSync(enabled);
    setBeatSync(enabled);
  }

  function handleBpmChange(value: string): void {
    const n = Math.max(40, Math.min(240, parseFloat(value) || 120));
    engine.setBpm(n);
    setBpm(n);
  }

  function handleLockPitch(): void {
    const next = !lockPitch();
    engine.setLockPitch(next);
    setLockPitch(next);
  }

  // ── Range panel drag ───────────────────────────────────────────────────────

  function setupRangeThumbDrag(
    group: ParamGroup,
    which: 'min' | 'max',
    trackEl: HTMLDivElement,
  ): (e: MouseEvent | TouchEvent) => void {
    return function onDown(e: MouseEvent | TouchEvent) {
      e.preventDefault();
      e.stopPropagation();

      const onMove = (ev: MouseEvent | TouchEvent) => {
        ev.preventDefault();
        const clientX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
        const rect = trackEl.getBoundingClientRect();
        const norm = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const current = paramRanges();
        const updated = { ...current };
        updated[group] = { ...updated[group], [which]: norm };
        engine.setParamRangeOverride(group, updated[group].min, updated[group].max);
        setParamRanges(updated);
        setRangeOverrides({ ...engine.getRangeOverrides() });
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove as any);
        document.removeEventListener('touchend', onUp);
      };

      document.addEventListener('mousemove', onMove, { passive: false });
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove as any, { passive: false });
      document.addEventListener('touchend', onUp);
    };
  }

  function handleClearRangeOverride(group: ParamGroup): void {
    engine.clearParamRangeOverride(group);
    setRangeOverrides({ ...engine.getRangeOverrides() });
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  onCleanup(() => {
    stopRaf();
    engine.destroy();
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  const paramGroups: Array<{ key: ParamGroup; label: string }> = [
    { key: 'volume',   label: 'Volume' },
    { key: 'pitch',    label: 'Pitch' },
    { key: 'position', label: 'Position' },
    { key: 'filter',   label: 'Filter' },
  ];

  return (
    <div
      ref={rootRef}
      class={`audio-canvas-root${dragging() ? ' drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer?.files.length) void handleFiles(e.dataTransfer.files);
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.opus,.webm,.mp4,.wma,.aif,.aiff"
        style="display:none"
        onChange={(e) => {
          const files = e.currentTarget.files;
          if (files?.length) void handleFiles(files);
          e.currentTarget.value = '';
        }}
      />

      {/* Drop overlay (only visible when no clips loaded) */}
      <Show when={clipCount() === 0}>
        <div class="audio-canvas-drop-overlay">
          <div class="audio-canvas-drop-inner">
            <svg
              width="48" height="48" viewBox="0 0 24 24"
              fill="none" stroke="#ccc" stroke-width="1.5"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div>Drop audio files here</div>
            <div class="drop-hint-sub">MP3, WAV, FLAC, OGG, M4A, OPUS, WebM, AIFF</div>
          </div>
        </div>
      </Show>

      {/* Clip cards grid */}
      <Show when={clipCount() > 0}>
        <div class="audio-canvas-clip-grid">
          <For each={visualState().clips}>
            {(clip, i) => {
              let trackRef!: HTMLDivElement;
              return (
                <div
                  class={`audio-canvas-clip-card${clip.level > 0.05 ? ' active' : ''}`}
                  style={{
                    'border-color': clip.level > 0.05
                      ? `${clip.activeColor}${Math.round(40 + clip.level * 180).toString(16).padStart(2, '0')}`
                      : '#ddd',
                    'box-shadow': clip.level > 0.05
                      ? `0 0 ${clip.level * 18}px ${clip.activeColor}${Math.round(clip.level * 80).toString(16).padStart(2, '0')}`
                      : '0 2px 8px rgba(0,0,0,0.06)',
                  }}
                >
                  <div class="audio-canvas-clip-header">
                    <span class="audio-canvas-clip-name" title={clip.name}>
                      {truncateName(clip.name)}
                    </span>
                    <span class="audio-canvas-clip-dur">{fmtDur(clip.duration)}</span>
                  </div>
                  {/* Canvas — ref stored by index */}
                  <canvas
                    ref={(el) => { waveCanvasRefs[i()] = el; }}
                    class="audio-canvas-clip-wave"
                    width={320}
                    height={100}
                  />
                  <div class="audio-canvas-clip-status">
                    <span class="audio-canvas-clip-label">{clip.label}</span>
                    <span class="audio-canvas-clip-loops">×{clip.loopCount}</span>
                    <div class="audio-canvas-clip-level-track" ref={trackRef!}>
                      <div
                        class="audio-canvas-clip-level-bar"
                        style={{
                          width: `${Math.round(clip.level * 100)}%`,
                          background: clip.activeColor,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      {/* Param range panel */}
      <Show when={clipCount() > 0}>
        <div class="audio-canvas-range-panel">
          <For each={paramGroups}>
            {({ key, label }) => {
              let trackEl!: HTMLDivElement;
              const color = GROUP_COLORS[key];
              return (
                <div class="audio-canvas-range-row">
                  <span class="audio-canvas-range-label" style={{ color }}>
                    {label}
                  </span>
                  {/* Override indicator dot */}
                  <div
                    class="audio-canvas-range-override-dot"
                    style={{
                      background: color,
                      opacity: rangeOverrides()[key] ? '1' : '0',
                    }}
                  />
                  <div
                    class="audio-canvas-range-track"
                    ref={trackEl!}
                    onDblClick={() => handleClearRangeOverride(key)}
                  >
                    <div
                      class="audio-canvas-range-fill"
                      style={{
                        background: color,
                        left:  `${Math.min(paramRanges()[key].min, paramRanges()[key].max) * 100}%`,
                        width: `${Math.abs(paramRanges()[key].max - paramRanges()[key].min) * 100}%`,
                      }}
                    />
                    {/* Min thumb */}
                    <div
                      class="audio-canvas-range-thumb"
                      style={{
                        background: color,
                        left: `${paramRanges()[key].min * 100}%`,
                      }}
                      onMouseDown={setupRangeThumbDrag(key, 'min', trackEl)}
                      onTouchStart={setupRangeThumbDrag(key, 'min', trackEl) as any}
                    />
                    {/* Max thumb */}
                    <div
                      class="audio-canvas-range-thumb"
                      style={{
                        background: color,
                        left: `${paramRanges()[key].max * 100}%`,
                      }}
                      onMouseDown={setupRangeThumbDrag(key, 'max', trackEl)}
                      onTouchStart={setupRangeThumbDrag(key, 'max', trackEl) as any}
                    />
                  </div>
                  <span class="audio-canvas-range-value">
                    {Math.min(paramRanges()[key].min, paramRanges()[key].max).toFixed(2)}
                    {' \u2013 '}
                    {Math.max(paramRanges()[key].min, paramRanges()[key].max).toFixed(2)}
                  </span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      {/* Control bar */}
      <div class="audio-canvas-control-bar">
        {/* Submode buttons */}
        <div style={{ display: 'flex', gap: '3px' }}>
          <For each={SUBMODES}>
            {(mode) => (
              <button
                class={`audio-canvas-submode-btn${submode() === mode ? ' active' : ''}`}
                onClick={() => handleSubmodeChange(mode)}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            )}
          </For>
        </div>

        <div class="audio-canvas-sep" />

        {/* Beat sync + BPM */}
        <div style={{ display: 'flex', gap: '3px', 'align-items': 'center' }}>
          <button
            class={`audio-canvas-timing-btn${!beatSync() ? ' active' : ''}`}
            onClick={() => handleBeatSyncChange(false)}
          >
            Free
          </button>
          <button
            class={`audio-canvas-timing-btn${beatSync() ? ' active' : ''}`}
            onClick={() => handleBeatSyncChange(true)}
          >
            Beat
          </button>
          <input
            class="audio-canvas-bpm-input"
            type="number"
            value={bpm()}
            min={40}
            max={240}
            onChange={(e) => handleBpmChange(e.currentTarget.value)}
          />
        </div>

        <div class="audio-canvas-sep" />

        {/* Lock pitch */}
        <button
          class={`audio-canvas-icon-btn${lockPitch() ? ' active' : ''}`}
          title="Lock pitch (ignore ML pitch output)"
          onClick={handleLockPitch}
        >
          1&#215;
        </button>

        <div class="audio-canvas-sep" />

        {/* Play / stop */}
        <button
          class="audio-canvas-play-btn"
          title={running() ? 'Stop' : 'Play'}
          onClick={() => void handlePlayPause()}
        >
          {running()
            ? (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="2" width="4" height="12" />
                <rect x="9" y="2" width="4" height="12" />
              </svg>
            )
            : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 2l10 6-10 6z" />
              </svg>
            )
          }
        </button>

        {/* Clip count */}
        <span class="audio-canvas-clip-count">
          {clipCount()} {clipCount() === 1 ? 'clip' : 'clips'}
        </span>

        <div class="audio-canvas-sep" />

        {/* Add files button */}
        <button
          class="audio-canvas-add-btn"
          title="Import audio files"
          onClick={() => fileInputRef.click()}
        >
          +
        </button>
      </div>
    </div>
  );
}
