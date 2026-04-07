/**
 * PresetSelector — Synth preset chips organized by tier.
 *
 * Renders four labeled sections (Beginner / Intermediate / Advanced / Expert),
 * each containing chip buttons for every preset in that tier. The active preset
 * is highlighted in accent color. Clicking a chip calls synthStore.applyPreset().
 */

import { For } from 'solid-js';
import type { SynthStore } from '../../stores/synth-store';
import { PRESET_TIERS, SYNTH_PRESETS } from '../../core/synth/presets';
import './preset-selector.css';

export interface PresetSelectorProps {
  synthStore: SynthStore;
}

export default function PresetSelector(props: PresetSelectorProps) {
  function activeParamCount(preset: typeof SYNTH_PRESETS[number]): string {
    if (preset.active === null) return 'all';
    return String(preset.active.length);
  }

  return (
    <div class="preset-selector">
      <For each={PRESET_TIERS}>
        {(tier) => {
          const presetsInTier = SYNTH_PRESETS.filter((p) => p.tier === tier.tier);
          return (
            <div class="preset-tier-section">
              <span class="preset-tier-label">{tier.label}</span>
              <div class="preset-chip-row">
                <For each={presetsInTier}>
                  {(preset) => {
                    const isActive = () =>
                      props.synthStore.state.presetId === preset.id;
                    return (
                      <button
                        class={`preset-chip${isActive() ? ' active' : ''}`}
                        title={preset.description}
                        onClick={() => props.synthStore.applyPreset(preset.id)}
                      >
                        <span class="preset-chip-name">{preset.name}</span>
                        <span class="preset-chip-count">{activeParamCount(preset)}</span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}
