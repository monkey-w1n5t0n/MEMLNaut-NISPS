/**
 * JoyMap Component — Canvas minimap showing joystick position, trail, noise rings.
 *
 * Small (160×160 by default) circular canvas positioned near the joystick.
 * Owns its own rAF loop so it runs independently of other renders.
 *
 * Reads:
 *   - inputStore.joyX / joyY — current joystick position
 *   - mlStore.noiseLevel     — RL noise for outer ring
 *   - mlStore.state.outputMode — trail colour selection
 *
 * Optional props:
 *   - size         — CSS pixel size (default 160)
 *   - zoomLevel    — current pipeline zoom level [0,1] (default 1.0)
 *   - effectiveX/Y — pipeline-adjusted position (shows ghost line)
 *   - frozen       — output freeze gate state
 *   - onTrailTap   — called with {x,y} when user taps a trail point
 */

import { onMount, onCleanup, createEffect } from 'solid-js';
import type { InputStore } from '../../stores/input-store';
import type { MLStore } from '../../stores/ml-store';
import { JoyMap } from '../../core/ui/joy-map';
import './joy-map.css';

export interface JoyMapProps {
  inputStore: InputStore;
  mlStore: MLStore;
  /** CSS pixel size. Canvas renders at size×size. Default: 160. */
  size?: number;
  /** Current pipeline zoom level [0,1]. Default: 1.0 (no zoom). */
  zoomLevel?: number;
  /** Pipeline-adjusted X position (shows ghost line from physical to effective). */
  effectiveX?: number;
  /** Pipeline-adjusted Y position. */
  effectiveY?: number;
  /** Whether the output freeze gate is active. */
  frozen?: boolean;
  /** Called when the user taps a trail point — receives {x,y} in [0,1] space. */
  onTrailTap?: (pt: { x: number; y: number }) => void;
}

export default function JoyMapComponent(props: JoyMapProps) {
  let canvasRef: HTMLCanvasElement | undefined;
  let joyMap: JoyMap | undefined;
  let rafId = 0;
  let prevX = 0.5;
  let prevY = 0.5;

  const size = () => props.size ?? 160;

  // ─── rAF loop ──────────────────────────────────────────────────────────────

  function frame(): void {
    if (!joyMap) return;

    const x = props.inputStore.joyX();
    const y = props.inputStore.joyY();

    // Record trail point whenever position has changed meaningfully
    joyMap.addTrailPoint(x, y, props.zoomLevel ?? 1.0);

    prevX = x;
    prevY = y;

    joyMap.draw({
      joyX:        x,
      joyY:        y,
      effectiveX:  props.effectiveX,
      effectiveY:  props.effectiveY,
      zoomLevel:   props.zoomLevel ?? 1.0,
      noiseLevel:  props.mlStore.noiseLevel(),
      outputMode:  props.mlStore.state.outputMode,
      frozen:      props.frozen ?? false,
    });

    rafId = requestAnimationFrame(frame);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  onMount(() => {
    if (!canvasRef) return;

    const s = size();
    canvasRef.width  = s;
    canvasRef.height = s;

    joyMap = new JoyMap(canvasRef, {
      onTrailTap: props.onTrailTap,
    });

    rafId = requestAnimationFrame(frame);
  });

  onCleanup(() => {
    cancelAnimationFrame(rafId);
    joyMap?.destroy();
    joyMap = undefined;
  });

  // ─── Re-register onTrailTap if it changes ──────────────────────────────────
  // JoyMap holds a closure reference — easiest to recreate when prop changes.
  createEffect(() => {
    const cb = props.onTrailTap;
    if (joyMap) {
      // Replace via the internal field — acceptable since JoyMap exposes it
      // through the options object; here we just write directly.
      (joyMap as any).onTrailTap = cb ?? null;
    }
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div class="joy-map-container">
      <canvas
        ref={canvasRef}
        width={size()}
        height={size()}
        style={{ width: `${size()}px`, height: `${size()}px` }}
        class="joy-map-canvas"
        aria-label="Joystick minimap"
      />
    </div>
  );
}
