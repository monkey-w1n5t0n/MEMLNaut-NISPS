/**
 * SessionPresets — UI panel for saving, loading, and sharing session presets.
 *
 * Features:
 *   - Save button: prompts for a name, then saves a snapshot of the current
 *     control surface + synth preset + output pipeline config.
 *   - Preset list: each entry has Load and Delete buttons.
 *   - Export JSON: downloads all presets as a JSON file.
 *   - Import JSON: opens a file picker to import a previously exported file.
 *   - Copy URL: encodes the current state into URL search params and copies
 *     the resulting URL to the clipboard.
 */

import { createSignal, For, Show } from 'solid-js';
import type { SessionPresetManager, SessionPresetState, SessionPresetSummary } from '../../core/session-presets';
import './session-presets.css';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SessionPresetsProps {
  /** Preset manager instance (shared with the rest of the app). */
  manager: SessionPresetManager;
  /**
   * Called when a preset is loaded.
   * The parent is responsible for applying the state to the relevant subsystems.
   */
  onLoad: (state: SessionPresetState) => void;
  /**
   * Returns the current session state to be captured when saving or copying URL.
   */
  getCurrentState: () => SessionPresetState;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function SessionPresets(props: SessionPresetsProps) {
  // Reactive list — we manage this ourselves since the manager is imperative
  const [presets, setPresets] = createSignal<SessionPresetSummary[]>(
    props.manager.list(),
  );

  // Whether the save-name prompt is open
  const [savingOpen, setSavingOpen] = createSignal(false);
  const [saveName, setSaveName] = createSignal('');

  // "Copied!" feedback state for Copy URL button
  const [copied, setCopied] = createSignal(false);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function refreshList(): void {
    setPresets(props.manager.list());
  }

  // ── Save flow ─────────────────────────────────────────────────────────────

  function openSavePrompt(): void {
    setSaveName('');
    setSavingOpen(true);
  }

  function closeSavePrompt(): void {
    setSavingOpen(false);
  }

  function confirmSave(): void {
    const name = saveName().trim();
    if (!name) return;
    props.manager.save(name, props.getCurrentState());
    refreshList();
    setSavingOpen(false);
  }

  function handleSaveKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') confirmSave();
    if (e.key === 'Escape') closeSavePrompt();
  }

  // ── Load / Delete ─────────────────────────────────────────────────────────

  function handleLoad(name: string): void {
    const preset = props.manager.load(name);
    if (preset) props.onLoad(preset);
  }

  function handleDelete(name: string): void {
    props.manager.delete(name);
    refreshList();
  }

  // ── Copy URL ──────────────────────────────────────────────────────────────

  function handleCopyURL(): void {
    const queryStr = props.manager.toURL(props.getCurrentState());
    const url = `${window.location.origin}${window.location.pathname}?${queryStr}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(err => {
      console.warn('[SessionPresets] Clipboard write failed:', err);
    });
  }

  // ── Export JSON ───────────────────────────────────────────────────────────

  function handleExportJSON(): void {
    const json = props.manager.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nisps-presets-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Import JSON ───────────────────────────────────────────────────────────

  function handleImportJSON(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result;
        if (typeof text !== 'string') return;
        try {
          props.manager.importJSON(text);
          refreshList();
        } catch (e) {
          console.warn('[SessionPresets] Import failed:', e);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Save-name prompt overlay */}
      <Show when={savingOpen()}>
        <div class="sp-save-prompt-backdrop" onClick={closeSavePrompt} />
        <div class="sp-save-prompt" role="dialog" aria-label="Name your preset">
          <span class="sp-save-prompt-label">Save preset</span>
          <input
            class="sp-save-input"
            type="text"
            placeholder="Preset name…"
            value={saveName()}
            onInput={e => setSaveName((e.target as HTMLInputElement).value)}
            onKeyDown={handleSaveKeyDown}
            // eslint-disable-next-line solid/reactivity -- autofocus attr
            autofocus
          />
          <div class="sp-save-prompt-actions">
            <button class="sp-save-confirm-btn" onClick={confirmSave}>
              Save
            </button>
            <button class="sp-save-cancel-btn" onClick={closeSavePrompt}>
              Cancel
            </button>
          </div>
        </div>
      </Show>

      {/* Main panel */}
      <div class="sp-panel">
        <div class="sp-header">
          <span class="sp-title">Session Presets</span>
        </div>

        {/* Action buttons row */}
        <div class="sp-actions">
          <button class="sp-btn sp-btn--save" onClick={openSavePrompt} title="Save current state as a named preset">
            + Save
          </button>
          <button
            class={`sp-btn sp-btn--url${copied() ? ' sp-btn--copied' : ''}`}
            onClick={handleCopyURL}
            title="Copy a shareable URL encoding the current state"
          >
            {copied() ? 'Copied!' : 'Copy URL'}
          </button>
          <button class="sp-btn" onClick={handleExportJSON} title="Export all presets as JSON">
            Export
          </button>
          <button class="sp-btn" onClick={handleImportJSON} title="Import presets from a JSON file">
            Import
          </button>
        </div>

        {/* Preset list */}
        <div class="sp-list-wrap">
          <Show
            when={presets().length > 0}
            fallback={<p class="sp-empty">No presets saved yet.</p>}
          >
            <ul class="sp-list">
              <For each={presets()}>
                {(item: SessionPresetSummary) => (
                  <li class="sp-item">
                    <div class="sp-item-info">
                      <span class="sp-item-name">{item.name}</span>
                      <span class="sp-item-time">{formatAge(item.timestamp)}</span>
                    </div>
                    <div class="sp-item-actions">
                      <button
                        class="sp-load-btn"
                        onClick={() => handleLoad(item.name)}
                      >
                        Load
                      </button>
                      <button
                        class="sp-delete-btn"
                        onClick={() => handleDelete(item.name)}
                        title={`Delete "${item.name}"`}
                      >
                        &times;
                      </button>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </div>
    </>
  );
}
