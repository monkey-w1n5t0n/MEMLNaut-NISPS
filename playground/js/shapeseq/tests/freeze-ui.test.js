import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// ---------------------------------------------------------------------------
// Minimal DOM stubs — just enough for FreezeUI's DOM operations
// ---------------------------------------------------------------------------

class StubClassList {
  constructor() { this._set = new Set(); }
  add(...names) { names.forEach(n => this._set.add(n)); }
  remove(...names) { names.forEach(n => this._set.delete(n)); }
  contains(name) { return this._set.has(name); }
}

class StubStyle {
  constructor() {
    this.opacity = '';
    this.position = '';
    this.cssText = '';
    this.left = '';
    this.width = '';
  }
}

class StubElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this._className = '';
    this.textContent = '';
    this.type = '';
    this.dataset = {};
    this.classList = new StubClassList();
    this.style = new StubStyle();
    this.children = [];
    this.parentElement = null;
    this._listeners = {};
  }
  get className() { return this._className; }
  set className(val) {
    this._className = val;
    // Sync classList with className string
    this.classList._set.clear();
    val.split(/\s+/).filter(Boolean).forEach(c => this.classList._set.add(c));
  }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  querySelector(sel) {
    return this._queryAll(sel)[0] || null;
  }
  querySelectorAll(sel) {
    return this._queryAll(sel);
  }
  _queryAll(sel) {
    const results = [];
    this._walk(el => {
      if (matchesSelector(el, sel)) results.push(el);
    });
    return results;
  }
  _walk(fn) {
    for (const child of this.children) {
      fn(child);
      child._walk(fn);
    }
  }
  closest(sel) {
    let cur = this;
    while (cur) {
      if (matchesSelector(cur, sel)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  removeEventListener(type, fn) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter(f => f !== fn);
  }
  dispatchEvent(evt) {
    const handlers = this._listeners[evt.type] || [];
    for (const h of handlers) h(evt);
    // Bubble
    if (evt.bubbles && this.parentElement) {
      this.parentElement.dispatchEvent(evt);
    }
  }
}

/**
 * Very basic selector matching: handles .class, .class1.class2, tag selectors
 */
function matchesSelector(el, sel) {
  // Handle compound selectors like ".chain-param-row.param-live"
  const parts = sel.split('.');
  const tagPart = parts[0]; // empty string if selector starts with '.'
  const classParts = parts.slice(1);

  if (tagPart && el.tagName !== tagPart.toUpperCase()) return false;
  for (const cls of classParts) {
    if (!el.classList.contains(cls)) return false;
  }
  // If selector is just a tag with no classes
  if (classParts.length === 0 && tagPart) {
    return el.tagName === tagPart.toUpperCase();
  }
  return classParts.length > 0 || tagPart !== '';
}

function createElement(tag) {
  return new StubElement(tag);
}

// Stub out globalThis.document so injectStyles() doesn't crash
globalThis.document = {
  createElement,
  head: { appendChild() {} },
};

// ---------------------------------------------------------------------------
// Minimal FreezeManager stub
// ---------------------------------------------------------------------------

class StubFreezeManager {
  constructor() {
    this._frozen = false;
    this._liveFlags = null;
  }
  get isFrozen() { return this._frozen; }
  freeze(paramCount) {
    this._frozen = true;
    this._liveFlags = new Uint8Array(paramCount);
  }
  unfreeze() {
    this._frozen = false;
    this._liveFlags = null;
  }
  getLiveFlags() { return this._liveFlags; }
  toggleParam(idx) {
    if (!this._frozen) throw new Error('not frozen');
    this._liveFlags[idx] = this._liveFlags[idx] ? 0 : 1;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContainer(paramCount) {
  const container = createElement('div');
  for (let i = 0; i < paramCount; i++) {
    const row = createElement('div');
    row.classList.add('chain-param-row');
    row.dataset.flatIndex = String(i);

    const label = createElement('span');
    label.classList.add('chain-param-label');
    label.textContent = 'p' + i;
    row.appendChild(label);

    const slider = createElement('input');
    slider.type = 'range';
    slider.classList.add('chain-param-slider');
    slider.dataset.flatIndex = String(i);
    row.appendChild(slider);

    container.appendChild(row);
  }
  return container;
}

function makeClickEvent(bubbles = true) {
  return { type: 'click', bubbles, target: null };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FreezeUI', () => {
  let FreezeUI;
  let freezeUI;
  let container;
  let fm;
  let toggleLog;

  beforeEach(async () => {
    if (!FreezeUI) {
      const mod = await import('../freeze-ui.js');
      FreezeUI = mod.FreezeUI;
    }

    container = buildContainer(4);
    fm = new StubFreezeManager();
    toggleLog = [];

    freezeUI = new FreezeUI({
      container,
      freezeManager: fm,
      onToggle: (idx) => toggleLog.push(idx),
    });
  });

  // ── Construction ──────────────────────────────────────────────────

  it('can be constructed', () => {
    assert.ok(freezeUI, 'FreezeUI instance should exist');
    assert.ok(freezeUI._container === container, 'container reference stored');
  });

  // ── update() when frozen ──────────────────────────────────────────

  it('update() adds param-frozen class to all rows when frozen', () => {
    fm.freeze(4);
    freezeUI.update();

    const rows = container.querySelectorAll('.chain-param-row');
    for (const row of rows) {
      assert.ok(row.classList.contains('param-frozen'),
        'row ' + row.dataset.flatIndex + ' should have param-frozen');
      assert.ok(!row.classList.contains('param-live'),
        'row ' + row.dataset.flatIndex + ' should NOT have param-live');
      assert.strictEqual(row.style.opacity, '0.4',
        'frozen row should be dimmed');
    }
  });

  it('update() adds param-live class for live params when frozen', () => {
    fm.freeze(4);
    fm.toggleParam(1);
    fm.toggleParam(3);
    freezeUI.update();

    const rows = container.querySelectorAll('.chain-param-row');

    // Row 0: frozen
    assert.ok(rows[0].classList.contains('param-frozen'));
    assert.ok(!rows[0].classList.contains('param-live'));
    assert.strictEqual(rows[0].style.opacity, '0.4');

    // Row 1: live
    assert.ok(rows[1].classList.contains('param-live'));
    assert.ok(!rows[1].classList.contains('param-frozen'));
    assert.notStrictEqual(rows[1].style.opacity, '0.4');

    // Row 2: frozen
    assert.ok(rows[2].classList.contains('param-frozen'));

    // Row 3: live
    assert.ok(rows[3].classList.contains('param-live'));
  });

  // ── update() when NOT frozen ──────────────────────────────────────

  it('update() removes freeze styling when not frozen', () => {
    fm.freeze(4);
    fm.toggleParam(1);
    freezeUI.update();

    // Now unfreeze
    fm.unfreeze();
    freezeUI.update();

    const rows = container.querySelectorAll('.chain-param-row');
    for (const row of rows) {
      assert.ok(!row.classList.contains('param-frozen'),
        'row should NOT have param-frozen after unfreeze');
      assert.ok(!row.classList.contains('param-live'),
        'row should NOT have param-live after unfreeze');
      assert.strictEqual(row.style.opacity, '',
        'opacity should be cleared');
    }
  });

  // ── Click toggle ──────────────────────────────────────────────────

  it('clicking a param row label calls onToggle with the flat index', () => {
    fm.freeze(4);
    freezeUI.update();

    // Click on the label of row 2
    const row2 = container.querySelectorAll('.chain-param-row')[2];
    const label = row2.querySelector('.chain-param-label');

    const evt = makeClickEvent();
    evt.target = label;
    label.dispatchEvent(evt);

    assert.deepStrictEqual(toggleLog, [2], 'onToggle should be called with index 2');
  });

  it('clicking does nothing when not frozen', () => {
    const row0 = container.querySelectorAll('.chain-param-row')[0];
    const label = row0.querySelector('.chain-param-label');

    const evt = makeClickEvent();
    evt.target = label;
    label.dispatchEvent(evt);

    assert.deepStrictEqual(toggleLog, [], 'no toggle when not frozen');
  });

  it('clicking the slider itself does not toggle', () => {
    fm.freeze(4);
    freezeUI.update();

    const row1 = container.querySelectorAll('.chain-param-row')[1];
    const slider = row1.querySelector('.chain-param-slider');

    const evt = makeClickEvent();
    evt.target = slider;
    slider.dispatchEvent(evt);

    assert.deepStrictEqual(toggleLog, [], 'slider click should not trigger toggle');
  });

  // ── destroy() ─────────────────────────────────────────────────────

  it('destroy() removes the click listener', () => {
    fm.freeze(4);
    freezeUI.update();
    freezeUI.destroy();

    const row0 = container.querySelectorAll('.chain-param-row')[0];
    const label = row0.querySelector('.chain-param-label');

    const evt = makeClickEvent();
    evt.target = label;
    label.dispatchEvent(evt);

    assert.deepStrictEqual(toggleLog, [], 'no toggle after destroy');
  });

  // ── updateDeltaIndicators() ───────────────────────────────────────

  it('updateDeltaIndicators() creates delta-indicator elements on live rows', () => {
    fm.freeze(4);
    fm.toggleParam(1);
    freezeUI.update();

    const frozenParams = new Float32Array([0.3, 0.5, 0.7, 0.2]);
    const effectiveParams = new Float32Array([0.3, 0.8, 0.7, 0.2]);

    freezeUI.updateDeltaIndicators(frozenParams, effectiveParams);

    // Row 1 is live — should have a delta indicator
    const row1 = container.querySelectorAll('.chain-param-row')[1];
    const indicator = row1.querySelector('.delta-indicator');
    assert.ok(indicator, 'live row should have a delta-indicator');
  });

  it('updateDeltaIndicators() does nothing when not frozen', () => {
    const frozenParams = new Float32Array([0.3, 0.5, 0.7, 0.2]);
    const effectiveParams = new Float32Array([0.3, 0.8, 0.7, 0.2]);

    freezeUI.updateDeltaIndicators(frozenParams, effectiveParams);

    const indicators = container.querySelectorAll('.delta-indicator');
    assert.strictEqual(indicators.length, 0, 'no indicators when not frozen');
  });
});
