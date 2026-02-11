// Control panel: mode toggle, buttons, status display

export class Controls {
  constructor(container, callbacks) {
    this.callbacks = callbacks;
    this.mode = 'examples'; // 'examples' or 'rl'
    this.el = container;
    this.build();
  }

  build() {
    this.el.innerHTML = `
      <div class="controls-mode-toggle">
        <button class="mode-btn active" data-mode="examples">Examples</button>
        <button class="mode-btn" data-mode="rl">RL Feedback</button>
      </div>
      <div class="controls-actions" id="controls-examples">
        <button class="btn btn-primary" id="btn-add">Add Example</button>
        <button class="btn" id="btn-train">Train</button>
        <button class="btn" id="btn-randomize">Randomize</button>
        <button class="btn btn-danger" id="btn-clear">Clear</button>
      </div>
      <div class="controls-actions hidden" id="controls-rl">
        <button class="btn btn-good" id="btn-thumbsup">
          <span style="font-size:1.4em">+</span>
        </button>
        <button class="btn btn-bad" id="btn-thumbsdown">
          <span style="font-size:1.4em">&minus;</span>
        </button>
        <button class="btn" id="btn-rl-randomize">Randomize</button>
        <button class="btn btn-danger" id="btn-rl-clear">Clear</button>
      </div>
      <div class="controls-status">
        <span id="status-examples">Examples: 0</span>
        <span id="status-loss"></span>
        <span id="status-noise" class="hidden">Noise: 0.05</span>
      </div>
      <div class="metrics-grid">
        <span class="metric-label">Mode</span>
        <span class="metric-value" id="metric-mode">examples</span>
        <span class="metric-label">Joystick</span>
        <span class="metric-value" id="metric-joystick">0.50, 0.50</span>
        <span class="metric-label">Output Mean</span>
        <span class="metric-value" id="metric-mean">0.000</span>
        <span class="metric-label">Output Spread</span>
        <span class="metric-value" id="metric-spread">0.000</span>
        <span class="metric-label">Best Loss</span>
        <span class="metric-value" id="metric-best-loss">-</span>
        <span class="metric-label">Train Iters</span>
        <span class="metric-value" id="metric-train-iters">0</span>
        <span class="metric-label">Gamepad</span>
        <span class="metric-value" id="metric-gamepad">Disconnected</span>
        <span class="metric-label">Follow</span>
        <span class="metric-value" id="metric-follow">Off</span>
      </div>
      <div class="loss-plot-wrap">
        <canvas id="loss-plot" width="420" height="86"></canvas>
      </div>
    `;

    // Mode toggle
    this.el.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    });

    // Examples mode buttons
    this.el.querySelector('#btn-add').addEventListener('click', () => this.callbacks.onAddExample?.());
    this.el.querySelector('#btn-train').addEventListener('click', () => this.callbacks.onTrain?.());
    this.el.querySelector('#btn-randomize').addEventListener('click', () => this.callbacks.onRandomize?.());
    this.el.querySelector('#btn-clear').addEventListener('click', () => this.callbacks.onClear?.());

    // RL mode buttons
    this.el.querySelector('#btn-thumbsup').addEventListener('click', () => this.callbacks.onThumbsUp?.());
    this.el.querySelector('#btn-thumbsdown').addEventListener('click', () => this.callbacks.onThumbsDown?.());
    this.el.querySelector('#btn-rl-randomize').addEventListener('click', () => this.callbacks.onRandomize?.());
    this.el.querySelector('#btn-rl-clear').addEventListener('click', () => this.callbacks.onClear?.());
  }

  setMode(mode) {
    this.mode = mode;
    this.el.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    this.el.querySelector('#controls-examples').classList.toggle('hidden', mode !== 'examples');
    this.el.querySelector('#controls-rl').classList.toggle('hidden', mode !== 'rl');
    this.el.querySelector('#status-noise').classList.toggle('hidden', mode !== 'rl');
    this.callbacks.onModeChange?.(mode);
  }

  updateStatus(exampleCount, loss, noiseLevel) {
    this.el.querySelector('#status-examples').textContent = `Examples: ${exampleCount}`;
    if (loss !== null && loss !== undefined) {
      this.el.querySelector('#status-loss').textContent = `Loss: ${loss.toFixed(5)}`;
    } else {
      this.el.querySelector('#status-loss').textContent = 'Loss: -';
    }
    if (noiseLevel !== undefined) {
      this.el.querySelector('#status-noise').textContent = `Noise: ${noiseLevel.toFixed(3)}`;
    }
  }

  updateMetrics(metrics = {}) {
    const set = (id, value) => {
      const el = this.el.querySelector(id);
      if (el) el.textContent = value;
    };

    if (metrics.mode) set('#metric-mode', metrics.mode);
    if (metrics.joystickX !== undefined && metrics.joystickY !== undefined) {
      set('#metric-joystick', `${metrics.joystickX.toFixed(2)}, ${metrics.joystickY.toFixed(2)}`);
    }
    if (metrics.outputMean !== undefined) set('#metric-mean', metrics.outputMean.toFixed(3));
    if (metrics.outputSpread !== undefined) set('#metric-spread', metrics.outputSpread.toFixed(3));
    if (metrics.bestLoss !== undefined && metrics.bestLoss !== null) {
      set('#metric-best-loss', metrics.bestLoss.toFixed(5));
    }
    if (metrics.totalTrainingIterations !== undefined) {
      set('#metric-train-iters', String(metrics.totalTrainingIterations));
    }
    if (metrics.gamepadConnected !== undefined) {
      set('#metric-gamepad', metrics.gamepadConnected ? 'Connected' : 'Disconnected');
    }
    if (metrics.followMode !== undefined) {
      set('#metric-follow', metrics.followMode ? 'On' : 'Off');
    }
  }

  updateLossPlot(lossHistory = []) {
    const canvas = this.el.querySelector('#loss-plot');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#2b2b2b';
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    if (!lossHistory.length) {
      ctx.fillStyle = '#666';
      ctx.font = '11px monospace';
      ctx.fillText('Loss history appears after training.', 10, 18);
      return;
    }

    const points = lossHistory.slice(-420);
    let min = Infinity;
    let max = -Infinity;
    for (const v of points) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = Math.max(max - min, 1e-9);
    const leftPad = 6;
    const rightPad = 6;
    const topPad = 6;
    const bottomPad = 14;
    const plotW = width - leftPad - rightPad;
    const plotH = height - topPad - bottomPad;

    ctx.strokeStyle = '#243523';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftPad, topPad + plotH / 2);
    ctx.lineTo(width - rightPad, topPad + plotH / 2);
    ctx.stroke();

    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = leftPad + (i / Math.max(points.length - 1, 1)) * plotW;
      const yNorm = (points[i] - min) / range;
      const y = topPad + (1 - yNorm) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = '#8a8a8a';
    ctx.font = '10px monospace';
    ctx.fillText(`min ${min.toFixed(5)}`, leftPad, height - 3);
    ctx.fillText(`max ${max.toFixed(5)}`, width - rightPad - 78, height - 3);
  }
}
