/**
 * Gamepad presence — tells the app when a controller appears or leaves so it
 * can reconfigure itself. The Gamepad API only reports a pad after the first
 * button press, so this listens for the connect event as well as checking
 * anything already connected at mount.
 */

export function gamepadPresent(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return false;
  for (const p of navigator.getGamepads()) if (p) return true;
  return false;
}

/** Calls `cb(true|false)` on every presence change (and once at start). */
export function watchGamepadPresence(cb: (present: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let last = gamepadPresent();
  cb(last);
  const check = () => {
    const now = gamepadPresent();
    if (now !== last) {
      last = now;
      cb(now);
    }
  };
  window.addEventListener('gamepadconnected', check);
  window.addEventListener('gamepaddisconnected', check);
  return () => {
    window.removeEventListener('gamepadconnected', check);
    window.removeEventListener('gamepaddisconnected', check);
  };
}
