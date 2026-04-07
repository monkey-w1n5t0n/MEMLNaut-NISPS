/**
 * Singleton signal bus — shared across the entire app.
 *
 * Created once at module load time and also exposed at window.__nispsBus
 * for e2e tests and debug access.
 */

import { createSignalBus, type SignalBus } from './signal-bus';

const bus: SignalBus = createSignalBus();

// Expose bus globally for e2e tests and debug access
(window as any).__nispsBus = bus;

export default bus;
export type { SignalBus };
