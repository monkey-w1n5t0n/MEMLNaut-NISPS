/**
 * Dock Component — Right-side vertical dock with icon buttons.
 *
 * macOS-style dock with 6 icons: Train, Mode, Synth, NISPS, FX, Help.
 * Each icon toggles its corresponding drawer.
 * Active state (accent color) shown when drawer is open.
 */

import { createSignal, For } from 'solid-js';
import './dock.css';

export interface DockIcon {
  /** Unique identifier matching drawer name */
  drawer: string;
  /** Tooltip text */
  title: string;
  /** Label below icon */
  label: string;
  /** SVG content */
  svg: string;
}

export const DOCK_ICONS: DockIcon[] = [
  {
    drawer: 'training',
    title: 'Training',
    label: 'Train',
    svg: '<path d="M3 8h10"/><rect x="1" y="5" width="3" height="6" rx="0.5"/><rect x="12" y="5" width="3" height="6" rx="0.5"/><rect x="3" y="6.5" width="2" height="3" rx="0.3"/><rect x="11" y="6.5" width="2" height="3" rx="0.3"/>',
  },
  {
    drawer: 'mode',
    title: 'Input / Output mode',
    label: 'Mode',
    svg: '<circle cx="5" cy="5" r="2"/><circle cx="11" cy="11" r="2"/><path d="M3 13L13 3"/>',
  },
  {
    drawer: 'synth',
    title: 'Synth controls',
    label: 'Synth',
    svg: '<path d="M2 10c2-4 4-4 6 0s4-4 6 0"/>',
  },
  {
    drawer: 'params',
    title: 'NISPS ML parameters',
    label: 'NISPS',
    svg: '<circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/>',
  },
  {
    drawer: 'eoc',
    title: 'Effects Chain',
    label: 'FX',
    svg: '<path d="M4 8a4 4 0 0 1 4-4h1a1 1 0 0 0 0-2H8a6 6 0 0 0 0 12h1a1 1 0 0 0 0-2H8a4 4 0 0 1-4-4zm8 0a4 4 0 0 1-4 4H7a1 1 0 0 0 0 2h1a6 6 0 0 0 0-12H7a1 1 0 0 0 0 2h1a4 4 0 0 1 4 4z"/>',
  },
  {
    drawer: 'help',
    title: 'Help',
    label: 'Help',
    svg: '<circle cx="8" cy="8" r="6"/><path d="M6 6a2 2 0 0 1 4 0c0 1.5-2 1.5-2 3"/><circle cx="8" cy="12" r="0.5" fill="currentColor"/>',
  },
];

export interface DockProps {
  /** Callback when a dock icon is clicked */
  onToggleDrawer: (drawerName: string) => void;
  /** Set of currently open drawer names */
  openDrawers: () => Set<string>;
}

export default function Dock(props: DockProps) {
  return (
    <div class="dock" id="dock">
      <For each={DOCK_ICONS}>
        {(icon) => (
          <button
            class={`dock-icon${props.openDrawers().has(icon.drawer) ? ' active' : ''}`}
            data-drawer={icon.drawer}
            title={icon.title}
            onClick={() => props.onToggleDrawer(icon.drawer)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              innerHTML={icon.svg}
            />
            <span class="dock-label">{icon.label}</span>
          </button>
        )}
      </For>
    </div>
  );
}
