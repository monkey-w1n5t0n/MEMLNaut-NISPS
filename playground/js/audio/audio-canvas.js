// audio-canvas.js — Audio Canvas mode for NISPS Immersive
// Infinite white canvas, drag-and-drop audio files, NISPS maps joystick→36 audio params
// 4 submodes: remix, granular, drone, slicer

export const N_AUDIO_OUTPUTS = 36;

// Output layout (indices 0–35):
//  [0..8]   clip volumes / grain density / slicer clip selector
//  [9..17]  clip pitch/speed / grain pitch / slicer position
//  [18..26] clip loop start / grain position / slicer speed
//  [27..35] clip filter cutoff / grain size / unused

const SUBMODES = ['remix', 'granular', 'drone', 'slicer'];
const CELL_W = 220;
const CELL_H = 110;
const CELL_GAP = 14;
const CELLS_PER_ROW = 3;

// Generate param names for heatmap
export const AUDIO_PARAM_NAMES = [
  ...Array.from({ length: 9 }, (_, i) => `Vol ${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `Pitch ${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `Loop ${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `Filt ${i + 1}`),
];

export const AUDIO_PARAM_COLORS = [
  ...Array.from({ length: 9 }, (_, i) => `hsl(${210 + i * 8}, 70%, 55%)`),   // blues - volumes
  ...Array.from({ length: 9 }, (_, i) => `hsl(${120 + i * 8}, 60%, 50%)`),   // greens - pitch
  ...Array.from({ length: 9 }, (_, i) => `hsl(${30 + i * 8}, 75%, 55%)`),    // oranges - loop
  ...Array.from({ length: 9 }, (_, i) => `hsl(${280 + i * 8}, 60%, 60%)`),   // purples - filter
];

function cellPosition(index) {
  const col = index % CELLS_PER_ROW;
  const row = Math.floor(index / CELLS_PER_ROW);
  return { x: col * (CELL_W + CELL_GAP), y: row * (CELL_H + CELL_GAP) };
}

export class AudioCanvas {
  constructor(container) {
    this._container = container;
    this._audioCtx = null;
    this._masterGain = null;
    this._clips = [];     // { id, name, buffer, duration, waveformData, _cell, _overviewCanvas, _detailCanvas, _statusBar }
    this._players = [];   // per-clip player state
    this._cellView = [];  // 'overview' | 'detail' per clip
    this._granularTimers = [];
    this._slicerTimer = null;
    this._slicerStep = 0;
    this._loopUpdateTimer = null;
    this._submode = 'remix';
    this._beatSync = false;
    this._bpm = 120;
    this._running = false;
    this._outputs = new Float32Array(N_AUDIO_OUTPUTS).fill(0.5);
    this._panX = 40;
    this._panY = 40;
    this._zoom = 1;

    this._setupDOM();
  }

  // ── DOM setup ──────────────────────────────────────────────────────────────

  _setupDOM() {
    this._container.innerHTML = '';
    Object.assign(this._container.style, {
      position: 'absolute', inset: '0',
      overflow: 'hidden',
      background: '#f0f0f0',
      cursor: 'grab',
      touchAction: 'none',
    });

    // Infinite canvas div (child elements positioned absolutely)
    this._canvas = document.createElement('div');
    this._canvas.style.cssText = `
      position: absolute; top: 0; left: 0;
      width: 6000px; height: 6000px;
      transform-origin: 0 0;
    `;
    this._applyTransform();
    this._container.appendChild(this._canvas);

    // Drop overlay
    this._dropOverlay = document.createElement('div');
    this._dropOverlay.style.cssText = `
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none;
      transition: opacity 0.3s;
    `;
    this._dropOverlay.innerHTML = `
      <div style="text-align:center; color:#aaa; font-family:'JetBrains Mono',monospace; font-size:0.8rem">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5" style="display:block;margin:0 auto 12px">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <div>Drop audio files here</div>
        <div style="color:#bbb;font-size:0.68rem;margin-top:4px">MP3, WAV, FLAC, OGG, M4A</div>
      </div>
    `;
    this._container.appendChild(this._dropOverlay);

    // Control bar
    this._buildControlBar();

    // Drag-and-drop
    this._container.addEventListener('dragover', e => {
      e.preventDefault();
      this._container.style.outline = '2px dashed #007aff';
    });
    this._container.addEventListener('dragleave', () => {
      this._container.style.outline = '';
    });
    this._container.addEventListener('drop', e => {
      e.preventDefault();
      this._container.style.outline = '';
      this._handleDrop(e.dataTransfer.files);
    });

    this._setupPanZoom();
  }

  _buildControlBar() {
    const bar = document.createElement('div');
    bar.style.cssText = `
      position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 6px;
      background: rgba(20,20,20,0.9); color: #fff;
      padding: 7px 12px; border-radius: 24px;
      font-family: 'JetBrains Mono', monospace; font-size: 0.68rem;
      z-index: 10; backdrop-filter: blur(10px);
      box-shadow: 0 4px 20px rgba(0,0,0,0.35);
      white-space: nowrap;
    `;
    bar.innerHTML = `
      <div class="ac-submode-group" style="display:flex;gap:3px">
        ${SUBMODES.map(m => `<button class="ac-sbtn" data-submode="${m}" style="
          padding:4px 8px; border-radius:12px; border:none; cursor:pointer;
          background:transparent; color:#aaa; font-family:inherit; font-size:0.68rem;
          transition:background 0.15s,color 0.15s;
        ">${m.charAt(0).toUpperCase() + m.slice(1)}</button>`).join('')}
      </div>
      <div style="width:1px;height:16px;background:rgba(255,255,255,0.15)"></div>
      <div style="display:flex;gap:3px">
        <button class="ac-tbtn active" data-sync="free" style="
          padding:4px 7px; border-radius:10px; border:none; cursor:pointer;
          background:rgba(255,255,255,0.1); color:#fff; font-family:inherit; font-size:0.62rem;
        ">Free</button>
        <button class="ac-tbtn" data-sync="sync" style="
          padding:4px 7px; border-radius:10px; border:none; cursor:pointer;
          background:transparent; color:#aaa; font-family:inherit; font-size:0.62rem;
        ">Beat</button>
        <input id="ac-bpm" type="number" value="120" min="40" max="240" style="
          width:42px; padding:2px 4px; border-radius:8px; border:1px solid rgba(255,255,255,0.2);
          background:rgba(255,255,255,0.08); color:#fff; font-family:inherit; font-size:0.62rem;
          text-align:center;
        ">
      </div>
      <div style="width:1px;height:16px;background:rgba(255,255,255,0.15)"></div>
      <button id="ac-play" style="
        width:28px; height:28px; border-radius:50%; border:none; cursor:pointer;
        background:rgba(0,122,255,0.8); color:#fff; display:flex; align-items:center; justify-content:center;
        transition:background 0.15s;
      ">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z"/></svg>
      </button>
      <span id="ac-clip-ct" style="color:#666;min-width:44px">0 clips</span>
    `;
    this._container.appendChild(bar);
    this._controlBar = bar;

    // Submode buttons
    bar.querySelectorAll('.ac-sbtn').forEach(btn => {
      btn.addEventListener('click', () => this.setSubmode(btn.dataset.submode));
    });
    this._syncSubmodeUI();

    // Timing buttons
    bar.querySelectorAll('.ac-tbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._beatSync = btn.dataset.sync === 'sync';
        bar.querySelectorAll('.ac-tbtn').forEach(b => {
          b.style.background = b === btn ? 'rgba(255,255,255,0.1)' : 'transparent';
          b.style.color = b === btn ? '#fff' : '#aaa';
        });
      });
    });

    bar.querySelector('#ac-bpm').addEventListener('change', e => {
      this._bpm = Math.max(40, Math.min(240, parseFloat(e.target.value) || 120));
    });

    bar.querySelector('#ac-play').addEventListener('click', () => {
      if (this._running) this.stop(); else this.start();
    });
  }

  _syncSubmodeUI() {
    this._controlBar.querySelectorAll('.ac-sbtn').forEach(btn => {
      const active = btn.dataset.submode === this._submode;
      btn.style.background = active ? 'rgba(255,255,255,0.15)' : 'transparent';
      btn.style.color = active ? '#fff' : '#aaa';
    });
  }

  _setupPanZoom() {
    const pointers = new Map();
    let lastDist = null;

    this._container.addEventListener('pointerdown', e => {
      if (e.target.closest('.ac-cell') || e.target.closest('[data-submode]') ||
          e.target.closest('[data-sync]') || e.target.closest('#ac-play') ||
          e.target.closest('#ac-bpm')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._container.setPointerCapture(e.pointerId);
      if (pointers.size === 1) this._container.style.cursor = 'grabbing';
    });

    this._container.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (lastDist !== null) {
          this._zoom = Math.max(0.15, Math.min(3, this._zoom * (dist / lastDist)));
          this._applyTransform();
        }
        lastDist = dist;
      } else if (pointers.size === 1) {
        this._panX += e.clientX - prev.x;
        this._panY += e.clientY - prev.y;
        this._applyTransform();
      }
    });

    this._container.addEventListener('pointerup', e => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        lastDist = null;
        this._container.style.cursor = 'grab';
      }
    });

    this._container.addEventListener('wheel', e => {
      e.preventDefault();
      this._zoom = Math.max(0.15, Math.min(3, this._zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      this._applyTransform();
    }, { passive: false });
  }

  _applyTransform() {
    this._canvas.style.transform = `translate(${this._panX}px, ${this._panY}px) scale(${this._zoom})`;
  }

  // ── Audio file handling ────────────────────────────────────────────────────

  async _handleDrop(files) {
    if (!this._audioCtx) await this._initAudio();
    const valid = [...files].filter(f =>
      f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(f.name));
    for (const file of valid) await this._loadFile(file);
  }

  async _loadFile(file) {
    let buffer;
    try {
      const ab = await file.arrayBuffer();
      buffer = await this._audioCtx.decodeAudioData(ab);
    } catch (err) {
      console.warn('[AudioCanvas] decode failed:', file.name, err);
      return;
    }
    const id = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const clip = {
      id,
      name: file.name.replace(/\.[^.]+$/, ''),
      buffer,
      duration: buffer.duration,
      waveformData: this._extractWaveform(buffer),
    };
    this._clips.push(clip);
    this._players.push(this._makePlayer(clip));
    this._cellView.push('overview');
    this._granularTimers.push(null);
    this._createCell(clip, this._clips.length - 1);
    this._updateUI();
    return id;
  }

  _extractWaveform(buffer, resolution = 500) {
    const ch = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / resolution));
    const data = new Float32Array(resolution);
    for (let i = 0; i < resolution; i++) {
      let peak = 0;
      for (let j = 0; j < step; j++) peak = Math.max(peak, Math.abs(ch[i * step + j] || 0));
      data[i] = peak;
    }
    return data;
  }

  _makePlayer(clip) {
    return {
      clip, source: null, gainNode: null, filterNode: null,
      playing: false, loopStart: 0, loopEnd: clip.duration,
    };
  }

  // ── Cell DOM ───────────────────────────────────────────────────────────────

  _createCell(clip, index) {
    const { x, y } = cellPosition(index);

    const cell = document.createElement('div');
    cell.className = 'ac-cell';
    cell.dataset.clipId = clip.id;
    cell.dataset.idx = index;
    cell.style.cssText = `
      position: absolute; left: ${x}px; top: ${y}px;
      width: ${CELL_W}px; height: ${CELL_H}px;
      background: #fff; border: 1.5px solid #ddd; border-radius: 10px;
      overflow: hidden; cursor: pointer; user-select: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    `;

    // Header
    const hdr = document.createElement('div');
    hdr.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; height: 20px;
      display: flex; justify-content: space-between; align-items: center;
      padding: 0 8px; font-family: 'JetBrains Mono', monospace;
      font-size: 0.58rem; color: #888; background: #fafafa;
      border-bottom: 1px solid #eee;
    `;
    hdr.innerHTML = `
      <span>${clip.name.length > 20 ? clip.name.slice(0, 20) + '…' : clip.name}</span>
      <span>${this._fmtDur(clip.duration)}</span>
    `;

    // Waveform canvases
    const overviewC = document.createElement('canvas');
    overviewC.width = CELL_W * 2; overviewC.height = 120;
    overviewC.style.cssText = `position:absolute;top:20px;left:0;width:${CELL_W}px;height:60px;`;

    const detailC = document.createElement('canvas');
    detailC.width = CELL_W * 2; detailC.height = 120;
    detailC.style.cssText = `position:absolute;top:20px;left:0;width:${CELL_W}px;height:60px;display:none;`;

    // Status bar
    const status = document.createElement('div');
    status.style.cssText = `
      position: absolute; bottom: 0; left: 0; right: 0; height: 24px;
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 8px; font-family: 'JetBrains Mono', monospace;
      font-size: 0.56rem; color: #bbb; background: #fafafa;
      border-top: 1px solid #eee;
    `;
    status.innerHTML = `
      <span class="ac-st-label">idle</span>
      <div style="width:60px;height:3px;background:#eee;border-radius:2px;overflow:hidden">
        <div class="ac-st-level" style="width:0%;height:100%;background:#4a90d9;border-radius:2px;transition:width 0.08s"></div>
      </div>
    `;

    cell.appendChild(hdr);
    cell.appendChild(overviewC);
    cell.appendChild(detailC);
    cell.appendChild(status);

    // Toggle overview/detail on tap (not when dragging canvas)
    let tapStart = 0;
    cell.addEventListener('pointerdown', () => { tapStart = Date.now(); });
    cell.addEventListener('pointerup', e => {
      if (Date.now() - tapStart < 200) {
        const idx = parseInt(cell.dataset.idx);
        this._cellView[idx] = this._cellView[idx] === 'overview' ? 'detail' : 'overview';
        this._syncCellView(idx);
      }
      e.stopPropagation();
    });

    this._canvas.appendChild(cell);
    clip._cell = cell;
    clip._overviewC = overviewC;
    clip._detailC = detailC;
    clip._status = status;

    this._drawOverview(clip);
    this._syncCellView(index);
  }

  _syncCellView(idx) {
    const clip = this._clips[idx];
    if (!clip) return;
    const v = this._cellView[idx];
    clip._overviewC.style.display = v === 'overview' ? 'block' : 'none';
    clip._detailC.style.display = v === 'detail' ? 'block' : 'none';
  }

  _drawOverview(clip) {
    const c = clip._overviewC;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const d = clip.waveformData;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f0f4ff';
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    for (let i = 0; i < d.length; i++) {
      const x = (i / d.length) * w;
      const a = d[i] * h * 0.44;
      const mid = h / 2;
      i === 0 ? ctx.moveTo(x, mid - a) : ctx.lineTo(x, mid - a);
    }
    for (let i = d.length - 1; i >= 0; i--) {
      ctx.lineTo((i / d.length) * w, h / 2 + d[i] * h * 0.44);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(74,144,217,0.25)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(74,144,217,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  _drawOverviewWithLoop(clip, loopStart, loopEnd) {
    this._drawOverview(clip);
    const c = clip._overviewC;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const sx = loopStart * w, ex = loopEnd * w;
    ctx.fillStyle = 'rgba(0,122,255,0.12)';
    ctx.fillRect(sx, 0, ex - sx, h);
    ctx.strokeStyle = 'rgba(0,122,255,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    ctx.moveTo(ex, 0); ctx.lineTo(ex, h);
    ctx.stroke();
  }

  _drawDetail(clip, loopStart, loopEnd, playhead) {
    const c = clip._detailC;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const d = clip.waveformData;
    const si = Math.floor(loopStart * d.length);
    const ei = Math.ceil(loopEnd * d.length);
    const sl = d.slice(si, ei);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff8f0';
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    for (let i = 0; i < sl.length; i++) {
      const x = (i / sl.length) * w;
      const a = sl[i] * h * 0.44;
      i === 0 ? ctx.moveTo(x, h / 2 - a) : ctx.lineTo(x, h / 2 - a);
    }
    for (let i = sl.length - 1; i >= 0; i--) {
      ctx.lineTo((i / sl.length) * w, h / 2 + sl[i] * h * 0.44);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(230,140,50,0.25)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(230,140,50,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (playhead != null) {
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playhead * w, 0);
      ctx.lineTo(playhead * w, h);
      ctx.stroke();
    }
  }

  _setCellActive(clip, label, level, color = '#4a90d9') {
    const s = clip._status;
    s.querySelector('.ac-st-label').textContent = label;
    s.querySelector('.ac-st-level').style.width = `${Math.round(level * 100)}%`;
    s.querySelector('.ac-st-level').style.background = color;
    clip._cell.style.borderColor = level > 0.05
      ? `${color}${Math.round(40 + level * 180).toString(16).padStart(2, '0')}`
      : '#ddd';
    clip._cell.style.boxShadow = level > 0.05
      ? `0 0 ${level * 18}px ${color}${Math.round(level * 80).toString(16).padStart(2, '0')}`
      : '0 2px 8px rgba(0,0,0,0.06)';
  }

  _setCellIdle(clip) {
    this._setCellActive(clip, 'idle', 0);
  }

  // ── Audio init ─────────────────────────────────────────────────────────────

  async _initAudio() {
    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this._masterGain = this._audioCtx.createGain();
    this._masterGain.gain.value = 0.75;
    this._masterGain.connect(this._audioCtx.destination);
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  async start() {
    if (this._running) return;
    if (!this._audioCtx) await this._initAudio();
    if (this._audioCtx.state === 'suspended') await this._audioCtx.resume();
    this._running = true;
    this._updatePlayBtn(true);
    this._startPlayback();
  }

  stop() {
    if (!this._running) return;
    this._running = false;
    this._updatePlayBtn(false);
    this._stopAll();
    this._clips.forEach(c => this._setCellIdle(c));
  }

  _stopAll() {
    clearInterval(this._loopUpdateTimer);
    clearTimeout(this._slicerTimer);
    this._loopUpdateTimer = null;
    this._slicerTimer = null;
    this._granularTimers.forEach((t, i) => {
      if (t) clearInterval(t);
      this._granularTimers[i] = null;
    });
    for (const p of this._players) {
      if (p.source) { try { p.source.stop(); } catch (_) {} p.source = null; }
      if (p.gainNode) { p.gainNode.disconnect(); p.gainNode = null; }
      if (p.filterNode) { p.filterNode.disconnect(); p.filterNode = null; }
      p.playing = false;
    }
  }

  _startPlayback() {
    if (this._clips.length === 0) return;
    if (this._submode === 'remix' || this._submode === 'drone') {
      this._startLooping();
    } else if (this._submode === 'granular') {
      this._startGranular();
    } else if (this._submode === 'slicer') {
      this._slicerStep = 0;
      this._scheduleSlicer();
    }
  }

  _updatePlayBtn(playing) {
    const btn = this._controlBar.querySelector('#ac-play');
    btn.innerHTML = playing
      ? `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/></svg>`
      : `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z"/></svg>`;
  }

  // ── Remix / Drone ──────────────────────────────────────────────────────────

  _startLooping() {
    for (let i = 0; i < this._clips.length; i++) this._startClipLoop(i);
    this._loopUpdateTimer = setInterval(() => this._tickLooping(), 60);
  }

  _startClipLoop(i) {
    const clip = this._clips[i];
    const player = this._players[i];

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

  _tickLooping() {
    if (!this._running) return;
    const now = this._audioCtx.currentTime;
    const isDrone = this._submode === 'drone';

    for (let i = 0; i < this._clips.length; i++) {
      const clip = this._clips[i];
      const player = this._players[i];
      if (!player.playing) continue;

      const vol = this._outputs[i] ?? 0.5;
      const pitchNorm = this._outputs[9 + i] ?? 0.5;
      const loopNorm = this._outputs[18 + i] ?? 0;
      const filtNorm = this._outputs[27 + i] ?? 0.7;

      const speed = isDrone
        ? 0.005 + pitchNorm * 0.095   // 0.005×–0.1× for drone
        : 0.5 + pitchNorm * 1.5;      // 0.5×–2.0× for remix

      // Loop window: treat loopNorm as start of a sliding window
      const winSecs = isDrone ? 120 : 15;
      const loopStart = loopNorm * Math.max(0, clip.duration - winSecs);
      const loopEnd = Math.min(loopStart + winSecs, clip.duration);
      const filterHz = 200 * Math.pow(40, filtNorm); // 200 Hz – 8000 Hz log

      player.source.playbackRate.setTargetAtTime(speed, now, 0.08);
      player.source.loopStart = loopStart;
      player.source.loopEnd = loopEnd;
      player.gainNode.gain.setTargetAtTime(isDrone ? vol * 0.7 : vol, now, 0.06);
      player.filterNode.frequency.setTargetAtTime(filterHz, now, 0.06);

      // Visuals
      const ls = loopStart / clip.duration, le = loopEnd / clip.duration;
      this._drawOverviewWithLoop(clip, ls, le);
      if (this._cellView[i] === 'detail') this._drawDetail(clip, ls, le, null);

      const color = isDrone ? '#8040c0' : '#4a90d9';
      this._setCellActive(clip, isDrone ? 'drone' : 'remix', vol, color);
    }
  }

  // ── Granular ───────────────────────────────────────────────────────────────

  _startGranular() {
    for (let i = 0; i < this._clips.length; i++) this._startClipGranular(i);
  }

  _startClipGranular(i) {
    if (this._granularTimers[i]) clearInterval(this._granularTimers[i]);
    this._granularTimers[i] = setInterval(() => {
      if (!this._running) { clearInterval(this._granularTimers[i]); return; }
      this._spawnGrain(i);
    }, 35);
  }

  _spawnGrain(i) {
    const clip = this._clips[i];
    if (!clip) return;

    const density = this._outputs[i] ?? 0.5;          // 0→rare, 1→dense
    const pitchNorm = this._outputs[9 + i] ?? 0.5;    // 0→0.5×, 1→2×
    const posNorm = this._outputs[18 + i] ?? 0.5;     // position center
    const sizeNorm = this._outputs[27 + i] ?? 0.3;    // 0→20ms, 1→400ms

    if (Math.random() > density) return;

    const grainDur = 0.02 + sizeNorm * 0.38;
    const pitch = 0.5 + pitchNorm * 1.5;
    const scatter = 0.04;
    const pos = Math.max(0, Math.min(1, posNorm + (Math.random() - 0.5) * scatter * 2));
    const startOff = pos * Math.max(0, clip.duration - grainDur);

    const gain = this._audioCtx.createGain();
    const t = this._audioCtx.currentTime;
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

    // Visuals: draw grain position
    this._drawOverviewWithLoop(clip, Math.max(0, posNorm - 0.03), Math.min(1, posNorm + 0.03));
    this._setCellActive(clip, 'granular', density, '#7040c0');
  }

  // ── Slicer ─────────────────────────────────────────────────────────────────

  _scheduleSlicer() {
    if (!this._running) return;
    const stepMs = this._beatSync ? (60000 / this._bpm / 2) : (60000 / this._bpm);
    this._slicerTimer = setTimeout(() => {
      this._fireSlice();
      this._scheduleSlicer();
    }, stepMs);
  }

  _fireSlice() {
    const step = this._slicerStep % 8;
    this._slicerStep++;

    if (this._clips.length === 0) return;

    const clipNorm = this._outputs[step] ?? 0.5;
    const clipIdx = Math.min(this._clips.length - 1, Math.floor(clipNorm * this._clips.length));
    const clip = this._clips[clipIdx];

    const posNorm = this._outputs[9 + step] ?? 0.5;
    const speedNorm = this._outputs[18 + step] ?? 0.5;
    const sliceDur = Math.min(1.2, (this._beatSync ? 60 / this._bpm / 2 : 60 / this._bpm));
    const speed = 0.5 + speedNorm * 1.5;
    const startOff = posNorm * Math.max(0, clip.duration - sliceDur);

    const gain = this._audioCtx.createGain();
    const t = this._audioCtx.currentTime;
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

    // Visuals: flash active cell, idle others
    this._clips.forEach((c, i) => {
      if (i === clipIdx) {
        this._drawOverviewWithLoop(c, posNorm - 0.02, posNorm + 0.02);
        this._setCellActive(c, `slice ${step}`, speedNorm, '#ff3b30');
      } else {
        this._drawOverview(c);
        this._setCellIdle(c);
      }
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setOutputs(outputs) {
    for (let i = 0; i < Math.min(outputs.length, N_AUDIO_OUTPUTS); i++) {
      this._outputs[i] = outputs[i];
    }
  }

  setSubmode(mode) {
    if (!SUBMODES.includes(mode)) return;
    const wasRunning = this._running;
    if (wasRunning) this.stop();
    this._submode = mode;
    this._syncSubmodeUI();
    if (wasRunning) this.start();
  }

  getOutputCount() { return N_AUDIO_OUTPUTS; }
  isRunning() { return this._running; }

  destroy() {
    this.stop();
    if (this._audioCtx) { this._audioCtx.close(); this._audioCtx = null; }
    this._container.innerHTML = '';
  }

  getState() {
    return { submode: this._submode, beatSync: this._beatSync, bpm: this._bpm, panX: this._panX, panY: this._panY, zoom: this._zoom };
  }

  setState(s) {
    if (s.submode) { this._submode = s.submode; this._syncSubmodeUI(); }
    if (s.beatSync !== undefined) this._beatSync = s.beatSync;
    if (s.bpm) this._bpm = s.bpm;
    if (s.panX !== undefined) this._panX = s.panX;
    if (s.panY !== undefined) this._panY = s.panY;
    if (s.zoom) this._zoom = s.zoom;
    this._applyTransform();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _fmtDur(s) {
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  _updateUI() {
    const ct = this._container.querySelector('#ac-clip-ct');
    if (ct) ct.textContent = `${this._clips.length} clip${this._clips.length !== 1 ? 's' : ''}`;
    this._dropOverlay.style.opacity = this._clips.length > 0 ? '0' : '1';
  }
}
