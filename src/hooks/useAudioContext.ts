/**
 * useAudioContext — SolidJS hook for Web Audio API AudioContext lifecycle.
 *
 * Supports two ownership patterns:
 *
 *   1. "I own the context" (Faust engines) — call getOrCreateContext() and pass
 *      the returned AudioContext to the engine on init. The hook owns the
 *      context and will close it on component unmount.
 *
 *   2. "The engine owns the context" (C15Bridge) — the bridge creates its own
 *      AudioContext internally. Call registerExternalContext(ctx) to hand that
 *      context to the manager. The hook will NOT close an externally-registered
 *      context on cleanup.
 *
 * AudioContext creation is lazy — browsers require a user gesture before
 * constructing one. Call resume() inside a click/touch/keydown handler to
 * unsuspend the context after the first user interaction.
 *
 * Usage:
 *   const audio = useAudioContext();
 *
 *   // On user gesture:
 *   audio.resume();
 *
 *   // For Faust / owned engines:
 *   const ctx = audio.getOrCreateContext();
 *   engine.init(ctx);
 *
 *   // For C15Bridge (external context):
 *   const bridgeCtx = await c15Bridge.start();
 *   audio.registerExternalContext(bridgeCtx);
 */

import { onCleanup } from 'solid-js';

// ─── AudioContextManager interface ───────────────────────────────────────────

export interface AudioContextManager {
  /**
   * Get the current AudioContext, or create a new one if none exists yet.
   * Lazy — no AudioContext is created until this is called.
   * If an external context was previously registered, returns that instead.
   */
  getOrCreateContext(): AudioContext;

  /**
   * Resume a suspended AudioContext. Must be called inside a user gesture
   * handler (click, touch, keydown) — browsers suspend new AudioContexts by
   * default and require a gesture to start them running.
   *
   * Safe to call even if no context exists yet; it will create one first.
   */
  resume(): Promise<void>;

  /**
   * Whether an AudioContext is available and in the 'running' state.
   * Returns false if no context has been created or registered yet, or if
   * the context is suspended/closed.
   */
  isReady(): boolean;

  /**
   * Register an AudioContext that was created externally (e.g. by C15Bridge).
   * The hook will NOT close this context on cleanup — the external owner is
   * responsible for its lifecycle.
   *
   * If a context already exists (owned or external), this replaces the
   * reference without closing the old one — the caller must handle that.
   */
  registerExternalContext(ctx: AudioContext): void;

  /**
   * Release resources. Closes the AudioContext if the hook owns it.
   * Externally-registered contexts are NOT closed.
   *
   * Called automatically via onCleanup when the component that called
   * useAudioContext() unmounts. You can also call it manually.
   */
  dispose(): void;
}

// ─── Module-level shared state ───────────────────────────────────────────────
//
// A single AudioContext is shared across the whole app — browsers impose a
// per-origin limit (typically 6). The context is created lazily on first call
// to getOrCreateContext() or resume().
//
// Ownership flag tracks whether this module created the context (and therefore
// should close it on dispose) vs. whether it was registered externally.

let sharedContext: AudioContext | null = null;
let isOwnedContext = false; // true = we created it; false = externally registered

// ─── Internal helpers ─────────────────────────────────────────────────────────

function ensureContext(): AudioContext {
  if (!sharedContext) {
    sharedContext = new AudioContext();
    isOwnedContext = true;
  }
  return sharedContext;
}

// ─── Factory — used by both the hook and standalone callers ──────────────────

function createAudioContextManager(): AudioContextManager {
  const manager: AudioContextManager = {
    getOrCreateContext(): AudioContext {
      return ensureContext();
    },

    async resume(): Promise<void> {
      const ctx = ensureContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
    },

    isReady(): boolean {
      return sharedContext !== null && sharedContext.state === 'running';
    },

    registerExternalContext(ctx: AudioContext): void {
      // Replace the reference — do NOT close the old one (not our job)
      sharedContext = ctx;
      isOwnedContext = false;
    },

    dispose(): void {
      // Only close contexts we created. External contexts are the caller's
      // responsibility — closing them here would break engines that hold refs.
      if (sharedContext && isOwnedContext) {
        sharedContext.close().catch(() => {
          // Ignore errors on close — context may already be closed
        });
        sharedContext = null;
        isOwnedContext = false;
      } else if (!isOwnedContext) {
        // We don't own it — just drop our reference without closing
        sharedContext = null;
      }
    },
  };

  return manager;
}

// ─── SolidJS hook ────────────────────────────────────────────────────────────

/**
 * useAudioContext — call inside a SolidJS component.
 *
 * Returns an AudioContextManager and registers cleanup via onCleanup so the
 * AudioContext is closed (if owned) when the component unmounts.
 *
 * The underlying AudioContext is module-level and shared — multiple components
 * calling useAudioContext() all operate on the same context. Only the first
 * component to unmount will trigger dispose(); subsequent unmounts are no-ops
 * (sharedContext is null by then).
 *
 * @example
 * const audio = useAudioContext();
 *
 * function handleClick() {
 *   audio.resume();                   // unblock browser autoplay policy
 *   const ctx = audio.getOrCreateContext();
 *   myFaustEngine.init(ctx);
 * }
 */
export function useAudioContext(): AudioContextManager {
  const manager = createAudioContextManager();

  // Wire SolidJS cleanup — fires when the calling component unmounts
  onCleanup(() => {
    manager.dispose();
  });

  return manager;
}
