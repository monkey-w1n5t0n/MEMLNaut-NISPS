/**
 * OutputBackend — the adapter interface every output sink implements
 * (backends-spec §1). Exactly one backend is "active" at a time; the
 * BackendManager (manager.ts) consumes the engine's reactive spine and forwards
 * each routed output vector to the active backend's `send()`.
 *
 * Concrete backends are framework-neutral (NO React). The manager is the single
 * consumer of `engine.subscribe()` + `engine.routedOutput()`; backends never
 * touch the engine — they receive a `Float32Array` and push it to their sink
 * (WebMIDI port, OSC-over-WS bridge, particle visualiser, synth worklet).
 *
 * British spelling in product copy; the synth is the "Built-in Synth", never
 * "C15".
 */
import type { BackendId } from '../dock/output-state';

/** Per-output baseline mapping (backends-spec §3). One per output dim. */
export interface OutputMapping {
  /** Tri-state — 'off' excludes the output entirely, 'fixed' pins it. */
  state: 'off' | 'fixed' | 'live';
  /** Downstream silence — still computed, but not emitted to the sink. */
  muted: boolean;
  /** Baseline range floor (normalised 0..1 maps here). */
  min: number;
  /** Baseline range ceil. */
  max: number;
  /** 0..1, 0.5 = linear. */
  curve: number;
  /** Held value when state === 'fixed'. */
  fixedValue: number;
}

/** What a backend needs to know about the active mode/output set. */
export interface BackendContext {
  modeId: string;
  /** Model output dims in use (≤ 126). */
  outputCount: number;
  /** Per-output baseline mapping, length === outputCount. */
  mappings: OutputMapping[];
  /** Per-output user-facing names (for OSC paths / MIDI names / labels). */
  names: string[];
}

/** Connection / readiness status surfaced to the dock. */
export interface BackendStatus {
  /** Coarse state for status dots. */
  state: 'idle' | 'connecting' | 'ready' | 'error' | 'unavailable';
  /** Human-readable one-liner (British spelling). */
  message: string;
}

export interface OutputBackend {
  readonly id: BackendId;

  /** Probe — WebMIDI / WebSocket / Canvas availability. */
  isAvailable(): boolean;

  /** Becomes active. Resolve only when ready to receive send(). */
  start(ctx: BackendContext): Promise<void>;

  /**
   * Hot per-frame path. `routed` is the post-pipeline Float32Array (0..1),
   * length === ctx.outputCount. MUST NOT allocate; MUST NOT mutate `routed`.
   * Throttling / dead-zone live INSIDE each backend.
   */
  send(routed: Float32Array): void;

  /** Switching away / unmount. Release WS / MIDI / threads. */
  teardown(): Promise<void>;

  /** Latest status (polled by the dock hook). */
  status(): BackendStatus;

  /** Apply a fresh BackendContext (mappings / names changed) without a restart. */
  setContext?(ctx: BackendContext): void;

  /** Subscribe to status changes (returns an unsubscribe). */
  onStatusChange?(cb: (s: BackendStatus) => void): () => void;
}
