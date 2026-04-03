// audio-canvas.js — Audio Canvas mode for NISPS Immersive
// Infinite white canvas, drag-and-drop audio files, NISPS maps joystick->audio params
// Per-clip configurable loop count (0-4), dynamic output sizing
// Beat-synced loop length with per-clip overrides
// Param range groups with dual-thumb sliders
// 4 submodes: remix, granular, drone, slicer

// Output layout (dynamic):
//  [0..7]     global param ranges: vol min/max, pitch min/max, pos min/max, filt min/max
//  [8..]      per-loop params, packed contiguously: [vol, pitch, pos, filt] x totalLoops
//             Loop order follows clip order (clip 0's loops first, then clip 1's, etc.)

const N_RANGE_OUTPUTS = 8;  // reserved range endpoint slots
const N_PARAMS_PER_LOOP = 4; // volume, pitch, position, filter
const MAX_LOOPS_PER_CLIP = 4;

const SUBMODES = ['remix', 'granular', 'drone', 'slicer'];
const CELL_W = 220;
const CELL_H = 110;
const CELL_GAP = 14;
const CELLS_PER_ROW = 3;

// Param group colors
const GROUP_COLORS = {
  volume:   '#4a90d9',
  pitch:    '#50c878',
  position: '#e88c32',
  filter:   '#9b59b6',
};

