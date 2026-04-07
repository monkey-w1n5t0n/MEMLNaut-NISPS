/**
 * eoc-chain.ts — End-of-Chain container.
 *
 * Manages an ordered list of EOCModule instances, wires them into the Web Audio
 * graph, and exposes a flat NISPS parameter surface across all enabled modules.
 *
 * Canonical module order (used as insertion default, not enforced):
 *   Saturation → EQ → Compressor → Reverb → Delay → Master Bus
 *
 * Usage:
 *   const chain = new EOCChain();
 *   await chain.init(audioCtx);
 *   chain.addModule(new SaturationModule());
 *   chain.addModule(new ReverbModule());
 *   chain.connect(synthOutputNode, audioCtx.destination);
 *
 * The chain dispatches 'eoc:change' CustomEvents on window whenever the
 * structure changes (add/remove/reorder/bypass/nispsMode).
 *
 * NISPS integration modes:
 *   'bypass'     — EOC params not used by NISPS at all (default)
 *   'shared'     — EOC params appended to synth param pool (separate MLP not needed)
 *   'linked'     — EOC has a separate MLP that receives the same joystick input
 *   'independent'— EOC has its own independent joystick + separate MLP
 */

import { EOCModule } from './eoc-module.js';
import type { ParamMeta } from './eoc-module.js';

// Default slot order — used to sort modules by type when no explicit position
// is given. Modules not in this list are appended after the last known slot.
const DEFAULT_ORDER = ['saturation', 'eq', 'compressor', 'reverb', 'delay', 'master'] as const;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type NispsMode = 'bypass' | 'shared' | 'linked' | 'independent';

/** ParamMeta entry enriched with its originating module id. */
export interface ChainParamMeta extends ParamMeta {
  _moduleId: string;
}

export interface EOCChangeDetail {
  reason: string;
  chain: EOCChain;
  modules: EOCModule[];
  paramCount: number;
  nispsMode: NispsMode;
}

// ---------------------------------------------------------------------------
// EOCChain
// ---------------------------------------------------------------------------

export class EOCChain {
  private _modules: EOCModule[] = [];
  private _audioCtx: AudioContext | null = null;
  private _inputNode: AudioNode | null = null;
  private _outputNode: AudioNode | null = null;
  private _initialized: boolean = false;
  private _nispsMode: NispsMode = 'bypass';

  // ---------------------------------------------------------------------------
  // Module management
  // ---------------------------------------------------------------------------

  /**
   * Insert a module at a given position. If no position is given, the module
   * is inserted at its canonical DEFAULT_ORDER slot.
   *
   * @param module    The EOCModule instance to add.
   * @param position  Optional 0-based insertion index.
   */
  addModule(module: EOCModule, position?: number): void {
    if (!(module instanceof EOCModule)) {
      throw new TypeError('EOCChain.addModule: argument must be an EOCModule instance');
    }
    if (this._modules.some(m => m.id === module.id)) {
      throw new Error(`EOCChain.addModule: module '${module.id}' is already in the chain`);
    }

    if (position !== undefined) {
      this._modules.splice(Math.max(0, Math.min(position, this._modules.length)), 0, module);
    } else {
      // Insert at canonical slot position
      const targetSlot = DEFAULT_ORDER.indexOf(module.id as typeof DEFAULT_ORDER[number]);
      if (targetSlot === -1) {
        // Unknown module type — append at end
        this._modules.push(module);
      } else {
        // Find the first existing module whose canonical slot is after this one
        const insertAt = this._modules.findIndex(m => {
          const slot = DEFAULT_ORDER.indexOf(m.id as typeof DEFAULT_ORDER[number]);
          return slot === -1 || slot > targetSlot;
        });
        if (insertAt === -1) {
          this._modules.push(module);
        } else {
          this._modules.splice(insertAt, 0, module);
        }
      }
    }

    // If the chain is already initialised, init the new module immediately
    if (this._initialized && this._audioCtx) {
      module.init(this._audioCtx).then(() => {
        this._rewire();
        this._dispatchChange('module-added');
      }).catch(err => {
        console.error(`[EOCChain] Failed to init module '${module.id}':`, err);
      });
    } else {
      this._dispatchChange('module-added');
    }
  }

