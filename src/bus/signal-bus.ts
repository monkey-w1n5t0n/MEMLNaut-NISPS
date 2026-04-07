/**
 * Reactive Signal Bus — unified event system for the NISPS SolidJS app.
 *
 * Replaces EventBus + CustomEvents from the old playground app.
 * Uses SolidJS `createSignal` with `equals: false` so every emit()
 * triggers subscribers even when the data is identical.
 *
 * Wildcard matching via `match()` supports:
 *   `*`  — matches exactly one segment (e.g. "ml.*" matches "ml.loss" but not "ml.a.b")
 *   `**` — matches zero or more segments (e.g. "a.**" matches "a", "a.b", "a.b.c")
 */
import { createSignal } from 'solid-js';

// ─── Types ────────────────────────────────────────────────────────────

export type Unsubscribe = () => void;

export type Subscriber<T> = (value: T, topicName: string) => void;

/** A callable topic: read current value by calling it, or use emit/subscribe. */
export interface Topic<T> {
  /** Read the current value (signal getter) */
  (): T | undefined;
  /** Emit a new value — always triggers subscribers (equals: false) */
  emit(value: T): void;
  /** Subscribe to emissions. Returns an unsubscribe function. */
  subscribe(fn: Subscriber<T>): Unsubscribe;
  /** The topic name */
  readonly name: string;
}

export interface SignalBus {
  /** Create (or get existing) named topic */
  createTopic<T>(name: string): Topic<T>;
  /** Retrieve an existing topic by name, or undefined */
  getTopic<T>(name: string): Topic<T> | undefined;
  /**
   * Subscribe to all topics matching a wildcard pattern.
   * - `*` matches one segment
   * - `**` matches zero or more segments
   * Also fires for topics created after the match() call.
   * Returns an unsubscribe function.
   */
  match<T>(pattern: string, fn: Subscriber<T>): Unsubscribe;
}

// ─── Implementation ───────────────────────────────────────────────────

/**
 * Check if a topic name matches a wildcard pattern.
 *
 * - `*` matches exactly one dot-separated segment
 * - `**` matches zero or more segments
 */
function matchesWildcard(pattern: string, name: string): boolean {
  // Exact match
  if (pattern === name) return true;

  const patternParts = pattern.split('.');
  const nameParts = name.split('.');

  return matchParts(patternParts, 0, nameParts, 0);
}

function matchParts(
  pp: string[], pi: number,
  np: string[], ni: number,
): boolean {
  // Both exhausted → match
  if (pi === pp.length && ni === np.length) return true;
  // Pattern exhausted but name remains → no match
  if (pi === pp.length) return false;

  // Double wildcard **
  if (pp[pi] === '**') {
    // Try matching ** with zero segments (skip ** in pattern)
    if (matchParts(pp, pi + 1, np, ni)) return true;
    // Try matching ** with one or more segments (consume one name segment, keep **)
    if (ni < np.length && matchParts(pp, pi, np, ni + 1)) return true;
    return false;
  }

  // Name exhausted but pattern remains (and it's not **) → no match
  if (ni === np.length) return false;

  // Single wildcard * or exact segment match
  if (pp[pi] === '*' || pp[pi] === np[ni]) {
    return matchParts(pp, pi + 1, np, ni + 1);
  }

  return false;
}

/**
 * Create a Topic by wrapping a function with signal-backed emit/subscribe.
 *
 * We use a factory function + Object.assign instead of an object literal with
 * a call signature, because Vite's OXC parser doesn't support function-call
 * shorthand inside object literals.
 */
function makeTopic<T>(
  name: string,
  matchSubscribers: Array<{
    pattern: string;
    fn: Subscriber<any>;
    matcher: (name: string) => boolean;
  }>,
): Topic<T> {
  // equals: false ensures every emit() triggers subscribers,
  // even if the value is identical to the previous one.
  const [getValue, setValue] = createSignal<T | undefined>(undefined, { equals: false });

  const subs: Array<Subscriber<T>> = [];

  // Start with a simple function (callable — reads the signal value)
  const topic = function topicReader(): T | undefined {
    return getValue();
  } as Topic<T>;

  // Attach properties
  Object.defineProperty(topic, 'name', {
    get: () => name,
    enumerable: true,
  });

  topic.emit = function emit(value: T): void {
    setValue(() => value);

    // Notify direct subscribers
    for (const sub of subs) {
      sub(value, name);
    }

    // Notify wildcard match subscribers
    for (const ms of matchSubscribers) {
      if (ms.matcher(name)) {
        ms.fn(value, name);
      }
    }
  };

  topic.subscribe = function subscribe(fn: Subscriber<T>): Unsubscribe {
    subs.push(fn);
    return () => {
      const idx = subs.indexOf(fn);
      if (idx !== -1) subs.splice(idx, 1);
    };
  };

  return topic;
}

export function createSignalBus(): SignalBus {
  const topics = new Map<string, Topic<any>>();
  const matchSubscribers = new Array<{
    pattern: string;
    fn: Subscriber<any>;
    matcher: (name: string) => boolean;
  }>();

  function createTopic<T>(name: string): Topic<T> {
    const existing = topics.get(name);
    if (existing) return existing as Topic<T>;

    const topic = makeTopic<T>(name, matchSubscribers);
    topics.set(name, topic);
    return topic;
  }

  function getTopic<T>(name: string): Topic<T> | undefined {
    return topics.get(name) as Topic<T> | undefined;
  }

  function match<T>(pattern: string, fn: Subscriber<T>): Unsubscribe {
    const matcher = (name: string) => matchesWildcard(pattern, name);

    const entry = { pattern, fn, matcher };
    matchSubscribers.push(entry);

    return () => {
      const idx = matchSubscribers.indexOf(entry);
      if (idx !== -1) matchSubscribers.splice(idx, 1);
    };
  }

  return { createTopic, getTopic, match };
}