// Range endpoint placeholder names/colors (first 8 outputs)
const RANGE_NAMES = ['Vol Min', 'Vol Max', 'Pitch Min', 'Pitch Max', 'Pos Min', 'Pos Max', 'Filt Min', 'Filt Max'];
const RANGE_COLORS = [
  GROUP_COLORS.volume, GROUP_COLORS.volume,
  GROUP_COLORS.pitch, GROUP_COLORS.pitch,
  GROUP_COLORS.position, GROUP_COLORS.position,
  GROUP_COLORS.filter, GROUP_COLORS.filter,
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
    this._loopCounts = []; // per-clip loop count (0-4), default 1
    this._loopPlayers = []; // per-clip array of player objects (one per active loop)
    this._cellView = [];  // 'overview' | 'detail' per clip
    this._granularTimers = []; // per-loop flat granular timers
    this._slicerTimer = null;
    this._slicerStep = 0;
    this._loopUpdateTimer = null;
    this._submode = 'remix';
    this._beatSync = false;
    this._bpm = 120;
    this._loopLengthUnit = 'bars';   // 'bars' | 'beats'
    this._loopLengthValue = 4;       // one of: 2, 4, 8, 16, 32, 64
    this._perLoopLengthOverrides = new Map(); // clipIndex -> { unit, value } or null
    this._lockPitch = false; // when true, playback rate stays fixed (no ML-driven pitch)
    this._running = false;
    this._outputs = new Float32Array(this.getOutputCount()).fill(0.5);
    this._loopOutputs = [];  // per-loop position values (after range outputs)
    this._panX = 40;
    this._panY = 40;
    this._zoom = 1;
    this._lastLoopCountChange = null; // for revert support

    // Global param ranges (from ML outputs 0-7)
    this._paramRanges = {
      volume:   { min: 0, max: 1 },
      pitch:    { min: 0, max: 1 },
      position: { min: 0, max: 1 },
      filter:   { min: 0, max: 1 },
    };
    // Manual override flags -- when true, ML outputs for that range are ignored
    this._rangeOverrides = {
      volume: false, pitch: false, position: false, filter: false,
    };

    this._setupDOM();
  }

  // -- DOM setup ---------------------------------------------------------------

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
        <div style="color:#bbb;font-size:0.68rem;margin-top:4px">MP3, WAV, FLAC, OGG, M4A, OPUS, WebM, AIFF</div>
      </div>
    `;
    this._container.appendChild(this._dropOverlay);

    // Param range panel
    this._buildRangePanel();

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

  // -- Range panel (dual-thumb sliders) ----------------------------------------

  _buildRangePanel() {
    const panel = document.createElement('div');
    panel.className = 'ac-range-panel';
    panel.style.cssText = `
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      background: rgba(20,20,20,0.88); backdrop-filter: blur(10px);
      border-radius: 14px; padding: 10px 16px 8px;
      font-family: 'JetBrains Mono', monospace; font-size: 0.62rem;
      color: #ccc; z-index: 9;
      box-shadow: 0 4px 20px rgba(0,0,0,0.35);
      display: none; min-width: 260px; max-width: 340px;
      touch-action: none; user-select: none;
    `;
    this._container.appendChild(panel);
    this._rangePanel = panel;
    this._rangeSliders = {};

    const groups = [
      { key: 'volume',   label: 'Volume',   color: GROUP_COLORS.volume },
      { key: 'pitch',    label: 'Pitch',    color: GROUP_COLORS.pitch },
      { key: 'position', label: 'Position', color: GROUP_COLORS.position },
      { key: 'filter',   label: 'Filter',   color: GROUP_COLORS.filter },
    ];

    for (const g of groups) {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:8px;margin-bottom:4px;height:20px;`;

      // Label
      const label = document.createElement('span');
      label.style.cssText = `width:56px;text-align:right;color:${g.color};font-size:0.58rem;flex-shrink:0;`;
      label.textContent = g.label;

      // Track container
      const track = document.createElement('div');
      track.style.cssText = `
        position:relative; flex:1; height:8px; background:rgba(255,255,255,0.08);
        border-radius:4px; cursor:pointer;
      `;

      // Filled range
      const fill = document.createElement('div');
      fill.style.cssText = `
        position:absolute; top:0; height:100%; border-radius:4px;
        background:${g.color}; opacity:0.35; pointer-events:none;
      `;
      track.appendChild(fill);

      // Min thumb
      const minThumb = this._createThumb(g.color);
      track.appendChild(minThumb);

      // Max thumb
      const maxThumb = this._createThumb(g.color);
      track.appendChild(maxThumb);

      // Override indicator dot
      const overrideDot = document.createElement('div');
      overrideDot.style.cssText = `
        width:5px;height:5px;border-radius:50%;background:${g.color};
        opacity:0;transition:opacity 0.15s;flex-shrink:0;
      `;

      // Value text
      const valueText = document.createElement('span');
      valueText.style.cssText = `width:72px;text-align:left;color:#888;font-size:0.56rem;flex-shrink:0;`;
      valueText.textContent = '0.00 - 1.00';

      row.appendChild(label);
      row.appendChild(overrideDot);
      row.appendChild(track);
      row.appendChild(valueText);
      panel.appendChild(row);

      this._rangeSliders[g.key] = { track, fill, minThumb, maxThumb, valueText, overrideDot };

      // Drag handling for thumbs
      this._setupThumbDrag(g.key, minThumb, 'min', track);
      this._setupThumbDrag(g.key, maxThumb, 'max', track);

      // Double-click track to clear override
      track.addEventListener('dblclick', (e) => {
        e.preventDefault();
        this._rangeOverrides[g.key] = false;
        this._updateRangePanel();
      });
    }

    this._updateRangePanel();
  }

  _createThumb(color) {
    const thumb = document.createElement('div');
    thumb.style.cssText = `
      position:absolute; top:50%; width:14px; height:14px;
      border-radius:50%; background:${color}; border:2px solid rgba(255,255,255,0.9);
      transform:translate(-50%,-50%); cursor:grab; z-index:2;
      box-shadow:0 1px 4px rgba(0,0,0,0.4); transition:box-shadow 0.1s;
    `;
    return thumb;
  }

  _setupThumbDrag(groupKey, thumb, which, track) {
    let dragging = false;

    const onMove = (e) => {
      if (!dragging) return;
      e.preventDefault();
      const rect = track.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX);
      const norm = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      this._paramRanges[groupKey][which] = norm;
      this._rangeOverrides[groupKey] = true;
      this._updateRangePanel();
    };

    const onUp = () => {
      dragging = false;
      thumb.style.cursor = 'grab';
      thumb.style.boxShadow = '0 1px 4px rgba(0,0,0,0.4)';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };

    const onDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      thumb.style.cursor = 'grabbing';
      thumb.style.boxShadow = '0 2px 8px rgba(0,0,0,0.6)';
      document.addEventListener('mousemove', onMove, { passive: false });
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    };

    thumb.addEventListener('mousedown', onDown);
    thumb.addEventListener('touchstart', onDown, { passive: false });
  }

  _updateRangePanel() {
    if (!this._rangePanel) return;
    // Show panel only when there are clips
    this._rangePanel.style.display = this._clips.length > 0 ? 'block' : 'none';

    for (const group of ['volume', 'pitch', 'position', 'filter']) {
      const s = this._rangeSliders[group];
      if (!s) continue;
      const r = this._paramRanges[group];
      const lo = Math.min(r.min, r.max);
      const hi = Math.max(r.min, r.max);

      // Position thumbs
      s.minThumb.style.left = `${r.min * 100}%`;
      s.maxThumb.style.left = `${r.max * 100}%`;

      // Fill bar between thumbs
      s.fill.style.left = `${lo * 100}%`;
      s.fill.style.width = `${(hi - lo) * 100}%`;

      // Value text
      s.valueText.textContent = `${lo.toFixed(2)} \u2013 ${hi.toFixed(2)}`;

      // Override indicator
      s.overrideDot.style.opacity = this._rangeOverrides[group] ? '1' : '0';
    }
  }

  // -- Control bar -------------------------------------------------------------

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
      <div id="ac-loop-len-group" style="display:flex;align-items:center;gap:3px;opacity:0.3;pointer-events:none">
        <div style="width:1px;height:16px;background:rgba(255,255,255,0.15)"></div>
        <select id="ac-loop-len" style="
          padding:2px 4px; border-radius:8px; border:1px solid rgba(255,255,255,0.2);
          background:rgba(255,255,255,0.08); color:#fff; font-family:inherit; font-size:0.62rem;
          cursor:pointer; appearance:none; text-align:center; width:36px;
        ">
          <option value="2">2</option>
          <option value="4" selected>4</option>
          <option value="8">8</option>
          <option value="16">16</option>
          <option value="32">32</option>
          <option value="64">64</option>
        </select>
        <div style="display:flex;gap:2px">
          <button class="ac-ubtn active" data-unit="bars" style="
            padding:3px 5px; border-radius:8px; border:none; cursor:pointer;
            background:rgba(255,255,255,0.1); color:#fff; font-family:inherit; font-size:0.58rem;
          ">bars</button>
          <button class="ac-ubtn" data-unit="beats" style="
            padding:3px 5px; border-radius:8px; border:none; cursor:pointer;
            background:transparent; color:#aaa; font-family:inherit; font-size:0.58rem;
          ">beats</button>
        </div>
        <button id="ac-reset-overrides" title="Reset per-loop overrides" style="
          padding:3px 5px; border-radius:8px; border:none; cursor:pointer;
          background:transparent; color:#aaa; font-family:inherit; font-size:0.62rem;
          display:none;
        ">&#x21ba;</button>
      </div>
      <div style="width:1px;height:16px;background:rgba(255,255,255,0.15)"></div>
      <button id="ac-lock-pitch" title="Lock pitch (ignore ML pitch output)" style="
        padding:3px 6px; border-radius:8px; border:none; cursor:pointer;
        background:transparent; color:#aaa; font-family:inherit; font-size:0.58rem;
        transition:background 0.15s,color 0.15s;
      ">1&#215;</button>
      <div style="width:1px;height:16px;background:rgba(255,255,255,0.15)"></div>
      <button id="ac-play" style="
        width:28px; height:28px; border-radius:50%; border:none; cursor:pointer;
        background:rgba(0,122,255,0.8); color:#fff; display:flex; align-items:center; justify-content:center;
        transition:background 0.15s;
      ">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z"/></svg>
      </button>
      <span id="ac-clip-ct" style="color:#666;min-width:44px">0 clips</span>
      <div style="width:1px;height:16px;background:rgba(255,255,255,0.15)"></div>
      <button id="ac-add-files" title="Import audio files" style="
        width:28px; height:28px; border-radius:50%; border:none; cursor:pointer;
        background:rgba(255,255,255,0.1); color:#aaa; display:flex; align-items:center; justify-content:center;
        font-size:1.1rem; font-family:inherit; transition:background 0.15s,color 0.15s;
      ">+</button>
    `;
    this._container.appendChild(bar);
    this._controlBar = bar;

    // Hidden file input for picker
    this._fileInput = document.createElement('input');
    this._fileInput.type = 'file';
    this._fileInput.multiple = true;
    this._fileInput.accept = 'audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.opus,.webm,.mp4,.wma,.aif,.aiff';
    this._fileInput.style.display = 'none';
    this._container.appendChild(this._fileInput);
    this._fileInput.addEventListener('change', () => {
      if (this._fileInput.files.length) this._handleDrop(this._fileInput.files);
      this._fileInput.value = '';
    });
    bar.querySelector('#ac-add-files').addEventListener('click', () => this._fileInput.click());

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
        this._syncLoopLenUI();
      });
    });

    bar.querySelector('#ac-bpm').addEventListener('change', e => {
      this._bpm = Math.max(40, Math.min(240, parseFloat(e.target.value) || 120));
    });

    // Loop length controls
    bar.querySelector('#ac-loop-len').addEventListener('change', e => {
      this._loopLengthValue = parseInt(e.target.value);
    });

    bar.querySelectorAll('.ac-ubtn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._loopLengthUnit = btn.dataset.unit;
        bar.querySelectorAll('.ac-ubtn').forEach(b => {
          b.style.background = b === btn ? 'rgba(255,255,255,0.1)' : 'transparent';
          b.style.color = b === btn ? '#fff' : '#aaa';
        });
      });
    });

    bar.querySelector('#ac-reset-overrides').addEventListener('click', () => {
      this._perLoopLengthOverrides.clear();
      this._syncResetBtn();
      this._syncAllOverrideBadges();
    });

    bar.querySelector('#ac-lock-pitch').addEventListener('click', () => {
      this._lockPitch = !this._lockPitch;
      this._syncLockPitchUI();
    });

    bar.querySelector('#ac-play').addEventListener('click', () => {
      if (this._running) this.stop(); else this.start();
    });
  }

  _syncLockPitchUI() {
    const btn = this._controlBar.querySelector('#ac-lock-pitch');
    if (!btn) return;
    btn.style.background = this._lockPitch ? 'rgba(255,255,255,0.15)' : 'transparent';
    btn.style.color = this._lockPitch ? '#fff' : '#aaa';
  }

  _syncSubmodeUI() {
    this._controlBar.querySelectorAll('.ac-sbtn').forEach(btn => {
      const active = btn.dataset.submode === this._submode;
      btn.style.background = active ? 'rgba(255,255,255,0.15)' : 'transparent';
      btn.style.color = active ? '#fff' : '#aaa';
    });
  }

  // -- Pan/Zoom ----------------------------------------------------------------

  _setupPanZoom() {
    const pointers = new Map();
    let lastDist = null;

    this._container.addEventListener('pointerdown', e => {
      if (e.target.closest('.ac-cell') || e.target.closest('[data-submode]') ||
          e.target.closest('[data-sync]') || e.target.closest('#ac-play') ||
          e.target.closest('#ac-bpm') || e.target.closest('#ac-loop-len-group') ||
          e.target.closest('#ac-add-files') || e.target.closest('.ac-loop-dropdown') ||
          e.target.closest('.ac-range-panel')) return;
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

  // -- Audio file handling -----------------------------------------------------

  async _handleDrop(files) {
    if (!this._audioCtx) await this._initAudio();
    const valid = [...files].filter(f =>
      f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac|opus|webm|mp4|wma|aif|aiff)$/i.test(f.name));
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
    this._loopCounts.push(1); // default 1 loop per clip
    this._loopPlayers.push([this._makePlayer(clip)]); // one player for the default loop
    this._cellView.push('overview');
    this._createCell(clip, this._clips.length - 1);
    this._updateUI();
    this._resizeOutputs();
    this._emitOutputCountChanged();
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

  // -- Cell DOM ----------------------------------------------------------------

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
      <span>${clip.name.length > 20 ? clip.name.slice(0, 20) + '\u2026' : clip.name}</span>
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
      <div style="display:flex;align-items:center;gap:4px">
        <div class="ac-loop-stepper" style="display:flex;align-items:center;gap:2px;user-select:none">
          <button class="ac-loop-dec" style="
            width:16px;height:16px;border:none;border-radius:4px;cursor:pointer;
            background:rgba(0,0,0,0.06);color:#888;font-family:inherit;font-size:0.6rem;
            display:flex;align-items:center;justify-content:center;padding:0;line-height:1;
          ">&minus;</button>
          <span class="ac-loop-count" style="min-width:10px;text-align:center;font-size:0.58rem;color:#666">${this._loopCounts[index]}</span>
          <button class="ac-loop-inc" style="
            width:16px;height:16px;border:none;border-radius:4px;cursor:pointer;
            background:rgba(0,0,0,0.06);color:#888;font-family:inherit;font-size:0.6rem;
            display:flex;align-items:center;justify-content:center;padding:0;line-height:1;
          ">+</button>
        </div>
        <div style="width:40px;height:3px;background:#eee;border-radius:2px;overflow:hidden">
          <div class="ac-st-level" style="width:0%;height:100%;background:#4a90d9;border-radius:2px;transition:width 0.08s"></div>
        </div>
      </div>
    `;

    cell.appendChild(hdr);
    cell.appendChild(overviewC);
    cell.appendChild(detailC);
    cell.appendChild(status);

    // Loop count stepper
    status.querySelector('.ac-loop-dec').addEventListener('click', (e) => {
      e.stopPropagation();
      this._setClipLoopCount(index, this._loopCounts[index] - 1);
    });
    status.querySelector('.ac-loop-inc').addEventListener('click', (e) => {
      e.stopPropagation();
      this._setClipLoopCount(index, this._loopCounts[index] + 1);
    });

    // Toggle overview/detail on tap; long-press or right-click for loop length dropdown
    let tapStart = 0;
    let longPressTimer = null;
    let longPressFired = false;
    cell.addEventListener('pointerdown', (e) => {
      tapStart = Date.now();
      longPressFired = false;
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        const idx = parseInt(cell.dataset.idx);
        this._showLoopLenDropdown(idx, cell);
      }, 500);
    });
    cell.addEventListener('pointermove', () => {
      clearTimeout(longPressTimer);
    });
    cell.addEventListener('pointerup', e => {
      clearTimeout(longPressTimer);
      if (!longPressFired && Date.now() - tapStart < 200) {
        const idx = parseInt(cell.dataset.idx);
        this._cellView[idx] = this._cellView[idx] === 'overview' ? 'detail' : 'overview';
        this._syncCellView(idx);
      }
      e.stopPropagation();
    });
    cell.addEventListener('contextmenu', e => {
      e.preventDefault();
      const idx = parseInt(cell.dataset.idx);
      this._showLoopLenDropdown(idx, cell);
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

  // -- Waveform drawing --------------------------------------------------------

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

  // -- Audio init --------------------------------------------------------------

  async _initAudio() {
    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this._masterGain = this._audioCtx.createGain();
    this._masterGain.gain.value = 0.75;
    this._masterGain.connect(this._audioCtx.destination);
  }

  // -- Playback ----------------------------------------------------------------

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
    this._granularTimers = [];
    for (const loopArr of this._loopPlayers) {
      for (const p of loopArr) {
        if (p.source) { try { p.source.stop(); } catch (_) {} p.source = null; }
        if (p.gainNode) { p.gainNode.disconnect(); p.gainNode = null; }
        if (p.filterNode) { p.filterNode.disconnect(); p.filterNode = null; }
        p.playing = false;
      }
    }
  }

  _startPlayback() {
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

  _updatePlayBtn(playing) {
    const btn = this._controlBar.querySelector('#ac-play');
    btn.innerHTML = playing
      ? `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/></svg>`
      : `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z"/></svg>`;
  }

  // -- Remix / Drone -----------------------------------------------------------

  _startLooping() {
    // Start a loop source for each active loop across all clips
    for (let ci = 0; ci < this._clips.length; ci++) {
      for (let li = 0; li < this._loopCounts[ci]; li++) {
        this._startOneLoop(ci, li);
      }
    }
    this._loopUpdateTimer = setInterval(() => this._tickLooping(), 60);
  }

  _startOneLoop(clipIdx, loopIdx) {
    const clip = this._clips[clipIdx];
    const player = this._loopPlayers[clipIdx]?.[loopIdx];
    if (!clip || !player) return;

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

    let flatIdx = 0;
    for (let ci = 0; ci < this._clips.length; ci++) {
      const clip = this._clips[ci];
      let clipMaxVol = 0;
      let clipLoopStart = 0, clipLoopEnd = 1;

      for (let li = 0; li < this._loopCounts[ci]; li++) {
        const player = this._loopPlayers[ci]?.[li];
        if (!player || !player.playing) { flatIdx++; continue; }

        // Resolve per-loop params through global ranges
        const volPos   = this._getLoopParam(flatIdx, 0);
        const pitchPos = this._getLoopParam(flatIdx, 1);
        const posPos   = this._getLoopParam(flatIdx, 2);
        const filtPos  = this._getLoopParam(flatIdx, 3);

        const vol      = this._resolveLoopParam('volume', volPos);
        const pitchNorm = this._resolveLoopParam('pitch', pitchPos);
        const loopNorm = this._resolveLoopParam('position', posPos);
        const filtNorm = this._resolveLoopParam('filter', filtPos);

        const speed = this._lockPitch
          ? (isDrone ? 0.05 : 1.0)
          : isDrone
            ? 0.005 + pitchNorm * 0.095   // 0.005x-0.1x for drone
            : 0.5 + pitchNorm * 1.5;      // 0.5x-2.0x for remix

        // Loop window: treat loopNorm as start of a sliding window
        const winSecs = this._beatSync
          ? this._getLoopDuration(ci)
          : (isDrone ? 120 : 15);
        const loopStart = loopNorm * Math.max(0, clip.duration - winSecs);
        const loopEnd = Math.min(loopStart + winSecs, clip.duration);
        const filterHz = 200 * Math.pow(40, filtNorm); // 200 Hz - 8000 Hz log

        player.source.playbackRate.setTargetAtTime(speed, now, 0.08);
        player.source.loopStart = loopStart;
        player.source.loopEnd = loopEnd;
        player.gainNode.gain.setTargetAtTime(isDrone ? vol * 0.7 : vol, now, 0.06);
        player.filterNode.frequency.setTargetAtTime(filterHz, now, 0.06);

        // Track highest vol and last loop window for cell visuals
        if (vol > clipMaxVol) clipMaxVol = vol;
        clipLoopStart = loopStart / clip.duration;
        clipLoopEnd = loopEnd / clip.duration;

        flatIdx++;
      }

      // Visuals: use the last loop's window (good enough for overview)
      if (this._loopCounts[ci] > 0) {
        this._drawOverviewWithLoop(clip, clipLoopStart, clipLoopEnd);
        if (this._cellView[ci] === 'detail') this._drawDetail(clip, clipLoopStart, clipLoopEnd, null);
        const color = isDrone ? '#8040c0' : '#4a90d9';
        this._setCellActive(clip, isDrone ? 'drone' : 'remix', clipMaxVol, color);
      }
    }
  }

  // -- Granular ----------------------------------------------------------------

  _startGranular() {
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
    // Consolidated visual update per clip (avoids multi-loop redraw flicker)
    this._loopUpdateTimer = setInterval(() => this._tickGranularVisuals(), 60);
  }

  _tickGranularVisuals() {
    if (!this._running) return;
    let flatIdx = 0;
    for (let ci = 0; ci < this._clips.length; ci++) {
      const clip = this._clips[ci];
      if (this._loopCounts[ci] === 0) continue;
      // Show the average grain position across loops for this clip
      let posSum = 0, densityMax = 0;
      for (let li = 0; li < this._loopCounts[ci]; li++) {
        const posNorm = this._resolveLoopParam('position', this._getLoopParam(flatIdx, 2));
        const density = this._resolveLoopParam('volume', this._getLoopParam(flatIdx, 0));
        posSum += posNorm;
        if (density > densityMax) densityMax = density;
        flatIdx++;
      }
      const avgPos = posSum / this._loopCounts[ci];
      this._drawOverviewWithLoop(clip, Math.max(0, avgPos - 0.03), Math.min(1, avgPos + 0.03));
      this._setCellActive(clip, 'granular', densityMax, '#7040c0');
    }
  }

  _spawnGrain(clipIdx, flatLoopIdx) {
    const clip = this._clips[clipIdx];
    if (!clip) return;

    // Resolve per-loop params through global ranges
    const density   = this._resolveLoopParam('volume', this._getLoopParam(flatLoopIdx, 0));
    const pitchNorm = this._resolveLoopParam('pitch', this._getLoopParam(flatLoopIdx, 1));
    const posNorm   = this._resolveLoopParam('position', this._getLoopParam(flatLoopIdx, 2));
    const sizeNorm  = this._resolveLoopParam('filter', this._getLoopParam(flatLoopIdx, 3));

    if (Math.random() > density) return;

    const grainDur = 0.02 + sizeNorm * 0.38;
    const pitch = this._lockPitch ? 1.0 : 0.5 + pitchNorm * 1.5;
    const scatter = 0.04;
    const pos = Math.max(0, Math.min(1, posNorm + (Math.random() - 0.5) * scatter * 2));
    let startOff;
    if (this._beatSync) {
      const loopDur = this._getLoopDuration(clipIdx);
      const loopWindow = Math.min(loopDur, clip.duration);
      startOff = pos * Math.max(0, loopWindow - grainDur);
    } else {
      startOff = pos * Math.max(0, clip.duration - grainDur);
    }

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
  }

  // -- Slicer ------------------------------------------------------------------

  _scheduleSlicer() {
    if (!this._running) return;
    const stepMs = this._beatSync
      ? (this._getLoopDuration(0) * 1000 / 8)  // divide the loop into 8 slices
      : (60000 / this._bpm);
    this._slicerTimer = setTimeout(() => {
      this._fireSlice();
      this._scheduleSlicer();
    }, stepMs);
  }

  _fireSlice() {
    const totalLoops = this.getTotalLoops();
    if (totalLoops === 0) return;

    const step = this._slicerStep % Math.max(1, totalLoops);
    this._slicerStep++;

    // Find which clip and loop this step maps to
    let flatIdx = 0;
    let targetClipIdx = 0, targetLoopIdx = 0;
    for (let ci = 0; ci < this._clips.length; ci++) {
      for (let li = 0; li < this._loopCounts[ci]; li++) {
        if (flatIdx === step) { targetClipIdx = ci; targetLoopIdx = li; }
        flatIdx++;
      }
    }

    const clip = this._clips[targetClipIdx];
    if (!clip) return;

    // Resolve through param ranges
    const clipNorm = this._resolveLoopParam('volume', this._getLoopParam(step, 0));
    const posNorm = this._resolveLoopParam('pitch', this._getLoopParam(step, 1));
    const speedNorm = this._resolveLoopParam('position', this._getLoopParam(step, 2));
    const sliceDur = Math.min(1.2, (this._beatSync ? 60 / this._bpm / 2 : 60 / this._bpm));
    const speed = this._lockPitch ? 1.0 : 0.5 + speedNorm * 1.5;
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
      if (i === targetClipIdx) {
        this._drawOverviewWithLoop(c, posNorm - 0.02, posNorm + 0.02);
        this._setCellActive(c, `slice ${step}`, speedNorm, '#ff3b30');
      } else {
        this._drawOverview(c);
        this._setCellIdle(c);
      }
    });
  }

  // -- Loop management ---------------------------------------------------------

  /** Set loop count for a clip (0-4). Returns true if changed. */
  _setClipLoopCount(clipIdx, count) {
    count = Math.max(0, Math.min(MAX_LOOPS_PER_CLIP, count));
    const old = this._loopCounts[clipIdx];
    if (count === old) return false;

    // Save for revert
    this._lastLoopCountChange = { clipIdx, oldCount: old };

    const wasRunning = this._running;
    if (wasRunning) this.stop();

    const clip = this._clips[clipIdx];
    const players = this._loopPlayers[clipIdx];

    if (count > old) {
      // Add new loops
      for (let i = old; i < count; i++) {
        players.push(this._makePlayer(clip));
      }
    } else {
      // Remove from the end
      const removed = players.splice(count);
      for (const p of removed) {
        if (p.source) { try { p.source.stop(); } catch (_) {} }
        if (p.gainNode) p.gainNode.disconnect();
        if (p.filterNode) p.filterNode.disconnect();
      }
    }

    this._loopCounts[clipIdx] = count;
    this._resizeOutputs();
    this._syncCellLoopCount(clipIdx);
    this._emitOutputCountChanged();

    if (wasRunning) this.start();
    return true;
  }

  /** Revert the last loop count change (called when user cancels confirm dialog) */
  revertLastLoopChange() {
    if (!this._lastLoopCountChange) return;
    const { clipIdx, oldCount } = this._lastLoopCountChange;
    this._lastLoopCountChange = null;
    this._setClipLoopCount(clipIdx, oldCount);
  }

  _syncCellLoopCount(clipIdx) {
    const clip = this._clips[clipIdx];
    if (!clip || !clip._cell) return;
    const countEl = clip._cell.querySelector('.ac-loop-count');
    if (countEl) countEl.textContent = this._loopCounts[clipIdx];
    // Dim cell when loop count is 0
    clip._cell.style.opacity = this._loopCounts[clipIdx] === 0 ? '0.5' : '1';
  }

  _resizeOutputs() {
    const count = this.getOutputCount();
    if (this._outputs.length !== count) {
      const old = this._outputs;
      this._outputs = new Float32Array(count).fill(0.5);
      // Preserve what we can from the old outputs
      for (let i = 0; i < Math.min(old.length, count); i++) this._outputs[i] = old[i];
    }
    // Keep _loopOutputs in sync (slice after the 8 range outputs)
    this._loopOutputs = Array.from(this._outputs).slice(N_RANGE_OUTPUTS);
  }

  _emitOutputCountChanged() {
    this._container.dispatchEvent(new CustomEvent('ac:outputcount-changed', {
      detail: { count: this.getOutputCount() },
      bubbles: true,
    }));
  }

  // -- Beat-synced loop length -------------------------------------------------

  _getLoopDuration(clipIndex) {
    const override = this._perLoopLengthOverrides.get(clipIndex);
    const unit = override?.unit ?? this._loopLengthUnit;
    const value = override?.value ?? this._loopLengthValue;
    const beatDuration = 60 / this._bpm; // seconds per beat
    if (unit === 'bars') return beatDuration * 4 * value; // 4 beats per bar
    return beatDuration * value;
  }

  _syncLoopLenUI() {
    const grp = this._controlBar.querySelector('#ac-loop-len-group');
    if (!grp) return;
    grp.style.opacity = this._beatSync ? '1' : '0.3';
    grp.style.pointerEvents = this._beatSync ? 'auto' : 'none';
  }

  _syncResetBtn() {
    const btn = this._controlBar.querySelector('#ac-reset-overrides');
    if (btn) btn.style.display = this._perLoopLengthOverrides.size > 0 ? 'block' : 'none';
  }

  _syncAllOverrideBadges() {
    for (let i = 0; i < this._clips.length; i++) {
      this._syncOverrideBadge(i);
    }
  }

  _syncOverrideBadge(idx) {
    const clip = this._clips[idx];
    if (!clip || !clip._cell) return;
    let badge = clip._cell.querySelector('.ac-loop-badge');
    const override = this._perLoopLengthOverrides.get(idx);
    if (override) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ac-loop-badge';
        badge.style.cssText = `
          position:absolute; top:2px; right:4px;
          padding:1px 5px; border-radius:8px;
          background:rgba(0,122,255,0.15); color:rgba(0,122,255,0.8);
          font-family:'JetBrains Mono',monospace; font-size:0.48rem;
          pointer-events:none; z-index:2;
        `;
        clip._cell.appendChild(badge);
      }
      badge.textContent = `${override.value} ${override.unit}`;
      badge.style.display = '';
    } else {
      if (badge) badge.style.display = 'none';
    }
  }

  _showLoopLenDropdown(idx, anchorEl) {
    this._dismissLoopLenDropdown();
    const override = this._perLoopLengthOverrides.get(idx);
    const curUnit = override?.unit ?? this._loopLengthUnit;

    const menu = document.createElement('div');
    menu.className = 'ac-loop-dropdown';
    menu.style.cssText = `
      position:fixed; z-index:100;
      background:rgba(20,20,20,0.95); color:#fff;
      border-radius:10px; padding:4px 0;
      font-family:'JetBrains Mono',monospace; font-size:0.6rem;
      box-shadow:0 6px 24px rgba(0,0,0,0.5); backdrop-filter:blur(10px);
      min-width:110px; overflow:hidden;
    `;

    const globalLabel = `Global (${this._loopLengthValue} ${this._loopLengthUnit})`;
    const isGlobal = !override;

    const items = [
      { label: globalLabel, action: () => { this._perLoopLengthOverrides.delete(idx); } },
      '---',
      ...[2, 4, 8, 16, 32, 64].map(v => ({
        label: `${v} ${curUnit}`,
        selected: !isGlobal && override?.value === v && override?.unit === curUnit,
        action: () => { this._perLoopLengthOverrides.set(idx, { unit: curUnit, value: v }); },
      })),
      '---',
    ];

    // Unit toggle row
    const unitRow = document.createElement('div');
    unitRow.style.cssText = 'display:flex;gap:2px;padding:4px 8px;justify-content:center';
    ['bars', 'beats'].forEach(u => {
      const btn = document.createElement('button');
      btn.textContent = u;
      btn.style.cssText = `
        padding:2px 6px; border-radius:6px; border:none; cursor:pointer;
        font-family:inherit; font-size:0.56rem;
        background:${u === curUnit ? 'rgba(255,255,255,0.15)' : 'transparent'};
        color:${u === curUnit ? '#fff' : '#888'};
      `;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const ov = this._perLoopLengthOverrides.get(idx);
        const val = ov?.value ?? this._loopLengthValue;
        this._perLoopLengthOverrides.set(idx, { unit: u, value: val });
        this._syncOverrideBadge(idx);
        this._syncResetBtn();
        this._dismissLoopLenDropdown();
        this._showLoopLenDropdown(idx, anchorEl);
      });
      unitRow.appendChild(btn);
    });

    for (const item of items) {
      if (item === '---') {
        const div = document.createElement('div');
        div.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin:2px 0';
        menu.appendChild(div);
        continue;
      }
      const row = document.createElement('div');
      row.style.cssText = `
        padding:5px 12px; cursor:pointer;
        color:${item.selected || (item.label === globalLabel && isGlobal) ? '#fff' : '#aaa'};
        background:${item.selected || (item.label === globalLabel && isGlobal) ? 'rgba(0,122,255,0.2)' : 'transparent'};
      `;
      row.textContent = item.label;
      row.addEventListener('pointerenter', () => { row.style.background = 'rgba(255,255,255,0.08)'; });
      row.addEventListener('pointerleave', () => {
        row.style.background = (item.selected || (item.label === globalLabel && isGlobal)) ? 'rgba(0,122,255,0.2)' : 'transparent';
      });
      row.addEventListener('click', e => {
        e.stopPropagation();
        item.action();
        this._syncOverrideBadge(idx);
        this._syncResetBtn();
        this._dismissLoopLenDropdown();
      });
      menu.appendChild(row);
    }
    menu.appendChild(unitRow);

    document.body.appendChild(menu);
    this._activeDropdown = menu;

    // Position near the anchor cell
    const rect = anchorEl.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.right + 4, window.innerWidth - 130)}px`;
    menu.style.top = `${Math.max(4, rect.top)}px`;

    // Dismiss on outside click
    const dismiss = (e) => {
      if (!menu.contains(e.target)) this._dismissLoopLenDropdown();
    };
    setTimeout(() => document.addEventListener('pointerdown', dismiss, { once: true }), 10);
    menu._dismissHandler = dismiss;
  }

  _dismissLoopLenDropdown() {
    if (this._activeDropdown) {
      this._activeDropdown.remove();
      this._activeDropdown = null;
    }
  }

  // -- Public API --------------------------------------------------------------

  setOutputs(outputs) {
    const count = this.getOutputCount();
    if (this._outputs.length !== count) this._resizeOutputs();
    for (let i = 0; i < Math.min(outputs.length, count); i++) {
      this._outputs[i] = outputs[i];
    }

    // Range outputs (0-7) -- only update if not manually overridden
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

    // Per-loop position outputs (8+)
    this._loopOutputs = Array.from(outputs).slice(N_RANGE_OUTPUTS);

    this._updateRangePanel();
  }

  /** Resolve a per-loop position value through the global param range */
  _resolveLoopParam(group, positionValue) {
    const r = this._paramRanges[group];
    const lo = Math.min(r.min, r.max);
    const hi = Math.max(r.min, r.max);
    return Math.max(0, Math.min(1, lo + positionValue * (hi - lo)));
  }

  /** Get a per-loop param from the loopOutputs array */
  _getLoopParam(flatLoopIdx, paramOffset) {
    const baseOutput = flatLoopIdx * N_PARAMS_PER_LOOP;
    return this._loopOutputs[baseOutput + paramOffset] ?? 0.5;
  }

  getParamGroupInfo() {
    return [
      { name: 'Volume',   color: GROUP_COLORS.volume,   range: this._paramRanges.volume },
      { name: 'Pitch',    color: GROUP_COLORS.pitch,    range: this._paramRanges.pitch },
      { name: 'Position', color: GROUP_COLORS.position, range: this._paramRanges.position },
      { name: 'Filter',   color: GROUP_COLORS.filter,   range: this._paramRanges.filter },
    ];
  }

  setSubmode(mode) {
    if (!SUBMODES.includes(mode)) return;
    const wasRunning = this._running;
    if (wasRunning) this.stop();
    this._submode = mode;
    this._syncSubmodeUI();
    if (wasRunning) this.start();
  }

  getOutputCount() { return N_RANGE_OUTPUTS + this.getTotalLoops() * N_PARAMS_PER_LOOP; }
  getTotalLoops() { return this._loopCounts.reduce((s, c) => s + c, 0); }
  isRunning() { return this._running; }

  /** Dynamic param names for heatmap */
  getAudioParamNames() {
    const names = [...RANGE_NAMES];
    for (let ci = 0; ci < this._clips.length; ci++) {
      for (let li = 0; li < this._loopCounts[ci]; li++) {
        const tag = `L${ci + 1}.${li + 1}`;
        names.push(`${tag} Vol`, `${tag} Pitch`, `${tag} Pos`, `${tag} Filt`);
      }
    }
    return names;
  }

  /** Dynamic param colors for heatmap */
  getAudioParamColors() {
    const colors = [...RANGE_COLORS];
    for (let ci = 0; ci < this._clips.length; ci++) {
      for (let li = 0; li < this._loopCounts[ci]; li++) {
        colors.push(GROUP_COLORS.volume, GROUP_COLORS.pitch, GROUP_COLORS.position, GROUP_COLORS.filter);
      }
    }
    return colors;
  }

  destroy() {
    this.stop();
    this._dismissLoopLenDropdown();
    if (this._audioCtx) { this._audioCtx.close(); this._audioCtx = null; }
    this._container.innerHTML = '';
  }

  getState() {
    return {
      submode: this._submode, beatSync: this._beatSync, bpm: this._bpm,
      panX: this._panX, panY: this._panY, zoom: this._zoom,
      loopCounts: [...this._loopCounts],
      loopLengthUnit: this._loopLengthUnit,
      loopLengthValue: this._loopLengthValue,
      perLoopLengthOverrides: Object.fromEntries(this._perLoopLengthOverrides),
      paramRanges: JSON.parse(JSON.stringify(this._paramRanges)),
      rangeOverrides: { ...this._rangeOverrides },
      lockPitch: this._lockPitch,
    };
  }

  setState(s) {
    if (s.submode) { this._submode = s.submode; this._syncSubmodeUI(); }
    if (s.beatSync !== undefined) this._beatSync = s.beatSync;
    if (s.bpm) this._bpm = s.bpm;
    if (s.panX !== undefined) this._panX = s.panX;
    if (s.panY !== undefined) this._panY = s.panY;
    if (s.zoom) this._zoom = s.zoom;
    // Restore loop counts
    if (Array.isArray(s.loopCounts)) {
      for (let i = 0; i < s.loopCounts.length && i < this._loopCounts.length; i++) {
        if (s.loopCounts[i] !== this._loopCounts[i]) {
          this._setClipLoopCount(i, s.loopCounts[i]);
        }
      }
    }
    // Restore beat-sync loop length
    if (s.loopLengthUnit) this._loopLengthUnit = s.loopLengthUnit;
    if (s.loopLengthValue) this._loopLengthValue = s.loopLengthValue;
    if (s.perLoopLengthOverrides) {
      this._perLoopLengthOverrides = new Map(Object.entries(s.perLoopLengthOverrides).map(([k, v]) => [parseInt(k), v]));
    }
    // Restore param ranges
    if (s.paramRanges) {
      for (const group of ['volume', 'pitch', 'position', 'filter']) {
        if (s.paramRanges[group]) {
          this._paramRanges[group].min = s.paramRanges[group].min ?? 0;
          this._paramRanges[group].max = s.paramRanges[group].max ?? 1;
        }
      }
    }
    if (s.rangeOverrides) {
      for (const group of ['volume', 'pitch', 'position', 'filter']) {
        if (s.rangeOverrides[group] !== undefined) this._rangeOverrides[group] = s.rangeOverrides[group];
      }
    }
    if (s.lockPitch !== undefined) { this._lockPitch = s.lockPitch; this._syncLockPitchUI(); }
    this._applyTransform();
    this._syncLoopLenUI();
    this._syncResetBtn();
    this._syncAllOverrideBadges();
    this._updateRangePanel();
    // Sync control bar values
    const lenSelect = this._controlBar?.querySelector('#ac-loop-len');
    if (lenSelect) lenSelect.value = this._loopLengthValue;
    this._controlBar?.querySelectorAll('.ac-ubtn').forEach(b => {
      b.style.background = b.dataset.unit === this._loopLengthUnit ? 'rgba(255,255,255,0.1)' : 'transparent';
      b.style.color = b.dataset.unit === this._loopLengthUnit ? '#fff' : '#aaa';
    });
    // Sync beat sync buttons
    this._controlBar?.querySelectorAll('.ac-tbtn').forEach(b => {
      const isActive = (this._beatSync && b.dataset.sync === 'sync') || (!this._beatSync && b.dataset.sync === 'free');
      b.style.background = isActive ? 'rgba(255,255,255,0.1)' : 'transparent';
      b.style.color = isActive ? '#fff' : '#aaa';
    });
  }

  // -- Helpers -----------------------------------------------------------------

  _fmtDur(s) {
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  _updateUI() {
    const ct = this._container.querySelector('#ac-clip-ct');
    if (ct) ct.textContent = `${this._clips.length} clip${this._clips.length !== 1 ? 's' : ''}`;
    this._dropOverlay.style.opacity = this._clips.length > 0 ? '0' : '1';
    this._updateRangePanel();
  }
}