  /**
   * Remove a module from the chain by id.
   * Disposes the module and rewires.
   *
   * @param id  The module id to remove.
   */
  removeModule(id: string): void {
    const idx = this._modules.findIndex(m => m.id === id);
    if (idx === -1) {
      console.warn(`EOCChain.removeModule: no module with id '${id}'`);
      return;
    }
    const [removed] = this._modules.splice(idx, 1);
    removed.dispose();
    this._rewire();
    this._dispatchChange('module-removed');
  }

  /**
   * Move a module to a new position.
   *
   * @param id           The module id to move.
   * @param newPosition  0-based target index (after removal).
   */
  moveModule(id: string, newPosition: number): void {
    const idx = this._modules.findIndex(m => m.id === id);
    if (idx === -1) {
      console.warn(`EOCChain.moveModule: no module with id '${id}'`);
      return;
    }
    const [module] = this._modules.splice(idx, 1);
    const clampedPos = Math.max(0, Math.min(newPosition, this._modules.length));
    this._modules.splice(clampedPos, 0, module);
    this._rewire();
    this._dispatchChange('module-moved');
  }

  /**
   * Retrieve a module by id.
   *
   * @param id  The module id to look up.
   * @returns The module, or undefined if not found.
   */
  getModule(id: string): EOCModule | undefined {
    return this._modules.find(m => m.id === id);
  }

  /**
   * Ordered array of all modules in the chain (enabled and bypassed).
   */
  get modules(): EOCModule[] {
    return [...this._modules];
  }

  // ---------------------------------------------------------------------------
  // Chain lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize all currently registered modules, then store the AudioContext.
   * Safe to call before or after addModule() calls.
   *
   * @param audioCtx  The Web Audio AudioContext to use.
   */
  async init(audioCtx: AudioContext): Promise<void> {
    this._audioCtx = audioCtx;
    await Promise.all(this._modules.map(m => m.init(audioCtx)));
    this._initialized = true;
  }

  /**
   * Dispose all modules and disconnect the chain.
   */
  dispose(): void {
    this._disconnect();
    this._modules.forEach(m => m.dispose());
    this._modules = [];
    this._audioCtx   = null;
    this._inputNode  = null;
    this._outputNode = null;
    this._initialized = false;
  }

  // ---------------------------------------------------------------------------
  // Audio graph wiring
  // ---------------------------------------------------------------------------

  /**
   * Wire the full chain into the audio graph:
   *   inputNode → [enabled modules in order] → outputNode
   *
   * If no modules are enabled, inputNode connects directly to outputNode (all-bypass).
   *
   * Stores inputNode/outputNode for _rewire() calls triggered by later
   * structural changes (add/remove/reorder/bypass toggle).
   *
   * @param inputNode   Upstream node (e.g. synth output GainNode).
   * @param outputNode  Downstream node (e.g. AudioContext.destination).
   */
  connect(inputNode: AudioNode, outputNode: AudioNode): void {
    this._inputNode  = inputNode;
    this._outputNode = outputNode;
    this._rewire();
  }

  // ---------------------------------------------------------------------------
  // NISPS integration
  // ---------------------------------------------------------------------------

  /**
   * Current NISPS integration mode.
   */
  get nispsMode(): NispsMode {
    return this._nispsMode;
  }

