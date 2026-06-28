/**
 * PassthroughBackend — the no-op sink for backends whose output is consumed
 * elsewhere in the app rather than transported by the BackendManager:
 *
 *   - 'synth'    : the Built-in Synth plays INSIDE the engine (EngineHost →
 *                  worklet). The manager only gates audio (mute on non-synth
 *                  modes) — it does NOT re-send params, the engine already does.
 *   - 'particles': the FlowFieldVisualiser reads engine.getOutputs() in its own
 *                  rAF loop (a separate consumer of the spine).
 *   - 'editor'   : the MEMLNaut serial Editor is not an output sink.
 *
 * `send()` is intentionally empty. The manager applies the synth audio gate.
 */
import type { BackendContext, BackendStatus, OutputBackend } from './backend';
import type { BackendId } from '../dock/output-state';

export class PassthroughBackend implements OutputBackend {
  readonly id: BackendId;
  private message: string;

  constructor(id: BackendId, message: string) {
    this.id = id;
    this.message = message;
  }

  isAvailable(): boolean {
    return true;
  }

  async start(_ctx: BackendContext): Promise<void> {
    /* nothing to start */
  }

  send(_routed: Float32Array): void {
    /* output consumed elsewhere (engine worklet / particle rAF / serial) */
  }

  async teardown(): Promise<void> {
    /* nothing to release */
  }

  status(): BackendStatus {
    return { state: 'ready', message: this.message };
  }
}
