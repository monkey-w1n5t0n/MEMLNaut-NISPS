/**
 * ParticleBackend — the output backend for the Particle System mode (the DEFAULT
 * mode).
 *
 * Transport is a NO-OP: the flow-field visualiser (console/flow-field.ts, driven
 * by ParticleStage) is a SEPARATE consumer of the engine spine — it reads
 * `engine.getOutputs()` directly in its own requestAnimationFrame loop and maps
 * the first 20 outputs onto the visual field. So there is nothing for the
 * BackendManager to "send" here.
 *
 * What this backend DOES contribute:
 *   - It is a non-synth backend, so selecting it makes the BackendManager gate
 *     audio (`engine.audio.setMuted(true)`) — the synth is silenced while the
 *     particles are on screen, exactly like the MIDI / OSC modes.
 *   - It reports a sensible "ready" status for the Outputs panel.
 *
 * It extends PassthroughBackend (the shared no-op sink) purely to keep the
 * empty-`send` / nothing-to-start behaviour in one place; the audio gate lives
 * in the manager (`setActive`), not here.
 */
import { PassthroughBackend } from './passthrough-backend';
import type { BackendStatus } from './backend';

export class ParticleBackend extends PassthroughBackend {
  constructor() {
    super('particles', 'ready');
  }

  override status(): BackendStatus {
    return {
      state: 'ready',
      message: 'ready',
    };
  }
}
