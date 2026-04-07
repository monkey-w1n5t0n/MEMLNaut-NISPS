/**
 * useGamepad — polls the Gamepad API via rAF and maps controller inputs to app actions.
 *
 * Ported from playground/js/ui/gamepad.js with SolidJS lifecycle integration.
 *
 * Button mapping:
 *   Left stick X/Y  → joystick position (inputStore.setJoystickPosition)
 *   LB (button 4)   → thumbs-down (mlStore.thumbsDown)
 *   RB (button 5)   → thumbs-up (mlStore.thumbsUp)
 *   A  (button 0)   → train (mlStore.trainAsync)
 *   X  (button 2)   → randomize (mlStore.randomise)
 *   B  (button 1)   → clear examples (mlStore.clearExamples)
 *
 * The rAF polling loop only runs while a gamepad is connected.
 * onCleanup wires up automatic teardown on component unmount.
 */

import { onCleanup } from 'solid-js';
import type { MLStore } from '../stores/ml-store';
import type { InputStore } from '../stores/input-store';

// ─── Public Interface ─────────────────────────────────────────────────

export interface GamepadController {
  /** Returns true if a gamepad is currently connected */
  isConnected(): boolean;
  /** Update the axis deadzone (default 0.15) */
  setDeadzone(dz: number): void;
  /** Invert the Y axis so that up maps to 0 */
  setInvertY(invert: boolean): void;
}

// ─── Config Defaults ──────────────────────────────────────────────────

const DEFAULT_DEADZONE = 0.15;
const DEFAULT_MOVE_THRESHOLD = 0.01;
const DEFAULT_AXIS_X = 0;
const DEFAULT_AXIS_Y = 1;

// Button indices (standard gamepad mapping)
const BUTTON_A = 0;
const BUTTON_B = 1;
const BUTTON_X = 2;
const BUTTON_LB = 4;
const BUTTON_RB = 5;

const WATCHED_BUTTONS = [BUTTON_A, BUTTON_B, BUTTON_X, BUTTON_LB, BUTTON_RB];

// ─── Hook ─────────────────────────────────────────────────────────────

