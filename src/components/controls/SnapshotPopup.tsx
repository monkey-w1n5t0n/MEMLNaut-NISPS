/**
 * SnapshotPopup — floating overlay showing weight snapshot history.
 *
 * Appears when the user clicks the undo button while the popup is toggled open,
 * or via a long-press gesture handled by the parent. Each entry shows the tag,
 * a relative timestamp, and a "jump to" button that restores that snapshot and
 * truncates the stack at that point.
 *
 * The parent is responsible for opening/closing via the `open` prop and
 * calling `onClose` when the backdrop or close button is clicked.
 */

import { For, Show } from 'solid-js';
import type { MLStore } from '../../stores/ml-store';
import type { SnapshotStack } from '../../core/snapshot-stack';
import './snapshot-popup.css';

export interface SnapshotPopupProps {
  open: boolean;
  onClose: () => void;
  mlStore: MLStore;
  stack: SnapshotStack;
}

/** Format a timestamp relative to now */
function formatAge(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  return `${diffH}h ago`;
}

export default function SnapshotPopup(props: SnapshotPopupProps) {
  function handleJumpTo(index: number): void {
    const state = props.stack.jumpTo(index);
    if (!state) return;
    const iml = props.mlStore.getActiveIml();
    if (iml) {
      iml._setFlatWeights(state.weights);
      // Re-run inference so outputs update
      iml.process();
    }
    props.onClose();
  }

  // Build a reversed list so newest is at top
  function items() {
    return props.stack.list().slice().reverse();
  }

  return (
    <Show when={props.open}>
      {/* Invisible backdrop to catch outside clicks */}
      <div class="snapshot-popup-backdrop" onClick={props.onClose} />

      <div class="snapshot-popup" role="dialog" aria-label="Snapshot history">
        <div class="snapshot-popup-header">
          <span class="snapshot-popup-title">History</span>
          <button class="snapshot-popup-close" onClick={props.onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <Show
          when={props.stack.depth > 0}
          fallback={<p class="snapshot-empty">No snapshots yet.</p>}
        >
          <ul class="snapshot-list">
            <For each={items()}>
              {(item) => (
                <li class="snapshot-item">
                  <div class="snapshot-item-info">
                    <span class="snapshot-item-tag">{item.tag}</span>
                    <span class="snapshot-item-time">{formatAge(item.timestamp)}</span>
                  </div>
                  <button
                    class="snapshot-jump-btn"
                    onClick={() => handleJumpTo(item.index)}
                  >
                    Jump to
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}
