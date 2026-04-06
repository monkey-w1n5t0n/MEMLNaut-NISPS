import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createSignal, createArraySignal } from '../signal.js';

// ---------------------------------------------------------------------------
// createSignal
// ---------------------------------------------------------------------------

describe('createSignal', () => {
  it('get returns the initial value', () => {
    const s = createSignal(42);
    assert.strictEqual(s.get(), 42);
  });

  it('set updates the value and notifies subscribers', () => {
    const s = createSignal(0);
    const calls = [];
    s.subscribe(v => calls.push(v));
    s.set(10);
    assert.strictEqual(s.get(), 10);
    assert.deepStrictEqual(calls, [10]);
  });

  it('does not notify on same value', () => {
    const s = createSignal('hello');
    const calls = [];
    s.subscribe(v => calls.push(v));
    s.set('hello');
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(s.get(), 'hello');
  });

  it('unsubscribe works', () => {
    const s = createSignal(0);
    const calls = [];
    const unsub = s.subscribe(v => calls.push(v));
    s.set(1);
    unsub();
    s.set(2);
    assert.deepStrictEqual(calls, [1]);
  });

  it('multiple subscribers each get notified', () => {
    const s = createSignal(0);
    const a = [], b = [];
    s.subscribe(v => a.push(v));
    s.subscribe(v => b.push(v));
    s.set(5);
    assert.deepStrictEqual(a, [5]);
    assert.deepStrictEqual(b, [5]);
  });
});

// ---------------------------------------------------------------------------
// createArraySignal
// ---------------------------------------------------------------------------

describe('createArraySignal', () => {
  it('initial value is all zeros', () => {
    const s = createArraySignal(4);
    const v = s.get();
    assert.strictEqual(v.length, 4);
    for (let i = 0; i < 4; i++) assert.strictEqual(v[i], 0);
  });

  it('update triggers only on actual changes', () => {
    const s = createArraySignal(3);
    const calls = [];
    s.subscribe(() => calls.push('changed'));

    // Same values (all zero) should not trigger
    s.update(new Float32Array([0, 0, 0]));
    assert.strictEqual(calls.length, 0);

    // Different values should trigger
    s.update(new Float32Array([0.5, 0, 0]));
    assert.strictEqual(calls.length, 1);
  });

  it('partial updates work (shorter array)', () => {
    const s = createArraySignal(4);
    s.update(new Float32Array([1, 2, 3, 4]));
    assert.strictEqual(s.get()[3], 4);

    // Partial update: only first 2 elements
    const calls = [];
    s.subscribe(() => calls.push('changed'));
    s.update(new Float32Array([10, 20]));

    // First two updated, last two unchanged
    assert.strictEqual(s.get()[0], 10);
    assert.strictEqual(s.get()[1], 20);
    assert.strictEqual(s.get()[2], 3);
    assert.strictEqual(s.get()[3], 4);
    assert.strictEqual(calls.length, 1);
  });

  it('subscriber receives the backing array', () => {
    const s = createArraySignal(2);
    let received = null;
    s.subscribe(v => { received = v; });
    s.update(new Float32Array([0.1, 0.2]));
    assert.ok(received instanceof Float32Array);
    assert.strictEqual(received[0], Float32Array.of(0.1)[0]);
  });

  it('unsubscribe works', () => {
    const s = createArraySignal(2);
    const calls = [];
    const unsub = s.subscribe(() => calls.push('x'));
    s.update(new Float32Array([1, 0]));
    unsub();
    s.update(new Float32Array([2, 0]));
    assert.strictEqual(calls.length, 1);
  });
});
