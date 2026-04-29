/**
 * Typed signal bus.
 *
 * Topics use dotted prefixes (`ml.*`, `ui.*`, `mode.*`, `pin.*`). Listeners
 * may subscribe to a specific topic or to a prefix wildcard. The bus is
 * simple synchronous pub/sub — handlers run in order of registration.
 *
 * The bus is generic over an event-map type so callers get full type
 * safety on emit/listen.
 *
 * Example:
 *
 *   type Events = {
 *     'ml.trained':       { loss: number };
 *     'ml.delta_update':  void;
 *     'ui.preset_load':   { id: string };
 *     'pin.create':       { region: { x: number; y: number; w: number; h: number } };
 *   };
 *   const bus = createBus<Events>();
 *   bus.on('ml.trained', ({ loss }) => console.log(loss));
 *   bus.emit('ml.trained', { loss: 0.42 });
 */

export type EventMap = Record<string, unknown>;

type Handler<T> = (data: T, eventName: string) => void;

export interface Bus<E extends EventMap> {
  emit<K extends keyof E & string>(topic: K, data: E[K]): void;
  on<K extends keyof E & string>(topic: K, handler: Handler<E[K]>): () => void;
  /** Subscribe to a prefix; receives any matching topic and its data. */
  onPrefix(prefix: string, handler: Handler<unknown>): () => void;
  /** Remove all handlers (test cleanup). */
  clear(): void;
}

export function createBus<E extends EventMap>(): Bus<E> {
  const handlers = new Map<string, Set<Handler<unknown>>>();
  const prefixHandlers: Array<{ prefix: string; handler: Handler<unknown> }> = [];

  function emit<K extends keyof E & string>(topic: K, data: E[K]): void {
    const set = handlers.get(topic);
    if (set) {
      for (const h of set) {
        try {
          h(data as unknown, topic);
        } catch (err) {
          // Don't let one handler kill the rest.
          // eslint-disable-next-line no-console
          console.error(`[bus] handler for "${topic}" threw:`, err);
        }
      }
    }
    for (const { prefix, handler } of prefixHandlers) {
      if (topic === prefix || topic.startsWith(prefix + '.')) {
        try {
          handler(data as unknown, topic);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[bus] prefix handler "${prefix}" threw on "${topic}":`, err);
        }
      }
    }
  }

  function on<K extends keyof E & string>(topic: K, handler: Handler<E[K]>): () => void {
    let set = handlers.get(topic);
    if (!set) {
      set = new Set();
      handlers.set(topic, set);
    }
    set.add(handler as Handler<unknown>);
    return () => {
      set!.delete(handler as Handler<unknown>);
    };
  }

  function onPrefix(prefix: string, handler: Handler<unknown>): () => void {
    const entry = { prefix, handler };
    prefixHandlers.push(entry);
    return () => {
      const idx = prefixHandlers.indexOf(entry);
      if (idx >= 0) prefixHandlers.splice(idx, 1);
    };
  }

  function clear(): void {
    handlers.clear();
    prefixHandlers.length = 0;
  }

  return { emit, on, onPrefix, clear };
}

/**
 * Canonical event map used throughout the playground.
 *
 * Adding a new topic? Add it here AND ensure consumers update.
 */
export type CoreEvents = {
  // ML
  'ml.trained': { loss: number };
  'ml.delta_update': { reason: 'thumbs_up' | 'thumbs_down' | 'randomize' | 'undo' };
  'ml.example_added': { count: number };
  'ml.examples_cleared': void;

  // UI
  'ui.mode_switch': { from: string | null; to: string };
  'ui.preset_load': { kind: 'control' | 'synth' | 'session'; id: string };
  'ui.drawer_toggle': { id: string; open: boolean };

  // Mode
  'mode.params_changed': { modeId: string };

  // Pin
  'pin.create': { kind: 'region' | 'param'; id: string };
  'pin.remove': { kind: 'region' | 'param'; id: string };

  // Snapshots
  'snap.push': { tag: string };
  'snap.pop': { tag: string | null };
  'snap.cleared': void;
};

/**
 * Singleton bus instance for the app. Tests can call `coreBus.clear()` to
 * reset between test cases.
 */
export const coreBus: Bus<CoreEvents> = createBus<CoreEvents>();
