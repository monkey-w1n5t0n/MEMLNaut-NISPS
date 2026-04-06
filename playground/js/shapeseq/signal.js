/**
 * Minimal signal/observable for reactive UI updates.
 * No framework dependency. ~40 lines.
 *
 * @module shapeseq/signal
 */

export function createSignal(initialValue) {
  let value = initialValue;
  const subscribers = new Set();

  function get() { return value; }

  function set(newValue) {
    if (newValue === value) return;
    value = newValue;
    for (const fn of subscribers) fn(value);
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return { get, set, subscribe };
}

/**
 * Signal backed by a Float32Array for param vectors.
 * Subscribers are called when any element changes.
 */
export function createArraySignal(length) {
  const value = new Float32Array(length);
  const subscribers = new Set();

  function get() { return value; }

  function update(newArray) {
    let changed = false;
    for (let i = 0; i < value.length && i < newArray.length; i++) {
      if (value[i] !== newArray[i]) { value[i] = newArray[i]; changed = true; }
    }
    if (changed) {
      for (const fn of subscribers) fn(value);
    }
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return { get, update, subscribe };
}
