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
    }
    if (noiseLevel !== undefined) {
      this.el.querySelector('#status-noise').textContent = `Noise: ${noiseLevel.toFixed(3)}`;
    }
  }
}
