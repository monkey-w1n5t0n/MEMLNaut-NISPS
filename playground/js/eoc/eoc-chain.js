// eoc-chain.js — End-of-Chain container.
//
// Manages an ordered list of EOCModule instances, wires them into the Web Audio
// graph, and exposes a flat NISPS parameter surface across all enabled modules.
//
// Canonical module order (used as insertion default, not enforced):
//   Saturation → EQ → Compressor → Reverb → Delay → Master Bus
//
// Usage:
//   const chain = new EOCChain();
//   await chain.init(audioCtx);
//   chain.addModule(new SaturationModule());
//   chain.addModule(new ReverbModule());
//   chain.connect(synthOutputNode, audioCtx.destination);
//
// The chain dispatches 'eoc:change' CustomEvents on window whenever the
// structure changes (add/remove/reorder/bypass/nispsMode).

import { EOCModule } from './eoc-module.js';

// Default slot order — used to sort modules by type when no explicit position
// is given. Modules not in this list are appended after the last known slot.
const DEFAULT_ORDER = ['saturation', 'eq', 'compressor', 'reverb', 'delay', 'master'];

export class EOCChain {
  constructor() {
    /** @type {EOCModule[]} */
    this._modules    = [];
    this._audioCtx   = null;
    this._inputNode  = null;   // stored after first connect() call
    this._outputNode = null;   // stored after first connect() call
    this._initialized = false;

    // NISPS integration mode.
    // 'bypass'     — EOC params not used by NISPS at all (default)
    // 'shared'     — EOC params appended to synth param pool (future)
    // 'linked'     — EOC params driven by a separate, linked NISPS instance (future)
    // 'independent'— EOC has its own independent NISPS instance (future)
    this._nispsMode = 'bypass';
  }

  // ---------------------------------------------------------------------------
  // Module management
  // ---------------------------------------------------------------------------

  /**
   * Insert a module at a given position. If no position is given, the module
   * is appended in DEFAULT_ORDER slot sequence.
   *
   * @param {EOCModule} module
   * @param {number} [position] — 0-based insertion index (optional)
   */
  addModule(module, position) {
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
      const targetSlot = DEFAULT_ORDER.indexOf(module.id);
      if (targetSlot === -1) {
        // Unknown module type — append at end
        this._modules.push(module);
      } else {
        // Find the first existing module whose canonical slot is after this one
        const insertAt = this._modules.findIndex(m => {
          const slot = DEFAULT_ORDER.indexOf(m.id);
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
      });
    } else {
      this._dispatchChange('module-added');
    }
  }

  /**
   * Remove a module from the chain by id.
   * Disposes the module and rewires.
   *
   * @param {string} id
   */
  removeModule(id) {
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
   * @param {string} id
   * @param {number} newPosition — 0-based target index (after removal)
   */
  moveModule(id, newPosition) {
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
   * @param {string} id
   * @returns {EOCModule|undefined}
   */
  getModule(id) {
    return this._modules.find(m => m.id === id);
  }

  /**
   * Ordered array of all modules in the chain (enabled and bypassed).
   * @returns {EOCModule[]}
   */
  get modules() {
    return [...this._modules];
  }

  // ---------------------------------------------------------------------------
  // Chain lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize all currently registered modules, then store the AudioContext.
   * Safe to call before or after addModule() calls.
   *
   * @param {AudioContext} audioCtx
   * @returns {Promise<void>}
   */
  async init(audioCtx) {
    this._audioCtx = audioCtx;
    await Promise.all(this._modules.map(m => m.init(audioCtx)));
    this._initialized = true;
  }

  /**
   * Dispose all modules and disconnect the chain.
   */
  dispose() {
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
   * @param {AudioNode} inputNode   — upstream node (e.g. synth output GainNode)
   * @param {AudioNode} outputNode  — downstream node (e.g. AudioContext.destination)
   */
  connect(inputNode, outputNode) {
    this._inputNode  = inputNode;
    this._outputNode = outputNode;
    this._rewire();
  }

  // ---------------------------------------------------------------------------
  // NISPS integration
  // ---------------------------------------------------------------------------

  /**
   * Current NISPS integration mode.
   * @returns {'bypass'|'shared'|'linked'|'independent'}
   */
  get nispsMode() {
    return this._nispsMode;
  }

  /**
   * Set NISPS integration mode.
   * Only stores the value and dispatches an event; actual wiring is handled
   * by the tasks that implement each mode (meml-xp3 and later).
   *
   * @param {'bypass'|'shared'|'linked'|'independent'} mode
   */
  set nispsMode(mode) {
    const valid = ['bypass', 'shared', 'linked', 'independent'];
    if (!valid.includes(mode)) {
      throw new Error(`EOCChain.nispsMode: invalid mode '${mode}'. Must be one of: ${valid.join(', ')}`);
    }
    this._nispsMode = mode;
    this._dispatchChange('nispsMode-changed');
  }

  /**
   * Total parameter count across all enabled modules.
   * @returns {number}
   */
  get paramCount() {
    return this._enabledModules().reduce((sum, m) => sum + m.paramCount, 0);
  }

  /**
   * Flat parameter metadata array across all enabled modules, in chain order.
   * Each entry carries an additional `_moduleId` field for routing.
   *
   * @returns {Array<{id:string, name:string, min:number, max:number, init:number, curve:number, group:string, _moduleId:string}>}
   */
  get paramMeta() {
    const result = [];
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
   * @param {number} globalIndex — flat index across all enabled modules' params
   * @param {number} value       — [0, 1]
   */
  setParam(globalIndex, value) {
    let offset = 0;
    for (const module of this._enabledModules()) {
      if (globalIndex < offset + module.paramCount) {
        module.setParam(globalIndex - offset, value);
        return;
      }
      offset += module.paramCount;
    }
    console.warn(`EOCChain.setParam: globalIndex ${globalIndex} out of range (paramCount=${this.paramCount})`);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Return only the currently enabled modules, in chain order.
   * @returns {EOCModule[]}
   */
  _enabledModules() {
    return this._modules.filter(m => m.enabled);
  }

  /**
   * Disconnect all inter-module and endpoint connections, then reconnect
   * in the current order. Safe to call at any time after connect() has been
   * called at least once.
   */
  _rewire() {
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
  _disconnect() {
    if (!this._inputNode) return;
    try { this._inputNode.disconnect(); } catch (_) { /* ok */ }
    for (const m of this._modules) {
      try { m.getOutputNode().disconnect(); } catch (_) { /* ok */ }
    }
  }

  /**
   * Dispatch an 'eoc:change' CustomEvent on window.
   *
   * @param {string} reason — short description of what changed
   */
  _dispatchChange(reason) {
    window.dispatchEvent(new CustomEvent('eoc:change', {
      detail: {
        reason,
        chain:      this,
        modules:    this.modules,
        paramCount: this.paramCount,
        nispsMode:  this.nispsMode,
      }
    }));
  }
}