export function useGamepad(mlStore: MLStore, inputStore: InputStore): GamepadController {
  // Mutable config — settable via controller interface
  let deadzone = DEFAULT_DEADZONE;
  let moveThreshold = DEFAULT_MOVE_THRESHOLD;
  let axisX = DEFAULT_AXIS_X;
  let axisY = DEFAULT_AXIS_Y;
  let invertY = false;

  // Runtime state
  let connected = false;
  let gamepadIndex = -1;
  let rafId: number | null = null;
  let probeInterval: ReturnType<typeof setInterval> | null = null;
  let lastAxes: [number, number] = [0.5, 0.5];
  let buttonsPrev: boolean[] = [];

  // ─── Gamepad discovery ───

  function findGamepad(): void {
    if (!navigator.getGamepads) return;
    const gamepads = navigator.getGamepads();
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp && gp.connected) {
        gamepadIndex = i;
        setConnected(true);
        return;
      }
    }
  }

  function setConnected(value: boolean): void {
    if (connected === value) return;
    connected = value;
    if (connected) {
      startPolling();
    } else {
      stopPolling();
    }
  }

  // ─── Event handlers ───

  function onConnected(e: GamepadEvent): void {
    if (gamepadIndex < 0) {
      gamepadIndex = e.gamepad.index;
    }
    setConnected(true);
  }

  function onDisconnected(e: GamepadEvent): void {
    if (e.gamepad.index !== gamepadIndex) return;
    gamepadIndex = -1;
    // Try to find another connected gamepad before marking disconnected
    findGamepad();
    if (gamepadIndex < 0) {
      setConnected(false);
    }
  }

  // ─── rAF polling ───

  function poll(): void {
    if (!navigator.getGamepads) return;
    const gamepads = navigator.getGamepads();
    let gp: Gamepad | null = null;

    if (gamepadIndex >= 0 && gamepads[gamepadIndex]?.connected) {
      gp = gamepads[gamepadIndex];
    } else {
      // Stale index — scan for any connected pad
      gamepadIndex = -1;
      for (let i = 0; i < gamepads.length; i++) {
        const candidate = gamepads[i];
        if (candidate?.connected) {
          gp = candidate;
          gamepadIndex = i;
          break;
        }
      }
    }

    if (!gp) {
      buttonsPrev = [];
      setConnected(false);
      return;
    }

    // ── Axes: left stick X/Y ──────────────────────────────────────────
    const rawX = gp.axes[axisX] ?? 0;
    const rawY = gp.axes[axisY] ?? 0;

    // Apply deadzone (clamp to zero inside deadzone, preserve direction outside)
    const applyDeadzone = (v: number): number =>
      Math.abs(v) < deadzone ? 0 : v;

    const filteredX = applyDeadzone(rawX);
    const filteredY = applyDeadzone(rawY);

    // Map [-1,1] → [0,1]
    let mappedX = (filteredX + 1) * 0.5;
    let mappedY = (filteredY + 1) * 0.5;
    if (invertY) mappedY = 1 - mappedY;

    const moved =
      Math.abs(mappedX - lastAxes[0]) > moveThreshold ||
      Math.abs(mappedY - lastAxes[1]) > moveThreshold;

    if (moved) {
      lastAxes = [mappedX, mappedY];
      inputStore.setJoystickPosition(mappedX, mappedY);
    }

    // ── Buttons ───────────────────────────────────────────────────────
    for (const idx of WATCHED_BUTTONS) {
      const pressed = !!gp.buttons[idx]?.pressed;
      const prev = !!buttonsPrev[idx];

      if (pressed && !prev) {
        handleButtonPress(idx);
      }

      buttonsPrev[idx] = pressed;
    }
  }

  function handleButtonPress(idx: number): void {
    switch (idx) {
      case BUTTON_LB:
        mlStore.thumbsDown();
        break;
      case BUTTON_RB:
        mlStore.thumbsUp();
        break;
      case BUTTON_A:
        mlStore.trainAsync();
        break;
      case BUTTON_X:
        mlStore.randomise();
        break;
      case BUTTON_B:
        mlStore.clearExamples();
        break;
    }
  }

  function rafLoop(): void {
    poll();
    if (connected) {
      rafId = requestAnimationFrame(rafLoop);
    } else {
      rafId = null;
    }
  }

  function startPolling(): void {
    if (rafId !== null) return; // already running
    rafId = requestAnimationFrame(rafLoop);
  }

  function stopPolling(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ─── Initialise ───────────────────────────────────────────────────────

  window.addEventListener('gamepadconnected', onConnected);
  window.addEventListener('gamepaddisconnected', onDisconnected);

  // Eagerly check for already-connected gamepads (no event fires for pre-existing ones)
  findGamepad();

  // Periodic fallback probe: some Linux/Steam Deck environments don't fire
  // gamepadconnected reliably. Poll every 500ms until we find one.
  probeInterval = setInterval(() => {
    if (!connected) {
      findGamepad();
    } else {
      if (probeInterval !== null) {
        clearInterval(probeInterval);
        probeInterval = null;
      }
    }
  }, 500);

  // ─── Cleanup ──────────────────────────────────────────────────────────

  onCleanup(() => {
    window.removeEventListener('gamepadconnected', onConnected);
    window.removeEventListener('gamepaddisconnected', onDisconnected);
    stopPolling();
    if (probeInterval !== null) {
      clearInterval(probeInterval);
      probeInterval = null;
    }
  });

  // ─── Public controller ────────────────────────────────────────────────

  return {
    isConnected: () => connected,
    setDeadzone: (dz: number) => { deadzone = dz; },
    setInvertY: (invert: boolean) => { invertY = invert; },
  };
}
