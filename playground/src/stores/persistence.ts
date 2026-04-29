/**
 * localStorage helpers with debounced writes.
 *
 * SolidJS stores want fine-grained reactivity, but localStorage I/O is slow
 * and we don't want to write on every keystroke. Each store using
 * persistence schedules a write via `schedulePersist(key, getValue)` and the
 * helper coalesces calls within a 200 ms window.
 */

const FLUSH_INTERVAL_MS = 200;
const pending = new Map<string, () => unknown>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  timer = null;
  for (const [key, getValue] of pending) {
    try {
      const value = getValue();
      if (value === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[persistence] failed to write "${key}":`, err);
    }
  }
  pending.clear();
}

export function schedulePersist(key: string, getValue: () => unknown): void {
  if (typeof localStorage === 'undefined') return;
  pending.set(key, getValue);
  if (timer === null) {
    timer = setTimeout(flush, FLUSH_INTERVAL_MS);
  }
}

export function flushPersist(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  flush();
}

export function loadPersisted<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function clearPersisted(key: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(key);
}
