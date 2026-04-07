/**
 * useHandTracking — SolidJS hook wrapping HandTracker.
 *
 * Manages the webcam MediaStream, the hidden video element, and the
 * rAF detection loop.  When features arrive they are forwarded to
 * imlHand via ml-store.  The hook wires its own onCleanup so the
 * camera is always released when the component unmounts.
 *
 * CDN load failures (network offline, CSP block, etc.) are caught
 * gracefully: an error is logged and the hook returns with `isActive`
 * remaining false — the rest of the app is unaffected.
 */

import { onCleanup } from 'solid-js';
import { HandTracker } from '../core/input/hand-tracker';
import type { HandTrackerOptions } from '../core/input/hand-tracker';
import type { MLStore } from '../stores/ml-store';

// ─── Controller interface (public API of the hook) ────────────────────────────

export interface UseHandTrackingController {
  /** Start the webcam and MediaPipe detection loop. */
  start(): Promise<void>;
  /** Stop detection and release the camera. */
  stop(): void;
  /** Whether the tracker is currently active. */
  isActive(): boolean;
  /** Current 14-element feature vector. */
  getFeatures(): number[];
  /** Update the exponential smoothing factor (0 = frozen, 1 = instant). */
  setSmoothing(factor: number): void;
  /** Override any tuning option at runtime. */
  setOptions(patch: Partial<HandTrackerOptions>): Promise<void>;
  /** Show or hide the video preview element. */
  setPreviewVisible(visible: boolean): void;
}

// ─── Hook options ─────────────────────────────────────────────────────────────

export interface UseHandTrackingOptions {
  /** Initial tracker tuning parameters. */
  trackerOptions?: Partial<HandTrackerOptions>;
  /** If provided, skeleton overlay is drawn on this canvas. */
  overlayCanvas?: HTMLCanvasElement;
  /** Whether the video preview starts visible (default false). */
  previewVisible?: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Create and wire a HandTracker into the ML engine.
 *
 * @param mlStore  - ML engine; imlHand receives features via setInput()
 * @param options  - Optional tuning / canvas / visibility config
 * @returns        Controller for start/stop and runtime adjustments
 */
export function useHandTracking(
  mlStore: MLStore,
  options: UseHandTrackingOptions = {},
): UseHandTrackingController {
  // Create an off-DOM video element for the camera feed.
  // The element is intentionally not appended to the document — callers
  // can place it in the DOM if they want a preview; by default it is hidden.
  const videoEl = document.createElement('video');
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.style.position = 'fixed';
  videoEl.style.bottom = '0';
  videoEl.style.right = '0';
  videoEl.style.width = '180px';
  videoEl.style.height = 'auto';
  videoEl.style.zIndex = '9999';
  videoEl.style.opacity = options.previewVisible ? '1' : '0';
  videoEl.style.pointerEvents = 'none';
  // Append to body so it can receive a srcObject and play (required in most browsers)
  document.body.appendChild(videoEl);

  // ─── Feature → imlHand bridge ───────────────────────────────────────────

  function onTrackingInput(features: number[]): void {
    const imlHand = mlStore.getImlHand();
    if (!imlHand) return;

    for (let i = 0; i < features.length; i++) {
      imlHand.setInput(i, features[i]);
    }
    imlHand.process();
  }

  // ─── Gesture → ML feedback bridge ──────────────────────────────────────

  function onPositiveFeedback(): void {
    mlStore.thumbsUp().catch((err: unknown) => {
      console.error('[useHandTracking] thumbsUp failed:', err);
    });
  }

  function onNegativeFeedback(): void {
    mlStore.thumbsDown();
  }

  // ─── HandTracker instance ───────────────────────────────────────────────

  const tracker = new HandTracker({
    videoElement: videoEl,
    overlayCanvas: options.overlayCanvas,
    options: options.trackerOptions,
    onTrackingInput,
    onPositiveFeedback,
    onNegativeFeedback,
    onConnectionChange: (active: boolean) => {
      console.log('[useHandTracking] Connection change:', active);
    },
  });

  // ─── Cleanup on unmount ─────────────────────────────────────────────────

  onCleanup(() => {
    tracker.destroy();
    if (videoEl.parentNode) {
      videoEl.parentNode.removeChild(videoEl);
    }
  });

  // ─── Controller ─────────────────────────────────────────────────────────

  const controller: UseHandTrackingController = {
    async start(): Promise<void> {
      try {
        await tracker.start();
      } catch (err) {
        // Graceful failure: log and do not propagate — CDN load failure or
        // webcam permission denial should not crash the app.
        console.error(
          '[useHandTracking] Could not start hand tracking. ' +
          'MediaPipe CDN may be unreachable or webcam access was denied.',
          err,
        );
      }
    },

    stop(): void {
      tracker.stop();
    },

    isActive(): boolean {
      return tracker.isActive();
    },

    getFeatures(): number[] {
      return tracker.getFeatures();
    },

    setSmoothing(factor: number): void {
      tracker.setSmoothing(factor);
    },

    async setOptions(patch: Partial<HandTrackerOptions>): Promise<void> {
      await tracker.setOptions(patch);
    },

    setPreviewVisible(visible: boolean): void {
      videoEl.style.opacity = visible ? '1' : '0';
    },
  };

  return controller;
}
