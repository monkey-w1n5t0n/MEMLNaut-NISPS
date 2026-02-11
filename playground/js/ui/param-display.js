// Parameter bar display
// Shows 8 output parameters as horizontal bars, draggable in examples mode

const PARAM_NAMES = ['Flow', 'Scale', 'Speed', 'Hue', 'Spread', 'Size', 'Trail', 'Turb'];
const PARAM_COLORS = ['#00ff88', '#00ccff', '#ff6600', '#ff00cc', '#ffcc00', '#88ff00', '#0088ff', '#ff3366'];

export class ParamDisplay {
  constructor(container, numParams = 8) {
    this.container = container;
    this.numParams = numParams;
    this.values = new Array(numParams).fill(0.5);
    this.draggable = false;
    this.onChange = null;
    this.activeBar = -1;
    this.build();
  }

  build() {
    this.container.innerHTML = '';
    this.bars = [];

    for (let i = 0; i < this.numParams; i++) {
      const row = document.createElement('div');
      row.className = 'param-row';

      const label = document.createElement('span');
      label.className = 'param-label';
      label.textContent = PARAM_NAMES[i] || `p${i}`;

      const track = document.createElement('div');
      track.className = 'param-track';
      track.dataset.index = i;

      const fill = document.createElement('div');
      fill.className = 'param-fill';
      fill.style.background = PARAM_COLORS[i] || '#888';
      fill.style.width = '50%';

      const val = document.createElement('span');
      val.className = 'param-value';
      val.textContent = '0.50';

      track.appendChild(fill);
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(val);
      this.container.appendChild(row);

      this.bars.push({ fill, val, track });
    }

    // Touch/mouse drag events on the container
    const onStart = (e) => {
      if (!this.draggable) return;
      const target = e.target.closest('.param-track');
      if (!target) return;
      e.preventDefault();
      this.activeBar = parseInt(target.dataset.index);
      this._updateFromEvent(e);
    };

    const onMove = (e) => {
      if (this.activeBar < 0 || !this.draggable) return;
      e.preventDefault();
      this._updateFromEvent(e);
    };

    const onEnd = () => {
      this.activeBar = -1;
    };

    this.container.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    this.container.addEventListener('touchstart', onStart, { passive: false });
    this.container.addEventListener('touchmove', onMove, { passive: false });
    this.container.addEventListener('touchend', onEnd);
  }

  _updateFromEvent(e) {
    const i = this.activeBar;
    if (i < 0) return;
    const track = this.bars[i].track;
    const rect = track.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const value = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    this.values[i] = value;
    this._renderBar(i);
    if (this.onChange) this.onChange(i, value, this.values);
  }

  update(values) {
    for (let i = 0; i < this.numParams && i < values.length; i++) {
      this.values[i] = values[i];
      this._renderBar(i);
    }
  }

  _renderBar(i) {
    const v = this.values[i];
    this.bars[i].fill.style.width = (v * 100) + '%';
    this.bars[i].val.textContent = v.toFixed(2);
  }

  setDraggable(draggable) {
    this.draggable = draggable;
    this.container.classList.toggle('draggable', draggable);
  }
}
