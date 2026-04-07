/**
 * useKeyboard — global keyboard shortcut handler for the immersive app.
 *
 * Mirrors the keyboard bindings from playground/js/a-app.js.
 * Shortcuts are suppressed when the user is typing in a form element.
 *
 * Key map:
 *   1         → thumbs-down
 *   2         → thumbs-up
 *   z / Z     → undo
 *   r / R     → randomise
 *   t / T     → trainAsync
 *   Space     → toggle follow mode
 *   Escape    → clear follow mode
 *   c / C     → clear all
 */

import { onCleanup } from 'solid-js';
import type { MLStore } from '../stores/ml-store';
import type { InputStore } from '../stores/input-store';

/** Returns true if the event target is an editable element that should consume keystrokes. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((target as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboard(
  mlStore: MLStore,
  inputStore: InputStore,
): void {
  function handleKeyDown(e: KeyboardEvent): void {
    if (isTypingTarget(e.target)) return;

    switch (e.key) {
      case '1':
        mlStore.thumbsDown();
        break;

      case '2':
        mlStore.thumbsUp();
        break;

      case 'z':
      case 'Z':
        mlStore.undo();
        break;

      case 'r':
      case 'R':
        mlStore.randomise();
        break;

      case 't':
      case 'T':
        mlStore.trainAsync();
        break;

      case ' ':
        e.preventDefault();
        inputStore.toggleFollowMode();
        break;

      case 'Escape':
        inputStore.setFollowMode(false);
        break;

      case 'c':
      case 'C':
        mlStore.clearAll();
        break;

      default:
        break;
    }
  }

  document.addEventListener('keydown', handleKeyDown);

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });
}
