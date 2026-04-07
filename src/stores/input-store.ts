/**
 * Input Store — SolidJS reactive store for joystick input state.
 *
 * Holds joyX, joyY as signals (not in a store — simpler access pattern).
 * Tracks drag state and follow mode. On position change, calls ML store's setInputs.
 *
 * Architecture:
 *   - joyX, joyY: signals in [0,1]
 *   - isDragging: tracks active pointer interaction
 *   - followMode: toggled by double-tap — allows full-screen pointer tracking
 *   - setJoystickPosition: clamps + updates signals + calls ML store setInputs
 */

import { createSignal } from 'solid-js';
import type { MLStore } from './ml-store';
import type { SignalBus } from '../bus/signal-bus';

// ─── Input Store Interface ──────────────────────────────────────────

export interface InputStore {
  /** Joystick X position [0,1] */
  joyX: () => number;
  /** Joystick Y position [0,1] */
  joyY: () => number;
  /** Whether the pointer is actively dragging */
  isDragging: () => boolean;
  /** Whether follow mode is active (full-screen pointer tracking) */
  followMode: () => boolean;

  /** Set joystick position, clamped to [0,1]. Updates ML store. */
  setJoystickPosition: (x: number, y: number) => void;
  /** Set drag state */
  setDragging: (dragging: boolean) => void;
  /** Toggle follow mode */
  toggleFollowMode: () => void;
  /** Set follow mode explicitly */
  setFollowMode: (enabled: boolean) => void;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createInputStore(mlStore: MLStore, bus: SignalBus): InputStore {
  const [joyX, setJoyX] = createSignal(0.5);
  const [joyY, setJoyY] = createSignal(0.5);
  const [isDragging, setIsDragging] = createSignal(false);
  const [followMode, setFollowModeSignal] = createSignal(false);

  // Create bus topics
  const inputTopic = bus.createTopic<{ x: number; y: number }>('input.position');

  const store: InputStore = {
    joyX,
    joyY,
    isDragging,
    followMode,

    setJoystickPosition: (x: number, y: number) => {
      // Clamp to [0,1], guard against NaN/Infinity
      const clamp = (v: number) => {
        if (!Number.isFinite(v)) return 0.5;
        return Math.max(0, Math.min(1, v));
      };

      const cx = clamp(x);
      const cy = clamp(y);

      setJoyX(cx);
      setJoyY(cy);

      // Propagate to ML store (which does its own clamping too)
      mlStore.setInputs(cx, cy);

      // Emit on bus for other consumers
      inputTopic.emit({ x: cx, y: cy });
    },

    setDragging: (dragging: boolean) => {
      setIsDragging(dragging);
    },

    toggleFollowMode: () => {
      setFollowModeSignal(prev => !prev);
    },

    setFollowMode: (enabled: boolean) => {
      setFollowModeSignal(enabled);
    },
  };

  return store;
}
