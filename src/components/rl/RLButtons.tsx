/**
 * RLButtons — Floating thumbs-up/thumbs-down buttons for RL feedback.
 *
 * Matches the old app's rl-buttons div:
 *   - Thumbs-down (−): explore more (adds noise to weights)
 *   - Thumbs-up (+): keep this (adds example + async training + decays noise)
 *
 * Positioned at bottom-center of viewport, above the status line.
 * Glass morphism circular buttons with keyboard shortcut hints.
 */

import { createEffect } from 'solid-js';
import type { MLStore } from '../../stores/ml-store';
import './rl-buttons.css';

export interface RLButtonsProps {
  mlStore: MLStore;
}

export default function RLButtons(props: RLButtonsProps) {
  let thumbsUpBtn: HTMLButtonElement | undefined;
  let thumbsDownBtn: HTMLButtonElement | undefined;

  function onThumbsUp(): void {
    flashButton(thumbsUpBtn);
    props.mlStore.thumbsUp().then(() => {
      // Training callback handles UI update via reactive signals
    });
  }

  function onThumbsDown(): void {
    flashButton(thumbsDownBtn);
    props.mlStore.thumbsDown();
  }

  function flashButton(btn: HTMLButtonElement | undefined): void {
    if (!btn) return;
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 300);
  }

  return (
    <div class="rl-buttons" id="rl-buttons">
      <button
        ref={thumbsDownBtn}
        class="rl-btn rl-down"
        id="btn-thumbsdown"
        title="Explore more"
        onClick={onThumbsDown}
      >
        <span class="rl-icon">&minus;</span>
        <span class="key-num">1</span>
      </button>
      <button
        ref={thumbsUpBtn}
        class="rl-btn rl-up"
        id="btn-thumbsup"
        title="Keep this"
        onClick={onThumbsUp}
      >
        <span class="rl-icon">+</span>
        <span class="key-num">2</span>
      </button>
    </div>
  );
}
