/**
 * EOCPanel — Effects Chain drawer panel.
 *
 * Contains:
 *   - NISPS mode selector: Bypass / Shared / Linked / Independent (pill buttons)
 *   - Module list: each active module with bypass toggle, param count badge, remove
 *   - Add-module bar: buttons for all modules not yet in the chain
 *   - Confirmation banner: shown when changing to/from Shared mode with loaded
 *     modules (total output count changes → "This will reset training examples")
 *
 * Props:
 *   chain   — EOCChain instance (imperative, not reactive)
 *   visible — whether the drawer is shown
 *   onClose — called when × is clicked
 *
 * The component keeps a reactive mirror of the chain state by listening to
 * 'eoc:change' CustomEvents dispatched by EOCChain. This avoids making EOCChain
 * itself reactive and keeps the core model free of SolidJS dependencies.
 *
 * Module construction note:
 *   Available module classes are imported here so the panel can instantiate
 *   them on demand. Each available module is shown in the add-bar only when it
 *   is not already present in the chain (EOCChain enforces uniqueness by id).
 */

import { createSignal, createMemo, For, Show, onMount, onCleanup } from 'solid-js';
import type { EOCChain, EOCChangeDetail, NispsMode } from '../../core/eoc/eoc-chain';
import type { EOCModule } from '../../core/eoc/eoc-module';
import {
  EQModule,
  CompressorModule,
  ReverbModule,
  DelayModule,
  SaturationModule,
  MasterModule,
} from '../../core/eoc/index';
import EOCModuleCard from './EOCModule';
import EOCJoystick from './EOCJoystick';
import '../layout/drawer.css';
import './eoc-panel.css';

// ── Available modules catalogue ───────────────────────────────────────────────

interface ModuleDef {
  id: string;
  label: string;
  create: () => EOCModule;
}

const AVAILABLE_MODULES: ModuleDef[] = [
  { id: 'eq',         label: 'EQ',         create: () => new EQModule() },
  { id: 'compressor', label: 'Compressor', create: () => new CompressorModule() },
  { id: 'reverb',     label: 'Reverb',     create: () => new ReverbModule() },
  { id: 'delay',      label: 'Delay',      create: () => new DelayModule() },
  { id: 'saturation', label: 'Saturation', create: () => new SaturationModule() },
  { id: 'master',     label: 'Master',     create: () => new MasterModule() },
];

const NISPS_MODES: { value: NispsMode; label: string }[] = [
  { value: 'bypass',      label: 'Bypass' },
  { value: 'shared',      label: 'Shared' },
  { value: 'linked',      label: 'Linked' },
  { value: 'independent', label: 'Indep.' },
];

// ── Props ─────────────────────────────────────────────────────────────────────

