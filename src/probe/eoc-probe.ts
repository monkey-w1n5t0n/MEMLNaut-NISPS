/**
 * EOC debug probe — window.__nispsEoc exposed unconditionally.
 *
 * Unlike window.__nisps (which requires ?debug=1), this probe is always
 * present for external tooling compatibility, matching the vanilla app's
 * behaviour.
 */

import type { EOCChain } from '../core/eoc/eoc-chain.js';
import type { WasmIML } from '../core/iml.js';

export interface EOCProbe {
  /** Get/set the training target for EOC (which IML instance feeds the chain) */
  trainingTarget: 'joy' | 'hand' | null;
  /** Direct access to the EOC IML instance (if in Linked/Independent mode) */
  imlEoc: WasmIML | null;
  /** Get the current NISPS mode */
  getMode(): string;
  /** Get the module list */
  getModules(): string[];
}

/**
 * Create the EOC probe object, wired to an EOCChain instance.
 *
 * The returned object uses getters so that reads always reflect the current
 * chain state rather than a snapshot taken at creation time.
 */
export function createEocProbe(chain: EOCChain): EOCProbe {
  return {
    get trainingTarget(): 'joy' | 'hand' | null {
      const mode = chain.nispsMode;
      if (mode === 'bypass' || mode === 'shared') return null;
      // 'linked' shares the same joystick input; 'independent' has its own
      return mode === 'linked' ? 'joy' : 'hand';
    },

    set trainingTarget(_value: 'joy' | 'hand' | null) {
      // Read-only via probe; mutations go through EOCChain.nispsMode
      console.warn('[NISPS EOC] trainingTarget is read-only via the probe. Use EOCChain.nispsMode to change the integration mode.');
    },

    get imlEoc(): WasmIML | null {
      const mode = chain.nispsMode;
      // Only 'linked' and 'independent' modes have a dedicated EOC IML instance.
      // The chain does not own a WasmIML directly — that is managed by the app layer.
      // Return null here; the app layer may override this property after calling
      // exposeEocProbe() to attach its own IML reference.
      if (mode === 'linked' || mode === 'independent') return null;
      return null;
    },

    set imlEoc(_value: WasmIML | null) {
      // Intentional no-op — app layer replaces this getter via Object.defineProperty
      // after wiring up the real WasmIML instance.
    },

    getMode(): string {
      return chain.nispsMode;
    },

    getModules(): string[] {
      return chain.modules.map(m => m.id);
    },
  };
}

/**
 * Expose window.__nispsEoc unconditionally (no ?debug=1 check).
 * Returns the probe object for use by the app layer (e.g. to attach imlEoc).
 *
 * @param chain  The EOCChain instance to bind the probe to.
 */
export function exposeEocProbe(chain: EOCChain): EOCProbe {
  const probe = createEocProbe(chain);
  (window as any).__nispsEoc = probe;
  console.log('[NISPS] EOC probe exposed at window.__nispsEoc');
  return probe;
}