  /**
   * Set NISPS integration mode.
   * Only stores the value and dispatches an event; actual wiring is handled
   * by the mode-specific implementations.
   *
   * Modes:
   *   'bypass'     — EOC params ignored by NISPS (default)
   *   'shared'     — EOC params appended to synth param pool, single MLP
   *   'linked'     — separate MLP for EOC, same joystick input
   *   'independent'— separate joystick + separate MLP for EOC
   */
  set nispsMode(mode: NispsMode) {
    const valid: NispsMode[] = ['bypass', 'shared', 'linked', 'independent'];
    if (!valid.includes(mode)) {
      throw new Error(
        `EOCChain.nispsMode: invalid mode '${mode}'. Must be one of: ${valid.join(', ')}`,
      );
    }
    this._nispsMode = mode;
    this._dispatchChange('nispsMode-changed');
  }

  /**
   * Total parameter count across all enabled modules.
   */
  get paramCount(): number {
    return this._enabledModules().reduce((sum, m) => sum + m.paramCount, 0);
  }

  /**
   * Flat parameter metadata array across all enabled modules, in chain order.
   * Each entry carries an additional `_moduleId` field for routing.
   */
  get paramMeta(): ChainParamMeta[] {
    const result: ChainParamMeta[] = [];
    for (const module of this._enabledModules()) {
      for (const meta of module.paramMeta) {
        result.push({ ...meta, _moduleId: module.id });
      }
    }
    return result;
  }

  /**
   * Route a normalized [0,1] value to the correct module by global index.
   *
   * @param globalIndex  Flat index across all enabled modules' params.
   * @param value        Normalized value [0, 1].
   */
  setParam(globalIndex: number, value: number): void {
    let offset = 0;
    for (const module of this._enabledModules()) {
      if (globalIndex < offset + module.paramCount) {
        module.setParam(globalIndex - offset, value);
        return;
      }
      offset += module.paramCount;
    }
    console.warn(
      `EOCChain.setParam: globalIndex ${globalIndex} out of range (paramCount=${this.paramCount})`,
    );
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Return only the currently enabled modules, in chain order. */
  private _enabledModules(): EOCModule[] {
    return this._modules.filter(m => m.enabled);
  }

  /**
   * Disconnect all inter-module and endpoint connections, then reconnect
   * in the current order. Safe to call at any time after connect() has been
   * called at least once.
   */
  private _rewire(): void {
    if (!this._inputNode || !this._outputNode) return;

    // Tear down: disconnect the input node and each module's output node.
    // We only disconnect from the nodes we own in the chain to avoid clobbering
    // any other connections the caller may have set up on inputNode/outputNode.
    try { this._inputNode.disconnect(); } catch (_) { /* not yet connected */ }
    for (const m of this._modules) {
      try { m.getOutputNode().disconnect(); } catch (_) { /* not yet connected */ }
    }

    const active = this._enabledModules();

    if (active.length === 0) {
      // All modules disabled (or chain is empty): straight wire
      this._inputNode.connect(this._outputNode);
      return;
    }

    // inputNode → first module
    this._inputNode.connect(active[0].getInputNode());

    // module[i] → module[i+1]
    for (let i = 0; i < active.length - 1; i++) {
      active[i].getOutputNode().connect(active[i + 1].getInputNode());
    }

    // last module → outputNode
    active[active.length - 1].getOutputNode().connect(this._outputNode);
  }

  /**
   * Disconnect everything the chain owns.
   * Called during dispose().
   */
  private _disconnect(): void {
    if (!this._inputNode) return;
    try { this._inputNode.disconnect(); } catch (_) { /* ok */ }
    for (const m of this._modules) {
      try { m.getOutputNode().disconnect(); } catch (_) { /* ok */ }
    }
  }

  /**
   * Dispatch an 'eoc:change' CustomEvent on window.
   *
   * @param reason  Short description of what changed.
   */
  private _dispatchChange(reason: string): void {
    window.dispatchEvent(
      new CustomEvent<EOCChangeDetail>('eoc:change', {
        detail: {
          reason,
          chain:      this,
          modules:    this.modules,
          paramCount: this.paramCount,
          nispsMode:  this.nispsMode,
        },
      }),
    );
  }
}