export interface EOCPanelProps {
  chain: EOCChain;
  visible: boolean;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EOCPanel(props: EOCPanelProps) {
  const chain = () => props.chain;

  // ── Reactive mirror of chain state ─────────────────────────────────────────
  // EOCChain dispatches 'eoc:change' on window; we re-read the chain's modules
  // array and nispsMode whenever that fires.

  const [modules, setModules] = createSignal<EOCModule[]>(chain().modules);
  const [nispsMode, setNispsMode] = createSignal<NispsMode>(chain().nispsMode);

  function syncFromChain(): void {
    setModules(chain().modules);
    setNispsMode(chain().nispsMode);
  }

  function onEocChange(e: Event): void {
    const detail = (e as CustomEvent<EOCChangeDetail>).detail;
    // Only sync if this event belongs to our chain instance
    if (detail.chain === props.chain) {
      syncFromChain();
    }
  }

  onMount(() => {
    window.addEventListener('eoc:change', onEocChange);
    syncFromChain();
  });

  onCleanup(() => {
    window.removeEventListener('eoc:change', onEocChange);
  });

  // ── Confirmation state ─────────────────────────────────────────────────────
  // Shown when the current mode is 'shared' AND a module add/remove would change
  // the total param count. We hold a pending action and ask the user to confirm.

  type PendingAction =
    | { type: 'add';    moduleDef: ModuleDef }
    | { type: 'remove'; moduleId: string     }
    | { type: 'mode';   mode: NispsMode       };

  const [pendingAction, setPendingAction] = createSignal<PendingAction | null>(null);

  // ── Derived: which modules are not yet in the chain ────────────────────────

  const activeIds = createMemo(() => new Set(modules().map(m => m.id)));

  const availableToAdd = createMemo(() =>
    AVAILABLE_MODULES.filter(def => !activeIds().has(def.id))
  );

  // ── Total param count of enabled modules ───────────────────────────────────

  const totalParams = createMemo(() =>
    modules().filter(m => m.enabled).reduce((sum, m) => sum + m.paramCount, 0)
  );

  // ── Handlers ────────────────────────────────────────────────────────────────

  // Check whether adding/removing a module requires confirmation.
  // Confirmation is only needed when mode is 'shared' (param space is shared
  // with the synth MLP — changing it would invalidate existing training).
  function needsConfirm(): boolean {
    return nispsMode() === 'shared';
  }

  // Add a module (with optional confirm gate)
  function requestAdd(def: ModuleDef): void {
    if (needsConfirm() && modules().length > 0) {
      setPendingAction({ type: 'add', moduleDef: def });
    } else {
      doAdd(def);
    }
  }

  function doAdd(def: ModuleDef): void {
    chain().addModule(def.create());
    setPendingAction(null);
  }

  // Remove a module (with optional confirm gate)
  function requestRemove(id: string): void {
    if (needsConfirm()) {
      setPendingAction({ type: 'remove', moduleId: id });
    } else {
      doRemove(id);
    }
  }

  function doRemove(id: string): void {
    chain().removeModule(id);
    setPendingAction(null);
  }

  // Bypass toggle — no confirm needed (doesn't change param count for enabled modules
  // in a meaningful training-breaking way for Independent/Linked, but for Shared it
  // does change the count, so we gate it the same as add/remove).
  function requestToggleBypass(id: string): void {
    const mod = chain().getModule(id);
    if (!mod) return;
    if (needsConfirm()) {
      setPendingAction({ type: 'remove', moduleId: id }); // reuse remove confirm — same reset concern
    } else {
      mod.enabled = !mod.enabled;
      syncFromChain();
    }
  }

  // Actually toggle bypass without confirm (called on confirm OK for bypass case)
  function doToggleBypass(id: string): void {
    const mod = chain().getModule(id);
    if (!mod) return;
    mod.enabled = !mod.enabled;
    syncFromChain();
    setPendingAction(null);
  }

  // Mode switch
  function requestModeChange(mode: NispsMode): void {
    if (mode === nispsMode()) return;
    // Switching into or out of 'shared' when modules are present affects the
    // combined param pool → confirm.
    const involvesShared =
      mode === 'shared' || nispsMode() === 'shared';
    if (involvesShared && modules().length > 0) {
      setPendingAction({ type: 'mode', mode });
    } else {
      doModeChange(mode);
    }
  }

  function doModeChange(mode: NispsMode): void {
    chain().nispsMode = mode;
    setPendingAction(null);
  }

  // Confirm / cancel pending action
  function onConfirm(): void {
    const action = pendingAction();
    if (!action) return;
    if (action.type === 'add')    doAdd(action.moduleDef);
    else if (action.type === 'remove') doRemove(action.moduleId);
    else if (action.type === 'mode')   doModeChange(action.mode);
  }

  function onCancel(): void {
    setPendingAction(null);
  }

  // EOCJoystick position handler — placeholder for when an FX MLP is wired up
  function onFxJoystickPosition(x: number, y: number): void {
    // Dispatch a custom event so higher-level app wiring can feed this into
    // the EOC-specific MLP without coupling EOCPanel to that layer directly.
    window.dispatchEvent(
      new CustomEvent('eoc:joystick', { detail: { x, y } })
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Main drawer */}
      <div
        class={`drawer${props.visible ? '' : ' hidden'}`}
        id="drawer-eoc"
        data-drawer="eoc"
      >
        <div class="drawer-header">
          <span>Effects Chain</span>
          <button class="drawer-close" data-drawer="eoc" onClick={props.onClose}>
            ×
          </button>
        </div>

        <div class="drawer-body">

          {/* ── NISPS mode selector ── */}
          <div class="eoc-mode-row">
            <span class="eoc-section-label">NISPS mode</span>
            <div class="pill-toggle">
              <For each={NISPS_MODES}>
                {(opt) => (
                  <button
                    class={`pill-opt${nispsMode() === opt.value ? ' active' : ''}`}
                    onClick={() => requestModeChange(opt.value)}
                    title={opt.value}
                  >
                    {opt.label}
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* ── Confirmation banner ── */}
          <Show when={pendingAction() !== null}>
            <div class="eoc-confirm-banner">
              <span>This will reset training examples</span>
              <button class="eoc-confirm-btn cancel" onClick={onCancel}>Cancel</button>
              <button class="eoc-confirm-btn ok" onClick={onConfirm}>OK</button>
            </div>
          </Show>

          {/* ── Module list ── */}
          <div>
            <span class="eoc-section-label">Active modules</span>
            <div class="eoc-module-list">
              <Show
                when={modules().length > 0}
                fallback={
                  <span class="eoc-empty-hint">No modules — add one below</span>
                }
              >
                <For each={modules()}>
                  {(mod) => (
                    <EOCModuleCard
                      id={mod.id}
                      displayName={mod.displayName}
                      paramCount={mod.paramCount}
                      enabled={mod.enabled}
                      onToggle={(id) => requestToggleBypass(id)}
                      onRemove={(id) => requestRemove(id)}
                    />
                  )}
                </For>
              </Show>
            </div>
          </div>

          {/* ── Add-module bar ── */}
          <Show when={availableToAdd().length > 0}>
            <div class="eoc-add-bar">
              <span class="eoc-section-label">Add module</span>
              <div class="action-row">
                <For each={availableToAdd()}>
                  {(def) => (
                    <button
                      class="action-btn"
                      onClick={() => requestAdd(def)}
                    >
                      + {def.label}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* ── Param summary ── */}
          <Show when={modules().length > 0}>
            <div class="eoc-param-summary">
              <strong>{totalParams()}</strong> params across{' '}
              <strong>{modules().filter(m => m.enabled).length}</strong> active module
              {modules().filter(m => m.enabled).length === 1 ? '' : 's'}
              {nispsMode() !== 'bypass' && (
                <> — mode: <strong>{nispsMode()}</strong></>
              )}
            </div>
          </Show>

        </div>
      </div>

      {/* ── Independent FX joystick (overlay, outside drawer) ── */}
      <EOCJoystick
        visible={props.visible && nispsMode() === 'independent'}
        onPosition={onFxJoystickPosition}
      />
    </>
  );
}
