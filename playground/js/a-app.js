// NISPS Immersive — Design A
// Full-viewport flow field with floating overlays

import { WasmIML } from './nisps/nisps-wasm.js';
import { FlowFieldVisualizer } from './ui/visualizer.js';
import { AudioCanvas } from './audio/audio-canvas.js';
import { C15Adapter } from './synth/c15-adapter.js';
import { Arpeggiator } from './synth/arpeggiator.js';
import { MIDIInput } from './synth/midi-input.js';
import { SYNTH_PARAM_MAP, SYNTH_PARAM_NAMES, SYNTH_PARAM_COLORS, applyCurve, applyGroupOverride } from './synth/param-map.js';
import { MIDIOutput } from './midi/midi-output.js';
import { loadCCMap, saveCCMap, createCCParam, exportCCMap, importCCMap, CC_NAMES } from './midi/midi-cc-map.js';
import { listPresets as listMidiPresets, loadPreset as loadMidiPreset, loadPresetFromFile as loadMidiPresetFromFile } from './midi/midi-cc-presets.js';
import { GamepadInput } from './ui/gamepad.js';
import { HandTracker } from './ui/hand-tracker.js';
import { createDevPanel } from './ui/dev-panel.js';
import { SYNTH_PRESETS, PRESET_TIERS } from './synth/presets.js';
import { ADDITIVE_PRESETS, ADDITIVE_PRESET_TIERS } from './synth/additive-presets.js';
import { FM_PRESETS, FM_PRESET_TIERS } from './synth/fm-presets.js';
import { EOCChain } from './eoc/index.js';
import { EOCChainUI, moduleFactory } from './ui/eoc-chain-ui.js';
import { EngineSwitcher } from './ui/engine-switcher.js';
import { EOCJoystick } from './ui/eoc-joystick.js';
import { initModularUI } from './ui/modular-ui.js';
import { createPatchBay } from './ui/patch-bay-modal.js';
import { createPatchEditor } from './ui/patch-editor-modal.js';
import { AdditiveEngine } from './synth/additive-engine.js';
import { FMEngine } from './synth/fm-engine.js';
import { ModularEngine } from './synth/modular-engine.js';
import { MODULAR_PRESETS, applyPreset as applyModularPreset, findPreset as findModularPreset } from './synth/modular-presets.js';
import { getColumn as getGroupColumn } from './synth/group-columns.js';
import { saveSession as saveSessionMem, loadSession as loadSessionMem, showRestoreModal, clearSession as clearSessionMem } from './nisps/session-memory.js';

// ---- Constants ----
const N_JOY_INPUTS = 2;
const N_HAND_INPUTS = 14;
const N_INPUTS = N_JOY_INPUTS; // default (joystick)
const N_VISUAL_OUTPUTS = 20;
const N_SYNTH_OUTPUTS = SYNTH_PARAM_MAP.length; // 126
// Audio canvas output count is dynamic — queried from audioCanvas.getOutputCount()
let N_OUTPUTS = N_SYNTH_OUTPUTS; // Dynamic — changes with output mode

let audioCanvas = null; // lazily created on first switch to audio-canvas mode
const STORAGE_KEY = 'nisps-a-immersive';

// Phase E — deferred modular DSP state. loadState() stashes this; the
// engine-switch handler consumes it as soon as a ModularEngine exists.
let _pendingModularDspState = null;

// Guard hot paths (rAF tick, joystick move, heatmap, RL feedback) from
// racing `resizeMLP` — during the WasmIML.create(...) await window the
// active `iml` references a destroyed WASM instance (bug: iml.process()
// writing to freed heap). Set true at start of resizeMLP, false at end.
let _rebuilding = false;

// Dirty flag for session-memory saves. Outgoing save (engine/preset switch)
// skips when false so fresh-init state doesn't evict useful older sessions.
// The explicit flag tracks user intent (trained, randomised, tweaked);
// `sessionWorthSaving()` combines it with a heuristic that treats any
// captured examples as worth saving, so programmatic `iml.addExample` calls
// (e.g. debug-probe driven tests) are still persisted.
let _sessionDirty = false;
function markSessionDirty() { _sessionDirty = true; }
function clearSessionDirty() { _sessionDirty = false; }
function sessionWorthSaving() {
  if (_sessionDirty) return true;
  if (imlJoy && imlJoy.dataset && imlJoy.dataset.features.length > 0) return true;
  if (imlHand && imlHand.dataset && imlHand.dataset.features.length > 0) return true;
  return false;
}

const VISUAL_PARAM_NAMES = [
  'Flow', 'Scale', 'Speed', 'Hue', 'Spread', 'Size', 'Trail', 'Turb',
  'Attract', 'Radius', 'DispRate', 'DispAmt', 'Lifetime', 'Respawn',
  'Advection', 'Inertia', 'Drag', 'Repulse', 'RepCnt', 'RepRate',
];
const VISUAL_PARAM_COLORS = [
  '#ff6a00', '#00ccff', '#ff6600', '#ff00cc', '#ffcc00', '#88ff00',
  '#0088ff', '#ff3366', '#9bff5f', '#59d3ff', '#ff8f3f', '#a0b7ff',
  '#f4ff7a', '#ffa8db', '#7dffc8', '#ffd166', '#8ad4ff', '#ff5f5f',
  '#ffc15f', '#ff8a3d',
];

// ---- Presets ----
const PRESETS = {
  'calm-to-chaotic': [
    { input: [0.1, 0.9], output: [0.25, 0.3, 0.1, 0.55, 0.2, 0.3, 0.02, 0.05, 0.9, 0.45, 0.25, 0.2, 0.9, 0.0, 0.0, 0.2, 0.05, 0.0, 0.0, 0.2] },
    { input: [0.9, 0.1], output: [0.75, 0.7, 0.9, 0.05, 0.8, 0.7, 0.9, 0.95, 0.3, 0.2, 0.85, 0.7, 0.25, 0.55, 1.0, 0.92, 0.02, 0.95, 0.8, 0.85] },
    { input: [0.5, 0.5], output: [0.5, 0.5, 0.5, 0.3, 0.5, 0.5, 0.4, 0.5, 0.7, 0.6, 0.5, 0.45, 0.55, 0.9, 0.5, 0.65, 0.08, 0.45, 0.4, 0.5] },
  ],
  'rainbow-sweep': [
    { input: [0.0, 0.5], output: [0.5, 0.5, 0.4, 0.0, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.4, 0.3, 0.8, 0.0, 0.0, 0.45, 0.08, 0.2, 0.25, 0.45] },
    { input: [0.5, 0.5], output: [0.5, 0.5, 0.4, 0.5, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.55, 0.35, 0.7, 0.0, 0.4, 0.45, 0.08, 0.45, 0.4, 0.6] },
    { input: [1.0, 0.5], output: [0.5, 0.5, 0.4, 1.0, 0.3, 0.4, 0.05, 0.3, 0.8, 0.55, 0.75, 0.45, 0.6, 0.0, 0.8, 0.45, 0.08, 0.7, 0.55, 0.75] },
  ],
  'vortex': [
    { input: [0.5, 0.5], output: [0.0, 0.8, 0.8, 0.6, 0.1, 0.15, 0.02, 1.0, 1.0, 0.3, 0.95, 0.85, 0.25, 1.0, 0.5, 0.95, 0.01, 1.0, 1.0, 1.0] },
    { input: [0.0, 0.0], output: [0.5, 0.2, 0.3, 0.8, 0.9, 0.6, 0.08, 0.1, 0.35, 0.8, 0.25, 0.15, 0.8, 0.5, 0.2, 0.35, 0.2, 0.15, 0.2, 0.25] },
    { input: [1.0, 1.0], output: [0.5, 0.2, 0.3, 0.2, 0.9, 0.6, 0.08, 0.1, 0.35, 0.8, 0.25, 0.15, 0.8, 0.5, 0.8, 0.35, 0.2, 0.15, 0.2, 0.25] },
    { input: [0.0, 1.0], output: [0.3, 0.4, 0.5, 0.4, 0.5, 0.4, 0.05, 0.5, 0.65, 0.5, 0.55, 0.45, 0.45, 0.2, 0.4, 0.7, 0.1, 0.5, 0.4, 0.55] },
    { input: [1.0, 0.0], output: [0.7, 0.4, 0.5, 0.0, 0.5, 0.4, 0.05, 0.5, 0.65, 0.5, 0.55, 0.45, 0.45, 0.2, 0.9, 0.7, 0.1, 0.5, 0.4, 0.55] },
  ],
  'spiral': [
    { input: [0.5, 0.5], output: [0.0, 0.6, 0.6, 0.3, 0.15, 0.2, 0.03, 0.7, 0.9, 0.25, 0.7, 0.6, 0.35, 0.8, 0.65, 0.9, 0.02, 0.3, 0.5, 0.7] },
    { input: [0.0, 0.0], output: [0.8, 0.3, 0.4, 0.7, 0.8, 0.5, 0.06, 0.2, 0.5, 0.7, 0.3, 0.2, 0.7, 0.3, 0.3, 0.4, 0.15, 0.1, 0.1, 0.3] },
    { input: [1.0, 1.0], output: [0.2, 0.3, 0.4, 0.1, 0.8, 0.5, 0.06, 0.2, 0.5, 0.7, 0.3, 0.2, 0.7, 0.3, 0.9, 0.4, 0.15, 0.1, 0.1, 0.3] },
  ],
  'embers': [
    { input: [0.5, 0.5], output: [0.1, 0.4, 0.2, 0.05, 0.05, 0.6, 0.02, 0.15, 0.6, 0.3, 0.15, 0.9, 0.5, 0.7, 0.1, 0.3, 0.2, 0.0, 0.0, 0.2] },
    { input: [0.2, 0.8], output: [0.5, 0.6, 0.15, 0.08, 0.08, 0.8, 0.015, 0.1, 0.8, 0.5, 0.1, 0.5, 0.8, 0.4, 0.05, 0.5, 0.1, 0.0, 0.0, 0.15] },
    { input: [0.8, 0.2], output: [0.9, 0.3, 0.35, 0.02, 0.12, 0.35, 0.04, 0.3, 0.4, 0.2, 0.3, 1.0, 0.3, 0.9, 0.2, 0.15, 0.3, 0.0, 0.0, 0.3] },
  ],
};

// ---- MLP architecture (flexible / experimental) ----
//
// MLP architecture is NOT sacred. Output size is preset-driven (= count of
// non-bypassed params); hidden layer widths are independent tunable knobs.
// Override via `?arch=3,32,48,64,N` URL param (first slot = nInputs+bias,
// last slot = nOutputs which auto-aligns to the active preset when omitted).
// Examples:
//   ?arch=3,16,32,126    — smaller net
//   ?arch=3,64,64,64,64  — 4 hidden layers, output count from preset
//
// For the hand-tracking IML, hidden layers default to the pre-existing
// [48,48,64]; the `?arch` override applies only to the joystick IML.
const DEFAULT_JOY_HIDDEN = [32, 48, 64];
const DEFAULT_HAND_HIDDEN = [48, 48, 64];

/**
 * Parse `?arch=a,b,c,...` into hidden-layer widths.
 * The URL form is the FULL layer spec including inputs+bias and outputs;
 * this helper strips the first slot (inputs+bias) and the last slot (outputs)
 * if either matches the expected input/output count — otherwise those slots
 * are trusted and the caller resizes to match.
 *
 * Returns `{ hiddenLayers, outputsOverride | null }` or null if no/invalid param.
 */
function parseArchURLParam() {
  const raw = new URLSearchParams(window.location.search).get('arch');
  if (!raw) return null;
  const parts = raw.split(',').map(s => parseInt(s.trim(), 10));
  if (parts.length < 2 || parts.some(n => !Number.isFinite(n) || n < 1)) {
    console.warn(`[NISPS] Ignoring malformed ?arch=${raw}`);
    return null;
  }
  if (parts.length === 2) {
    // [inputs+bias, outputs] — no hidden layers
    return { hiddenLayers: [], outputsOverride: parts[1] };
  }
  return {
    hiddenLayers: parts.slice(1, -1),
    outputsOverride: parts[parts.length - 1],
  };
}

const _archOverride = parseArchURLParam();
const JOY_HIDDEN_LAYERS = _archOverride ? _archOverride.hiddenLayers : DEFAULT_JOY_HIDDEN;
const ARCH_OUTPUTS_OVERRIDE = _archOverride ? _archOverride.outputsOverride : null;

// ---- ShapeSeq feature flag ----
const shapeSeqEnabled = new URLSearchParams(location.search).get('shapeseq') === '1';

// Lazy-loaded ShapeSeq modules (only when shapeSeqEnabled)
let ShapeSeqEngine, StepVisualizer, ChainBuilderUI, EventBus, getDefaultBus;

// ShapeSeq state
let shapeSeqEngine = null;
let shapeSeqViz = null;
let shapeSeqChainUI = null;
let shapeSeqBus = null;
let _shapeSeqInited = false;

// ---- App state ----
let iml;       // active IML (points to imlJoy or imlHand)
let imlJoy;    // IML for joystick mode (2 inputs)
let imlHand;   // IML for hand tracking mode (14 inputs)
let inputMode = 'joystick'; // 'joystick' | 'hands'
let handTracker = null;
let visualizer;
let synthVisualizer;
let activeEngine = null; // active SynthEngine (currently always a C15Adapter)
let c15 = null;          // alias kept for MIDIInput and volume controls that still reference it
let arpeggiator = null;
let midiInput = null;

let outputMode = 'visual';

// EOC Effects Chain — module-scoped so audio-start and setActiveEngine can reference it
let eocChain = null;
let _eocInited = false; // guard: init once per AudioContext lifetime

// EOC Linked/Independent mode — second IML driven by joystick(s), independent training
let imlEoc = null;       // second IML for EOC params (Linked/Independent mode)
let eocTrainingTarget = 'synth'; // 'synth' | 'eoc' — which MLP RL feedback targets
let eocJoystick = null;  // EOCJoystick instance for Independent mode

// Modular-mode UI (Phase C) — created once during init(), toggled via show/hide
// by setActiveEngine() when the modular engine becomes active.
let modularUI = null;
let patchBay = null;
let patchEditor = null;

// ---- MIDI CC state ----
let midiOutput = null;
// Storage key scoped per engine so CC assignments don't bleed between engines.
function midiCCStorageKey() {
  return `nisps-midi-cc-map:${activeEngine?.id ?? 'shaper-feedback'}`;
}
let midiCCMap = loadCCMap(midiCCStorageKey());
// Per-param overrides for MIDI CC mode (same shape as visual overrides)
let midiCCOverrides = midiCCMap.map(p => ({
  min: p.min, max: p.max, curve: p.curve, frozen: p.muted, fixedValue: p.fixedValue,
}));
const MIDI_CC_PARAM_COLORS = [];
// Generate distinct colors for CC params
function _generateCCColors(n) {
  MIDI_CC_PARAM_COLORS.length = 0;
  for (let i = 0; i < n; i++) {
    const hue = (i * 137.508) % 360; // golden angle
    MIDI_CC_PARAM_COLORS.push(`hsl(${hue}, 70%, 60%)`);
  }
}
_generateCCColors(midiCCMap.length);

/** Reload the MIDI CC map from localStorage for the current engine. */
function reloadMidiCCMap() {
  const saved = loadCCMap(midiCCStorageKey());
  midiCCMap.length = 0;
  midiCCMap.push(...saved);
  midiCCOverrides.length = 0;
  midiCCOverrides.push(...saved.map(p => ({
    min: p.min, max: p.max, curve: p.curve, frozen: p.muted, fixedValue: p.fixedValue,
  })));
  _generateCCColors(midiCCMap.length);
}

// tame level is now baked into groupOverrides defaults at init time (see ?tame URL param)
let spreadLevel = 0.6;
let noiseLevel = 0.05;
let rlExplorationDecay = 0.97;

// Joystick state
let joyX = 0.5;
let joyY = 0.5;
let joyDragging = false;
let joyFollowMode = false;
let joyTrail = [];

// Gamepad
let gamepad;

// Raw param slider values (for examples mode advanced editing)
let rawParamValues = new Array(N_OUTPUTS).fill(0.5);

// ---- DOM refs ----
let $canvas, $heatmapCells, $heatmapTooltip;
let $joystickContainer, $joyMap, $joyMapCtx;
let $noiseRing, $followBadge;
let $rlButtons, $btnThumbsUp, $btnThumbsDown;
let $statusText;
let $lossCanvas, $lossCtx;
let $engineParams;
let $followPill;
let $synthVisCanvas;

// Undo stack — stores weight snapshots before RL actions
const undoStack = [];
const MAX_UNDO = 20;

// ---- Visual Overrides: per-param curve/min/max/freeze for visual mode ----
const visualOverrides = VISUAL_PARAM_NAMES.map(() => ({
  min: 0,
  max: 1,
  curve: 0.5,
  frozen: false,
  fixedValue: 0.5,
}));

// ---- Audio Canvas Overrides ----
// Dynamic array — resized when AudioCanvas output count changes
let audioCanvasOverrides = [];
function _ensureAudioCanvasOverrides(count) {
  while (audioCanvasOverrides.length < count) {
    audioCanvasOverrides.push({ min: 0, max: 1, curve: 0.5, frozen: false, fixedValue: 0.5 });
  }
  if (audioCanvasOverrides.length > count) audioCanvasOverrides.length = count;
}

// ---- Synth Sections (for SynthVisualizer) ----
const SYNTH_SECTIONS = [
  { name: 'Env A', count: 7, color: '#4488ff' },
  { name: 'Env B', count: 7, color: '#4488ff' },
  { name: 'Env C', count: 6, color: '#6688dd' },
  { name: 'Osc A', count: 5, color: '#ff8844' },
  { name: 'Osc B', count: 5, color: '#ff8844' },
  { name: 'Shp A', count: 6, color: '#ff4466' },
  { name: 'Shp B', count: 6, color: '#ff4466' },
  { name: 'Comb', count: 8, color: '#44ddaa' },
  { name: 'SVF', count: 9, color: '#44ddaa' },
  { name: 'Gap', count: 6, color: '#44bbaa' },
  { name: 'FB Mix', count: 9, color: '#ddaa44' },
  { name: 'Out Mix', count: 14, color: '#ddaa44' },
  { name: 'Cabinet', count: 8, color: '#aa88dd' },
  { name: 'Flanger', count: 13, color: '#dd88aa' },
  { name: 'Echo', count: 7, color: '#88aadd' },
  { name: 'Reverb', count: 6, color: '#88ddaa' },
  { name: 'Unison', count: 3, color: '#cccccc' },
  { name: 'Mono', count: 1, color: '#999999' },
];

// ---- Group Overrides: per-group curve + per-param min/max/curve/mute ----
// groupOverrides[sectionIndex] = { curve: 0.5, params: [{ min, max, curve, muted, fixedValue }, ...] }
// Defaults are seeded from safeMin/safeMax in SYNTH_PARAM_MAP, scaled by the
// ?tame URL parameter (0 = unconstrained, 1 = full safe limits).
// localStorage overrides on load.

// Module-level tame so applyPreset() can use it
const _urlTame = parseFloat(new URLSearchParams(window.location.search).get('tame') ?? '1');
const tameLevel = isNaN(_urlTame) ? 1 : Math.max(0, Math.min(1, _urlTame));

const groupOverrides = (() => {
  const t = tameLevel;
  let flatIdx = 0;
  return SYNTH_SECTIONS.map(sec => ({
    curve: 0.5,
    params: new Array(sec.count).fill(null).map(() => {
      const p = SYNTH_PARAM_MAP[flatIdx++];
      // Interpolate: at tame=0 use full [0,1]; at tame=1 use [safeMin, safeMax]
      const safeMin = p?.safeMin ?? 0;
      const safeMax = p?.safeMax ?? 1;
      return {
        min: safeMin * t,
        max: 1 - (1 - safeMax) * t,
        curve: 0.5,
        muted: false,
        fixedValue: 0.5,
      };
    }),
  }));
})();

// Lookup: param name -> flat index (for preset application)
const paramNameToIndex = new Map();
SYNTH_PARAM_MAP.forEach((p, i) => paramNameToIndex.set(p.name, i));

// Currently active synth preset id (null = no preset / manual)
let activeSynthPresetId = null;

// Build a flat lookup: paramIndex -> { sectionIndex, localIndex }
const paramToSection = [];
{
  let idx = 0;
  for (let si = 0; si < SYNTH_SECTIONS.length; si++) {
    for (let li = 0; li < SYNTH_SECTIONS[si].count; li++) {
      paramToSection.push({ si, li });
      idx++;
    }
  }
  // Pad for any params beyond sections
  while (paramToSection.length < N_SYNTH_OUTPUTS) {
    paramToSection.push(null);
  }
}

/**
 * Rebuild paramToSection from an engine's paramMeta groups.
 * For C15, restores the static SYNTH_SECTIONS-based mapping.
 * For non-C15 engines, derives sections from paramMeta group fields.
 */
function rebuildParamToSection(paramMeta) {
  paramToSection.length = 0;
  let si = 0, li = 0;
  let currentGroup = null;
  for (const pm of paramMeta) {
    const group = pm.group ?? 'Other';
    if (group !== currentGroup) {
      if (currentGroup !== null) si++;
      currentGroup = group;
      li = 0;
    }
    paramToSection.push({ si, li });
    li++;
  }
}

/**
 * Dynamic section metadata for non-C15 engines (parallel to SYNTH_SECTIONS
 * for C15). Indexed by section index (the `si` field in paramToSection).
 *
 *   nonC15Sections[si]      = { name, color, count, startIndex }
 *   nonC15GroupCurves[si]   = scalar group-master curve [0,1]
 *
 * Group curves persist across engine switches keyed by section NAME, so a
 * user's "Filter" curve survives a sub-engine swap that keeps the same
 * group label.
 */
let nonC15Sections = [];
let nonC15GroupCurves = [];
const _nonC15GroupCurveMemory = new Map(); // groupName -> curve

function rebuildNonC15Sections(paramMeta) {
  nonC15Sections = [];
  nonC15GroupCurves = [];
  let currentGroup = null;
  let si = -1;
  for (let i = 0; i < paramMeta.length; i++) {
    const g = paramMeta[i].group ?? 'Other';
    if (g !== currentGroup) {
      si++;
      currentGroup = g;
      // Prefer curated SYNTH_SECTIONS[si].color for C15 (same enumeration
      // order as paramMeta), otherwise hash-derive from the group name.
      const curated = (activeEngine?.id === 'shaper-feedback') ? SYNTH_SECTIONS[si] : null;
      nonC15Sections.push({
        name: g,
        color: curated?.color ?? _colorFromGroup(g),
        count: 0,
        startIndex: i,
      });
      nonC15GroupCurves.push(_nonC15GroupCurveMemory.get(g) ?? 0.5);
    }
    nonC15Sections[si].count++;
  }
}

/**
 * Restore paramToSection to the static C15 layout (from SYNTH_SECTIONS).
 */
function restoreC15ParamToSection() {
  paramToSection.length = 0;
  let idx = 0;
  for (let si = 0; si < SYNTH_SECTIONS.length; si++) {
    for (let li = 0; li < SYNTH_SECTIONS[si].count; li++) {
      paramToSection.push({ si, li });
      idx++;
    }
  }
  while (paramToSection.length < N_SYNTH_OUTPUTS) {
    paramToSection.push(null);
  }
}

// ---- Engine-aware preset helpers ----

/**
 * Return the preset array for the given engine id.
 */
function getPresetsForEngine(engineId) {
  switch (engineId) {
    case 'shaper-feedback': return SYNTH_PRESETS;
    case 'additive':        return ADDITIVE_PRESETS;
    case 'fm':              return FM_PRESETS;
    case 'modular':         return MODULAR_PRESETS;
    default:                return [];
  }
}

/**
 * Sync the Patch Editor preset picker with the current engine + active preset.
 * Safe to call before `patchEditor` is created.
 */
function syncPatchEditorPresets() {
  if (!patchEditor) return;
  const engineId = activeEngine?.id ?? 'shaper-feedback';
  const presets = getPresetsForEngine(engineId);
  try { patchEditor.setPresets(presets, activeSynthPresetId); } catch (e) { /* non-fatal */ }
}

/**
 * Return the tier labels for the given engine id.
 */
function getPresetTiersForEngine(engineId) {
  switch (engineId) {
    case 'shaper-feedback': return PRESET_TIERS;
    case 'additive':        return ADDITIVE_PRESET_TIERS;
    case 'fm':              return FM_PRESET_TIERS;
    default:                return [];
  }
}

// ---- Engine param overrides (for non-C15 engines) ----
// Flat array of per-param overrides for the current Faust engine.
// null when C15 is active (uses groupOverrides instead).
// Each entry: { min, max, curve, muted, fixedValue }
let engineParamOverrides = null;

/**
 * Build a fresh engineParamOverrides array from the current engine's paramMeta.
 * All params default to unmuted with [0,1] range and linear curve.
 */
function buildEngineParamOverrides() {
  const meta = activeEngine?.paramMeta;
  if (!meta) { engineParamOverrides = null; return; }
  engineParamOverrides = meta.map(p => ({
    min: 0,
    max: 1,
    curve: 0.5,
    muted: false,
    fixedValue: 0.5,
  }));
}

/**
 * Apply group overrides (per-param curve + min/max) to a single ML output value.
 * Returns the remapped value, or fixedValue if the param is muted.
 *
 * For non-C15 engines, uses engineParamOverrides (flat array).
 * For C15, uses the nested groupOverrides/paramToSection system.
 */
function applyGroupOverrides(rawValue, paramIndex) {
  // Non-C15 engine: use flat engine param overrides
  if (engineParamOverrides && paramIndex < engineParamOverrides.length) {
    const p = engineParamOverrides[paramIndex];
    if (p.muted) return p.fixedValue;
    return applyGroupOverride(rawValue, p.curve, p.min, p.max);
  }
  // C15 path: nested section/group overrides
  const mapping = paramToSection[paramIndex];
  if (!mapping) return rawValue;
  const ov = groupOverrides[mapping.si];
  const p = ov.params[mapping.li];
  if (p.muted) return p.fixedValue;
  // Per-param curve overrides group curve (if param curve != 0.5, use it; else use group curve)
  const curve = p.curve !== 0.5 ? p.curve : ov.curve;
  return applyGroupOverride(rawValue, curve, p.min, p.max);
}

/** Check if param at given index is muted */
function isParamMuted(paramIndex) {
  // Non-C15 engine: use flat engine param overrides
  if (engineParamOverrides && paramIndex < engineParamOverrides.length) {
    return engineParamOverrides[paramIndex].muted;
  }
  // C15 path
  const mapping = paramToSection[paramIndex];
  if (!mapping) return false;
  return groupOverrides[mapping.si].params[mapping.li].muted;
}

// ---- Synth Preset Application ----

/**
 * Apply a synth preset by id.
 * Engine-aware: uses groupOverrides for C15, engineParamOverrides for Faust engines.
 * Sets muted/active, min/max/curve/fixedValue for all params,
 * re-routes outputs, saves state, and updates the UI dropdown.
 */
// ---- Per-preset session memory helpers (meml-4uye) ----

// Pseudo-preset id used when the engine has no active preset at save time.
// Scoped per engine via the session key (nisps.session.<engine>.__no_preset__).
// Used by the cross-engine switch save/restore flow (meml-u78y).
const NO_PRESET_KEY = '__no_preset__';

/**
 * Capture a snapshot of the current preset's ML state.
 * Returned object is JSON-serializable.
 */
function capturePresetSession() {
  const engineId = activeEngine?.id ?? 'shaper-feedback';
  const payload = {
    engineId,
    presetId: activeSynthPresetId,
    nOutputs: N_OUTPUTS,
    // IML weights + datasets. imlJoy is primary (warm-started across rebuilds);
    // imlHand is included when we have one so hand mode doesn't lose its work.
    joy: imlJoy ? {
      layerSizes: [...imlJoy.layerSizes],
      weights: imlJoy._getFlatWeights(),
      features: imlJoy.dataset.features.map(r => [...r]),
      labels:   imlJoy.dataset.labels.map(r => [...r]),
    } : null,
    hand: imlHand ? {
      layerSizes: [...imlHand.layerSizes],
      weights: imlHand._getFlatWeights(),
      features: imlHand.dataset.features.map(r => [...r]),
      labels:   imlHand.dataset.labels.map(r => [...r]),
    } : null,
    // Applied overrides (user tweaks on top of preset).
    groupOverrides: (engineId === 'shaper-feedback') ? groupOverrides : null,
    engineParamOverrides: (engineId !== 'shaper-feedback') ? engineParamOverrides : null,
    // Snapshot stack + A/B slots — held externally today, but we reserve the
    // slots so they can be wired in without a schema bump.
    snapshotStack: null,
    abCompare: null,
    noiseLevel,
  };
  return payload;
}

/**
 * Restore a previously saved preset session onto the live IMLs.
 * Assumes the MLP output count already matches; if not, examples with
 * mismatched dims are dropped (dataset.add enforces shape).
 */
function restorePresetSession(payload) {
  if (!payload) return;
  try {
    let weightMismatch = false;
    let droppedExamples = 0;

    if (payload.joy && imlJoy) {
      const expected = imlJoy._weightCount;
      if (payload.joy.weights && payload.joy.weights.length === expected) {
        imlJoy._setFlatWeights(payload.joy.weights);
        imlJoy.dataset.clear();
        if (Array.isArray(payload.joy.features)) {
          for (let i = 0; i < payload.joy.features.length; i++) {
            const f = payload.joy.features[i];
            const l = payload.joy.labels[i] || [];
            if (f && f.length === imlJoy.nInputs && l.length === imlJoy.nOutputs) {
              imlJoy.dataset.add(f, l);
            } else {
              droppedExamples++;
            }
          }
        }
      } else {
        // Weight mismatch: whole payload for this IML is incompatible — skip
        // dataset reload too so we don't leave a partial state.
        weightMismatch = true;
        console.warn('[NISPS] session: joy weights length mismatch, skipping entire joy payload');
      }
    }
    if (payload.hand && imlHand) {
      const expected = imlHand._weightCount;
      if (payload.hand.weights && payload.hand.weights.length === expected) {
        imlHand._setFlatWeights(payload.hand.weights);
        imlHand.dataset.clear();
        if (Array.isArray(payload.hand.features)) {
          for (let i = 0; i < payload.hand.features.length; i++) {
            const f = payload.hand.features[i];
            const l = payload.hand.labels[i] || [];
            if (f && f.length === imlHand.nInputs && l.length === imlHand.nOutputs) {
              imlHand.dataset.add(f, l);
            } else {
              droppedExamples++;
            }
          }
        }
      } else {
        weightMismatch = true;
        console.warn('[NISPS] session: hand weights length mismatch, skipping entire hand payload');
      }
    }

    if (weightMismatch) {
      try { showToast('Saved session incompatible with new topology — starting fresh'); }
      catch (_) { /* best-effort */ }
    } else if (droppedExamples > 0) {
      try { showToast(`${droppedExamples} saved example(s) dropped (shape mismatch)`); }
      catch (_) { /* best-effort */ }
    }
    if (typeof payload.noiseLevel === 'number') noiseLevel = payload.noiseLevel;
    // Run inference so routed outputs reflect the restored weights.
    if (iml) {
      iml.inputUpdated = true;
      iml.process();
      routeOutputs(iml.getOutputs());
    }
  } catch (e) {
    console.warn('[NISPS] restorePresetSession failed:', e);
  }
}

/**
 * Reset the ML state to a "fresh" starting point: clear datasets and
 * randomise weights. Used when the user chooses "Start Fresh" on the
 * restore dialog.
 */
function freshPresetSession() {
  try {
    if (imlJoy) {
      imlJoy.dataset.clear();
      imlJoy.randomiseWeights(spreadLevel);
    }
    if (imlHand) {
      imlHand.dataset.clear();
      imlHand.randomiseWeights(spreadLevel);
    }
    if (iml) {
      iml.inputUpdated = true;
      iml.process();
      routeOutputs(iml.getOutputs());
    }
  } catch (e) {
    console.warn('[NISPS] freshPresetSession failed:', e);
  }
}

async function applyPreset(presetId) {
  // --- Step 1: capture outgoing session under its {engine, presetId} key ---
  const prevEngineId = activeEngine?.id ?? 'shaper-feedback';
  const prevPresetId = activeSynthPresetId;
  if (prevPresetId && prevPresetId !== presetId && sessionWorthSaving()) {
    try {
      saveSessionMem(prevEngineId, prevPresetId, capturePresetSession());
      clearSessionDirty();
    } catch (e) {
      console.warn('[NISPS] session save (outgoing) failed:', e);
    }
  }

  // Snapshot preset-scoped state so we can revert on Cancel from the restore
  // modal. Deep-clones cover the mutations done below (groupOverrides params
  // array + engineParamOverrides entries).
  const _prevStateSnapshot = {
    presetId: prevPresetId,
    groupOverrides: groupOverrides ? JSON.parse(JSON.stringify(groupOverrides)) : null,
    engineParamOverrides: engineParamOverrides
      ? JSON.parse(JSON.stringify(engineParamOverrides))
      : null,
    nonC15GroupCurves: Array.isArray(nonC15GroupCurves) ? [...nonC15GroupCurves] : nonC15GroupCurves,
  };

  const engineId = activeEngine?.id ?? 'shaper-feedback';
  const presets = getPresetsForEngine(engineId);
  const preset = presets.find(p => p.id === presetId);
  if (!preset) {
    console.warn(`[NISPS] Unknown preset: ${presetId} (engine: ${engineId})`);
    return;
  }

  // meml-17mp: read from unified `preset.params`; fall back to legacy
  // `active`/`overrides`/`mutedOverrides` shim for safety.
  const unifiedParams = (preset.params && typeof preset.params === 'object' && !Array.isArray(preset.params))
    ? preset.params : null;

  /**
   * Resolve a per-param entry from either the unified `params` map (preferred)
   * or the legacy shim. Returns `{ bypassed, muted, min, max, curve, fixedValue }`
   * with schema defaults filled. An absent param is treated as fully live
   * per unified-preset-schema omission rules.
   */
  function resolveEntry(labelOrId, defaultFixed) {
    if (unifiedParams) {
      const e = unifiedParams[labelOrId];
      if (e) {
        return {
          bypassed: !!e.bypassed,
          muted:    !!e.muted,
          min:      e.min   !== undefined ? e.min   : 0,
          max:      e.max   !== undefined ? e.max   : 1,
          curve:    e.curve !== undefined ? e.curve : 0.5,
          fixedValue: e.fixedValue !== undefined ? e.fixedValue : defaultFixed,
        };
      }
      return { bypassed: false, muted: false, min: 0, max: 1, curve: 0.5, fixedValue: defaultFixed };
    }
    // Legacy shim fallback
    const legacyActive    = preset.active; // null = all active
    const legacyOverrides = preset.overrides || {};
    const legacyMutedOv   = preset.mutedOverrides || {};
    const isActive = legacyActive === null
      || (Array.isArray(legacyActive) && legacyActive.includes(labelOrId));
    if (isActive) {
      const ov = legacyOverrides[labelOrId];
      return {
        bypassed: false, muted: false,
        min:   ov?.min   ?? 0,
        max:   ov?.max   ?? 1,
        curve: ov?.curve ?? 0.5,
        fixedValue: ov?.fixedValue ?? defaultFixed,
      };
    }
    const mov = legacyMutedOv[labelOrId];
    return {
      bypassed: true, muted: false,
      min: 0, max: 1, curve: 0.5,
      fixedValue: mov?.fixedValue ?? defaultFixed,
    };
  }

  if (engineId === 'shaper-feedback') {
    // ---- C15 path: uses groupOverrides / paramToSection ----
    const t = tameLevel;
    for (let i = 0; i < N_SYNTH_OUTPUTS; i++) {
      const param = SYNTH_PARAM_MAP[i];
      const mapping = paramToSection[i];
      if (!mapping) continue;
      const gp = groupOverrides[mapping.si].params[mapping.li];

      const safeMin = param.safeMin ?? 0;
      const safeMax = param.safeMax ?? 1;
      const tameMin = safeMin * t;
      const tameMax = 1 - (1 - safeMax) * t;

      const entry = resolveEntry(param.name, param.defaultValue);

      // bypassed | muted collapse to "pinned at fixedValue" at runtime (the
      // MLP still has an output node; meml-gmus-driven structural rebuild
      // will consume the bypassed flag for true paramMeta filtering).
      if (entry.bypassed || entry.muted) {
        gp.muted = true;
        gp.fixedValue = entry.fixedValue;
        gp.min = tameMin;
        gp.max = tameMax;
        gp.curve = 0.5;
      } else {
        gp.muted = false;
        // Preset min/max are already normalised [0,1]; keep them as-is but
        // clamp to the tame envelope so ?tame=1 still constrains unsafe values.
        gp.min = Math.max(entry.min, tameMin);
        gp.max = Math.min(entry.max, tameMax);
        gp.curve = entry.curve;
        gp.fixedValue = entry.fixedValue;
      }
    }

    // Apply group curves — keyed by SYNTH_SECTIONS.name for back-compat.
    const gc = preset.groupCurves || {};
    for (let si = 0; si < SYNTH_SECTIONS.length; si++) {
      const secName = SYNTH_SECTIONS[si].name;
      groupOverrides[si].curve = (gc[secName] !== undefined) ? gc[secName] : 0.5;
    }
  } else {
    // ---- Faust engine path: uses engineParamOverrides (flat array) ----

    // meml-17mp: for modular engine, push DSP state to the worklet first.
    // applyModularPreset handles sub-engine swap, mod source counts,
    // expose flags for sound params AND matrix cells, plus raw value
    // writes. It fires paramMeta:change (multiple times); the engine
    // switcher callback already handles MLP resize + engineParamOverrides
    // rebuild. We then layer min/max/curve on top from the unified entries.
    if (engineId === 'modular' && activeEngine) {
      try {
        await applyModularPreset(activeEngine, preset);
      } catch (err) {
        console.warn('[NISPS] applyModularPreset failed:', err);
      }
    }

    const meta = activeEngine?.paramMeta ?? [];

    // Ensure engineParamOverrides exists with correct length
    if (!engineParamOverrides || engineParamOverrides.length !== meta.length) {
      buildEngineParamOverrides();
    }

    // Build a helper to resolve matrix-cell entries keyed by sNN_dNN
    // (unified schema). Modular paramMeta rows for matrix cells have
    // id = 'MM_Matrix/sNN_dNN_<destName>' — we extract sNN/dNN and look
    // up in preset.matrix.
    const _matrixEntries = (engineId === 'modular' && preset.matrix) || null;
    const _resolveMatrixEntry = (paramLabel, defFixed) => {
      if (!_matrixEntries || typeof paramLabel !== 'string') return null;
      const mm = /^MM_Matrix\/s(\d{2})_d(\d{2})_/.exec(paramLabel);
      if (!mm) return null;
      const key = `s${mm[1]}_d${mm[2]}`;
      const mc = _matrixEntries[key];
      if (!mc) {
        // Cell not listed in preset.matrix → schema says muted/off.
        return { bypassed: false, muted: true, min: 0, max: 1, curve: 0.5,
                 fixedValue: defFixed };
      }
      return {
        bypassed: !!mc.bypassed,
        muted:    !!mc.muted,
        min:      typeof mc.min   === 'number' ? mc.min   : 0,
        max:      typeof mc.max   === 'number' ? mc.max   : 1,
        curve:    typeof mc.curve === 'number' ? mc.curve : 0.5,
        fixedValue: typeof mc.fixedValue === 'number' ? mc.fixedValue : defFixed,
      };
    };

    for (let i = 0; i < meta.length; i++) {
      const paramId = meta[i].id;
      const defFixed = meta[i].init ?? 0.5;
      const ep = engineParamOverrides[i];
      const entry = _resolveMatrixEntry(paramId, defFixed) || resolveEntry(paramId, defFixed);

      if (entry.bypassed || entry.muted) {
        ep.muted = true;
        ep.fixedValue = entry.fixedValue;
        ep.min = 0;
        ep.max = 1;
        ep.curve = 0.5;
      } else {
        ep.muted = false;
        ep.min = entry.min;
        ep.max = entry.max;
        ep.curve = entry.curve;
        ep.fixedValue = entry.fixedValue;
      }
    }

    // Faust engines: apply group curves keyed by paramMeta-derived section names.
    const gc = preset.groupCurves || {};
    for (let si = 0; si < nonC15Sections.length; si++) {
      const secName = nonC15Sections[si].name;
      if (gc[secName] !== undefined) {
        nonC15GroupCurves[si] = gc[secName];
        _nonC15GroupCurveMemory.set(secName, gc[secName]);
      }
    }
  }

  activeSynthPresetId = presetId;

  // Close the group drawer if open
  hideGroupDrawer();

  // Re-route outputs through updated overrides
  if (iml) {
    routeOutputs(iml.getOutputs());
  }

  // Update the preset dropdown
  const $presetSelect = document.getElementById('synth-preset-select');
  if ($presetSelect) $presetSelect.value = presetId;

  // meml-coh8: propagate to Patch Editor + Patch Bay so open modals refresh.
  if (patchEditor) patchEditor.setContext({ engine: activeEngine, preset });
  if (patchBay && typeof patchBay.setPreset === 'function') patchBay.setPreset(preset);

  // Sync Patch Editor preset picker (active highlight)
  syncPatchEditorPresets();

  // Save to storage
  saveState();

  console.log(`[NISPS] Applied synth preset: ${preset.name} (engine: ${engineId})`);

  // --- Step 2: check localStorage for prior session under new preset key ---
  // Only prompt if we're actually switching to a different preset (avoid
  // re-prompting on init/same-preset re-apply) and we have a saved entry.
  if (prevPresetId !== presetId) {
    const saved = loadSessionMem(engineId, presetId);
    if (saved && saved.payload) {
      const exampleCount = (saved.payload.joy?.features?.length ?? 0)
                         + (saved.payload.hand?.features?.length ?? 0);
      try {
        const choice = await showRestoreModal({
          presetName: preset.name,
          timestamp: saved.timestamp,
          exampleCount,
        });
        if (choice === 'restore') {
          restorePresetSession(saved.payload);
          clearSessionDirty(); // newly-restored state is not "dirty" yet
          saveState();
          console.log(`[NISPS] Restored prior session for ${presetId}`);
        } else if (choice === 'fresh') {
          freshPresetSession();
          saveState();
          console.log(`[NISPS] Started fresh session for ${presetId}`);
        } else {
          // 'cancel' → revert preset application. Overrides were already
          // mutated above; restore them from the snapshot and flip the
          // active preset id back. Do NOT persist the half-applied state.
          if (_prevStateSnapshot.groupOverrides && groupOverrides) {
            // Preserve live object identity — copy fields in place.
            for (let si = 0; si < groupOverrides.length && si < _prevStateSnapshot.groupOverrides.length; si++) {
              const src = _prevStateSnapshot.groupOverrides[si];
              const dst = groupOverrides[si];
              dst.curve = src.curve;
              if (Array.isArray(src.params) && Array.isArray(dst.params)) {
                for (let li = 0; li < dst.params.length && li < src.params.length; li++) {
                  Object.assign(dst.params[li], src.params[li]);
                }
              }
            }
          }
          if (_prevStateSnapshot.engineParamOverrides && engineParamOverrides) {
            for (let i = 0; i < engineParamOverrides.length && i < _prevStateSnapshot.engineParamOverrides.length; i++) {
              Object.assign(engineParamOverrides[i], _prevStateSnapshot.engineParamOverrides[i]);
            }
          }
          if (Array.isArray(_prevStateSnapshot.nonC15GroupCurves)) {
            for (let i = 0; i < nonC15GroupCurves.length && i < _prevStateSnapshot.nonC15GroupCurves.length; i++) {
              nonC15GroupCurves[i] = _prevStateSnapshot.nonC15GroupCurves[i];
            }
          }
          activeSynthPresetId = _prevStateSnapshot.presetId;
          const $ps2 = document.getElementById('synth-preset-select');
          if ($ps2) $ps2.value = activeSynthPresetId || '';
          if (iml) routeOutputs(iml.getOutputs());
          console.log(`[NISPS] Cancelled preset switch; reverted to ${_prevStateSnapshot.presetId ?? '(none)'}`);
        }
      } catch (e) {
        console.warn('[NISPS] restore modal failed:', e);
      }
    }
  }
}

// ---- SynthVisualizer class ----
class SynthVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.params = new Array(N_OUTPUTS).fill(0.5);
    this.displayParams = new Array(N_OUTPUTS).fill(0.5);
    this.lerpSpeed = 0.12;
    this.topPadding = 40;
    this.bottomPadding = 100;

    // Interaction state
    this._dragging = false;
    this._dragBarIndex = -1;
    this._interactionEnabled = false;

    // Hover tooltip state
    this._hoveredBar = -1;
    this._tooltipEl = null;

    // Build section map
    this.sectionMap = [];
    let idx = 0;
    for (const sec of SYNTH_SECTIONS) {
      for (let i = 0; i < sec.count && idx < N_OUTPUTS; i++, idx++) {
        this.sectionMap.push(sec);
      }
    }
    // Fill remainder with generic
    while (this.sectionMap.length < N_OUTPUTS) {
      this.sectionMap.push({ name: 'Other', count: 1, color: '#666666' });
    }

    // Always-on hover tracking for tooltip (independent of enableInteraction)
    this.canvas.addEventListener('pointermove', (e) => {
      if (this._dragging) return; // interaction handler takes over
      const idx = this.hitTest(e.clientX, e.clientY);
      this._hoveredBar = idx;
      // Store mouse position in canvas pixels for tooltip
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this._mouseCanvasX = (e.clientX - rect.left) * dpr;
      this._mouseCanvasY = (e.clientY - rect.top) * dpr;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this._hoveredBar = -1;
    });

    this.resize();
  }

  /**
   * Rebuild the visualizer for a new engine's param layout.
   * Derives sections from paramMeta's group field so it works with any engine.
   * @param {Array<{group?: string}>} paramMeta
   */
  rebuild(paramMeta) {
    if (!paramMeta || paramMeta.length === 0) return;

    // Derive sections from paramMeta groups
    const sections = [];
    let currentGroup = null;
    let currentCount = 0;
    for (const pm of paramMeta) {
      const group = pm.group ?? 'Other';
      if (group !== currentGroup) {
        if (currentGroup !== null) {
          sections.push({ name: currentGroup, count: currentCount, color: _colorFromGroup(currentGroup) });
        }
        currentGroup = group;
        currentCount = 0;
      }
      currentCount++;
    }
    if (currentGroup !== null) {
      sections.push({ name: currentGroup, count: currentCount, color: _colorFromGroup(currentGroup) });
    }

    // Rebuild sectionMap
    this.sectionMap = [];
    for (const sec of sections) {
      for (let i = 0; i < sec.count; i++) {
        this.sectionMap.push(sec);
      }
    }

    // Resize param arrays
    this.params = new Array(paramMeta.length).fill(0.5);
    this.displayParams = new Array(paramMeta.length).fill(0.5);
  }

  resize() {
    this.canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
    this.canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
  }

  setParams(outputs) {
    for (let i = 0; i < N_OUTPUTS && i < outputs.length; i++) {
      this.params[i] = outputs[i];
    }
  }

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const n = N_OUTPUTS;

    // Lerp display values toward target
    for (let i = 0; i < n; i++) {
      this.displayParams[i] += (this.params[i] - this.displayParams[i]) * this.lerpSpeed;
    }

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    // Build list of visible (non-muted) param indices
    const visibleIndices = [];
    for (let i = 0; i < n; i++) {
      if (!isParamMuted(i)) visibleIndices.push(i);
    }
    const nVisible = visibleIndices.length || 1;

    // Calculate section gap positions (among visible params only)
    const sectionGaps = new Set();
    let prevSi = -1;
    for (const vi of visibleIndices) {
      const mapping = paramToSection[vi];
      const curSi = mapping ? mapping.si : -1;
      if (prevSi >= 0 && curSi !== prevSi) {
        sectionGaps.add(vi);
      }
      prevSi = curSi;
    }

    const topPad = this.topPadding * dpr;
    const bottomPad = this.bottomPadding * dpr;
    const totalGapPx = sectionGaps.size * 2 * dpr;
    const barAreaWidth = W - totalGapPx;
    const barWidth = barAreaWidth / nVisible;
    const usableHeight = H - topPad - bottomPad;
    const maxBarHeight = usableHeight;

    // Store layout for interaction hit-testing
    this._layout = { W, H, n, barWidth, totalGapPx, sectionGaps, topPad, bottomPad, usableHeight, dpr, visibleIndices };

    // Draw bars
    let x = 0;
    let prevSection = null;
    let sectionStartX = 0;
    let sectionIndex = -1;
    // Store bar x positions for hit testing (indexed by original param index)
    this._barXPositions = new Array(n).fill(-1);
    this._barWidths = new Array(n).fill(0);
    // Store section label regions (in CSS pixels) for drawer hit testing
    this._sectionLabelRegions = [];

    for (let vi = 0; vi < visibleIndices.length; vi++) {
      const i = visibleIndices[vi];
      const sec = this.sectionMap[i] ?? { name: 'Other', count: 1, color: '#666666' };
      const mapping = paramToSection[i];
      const curSi = mapping ? mapping.si : -1;

      // Section divider gap
      if (sectionGaps.has(i)) {
        // Draw section label for the previous section at top
        if (prevSection) {
          this._drawSectionLabel(ctx, prevSection.name, sectionStartX, x, topPad, prevSection.color);
          this._sectionLabelRegions.push({
            index: sectionIndex,
            left: sectionStartX / dpr,
            right: x / dpr,
            top: 0,
            bottom: topPad / dpr,
            name: prevSection.name,
          });
        }
        sectionIndex = curSi;
        x += 2 * dpr;
        sectionStartX = x;
        prevSection = sec;
      }

      if (vi === 0) {
        sectionStartX = x;
        prevSection = sec;
        sectionIndex = curSi;
      }

      this._barXPositions[i] = x;
      this._barWidths[i] = barWidth;

      const val = this.displayParams[i];
      const barH = val * maxBarHeight;
      const barY = topPad + usableHeight - barH;

      // Bar with slight transparency
      ctx.fillStyle = sec.color + 'cc';
      ctx.fillRect(x, barY, Math.max(barWidth - 0.5, 1), barH);

      // Bright top edge
      ctx.fillStyle = sec.color;
      ctx.fillRect(x, barY, Math.max(barWidth - 0.5, 1), Math.min(2 * dpr, barH));

      x += barWidth;
    }

    // Draw final section label at top
    if (prevSection) {
      this._drawSectionLabel(ctx, prevSection.name, sectionStartX, x, topPad, prevSection.color);
      this._sectionLabelRegions.push({
        index: sectionIndex,
        left: sectionStartX / dpr,
        right: x / dpr,
        top: 0,
        bottom: topPad / dpr,
        name: prevSection.name,
      });
    }

    // Draw tooltip for hovered bar
    this._drawTooltip(ctx, dpr);
  }

  _drawSectionLabel(ctx, name, startX, endX, topPad, color) {
    const dpr = window.devicePixelRatio || 1;
    const fontSize = 9 * dpr;
    ctx.save();
    ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = color + '88';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const cx = (startX + endX) / 2;
    ctx.fillText(name, cx, topPad - 4 * dpr);
    ctx.restore();
  }

  // Returns section region at client coordinates, or null
  hitTestSection(clientX, clientY) {
    if (!this._sectionLabelRegions) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    for (const region of this._sectionLabelRegions) {
      if (px >= region.left && px <= region.right && py >= region.top && py <= region.bottom) {
        return region;
      }
    }
    return null;
  }

  // Returns bar index at canvas-relative pixel x, or -1
  hitTest(clientX, clientY) {
    if (!this._barXPositions || !this._layout) return -1;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this._layout.dpr;
    const px = (clientX - rect.left) * dpr;
    const n = this._layout.n;

    for (let i = 0; i < n; i++) {
      const bx = this._barXPositions[i];
      if (bx < 0) continue; // muted
      const bw = this._barWidths[i] || this._layout.barWidth;
      if (px >= bx && px < bx + bw) return i;
    }
    return -1;
  }

  // Returns 0-1 value from clientY (top of bar area = 1, bottom = 0)
  yToValue(clientY) {
    if (!this._layout) return 0.5;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this._layout.dpr;
    const py = (clientY - rect.top) * dpr;
    const { topPad, usableHeight } = this._layout;
    const val = 1 - (py - topPad) / usableHeight;
    return Math.max(0, Math.min(1, val));
  }

  enableInteraction(enabled) {
    if (enabled && !this._interactionEnabled) {
      this._interactionEnabled = true;
      this.canvas.style.cursor = 'crosshair';

      this._onPointerDown = (e) => {
        const idx = this.hitTest(e.clientX, e.clientY);
        if (idx < 0) return;
        e.preventDefault();
        this._dragging = true;
        this._dragBarIndex = idx;
        this.canvas.setPointerCapture(e.pointerId);
        const val = this.yToValue(e.clientY);
        rawParamValues[idx] = val;
        this.params[idx] = val;
        routeOutputs(rawParamValues);
        updateHeatmap(rawParamValues);
      };

      this._onPointerMove = (e) => {
        if (!this._dragging) return;
        e.preventDefault();
        // Allow sliding to adjacent bars
        let idx = this.hitTest(e.clientX, e.clientY);
        if (idx < 0) idx = this._dragBarIndex;
        this._dragBarIndex = idx;
        const val = this.yToValue(e.clientY);
        rawParamValues[idx] = val;
        this.params[idx] = val;
        routeOutputs(rawParamValues);
        updateHeatmap(rawParamValues);
      };

      this._onPointerUp = (e) => {
        this._dragging = false;
        this._dragBarIndex = -1;
      };

      this.canvas.addEventListener('pointerdown', this._onPointerDown);
      this.canvas.addEventListener('pointermove', this._onPointerMove);
      this.canvas.addEventListener('pointerup', this._onPointerUp);
      this.canvas.addEventListener('pointercancel', this._onPointerUp);
    } else if (!enabled && this._interactionEnabled) {
      this._interactionEnabled = false;
      this.canvas.style.cursor = '';
      this._dragging = false;
      this._dragBarIndex = -1;
      this._hoveredBar = -1;
      if (this._onPointerDown) {
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerup', this._onPointerUp);
        this.canvas.removeEventListener('pointercancel', this._onPointerUp);
      }
    }
  }

  _drawTooltip(ctx, dpr) {
    const i = this._hoveredBar;
    if (i < 0 || !this._layout) return;
    if (this._barXPositions[i] < 0) return; // muted

    const name = (activeEngine?.paramMeta?.[i]?.name) || SYNTH_PARAM_NAMES[i] || `p${i}`;
    const val = this.displayParams[i];
    let rangeStr = '0.00 – 1.00';
    let curveStr = '0.50';
    if (engineParamOverrides && i < engineParamOverrides.length) {
      // Non-C15 engine: use flat engine param overrides
      const p = engineParamOverrides[i];
      rangeStr = `${p.min.toFixed(2)} – ${p.max.toFixed(2)}`;
      curveStr = p.curve.toFixed(2);
    } else {
      // C15 path: nested section/group overrides
      const mapping = paramToSection[i];
      if (mapping) {
        const ov = groupOverrides[mapping.si];
        const p = ov.params[mapping.li];
        rangeStr = `${p.min.toFixed(2)} – ${p.max.toFixed(2)}`;
        const curve = p.curve !== 0.5 ? p.curve : ov.curve;
        curveStr = curve.toFixed(2);
      }
    }

    const lines = [name, `Val: ${val.toFixed(2)}`, `Range: ${rangeStr}`, `Curve: ${curveStr}`];
    const fontSize = 10 * dpr;
    const lineHeight = fontSize * 1.4;
    const padX = 8 * dpr;
    const padY = 6 * dpr;

    ctx.save();
    ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;

    // Measure text
    let maxW = 0;
    for (const line of lines) {
      const m = ctx.measureText(line);
      if (m.width > maxW) maxW = m.width;
    }
    const boxW = maxW + padX * 2;
    const boxH = lines.length * lineHeight + padY * 2;

    // Position near the mouse cursor
    const mx = this._mouseCanvasX || 0;
    const my = this._mouseCanvasY || 0;
    const offset = 12 * dpr;
    let tx = mx + offset;
    let ty = my - boxH - offset;
    // Clamp to canvas
    if (tx + boxW > this._layout.W - 2 * dpr) tx = mx - boxW - offset;
    if (ty < 2 * dpr) ty = my + offset;
    if (tx < 2 * dpr) tx = 2 * dpr;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    const r = 4 * dpr;
    ctx.beginPath();
    ctx.roundRect(tx, ty, boxW, boxH, r);
    ctx.fill();
    ctx.stroke();

    // Text
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let li = 0; li < lines.length; li++) {
      ctx.fillStyle = li === 0 ? '#ffffff' : 'rgba(255,255,255,0.6)';
      if (li === 0) ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
      else ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
      ctx.fillText(lines[li], tx + padX, ty + padY + li * lineHeight);
    }
    ctx.restore();
  }
}

// ---- Preset padding ----
function padPresetOutputs(outputs) {
  const padded = new Array(N_OUTPUTS).fill(0.5);
  for (let i = 0; i < outputs.length && i < padded.length; i++) padded[i] = outputs[i];
  return padded;
}

// ---- MLP Resize ----
// Returns the target output count for a given mode
function outputCountForMode(mode) {
  if (mode === 'visual') return N_VISUAL_OUTPUTS;
  if (mode === 'synth') return N_SYNTH_OUTPUTS;
  if (mode === 'midi-cc') return midiCCMap.length;
  if (mode === 'audio-canvas') return audioCanvas ? audioCanvas.getOutputCount() : 12;
  return N_SYNTH_OUTPUTS;
}

/**
 * Total MLP output count: engine params + EOC params when in Shared mode.
 * In all other NISPS modes (bypass/linked/independent) or when no EOC chain
 * exists, only the engine's own param count is included.
 *
 * @returns {number}
 */
function totalOutputCount() {
  // If the user explicitly pinned an output count via ?arch=..., honour it
  // across engine switches. The engine's own paramCount may not line up, in
  // which case excess outputs route to nothing and a one-shot warning fires.
  if (ARCH_OUTPUTS_OVERRIDE) {
    const engineParams = activeEngine?.paramCount ?? N_SYNTH_OUTPUTS;
    if (!_archOverrideWarned && engineParams !== ARCH_OUTPUTS_OVERRIDE) {
      _archOverrideWarned = true;
      console.warn(
        `[NISPS] ?arch override ${ARCH_OUTPUTS_OVERRIDE} doesn't match engine paramCount ${engineParams}; ` +
        `MLP will use ${ARCH_OUTPUTS_OVERRIDE} but some outputs may not route.`
      );
    }
    return ARCH_OUTPUTS_OVERRIDE;
  }
  const engineParams = activeEngine?.paramCount ?? N_SYNTH_OUTPUTS;
  const eocParams = (eocChain?.nispsMode === 'shared') ? (eocChain?.paramCount ?? 0) : 0;
  return engineParams + eocParams;
}
let _archOverrideWarned = false;

/**
 * Recreate IML instances with a new output count.
 * Joystick IML uses warm-start weight transfer to preserve learned mappings.
 * Training examples are always cleared (dataset is JS-side and output-count-specific).
 */
// ---- EOC audio graph wiring ----
/**
 * Wire the EOC chain into the audio graph after the C15 AudioContext is created.
 * Safe to call multiple times — guarded by _eocInited flag.
 *
 * Call this immediately after any c15.start() / activeEngine.init() that brings
 * the AudioContext into existence.
 */
async function _startEocChain() {
  if (_eocInited || !eocChain) return;
  // C15Adapter exposes _bridge.audioContext; Faust engines expose _audioCtx
  const audioCtx = activeEngine?._bridge?.audioContext ?? activeEngine?._audioCtx;
  if (!audioCtx) {
    console.warn('[EOC] _startEocChain: no AudioContext yet — skipping');
    return;
  }

  await eocChain.init(audioCtx);
  _eocInited = true;

  // Disconnect the limiter from destination (it auto-connects there in C15Bridge.start())
  const outputNode = activeEngine.getOutputNode();
  try { outputNode.disconnect(); } catch (_) { /* already disconnected */ }

  eocChain.connect(outputNode, audioCtx.destination);
  console.log('[EOC] chain wired into audio graph');
}

/**
 * Lazily initialise ShapeSeq subsystem.
 * Guarded by _shapeSeqInited — safe to call multiple times.
 * Requires audio to be running (AudioContext must exist).
 */
async function _ensureShapeSeqInit() {
  if (_shapeSeqInited || !shapeSeqEnabled) return;

  // Import modules lazily
  if (!ShapeSeqEngine) {
    ({ ShapeSeqEngine } = await import('./shapeseq/sequencer.js'));
    ({ StepVisualizer } = await import('./shapeseq/step-viz.js'));
    ({ ChainBuilderUI } = await import('./shapeseq/chain-ui.js'));
    ({ EventBus, getDefaultBus } = await import('./shapeseq/event-bus.js'));
  }

  const audioCtx = activeEngine?._bridge?.audioContext ?? activeEngine?._audioCtx;
  if (!audioCtx) {
    console.warn('[ShapeSeq] _ensureShapeSeqInit: no AudioContext yet — skipping');
    return;
  }

  shapeSeqBus = getDefaultBus(audioCtx);

  // activeEngine (C15Adapter) exposes noteOn/noteOff directly — use it as the c15Bridge
  shapeSeqEngine = new ShapeSeqEngine({
    audioContext: audioCtx,
    eventBus: shapeSeqBus,
    c15Bridge: activeEngine,
  });

  await shapeSeqEngine.init();
  _shapeSeqInited = true;

  // Show the ShapeSeq container
  const container = document.getElementById('shapeseq-container');
  if (container && outputMode === 'synth') {
    container.style.display = 'block';
  }

  console.log('[ShapeSeq] engine initialised');
}

/**
 * Destroy the ShapeSeq engine (e.g. on engine switch).
 */
function _destroyShapeSeq() {
  if (shapeSeqEngine) {
    shapeSeqEngine.destroy();
    shapeSeqEngine = null;
  }
  shapeSeqViz = null;
  shapeSeqChainUI = null;
  shapeSeqBus = null;
  _shapeSeqInited = false;

  const container = document.getElementById('shapeseq-container');
  if (container) container.style.display = 'none';

  console.log('[ShapeSeq] engine destroyed');
}

// ---- Engine switching (stub for meml-phg UI) ----
/**
 * Hot-swap the active synth engine.
 * Reinitialises the arpeggiator and resizes the MLP to match the new engine's
 * param count. The new engine must already be initialised (init() called).
 *
 * @param {import('./synth/engine-interface.js').SynthEngine} engine
 */
async function setActiveEngine(engine) {
  // Destroy ShapeSeq on engine switch — it holds a reference to the old engine
  if (shapeSeqEnabled && _shapeSeqInited) {
    _destroyShapeSeq();
  }

  activeEngine = engine;
  c15 = engine; // keep alias in sync
  arpeggiator.setEngine(engine);
  if (midiInput) midiInput.setEngine(engine);
  const btn = document.getElementById('synth-mode-btn');
  if (btn) btn.textContent = engine.displayName;
  const synthDockBtn = document.querySelector('[data-drawer="synth"]');
  if (synthDockBtn) synthDockBtn.title = `Synth: ${engine.displayName}`;
  EngineSwitcher.setActive(engine.id);
  EngineSwitcher.setLoading(engine.id, false);
  await resizeMLP(totalOutputCount());

  // Reload MIDI CC map for the new engine (scoped storage key)
  reloadMidiCCMap();

  // Rebuild heatmap cells — include EOC params when in shared mode
  if (eocChain?.nispsMode === 'shared') {
    const combinedMeta = [...(engine.paramMeta ?? []), ...eocChain.paramMeta];
    rebuildHeatmap(combinedMeta);
  } else {
    rebuildHeatmap(engine.paramMeta);
  }
  document.getElementById('heatmap-cells')?.parentElement
    ?.classList.toggle('shared-mode', eocChain?.nispsMode === 'shared');

  // Rewire EOC chain to the new engine's output node
  if (eocChain && _eocInited) {
    const outputNode = engine.getOutputNode();
    if (outputNode) {
      try { outputNode.disconnect(); } catch (_) { /* not yet connected */ }
      // C15Adapter exposes _bridge.audioContext; Faust engines expose _audioCtx
      const rewireCtx = engine._bridge?.audioContext ?? engine._audioCtx;
      if (rewireCtx) {
        eocChain.connect(outputNode, rewireCtx.destination);
      }
    }
  }

  // Rebuild paramToSection and SynthVisualizer for the new engine.
  // Unified path (meml-17mp): derive sections from paramMeta.group for ALL
  // engines. For C15, paramToSection keeps the static SYNTH_SECTIONS layout
  // (preserves legacy groupOverrides indexing), but nonC15Sections is now
  // populated from paramMeta so getSectionView() has a single codepath.
  if (engine.id === 'shaper-feedback') {
    restoreC15ParamToSection();
    if (engine.paramMeta?.length > 0) {
      rebuildNonC15Sections(engine.paramMeta);
    }
    // Restore C15 section map in SynthVisualizer
    if (synthVisualizer) {
      synthVisualizer.sectionMap = [];
      let idx = 0;
      for (const sec of SYNTH_SECTIONS) {
        for (let i = 0; i < sec.count; i++, idx++) {
          synthVisualizer.sectionMap.push(sec);
        }
      }
      while (synthVisualizer.sectionMap.length < N_SYNTH_OUTPUTS) {
        synthVisualizer.sectionMap.push({ name: 'Other', count: 1, color: '#666666' });
      }
      synthVisualizer.params = new Array(N_SYNTH_OUTPUTS).fill(0.5);
      synthVisualizer.displayParams = new Array(N_SYNTH_OUTPUTS).fill(0.5);
    }
  } else if (engine.paramMeta?.length > 0) {
    rebuildParamToSection(engine.paramMeta);
    rebuildNonC15Sections(engine.paramMeta);
    if (synthVisualizer) {
      synthVisualizer.rebuild(engine.paramMeta);
    }
  }

  // Build engine-specific param overrides (null for C15, flat array for Faust)
  if (engine.id === 'shaper-feedback') {
    engineParamOverrides = null;
  } else {
    buildEngineParamOverrides();
  }

  // Rebuild the preset selector for the new engine
  rebuildPresetSelector();

  // Clear active preset — it belongs to the previous engine
  activeSynthPresetId = null;

  // Sync Patch Editor preset picker to the new engine's preset list
  syncPatchEditorPresets();

  // Modular UI show/hide (Phase C). The UI is created once during init()
  // and stays in the DOM; we toggle its visibility via the dock icon.
  if (modularUI) {
    if (engine.id === 'modular') modularUI.show();
    else                         modularUI.hide();
  }
  // meml-usd6: sync Patch Bay engine binding + launcher visibility
  if (patchBay) {
    patchBay.setEngine(engine.id === 'modular' ? engine : null);
    if (engine.id !== 'modular' && patchBay.isOpen()) patchBay.close();
  }
  const pbBtn = window.__patchBayLaunchBtn;
  if (pbBtn) pbBtn.style.display = engine.id === 'modular' ? '' : 'none';

  // meml-coh8: Patch Editor follows the active engine + preset.
  if (patchEditor) {
    const engineId = engine.id ?? 'shaper-feedback';
    const presets = getPresetsForEngine(engineId);
    const curPreset = presets.find(p => p.id === activeSynthPresetId) || null;
    patchEditor.setContext({ engine, preset: curPreset });
    if (patchEditor.isOpen && patchEditor.isOpen()) patchEditor.close();
  }
}

async function resizeMLP(newOutputCount) {
  if (newOutputCount === N_OUTPUTS) return;
  _rebuilding = true;
  try {
    N_OUTPUTS = newOutputCount;

    // Extract joystick weights + dataset before destroying
    const joySnapshot = imlJoy ? imlJoy.extractWeights() : null;
    const oldJoyFeatures = imlJoy ? imlJoy.dataset.features.map(r => [...r]) : [];
    const oldJoyLabels   = imlJoy ? imlJoy.dataset.labels.map(r => [...r])   : [];
    const oldHandFeatures = imlHand ? imlHand.dataset.features.map(r => [...r]) : [];
    const oldHandLabels   = imlHand ? imlHand.dataset.labels.map(r => [...r])   : [];
    const oldOutputsForToast = imlJoy ? imlJoy.nOutputs : newOutputCount;

    // Destroy old IML instances (free WASM memory).
    // Any pending trainAsync promises get resolved as { cancelled: true }.
    if (imlJoy) imlJoy.destroy();
    if (imlHand) imlHand.destroy();

    // Joystick IML: warm-start from previous weights when possible
    if (joySnapshot) {
      imlJoy = await WasmIML.createWithWarmStart(joySnapshot, N_OUTPUTS, 1000, 1.0, 0.00001);
    } else {
      imlJoy = await WasmIML.create(N_JOY_INPUTS, N_OUTPUTS, JOY_HIDDEN_LAYERS, 1000, 1.0, 0.00001);
      imlJoy.randomiseWeights(spreadLevel);
    }
    imlJoy.setLogger(msg => console.log('[NISPS:joy]', msg));

    // Hand IML: fresh init (warm-start for 14-input networks is a future concern)
    imlHand = await WasmIML.create(N_HAND_INPUTS, N_OUTPUTS, DEFAULT_HAND_HIDDEN, 1000, 1.0, 0.00001);
    imlHand.setLogger(msg => console.log('[NISPS:hand]', msg));
    imlHand.randomiseWeights(spreadLevel);

    // Replay examples that still match the new output dim (dataset is
    // JS-side; both WasmIML.create and createWithWarmStart start with a
    // fresh Dataset(100), so we need to re-add here to preserve training
    // examples across resizes.)
    let dropped = 0;
    for (let i = 0; i < oldJoyFeatures.length; i++) {
      if (oldJoyLabels[i] && oldJoyLabels[i].length === N_OUTPUTS &&
          oldJoyFeatures[i] && oldJoyFeatures[i].length === N_JOY_INPUTS) {
        imlJoy.dataset.add(oldJoyFeatures[i], oldJoyLabels[i]);
      } else {
        dropped++;
      }
    }
    for (let i = 0; i < oldHandFeatures.length; i++) {
      if (oldHandLabels[i] && oldHandLabels[i].length === N_OUTPUTS &&
          oldHandFeatures[i] && oldHandFeatures[i].length === N_HAND_INPUTS) {
        imlHand.dataset.add(oldHandFeatures[i], oldHandLabels[i]);
      } else {
        dropped++;
      }
    }
    if (dropped > 0 && oldOutputsForToast !== N_OUTPUTS) {
      try { showToast(`${dropped} training example(s) dropped (output shape changed)`); }
      catch (_) { /* toast is best-effort */ }
    }

    iml = (inputMode === 'joystick') ? imlJoy : imlHand;

    // Reset dependent state
    rawParamValues = new Array(N_OUTPUTS).fill(0.5);
    _lastSentParams = new Float32Array(N_OUTPUTS);

    // Re-run inference
    iml.setInput(0, joyX);
    iml.setInput(1, joyY);
    iml.process();

    console.log(`[NISPS] MLP resized to ${N_OUTPUTS} outputs (joystick IML warm-started)`);
  } finally {
    _rebuilding = false;
  }
}

// ---- Init ----
async function init() {
  // Parse ?tame URL param
  const urlParams = new URLSearchParams(window.location.search);
  // tame is handled at groupOverrides init time, no longer needed here
  spreadLevel = parseFloat(urlParams.get('spread') ?? '0.6');
  if (isNaN(spreadLevel)) spreadLevel = 0.6;
  spreadLevel = Math.max(0, Math.min(1, spreadLevel));

  // Apply ?arch output-count override (if given & differs from preset default)
  if (ARCH_OUTPUTS_OVERRIDE && ARCH_OUTPUTS_OVERRIDE !== N_OUTPUTS) {
    console.log(`[NISPS] ?arch override: outputs ${N_OUTPUTS} -> ${ARCH_OUTPUTS_OVERRIDE}`);
    N_OUTPUTS = ARCH_OUTPUTS_OVERRIDE;
  }

  // Dual IML instances — joystick (2 inputs) and hand tracking (14 inputs)
  imlJoy = await WasmIML.create(N_JOY_INPUTS, N_OUTPUTS, JOY_HIDDEN_LAYERS, 1000, 1.0, 0.00001);
  imlJoy.setLogger(msg => console.log('[NISPS:joy]', msg));
  imlHand = await WasmIML.create(N_HAND_INPUTS, N_OUTPUTS, DEFAULT_HAND_HIDDEN, 1000, 1.0, 0.00001);
  imlHand.setLogger(msg => console.log('[NISPS:hand]', msg));
  iml = imlJoy; // default to joystick

  // Canvas + Visualizer
  $canvas = document.getElementById('vis-canvas');
  visualizer = new FlowFieldVisualizer($canvas);

  // Synth visualizer
  $synthVisCanvas = document.getElementById('synth-vis-canvas');
  synthVisualizer = new SynthVisualizer($synthVisCanvas);

  // Synth — use C15Adapter to satisfy the SynthEngine interface
  activeEngine = new C15Adapter();
  c15 = activeEngine; // alias: existing code that references c15 continues to work
  activeEngine.onStatusChange = msg => {
    const el = document.getElementById('synth-status');
    if (el) el.textContent = msg;
  };
  arpeggiator = new Arpeggiator(activeEngine);
  midiInput = new MIDIInput(activeEngine);
  initMIDIControls();

  // MIDI Output
  midiOutput = new MIDIOutput();
  initMIDICCControls();

  // DOM refs
  $heatmapCells = document.getElementById('heatmap-cells');
  $heatmapTooltip = document.getElementById('heatmap-tooltip');

  $joystickContainer = document.getElementById('joystick-container');
  $joyMap = document.getElementById('joy-map');
  $joyMapCtx = $joyMap.getContext('2d');
  $noiseRing = document.getElementById('noise-ring');
  $followBadge = document.getElementById('follow-badge');

  $rlButtons = document.getElementById('rl-buttons');
  $btnThumbsUp = document.getElementById('btn-thumbsup');
  $btnThumbsDown = document.getElementById('btn-thumbsdown');

  $statusText = document.getElementById('status-text');

  $lossCanvas = document.getElementById('loss-canvas');
  $lossCtx = $lossCanvas.getContext('2d');
  $engineParams = document.getElementById('engine-params');

  $followPill = document.getElementById('follow-pill');

  // Build heatmap cells (engine-aware: uses activeEngine.paramMeta for synth mode)
  rebuildHeatmap(activeEngine.paramMeta);

  // Build raw param sliders
  buildEngineParams();

  // Engine switcher — prepended above the tuning sliders in the Engine drawer
  const ENGINES = [
    {
      id: 'shaper-feedback',
      displayName: 'C15 Shaper-Feedback',
      paramCount: 126,
      description: 'Phase-aligned waveshapers with feedback mixer. Complex harmonic textures.',
    },
    {
      id: 'additive',
      displayName: 'Additive',
      paramCount: 48,
      description: 'Spectral envelope additive synthesis. 64 harmonics shaped by ML.',
    },
    {
      id: 'fm',
      displayName: 'FM Matrix',
      paramCount: 55,
      description: '4-operator FM with continuous routing matrix. Algorithm emerges from exploration.',
    },
    {
      id: 'modular',
      displayName: 'Modular',
      paramCount: 512,
      description: 'Shared mod pool (4 ADSRs + 8 LFOs) routed through a matrix into a swappable voice. Starts with a 3-osc subtractive sub-engine.',
    },
  ];
  const engineSwitcherEl = document.getElementById('synth-engine-switcher');
  if (engineSwitcherEl) {
    EngineSwitcher.init(engineSwitcherEl, ENGINES, async (engineId) => {
      if (engineId === activeEngine?.id) return;

      EngineSwitcher.setLoading(engineId, true);

      // meml-u78y: BEFORE the swap commits, save current state under the
      // outgoing {engine, presetId} key. If no preset is active, use the
      // per-engine __no_preset__ pseudo-key. Reuses the A3 payload shape.
      const prevEngineId = activeEngine?.id ?? null;
      const prevPresetKey = activeSynthPresetId || NO_PRESET_KEY;
      if (prevEngineId && sessionWorthSaving()) {
        try {
          saveSessionMem(prevEngineId, prevPresetKey, capturePresetSession());
          clearSessionDirty();
        } catch (e) {
          console.warn('[NISPS] engine-switch session save (outgoing) failed:', e);
        }
      }

      try {
        let newEngine;
        if (engineId === 'shaper-feedback') {
          // Switch back to C15 — reuse the existing instance
          newEngine = c15 instanceof C15Adapter ? c15 : new C15Adapter();
        } else if (engineId === 'additive') {
          newEngine = new AdditiveEngine();
        } else if (engineId === 'fm') {
          newEngine = new FMEngine();
        } else if (engineId === 'modular') {
          newEngine = new ModularEngine();
          // When the modular engine's paramMeta changes (sub-engine swap or
          // expose/unexpose toggles from Phase C UI), resize the MLP and
          // rebuild downstream state that depends on paramCount.
          newEngine.on('paramMeta:change', async () => {
            if (activeEngine !== newEngine) return;
            // Structural change: the {engine, presetId} session key's paramCount
            // no longer matches the saved payload. Invalidate rather than risk
            // a stale restore on next preset re-apply.
            try {
              const eid = newEngine.id;
              const pid = activeSynthPresetId;
              if (eid && pid) clearSessionMem(eid, pid);
            } catch (_) { /* best-effort */ }
            await resizeMLP(totalOutputCount());
            if (eocChain?.nispsMode === 'shared') {
              const combinedMeta = [...(newEngine.paramMeta ?? []), ...eocChain.paramMeta];
              rebuildHeatmap(combinedMeta);
            } else {
              rebuildHeatmap(newEngine.paramMeta);
            }
            if (newEngine.paramMeta?.length > 0) {
              rebuildParamToSection(newEngine.paramMeta);
              rebuildNonC15Sections(newEngine.paramMeta);
              if (synthVisualizer) synthVisualizer.rebuild(newEngine.paramMeta);
            }
            buildEngineParamOverrides();
          });
        } else {
          showToast(`Unknown engine: ${engineId}`);
          return;
        }

        if (newEngine !== activeEngine) {
          // Stop arpeggiator/ShapeSeq before switching
          if (shapeSeqEnabled && shapeSeqEngine) shapeSeqEngine.stop();
          if (arpeggiator) arpeggiator.stop();

          // Ensure paramMeta is available even if audio isn't started yet.
          // This prevents MLP resizing to 0 outputs for Faust engines.
          if (newEngine.loadParamMeta) {
            await newEngine.loadParamMeta();
          }

          // If audio is already running, init the new engine now
          const audioCtxForInit = activeEngine?._audioCtx
            ?? activeEngine?._bridge?.audioContext
            ?? null;
          if (audioCtxForInit && !newEngine._running) {
            await newEngine.init(audioCtxForInit);
          }

          // Phase E — apply any pending modular DSP snapshot from loadState().
          // Runs BEFORE setActiveEngine so paramMeta is correct when the MLP
          // resizes below. Note: Phase C's UI state (counts, sub-engine,
          // exposed params, enables) is applied separately by modular-ui.js
          // on its first refresh(); that runs AFTER setActiveEngine via
          // modularUI.show(), so the load ordering is:
          //   1. setState() here — restores raw DSP values + sub-engine
          //   2. modular-ui refresh() — replays Phase C's UI state
          // Step 2 may call setModSourceCount() which re-emits
          // paramMeta:change; that's fine since the raw values are already
          // in _lastRawByLabel.
          if (engineId === 'modular' && _pendingModularDspState &&
              typeof newEngine.setState === 'function') {
            try {
              await newEngine.setState(_pendingModularDspState);
            } catch (err) {
              console.warn('[NISPS] modular setState on engine switch failed:', err);
            }
            _pendingModularDspState = null;
          }

          await setActiveEngine(newEngine);

          // meml-u78y: AFTER the new engine is ready, check for a prior
          // session saved under {newEngine, __no_preset__}. We key by
          // __no_preset__ because setActiveEngine() clears activeSynthPresetId;
          // any prior preset-scoped restore will fire later via applyPreset().
          try {
            const saved = loadSessionMem(engineId, NO_PRESET_KEY);
            if (saved && saved.payload) {
              const exampleCount = (saved.payload.joy?.features?.length ?? 0)
                                 + (saved.payload.hand?.features?.length ?? 0);
              const choice = await showRestoreModal({
                presetName: `${newEngine.displayName} (no preset)`,
                timestamp: saved.timestamp,
                exampleCount,
              });
              if (choice === 'restore') {
                restorePresetSession(saved.payload);
                saveState();
                console.log(`[NISPS] Restored prior no-preset session for engine ${engineId}`);
              } else if (choice === 'fresh') {
                freshPresetSession();
                saveState();
                console.log(`[NISPS] Started fresh no-preset session for engine ${engineId}`);
              }
              // 'cancel' → leave state as-is (default engine init).
            }
          } catch (e) {
            console.warn('[NISPS] engine-switch restore check failed:', e);
          }
        }
      } catch (err) {
        console.error('[EngineSwitcher] Failed to switch engine:', err);
        showToast(`Failed to load ${engineId}: ${err.message}`);
      } finally {
        EngineSwitcher.setLoading(engineId, false);
      }
    }, {
      hasTrainingData: () => (imlJoy?.exampleCount ?? 0) > 0 || (imlHand?.exampleCount ?? 0) > 0,
    });
    EngineSwitcher.setActive(activeEngine.id);
    const engineDockBtn = document.querySelector('[data-drawer="params"]');
    if (engineDockBtn) engineDockBtn.title = `Engine: ${activeEngine.displayName}`;
  }

  // Wire events
  wireJoystick();
  wireDock();

  // Phase C: Modular UI. Mount once here (after dock + drawer-stack exist).
  // The UI is hidden until the modular engine becomes active.
  try {
    modularUI = initModularUI({
      getEngine: () => activeEngine,
      // Phase E: when modular UI mutates its state (preset applied,
      // enables toggled, etc.) trigger the top-level save so the DSP
      // snapshot is re-persisted alongside Phase C's UI-state key.
      onStateChange: () => saveState(),
    });
    if (activeEngine?.id === 'modular') modularUI.show();
  } catch (err) {
    console.error('[NISPS] Failed to init modular UI:', err);
  }

  // meml-coh8: helper — resolve currently-active preset for the active engine.
  const _currentPreset = () => {
    const engineId = activeEngine?.id ?? 'shaper-feedback';
    const presets = getPresetsForEngine(engineId);
    return presets.find(p => p.id === activeSynthPresetId) || null;
  };

  // meml-usd6: Patch Bay modal — full-viewport 48×10 matrix editor.
  // meml-coh8: entry point is the matrix-icon button in the groups bar
  // (#patch-bay-gear) + the `M` keyboard shortcut.
  try {
    patchBay = createPatchBay({
      engine: activeEngine?.id === 'modular' ? activeEngine : null,
      preset: _currentPreset(),
      onChange: () => { markSessionDirty(); saveState(); },
    });
    const pbGear = document.getElementById('patch-bay-gear');
    if (pbGear) {
      pbGear.addEventListener('click', () => {
        if (!patchBay) return;
        patchBay.setEngine(activeEngine?.id === 'modular' ? activeEngine : null);
        patchBay.open();
      });
      pbGear.style.display = activeEngine?.id === 'modular' ? '' : 'none';
    }
    window.__patchBayLaunchBtn = pbGear || null;
  } catch (err) {
    console.error('[NISPS] Failed to init Patch Bay:', err);
  }

  // meml-n3uh: Patch Editor modal — card-per-group three-column editor
  // (Sound | Modulation | Routing). meml-coh8: gear icon + `E` shortcut.
  try {
    patchEditor = createPatchEditor({
      engine: activeEngine,
      preset: _currentPreset(),
      sectionView: (si) => getSectionView(si),
      sectionCount: () => {
        const engineId = activeEngine?.id ?? 'shaper-feedback';
        if (engineId === 'shaper-feedback') return SYNTH_SECTIONS.length;
        return nonC15Sections.length;
      },
      onChange: () => {
        try { routeOutputs(iml.getOutputs()); } catch (e) { /* non-fatal */ }
        markSessionDirty();
        saveState();
      },
      onLoadPreset: async (presetId) => {
        const engineId = activeEngine?.id ?? 'shaper-feedback';
        try {
          if (engineId === 'modular') {
            const p = findModularPreset(presetId);
            if (p) await applyModularPreset(activeEngine, p);
            activeSynthPresetId = presetId;
            saveState();
          } else {
            await applyPreset(presetId);
          }
        } catch (e) {
          console.warn('[NISPS] preset load via picker failed:', e);
        }
        // Refresh picker to highlight new active preset + sync dropdown
        syncPatchEditorPresets();
        const $ps = document.getElementById('synth-preset-select');
        if ($ps) $ps.value = presetId;
        if (patchEditor?.isOpen()) patchEditor.refresh();
      },
    });
    // Populate picker now that editor exists
    syncPatchEditorPresets();
    const peGear = document.getElementById('patch-editor-gear');
    if (peGear) {
      peGear.addEventListener('click', () => {
        if (!patchEditor) return;
        patchEditor.setContext({
          engine: activeEngine,
          preset: _currentPreset(),
          sectionView: (si) => getSectionView(si),
          sectionCount: () => {
            const engineId = activeEngine?.id ?? 'shaper-feedback';
            if (engineId === 'shaper-feedback') return SYNTH_SECTIONS.length;
            return nonC15Sections.length;
          },
        });
        patchEditor.open();
      });
    }
    window.__patchEditorLaunchBtn = peGear || null;
  } catch (err) {
    console.error('[NISPS] Failed to init Patch Editor:', err);
  }

  wireControls();
  wireSynthControls();
  wireGamepad();
  wireKeyboard();
  wireInputToggle();
  createDevPanel(() => handTracker);
  wireQuickPlayControls();
  wireGroupDrawer();
  wireParamPopup();
  wireHelp();

  // Resize
  window.addEventListener('resize', onResize);
  onResize();

  // Restore saved state (if any)
  await loadState();

  // Wire synth preset selector
  wireSynthPresets();

  // Check URL ?preset param (overrides localStorage) — search all engines
  const urlPreset = urlParams.get('preset');
  const allPresets = [...SYNTH_PRESETS, ...ADDITIVE_PRESETS, ...FM_PRESETS, ...MODULAR_PRESETS];
  if (urlPreset && allPresets.some(p => p.id === urlPreset)) {
    applyPreset(urlPreset);
  } else if (activeSynthPresetId) {
    // Restored from localStorage — sync the dropdown
    const $ps = document.getElementById('synth-preset-select');
    if ($ps) $ps.value = activeSynthPresetId;
  }

  // Initial inference
  iml.setInput(0, joyX);
  iml.setInput(1, joyY);
  iml.process();
  routeOutputs(iml.getOutputs());
  updateHeatmap(iml.getOutputs());
  updateStatus();
  drawJoyMap();
  drawLossPlot();

  // Auto-save every 10 seconds
  setInterval(saveState, 10000);

  // EOC Effects Chain — initialise chain and wire drawer UI
  eocChain = new EOCChain();
  const eocDrawerBody = document.getElementById('eoc-drawer-body');
  if (eocDrawerBody) {
    EOCChainUI.init(eocChain, eocDrawerBody);
  }

  // EOC Independent mode joystick
  const eocJoyCanvas = document.getElementById('eoc-joy-map');
  if (eocJoyCanvas) {
    eocJoystick = new EOCJoystick(eocJoyCanvas);
    eocJoystick.onChange = (x, y) => {
      if (!imlEoc || eocChain?.nispsMode !== 'independent') return;
      imlEoc.setInput(0, x);
      imlEoc.setInput(1, y);
      imlEoc.process();
      const eocOutputs = imlEoc.getOutputs();
      for (let i = 0; i < eocOutputs.length; i++) {
        eocChain.setParam(i, eocOutputs[i]);
      }
    };
  }

  // Handle EOC structural changes — Shared mode resizes MLP; Linked mode manages second IML
  window.addEventListener('eoc:change', async (e) => {
    const reason = e.detail?.reason;
    console.log('[EOC] chain changed, reason:', reason, 'paramCount:', eocChain.paramCount, 'nispsMode:', eocChain.nispsMode);

    if (reason === 'nispsMode-changed') {
      // Linked/Independent mode lifecycle — both need a second IML
      if (eocChain.nispsMode === 'linked' || eocChain.nispsMode === 'independent') {
        await initEocIML();
      } else {
        destroyEocIML();
        eocTrainingTarget = 'synth';
      }
      // Show/hide EOC joystick (only visible in independent mode)
      const eocJoyContainer = document.getElementById('eoc-joy-container');
      if (eocJoyContainer) {
        eocJoyContainer.classList.toggle('hidden', eocChain.nispsMode !== 'independent');
      }
    }

    // Shared mode: resize MLP and rebuild heatmap on mode switch or module change
    if (reason === 'nispsMode-changed' || reason?.startsWith('module')) {
      const newTotal = totalOutputCount();
      if (newTotal !== N_OUTPUTS) {
        await resizeMLP(newTotal);
      }
      if (eocChain.nispsMode === 'shared') {
        const combinedMeta = [
          ...(activeEngine?.paramMeta ?? []),
          ...eocChain.paramMeta,
        ];
        rebuildHeatmap(combinedMeta);
      } else {
        rebuildHeatmap(activeEngine?.paramMeta ?? []);
      }
      document.getElementById('heatmap-cells')?.parentElement
        ?.classList.toggle('shared-mode', eocChain.nispsMode === 'shared');

      // Linked/Independent mode: recreate EOC IML when modules change
      if ((eocChain.nispsMode === 'linked' || eocChain.nispsMode === 'independent') && imlEoc) {
        await initEocIML();
      }
    }

    // Show/hide EOC RL buttons and Synth label based on linked mode
    const isLinked = eocChain.nispsMode === 'linked';
    const eocRlContainer = document.getElementById('eoc-rl-buttons');
    if (eocRlContainer) eocRlContainer.classList.toggle('hidden', !isLinked);
    const rlLabel = document.getElementById('rl-label');
    if (rlLabel) rlLabel.classList.toggle('hidden', !isLinked);
  });

  // Debug probe — exposed on window when ?debug=1 is in the URL.
  // Used by Playwright e2e tests. Zero footprint in production.
  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__nisps = {
      get iml()    { return iml; },
      get imlJoy() { return imlJoy; },
      get imlHand(){ return imlHand; },
      getOutputs:      () => [...iml.getOutputs()],
      getLoss:         () => iml.lastLoss,
      getWeights:      () => iml._getFlatWeights(),
      getExampleCount: () => iml.exampleCount,
      setInputs: (x, y) => {
        iml.setInput(0, x);
        iml.setInput(1, y);
        iml.process();
        const outputs = iml.getOutputs();
        routeOutputs(outputs);
        updateHeatmap(outputs);
      },
      thumbsUp:   () => onThumbsUp(),
      thumbsDown: () => onThumbsDown(),
      train: () => {
        const loss = trainModel();
        const outputs = iml.getOutputs();
        routeOutputs(outputs);
        updateHeatmap(outputs);
        syncRawParamsFromOutputs(outputs);
        updateStatus();
        drawLossPlot();
        return loss;
      },
      trainAsync: () => new Promise(resolve => trainModelAsync(resolve)),
      randomise:  () => {
        iml.randomiseWeights(spreadLevel);
        const outputs = iml.getOutputs();
        routeOutputs(outputs);
        updateHeatmap(outputs);
        syncRawParamsFromOutputs(outputs);
        updateStatus();
      },
      clearExamples: () => {
        iml.clearDataset();
        updateStatus();
      },
      saveState: () => saveState(),
      evalLoss:     () => iml.evalLoss(),
      inferBatch:   (points) => iml.inferBatch(points),
      getLayerStats:() => iml.getLayerStats(),
      /**
       * Rebuild the active IML's MLP with a new architecture.
       * Pass full layer spec including inputs+bias and outputs, e.g.
       *   __nisps.rebuildArch([3, 64, 64, 126])
       * Weights are discarded. Dataset examples with mismatched dims are dropped.
       */
      rebuildArch: (newLayers) => {
        iml.rebuild(newLayers);
        iml.randomiseWeights(spreadLevel);
        // Keep module-level N_OUTPUTS in sync so downstream routing stays correct
        const outs = newLayers[newLayers.length - 1];
        if (outs !== N_OUTPUTS) {
          N_OUTPUTS = outs;
          rawParamValues = new Array(N_OUTPUTS).fill(0.5);
          _lastSentParams = new Float32Array(N_OUTPUTS);
        }
        const outputs = iml.getOutputs();
        routeOutputs(outputs);
        updateHeatmap(outputs);
        syncRawParamsFromOutputs(outputs);
        updateStatus();
        return [...iml.layerSizes];
      },
      /** Returns the active IML's current layer shape. */
      getArch: () => [...iml.layerSizes],
      eocChain,
      // ---- Phase E — modular engine hooks ----
      get activeEngine() { return activeEngine; },
      get activeEngineId() { return activeEngine?.id ?? null; },
      get paramCount() { return activeEngine?.paramCount ?? 0; },
      /** Returns the modular engine's full DSP snapshot, or null if not active. */
      getModularState: () => {
        if (activeEngine?.id !== 'modular' ||
            typeof activeEngine.getState !== 'function') return null;
        return activeEngine.getState();
      },
      /** Restores a modular DSP snapshot. Returns a Promise. */
      setModularState: async (s) => {
        if (activeEngine?.id !== 'modular' ||
            typeof activeEngine.setState !== 'function') return false;
        await activeEngine.setState(s);
        return true;
      },
      /** Swap the active sub-engine (subtractive/additive/fm). */
      setModularSubEngine: async (id) => {
        if (activeEngine?.id !== 'modular' ||
            typeof activeEngine.setSubEngine !== 'function') return false;
        await activeEngine.setSubEngine(id);
        return true;
      },
      /** Apply a named modular preset. Returns a Promise<boolean>. */
      applyModularPreset: async (presetId) => {
        if (activeEngine?.id !== 'modular') return false;
        const p = findModularPreset(presetId);
        if (!p) return false;
        await applyModularPreset(activeEngine, p);
        return true;
      },
      /** Change modular ADSR/LFO counts. */
      setModularSourceCount: (adsr, lfo) => {
        if (activeEngine?.id !== 'modular' ||
            typeof activeEngine.setModSourceCount !== 'function') return false;
        activeEngine.setModSourceCount(adsr, lfo);
        return true;
      },
      /** List of known modular preset ids. */
      listModularPresets: () => MODULAR_PRESETS.map(p => ({ id: p.id, name: p.name })),
      /** Returns the currently-applied preset for the active engine, or null. */
      getCurrentPreset: () => {
        const engineId = activeEngine?.id ?? 'shaper-feedback';
        const presets = getPresetsForEngine(engineId);
        return presets.find(p => p.id === activeSynthPresetId) || null;
      },
      /** Returns the currently-applied preset id, or null. */
      getCurrentPresetId: () => activeSynthPresetId,
      /**
       * Apply a preset by id for the current engine. Returns Promise.
       * Triggers the per-preset session memory restore flow.
       */
      applyPresetById: async (presetId) => {
        const engineId = activeEngine?.id ?? 'shaper-feedback';
        const presets = getPresetsForEngine(engineId);
        const p = presets.find(pr => pr.id === presetId);
        if (!p) return false;
        await applyPreset(presetId);
        return true;
      },
      /**
       * Manually trigger a per-preset session-memory save for the active
       * engine + preset. Returns true on success. Useful in tests to
       * exercise the session-memory path without driving the modal DOM.
       */
      saveSessionMem: () => {
        const engineId = activeEngine?.id ?? 'shaper-feedback';
        const presetId = activeSynthPresetId;
        if (!engineId || !presetId) return false;
        return saveSessionMem(engineId, presetId, capturePresetSession());
      },
      /**
       * Return the raw session-memory payload for {engine, presetId}, or
       * null if absent. Test introspection hook.
       */
      loadSessionMem: (engineId, presetId) => {
        const eid = engineId ?? (activeEngine?.id ?? 'shaper-feedback');
        const pid = presetId ?? activeSynthPresetId;
        if (!eid || !pid) return null;
        return loadSessionMem(eid, pid);
      },
    };
  }

  // EOC Linked-mode probe — exposed unconditionally so the training-target UI
  // (meml-0r0) can wire buttons without requiring ?debug=1.
  window.__nispsEoc = {
    get trainingTarget() { return eocTrainingTarget; },
    setTrainingTarget(t) { eocTrainingTarget = t; },
    get imlEoc() { return imlEoc; },
  };

  // Start animation
  requestAnimationFrame(animate);
}

// ---- Heatmap helpers ----

/**
 * Derive a stable HSL color string from a group name.
 * Uses a simple djb2-style hash to map any group string to a consistent hue.
 */
function _colorFromGroup(group) {
  let hash = 5381;
  for (let i = 0; i < group.length; i++) {
    hash = ((hash << 5) + hash) + group.charCodeAt(i);
    hash |= 0; // force 32-bit int
  }
  const hue = ((hash >>> 0) % 360);
  return `hsl(${hue}, 70%, 55%)`;
}

/**
 * Rebuild heatmap cells (and reset per-param state arrays) from a paramMeta array.
 * Call this when the active engine switches to update the heatmap for the new param layout.
 * @param {Array<{id:string, name:string, group:string}>} paramMeta
 */
function rebuildHeatmap(paramMeta) {
  // Resize state arrays to match the new engine's param count
  rawParamValues = new Array(paramMeta.length).fill(0.5);
  _lastSentParams = new Float32Array(paramMeta.length);
  buildHeatmap();
}

// ---- Heatmap (bar chart style) ----
function buildHeatmap() {
  $heatmapCells.innerHTML = '';
  const isSynth = outputMode === 'synth';
  const isMidiCC = outputMode === 'midi-cc';
  const isAudioCanvas = outputMode === 'audio-canvas';

  // For synth mode, derive names and colors from the active engine's paramMeta.
  // For all other modes, use the static arrays as before.
  let count, names, colors;
  if (isSynth && activeEngine?.paramMeta) {
    const meta = activeEngine.paramMeta;
    count = meta.length;
    // C15 has curated per-param colors from SYNTH_PARAM_COLORS; other engines derive from group.
    const useCuratedColors = activeEngine.id === 'shaper-feedback' && SYNTH_PARAM_COLORS.length === meta.length;
    names = meta.map(p => p.name);
    colors = useCuratedColors ? SYNTH_PARAM_COLORS : meta.map(p => _colorFromGroup(p.group));
  } else {
    if (isAudioCanvas && audioCanvas) {
      count = audioCanvas.getOutputCount();
      names = audioCanvas.getAudioParamNames();
      colors = audioCanvas.getAudioParamColors();
      _ensureAudioCanvasOverrides(count);
    } else if (isMidiCC) {
      count = midiCCMap.length;
      names = midiCCMap.map(p => p.name);
      colors = MIDI_CC_PARAM_COLORS;
    } else {
      count = N_VISUAL_OUTPUTS;
      names = VISUAL_PARAM_NAMES;
      colors = VISUAL_PARAM_COLORS;
    }
  }

  for (let i = 0; i < count; i++) {
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    cell.dataset.index = i;

    const bar = document.createElement('div');
    bar.className = 'heatmap-cell-bar';
    bar.style.background = colors[i];
    bar.style.width = '30%'; // default
    bar.style.height = '100%';
    cell.appendChild(bar);

    // Tooltip on hover (quick info) + click to open popup
    cell.addEventListener('pointerenter', (e) => {
      if (cell._dragging) return;
      const outputs = iml.getOutputs();
      $heatmapTooltip.textContent = `${names[i]}: ${outputs[i].toFixed(3)}  ▾`;
      $heatmapTooltip.classList.add('visible');
      const rect = cell.getBoundingClientRect();
      $heatmapTooltip.style.left = `${rect.left}px`;
    });
    cell.addEventListener('pointerleave', () => {
      if (!cell._dragging) $heatmapTooltip.classList.remove('visible');
      // Delay hide popup so user can move to it
      if (activePopupParam === i) {
        popupHideTimer = setTimeout(() => hideParamPopup(), 300);
      }
    });

    // Click opens popup; drag sets parameter value
    cell.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cell._downX = e.clientX;
      cell._downY = e.clientY;
      cell._didDrag = false;
      cell._dragging = true;
      cell.classList.add('dragging');
      cell.setPointerCapture(e.pointerId);
    });
    cell.addEventListener('pointermove', (e) => {
      if (!cell._dragging) return;
      const dx = Math.abs(e.clientX - cell._downX);
      const dy = Math.abs(e.clientY - cell._downY);
      if (dx > 3 || dy > 3) cell._didDrag = true;
      if (cell._didDrag) setHeatmapValue(i, e, cell);
    });
    cell.addEventListener('pointerup', () => {
      cell._dragging = false;
      cell.classList.remove('dragging');
      if (!cell._didDrag) {
        // Click — toggle popup
        clearTimeout(popupHideTimer);
        if (activePopupParam === i) {
          hideParamPopup();
        } else {
          showParamPopup(i, cell);
        }
      }
    });
    cell.addEventListener('pointercancel', () => {
      cell._dragging = false;
      cell.classList.remove('dragging');
    });

    $heatmapCells.appendChild(cell);
  }
}

function setHeatmapValue(paramIndex, e, cell) {
  const rect = cell.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  // If frozen, dragging updates the fixed value directly
  const ov = getParamOverride(paramIndex);
  if (ov && ov.frozen) {
    ov.fixedValue = x;
  }
  rawParamValues[paramIndex] = x;
  routeOutputs(rawParamValues);
  updateHeatmap(rawParamValues);
  syncRawParamsFromOutputs(rawParamValues);
  // Update tooltip
  const isSynth = outputMode === 'synth';
  const isMidiCC = outputMode === 'midi-cc';
  const isAudioCanvas = outputMode === 'audio-canvas';
  let paramName;
  if (isSynth && activeEngine?.paramMeta?.[paramIndex]) {
    paramName = activeEngine.paramMeta[paramIndex].name;
  } else if (isMidiCC) {
    paramName = midiCCMap[paramIndex]?.name ?? `p${paramIndex}`;
  } else if (isAudioCanvas && audioCanvas) {
    const acNames = audioCanvas.getAudioParamNames();
    paramName = acNames[paramIndex] ?? `p${paramIndex}`;
  } else {
    paramName = VISUAL_PARAM_NAMES[paramIndex] ?? `p${paramIndex}`;
  }
  $heatmapTooltip.textContent = `${paramName}: ${x.toFixed(3)}`;
  $heatmapTooltip.classList.add('visible');
  $heatmapTooltip.style.left = `${rect.left}px`;
}

function updateHeatmap(outputs) {
  const cells = $heatmapCells.children;
  for (let i = 0; i < cells.length && i < outputs.length; i++) {
    const bar = cells[i].querySelector('.heatmap-cell-bar');
    if (bar) {
      const pct = Math.max(2, Math.round(outputs[i] * 100));
      bar.style.width = pct + '%';
    }
    // Dim frozen/muted cells
    const ov = getParamOverride(i);
    if (ov) {
      cells[i].classList.toggle('heatmap-cell-frozen', !!ov.frozen);
    }
  }
}

/** Get the override object for a heatmap param (works in both visual & synth mode) */
function getParamOverride(paramIndex) {
  if (outputMode === 'synth') {
    // Non-C15 engines use the flat engineParamOverrides array
    if (engineParamOverrides && paramIndex < engineParamOverrides.length) {
      const p = engineParamOverrides[paramIndex];
      return {
        get min() { return p.min; }, set min(v) { p.min = v; },
        get max() { return p.max; }, set max(v) { p.max = v; },
        get curve() { return p.curve; }, set curve(v) { p.curve = v; },
        get frozen() { return p.muted; }, set frozen(v) { p.muted = v; },
        get fixedValue() { return p.fixedValue; }, set fixedValue(v) { p.fixedValue = v; },
      };
    }
    // C15 path: use groupOverrides + paramToSection
    const mapping = paramToSection[paramIndex];
    if (!mapping) return null;
    const group = groupOverrides[mapping.si];
    if (!group) return null;
    const p = group.params[mapping.li];
    if (!p) return null;
    // Expose as { min, max, curve, frozen, fixedValue } — map 'muted' to 'frozen'
    return {
      get min() { return p.min; }, set min(v) { p.min = v; },
      get max() { return p.max; }, set max(v) { p.max = v; },
      get curve() { return p.curve; }, set curve(v) { p.curve = v; },
      get frozen() { return p.muted; }, set frozen(v) { p.muted = v; },
      get fixedValue() { return p.fixedValue; }, set fixedValue(v) { p.fixedValue = v; },
    };
  } else if (outputMode === 'midi-cc') {
    return midiCCOverrides[paramIndex] || null;
  } else if (outputMode === 'audio-canvas') {
    return audioCanvasOverrides[paramIndex] || null;
  } else {
    return visualOverrides[paramIndex] || null;
  }
}

// ---- Param Popup (hover menu on heatmap cells) ----
function wireParamPopup() {
  $paramPopup = document.createElement('div');
  $paramPopup.className = 'param-popup';
  $paramPopup.innerHTML = '<div class="pp-header"></div><div class="pp-body"></div>';
  document.body.appendChild($paramPopup);

  $paramPopup.addEventListener('pointerenter', () => {
    clearTimeout(popupHideTimer);
  });
  $paramPopup.addEventListener('pointerleave', () => {
    popupHideTimer = setTimeout(() => hideParamPopup(), 300);
  });
}

function showParamPopup(paramIndex, cell) {
  if (activePopupParam === paramIndex) return;
  activePopupParam = paramIndex;

  const isSynth = outputMode === 'synth';
  const isMidiCC = outputMode === 'midi-cc';
  const isAudioCanvas = outputMode === 'audio-canvas';
  let name, color;
  if (isSynth && activeEngine?.paramMeta?.[paramIndex]) {
    const pm = activeEngine.paramMeta[paramIndex];
    name = pm.name;
    // Use curated C15 colors when available, else derive from group.
    const useCuratedColors = activeEngine.id === 'shaper-feedback' && SYNTH_PARAM_COLORS.length > paramIndex;
    color = useCuratedColors ? SYNTH_PARAM_COLORS[paramIndex] : _colorFromGroup(pm.group);
  } else if (isMidiCC) {
    name = midiCCMap[paramIndex]?.name ?? `p${paramIndex}`;
    color = MIDI_CC_PARAM_COLORS[paramIndex] ?? '#888';
  } else if (isAudioCanvas && audioCanvas) {
    const acNames = audioCanvas.getAudioParamNames();
    const acColors = audioCanvas.getAudioParamColors();
    name = acNames[paramIndex] ?? `p${paramIndex}`;
    color = acColors[paramIndex] ?? '#888';
  } else {
    name = VISUAL_PARAM_NAMES[paramIndex] ?? `p${paramIndex}`;
    color = VISUAL_PARAM_COLORS[paramIndex] ?? '#888';
  }
  const ov = getParamOverride(paramIndex);
  if (!ov) return;

  const header = $paramPopup.querySelector('.pp-header');
  header.textContent = name;
  header.style.color = color;

  const body = $paramPopup.querySelector('.pp-body');
  body.innerHTML = '';

  // -- MIDI CC specific: name, CC#, channel editors --
  if (isMidiCC) {
    const ccParam = midiCCMap[paramIndex];
    // Editable name
    const nameRow = document.createElement('div');
    nameRow.className = 'pp-row';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'pp-label';
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = ccParam.name;
    nameInput.className = 'pp-text-input';
    nameInput.addEventListener('change', () => {
      ccParam.name = nameInput.value;
      header.textContent = nameInput.value;
      buildHeatmap();
      updateHeatmap(iml.getOutputs());
      saveCCMap(midiCCMap, midiCCStorageKey());
    });
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(nameInput);
    body.appendChild(nameRow);

    // CC number
    const ccRow = document.createElement('div');
    ccRow.className = 'pp-row';
    const ccLabel = document.createElement('span');
    ccLabel.className = 'pp-label';
    ccLabel.textContent = 'CC#';
    const ccInput = document.createElement('input');
    ccInput.type = 'number';
    ccInput.min = '0';
    ccInput.max = '127';
    ccInput.value = ccParam.cc;
    ccInput.className = 'pp-num-input';
    ccInput.addEventListener('change', () => {
      ccParam.cc = parseInt(ccInput.value) || 0;
      // Auto-name if name matches old CC name
      if (CC_NAMES[ccParam.cc]) {
        ccParam.name = CC_NAMES[ccParam.cc];
        nameInput.value = ccParam.name;
        header.textContent = ccParam.name;
        buildHeatmap();
        updateHeatmap(iml.getOutputs());
      }
      saveCCMap(midiCCMap, midiCCStorageKey());
    });
    ccRow.appendChild(ccLabel);
    ccRow.appendChild(ccInput);
    body.appendChild(ccRow);

    // Channel
    const chRow = document.createElement('div');
    chRow.className = 'pp-row';
    const chLabel = document.createElement('span');
    chLabel.className = 'pp-label';
    chLabel.textContent = 'Ch';
    const chInput = document.createElement('input');
    chInput.type = 'number';
    chInput.min = '1';
    chInput.max = '16';
    chInput.value = ccParam.channel;
    chInput.className = 'pp-num-input';
    chInput.addEventListener('change', () => {
      ccParam.channel = Math.max(1, Math.min(16, parseInt(chInput.value) || 1));
      chInput.value = ccParam.channel;
      saveCCMap(midiCCMap, midiCCStorageKey());
    });
    chRow.appendChild(chLabel);
    chRow.appendChild(chInput);
    body.appendChild(chRow);
  }

  // -- Curve row --
  const curveRow = document.createElement('div');
  curveRow.className = 'pp-row';

  const curveLabel = document.createElement('span');
  curveLabel.className = 'pp-label';
  curveLabel.textContent = 'Curve';

  const curveCanvas = document.createElement('canvas');
  curveCanvas.className = 'pp-curve-canvas';
  curveCanvas.width = 36;
  curveCanvas.height = 36;

  const curveVal = document.createElement('span');
  curveVal.className = 'pp-val';
  curveVal.textContent = ov.curve.toFixed(2);

  function redrawCurve() {
    _drawCurveOnCanvas(curveCanvas, ov.curve, color);
  }

  _wireCurveDrag(curveCanvas, () => ov.curve, (v) => {
    ov.curve = v;
    curveVal.textContent = v.toFixed(2);
    redrawCurve();
    routeOutputs(iml.getOutputs());
  });
  redrawCurve();

  curveRow.appendChild(curveLabel);
  curveRow.appendChild(curveCanvas);
  curveRow.appendChild(curveVal);
  body.appendChild(curveRow);

  // -- Min/Max row --
  const rangeRow = document.createElement('div');
  rangeRow.className = 'pp-row';

  const rangeLabel = document.createElement('span');
  rangeLabel.className = 'pp-label';
  rangeLabel.textContent = 'Range';

  const rangeWrap = document.createElement('div');
  rangeWrap.className = 'pp-range-wrap';

  const rangeFill = document.createElement('div');
  rangeFill.className = 'gd-range-fill';

  const minSlider = document.createElement('input');
  minSlider.type = 'range'; minSlider.min = '0'; minSlider.max = '1'; minSlider.step = '0.01';
  minSlider.value = ov.min;
  minSlider.className = 'gd-range-input gd-range-min';

  const maxSlider = document.createElement('input');
  maxSlider.type = 'range'; maxSlider.min = '0'; maxSlider.max = '1'; maxSlider.step = '0.01';
  maxSlider.value = ov.max;
  maxSlider.className = 'gd-range-input gd-range-max';

  const rangeValSpan = document.createElement('span');
  rangeValSpan.className = 'pp-val';

  function updateRangeFill() {
    rangeFill.style.left = `${ov.min * 100}%`;
    rangeFill.style.width = `${(ov.max - ov.min) * 100}%`;
    rangeValSpan.textContent = `${ov.min.toFixed(2)}–${ov.max.toFixed(2)}`;
  }
  updateRangeFill();

  minSlider.addEventListener('input', () => {
    ov.min = parseFloat(minSlider.value);
    if (ov.min > ov.max) { ov.max = ov.min; maxSlider.value = ov.max; }
    updateRangeFill();
    routeOutputs(iml.getOutputs());
  });
  maxSlider.addEventListener('input', () => {
    ov.max = parseFloat(maxSlider.value);
    if (ov.max < ov.min) { ov.min = ov.max; minSlider.value = ov.min; }
    updateRangeFill();
    routeOutputs(iml.getOutputs());
  });

  rangeWrap.appendChild(rangeFill);
  rangeWrap.appendChild(minSlider);
  rangeWrap.appendChild(maxSlider);

  rangeRow.appendChild(rangeLabel);
  rangeRow.appendChild(rangeWrap);
  rangeRow.appendChild(rangeValSpan);
  body.appendChild(rangeRow);

  // -- Freeze row --
  const freezeRow = document.createElement('div');
  freezeRow.className = 'pp-row pp-freeze-row';

  const freezeBtn = document.createElement('button');
  freezeBtn.className = 'pp-freeze-btn' + (ov.frozen ? ' frozen' : '');
  freezeBtn.textContent = ov.frozen ? 'Frozen' : 'Freeze';
  freezeBtn.title = ov.frozen ? 'Unfreeze — re-enable NISPS control' : 'Freeze — lock value, disable NISPS';

  const valSlider = document.createElement('input');
  valSlider.type = 'range'; valSlider.min = '0'; valSlider.max = '1'; valSlider.step = '0.01';
  valSlider.value = ov.fixedValue;
  valSlider.className = 'pp-val-slider';
  if (!ov.frozen) valSlider.style.display = 'none';

  const valDisplay = document.createElement('span');
  valDisplay.className = 'pp-val';
  valDisplay.textContent = ov.frozen ? ov.fixedValue.toFixed(2) : '';

  freezeBtn.addEventListener('click', () => {
    ov.frozen = !ov.frozen;
    freezeBtn.classList.toggle('frozen', ov.frozen);
    freezeBtn.textContent = ov.frozen ? 'Frozen' : 'Freeze';
    freezeBtn.title = ov.frozen ? 'Unfreeze — re-enable NISPS control' : 'Freeze — lock value, disable NISPS';
    valSlider.style.display = ov.frozen ? '' : 'none';
    valDisplay.textContent = ov.frozen ? ov.fixedValue.toFixed(2) : '';
    // When freezing, capture the current output value
    if (ov.frozen) {
      const outputs = iml.getOutputs();
      ov.fixedValue = outputs[paramIndex];
      valSlider.value = ov.fixedValue;
      valDisplay.textContent = ov.fixedValue.toFixed(2);
    }
    routeOutputs(iml.getOutputs());
  });

  valSlider.addEventListener('input', () => {
    ov.fixedValue = parseFloat(valSlider.value);
    valDisplay.textContent = ov.fixedValue.toFixed(2);
    routeOutputs(iml.getOutputs());
  });

  freezeRow.appendChild(freezeBtn);
  freezeRow.appendChild(valSlider);
  freezeRow.appendChild(valDisplay);
  body.appendChild(freezeRow);

  // Position below the heatmap cell
  const cellRect = cell.getBoundingClientRect();
  const popupWidth = 260;
  let left = cellRect.left + cellRect.width / 2 - popupWidth / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - popupWidth - 4));
  $paramPopup.style.left = `${left}px`;
  $paramPopup.style.top = `${cellRect.bottom + 4}px`;
  $paramPopup.classList.add('visible');
}

function hideParamPopup() {
  activePopupParam = -1;
  if ($paramPopup) $paramPopup.classList.remove('visible');
}

// ---- Joy Map (merged joystick + minimap) ----
function drawJoyMap() {
  const canvas = $joyMap;
  const ctx = $joyMapCtx;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = w / 2 - 2;

  // Clear with circle clip
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // Background
  ctx.fillStyle = 'rgba(13, 13, 13, 0.7)';
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 0.5;
  for (let frac = 0.25; frac < 1; frac += 0.25) {
    ctx.beginPath();
    ctx.moveTo(frac * w, 0); ctx.lineTo(frac * w, h);
    ctx.moveTo(0, frac * h); ctx.lineTo(w, frac * h);
    ctx.stroke();
  }

  // Ring border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Training example dots
  const features = iml.dataset.features;
  const labels = iml.dataset.labels;

  for (let i = 0; i < features.length; i++) {
    const fx = features[i][0] * w;
    const fy = (1 - features[i][1]) * h;

    let hue = 0;
    if (labels[i]) {
      hue = (labels[i][3] || 0) * 360;
    }

    ctx.fillStyle = `hsla(${hue}, 80%, 60%, 0.85)`;
    ctx.beginPath();
    ctx.arc(fx, fy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Current position knob (accent dot with glow)
  const px = joyX * w;
  const py = (1 - joyY) * h;

  // Glow
  ctx.shadowColor = 'rgba(255, 106, 0, 0.6)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(255, 106, 0, 0.9)';
  ctx.beginPath();
  ctx.arc(px, py, 8, 0, Math.PI * 2);
  ctx.fill();

  // Inner bright dot
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI * 2);
  ctx.fill();

  // Crosshair
  ctx.strokeStyle = 'rgba(255, 106, 0, 0.2)';
  ctx.lineWidth = 0.5;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(px, 0); ctx.lineTo(px, h);
  ctx.moveTo(0, py); ctx.lineTo(w, py);
  ctx.stroke();

  ctx.restore();
}

// ---- Joystick ----
function wireJoystick() {
  const canvas = $joyMap;
  let startX, startY, startJX, startJY;
  let lastDoubleTap = 0;

  function onStart(e) {
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;

    // Double-tap detection for follow mode
    const now = Date.now();
    if (now - lastDoubleTap < 350) {
      toggleFollowMode();
      lastDoubleTap = 0;
      return;
    }
    lastDoubleTap = now;

    // Snap to tap position within the circle
    const rect = canvas.getBoundingClientRect();
    const size = rect.width;
    const dx = touch.clientX - rect.left - size / 2;
    const dy = touch.clientY - rect.top - size / 2;
    const maxR = size / 2 - 8;

    joyX = Math.max(0, Math.min(1, 0.5 + (dx / maxR) * 0.5));
    joyY = Math.max(0, Math.min(1, 0.5 - (dy / maxR) * 0.5));

    drawJoyMap();
    onJoystickMove();

    joyDragging = true;
    startX = touch.clientX;
    startY = touch.clientY;
    startJX = joyX;
    startJY = joyY;
  }

  function onMove(e) {
    if (!joyDragging && !joyFollowMode) return;
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;

    if (joyFollowMode) {
      joyX = Math.max(0, Math.min(1, touch.clientX / window.innerWidth));
      joyY = Math.max(0, Math.min(1, 1 - touch.clientY / window.innerHeight));
    } else if (joyDragging) {
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const size = canvas.getBoundingClientRect().width;
      const maxR = size / 2 - 8;
      const scale = 1 / maxR;

      joyX = Math.max(0, Math.min(1, startJX + dx * scale * 0.5));
      joyY = Math.max(0, Math.min(1, startJY - dy * scale * 0.5));
    }

    drawJoyMap();
    onJoystickMove();
  }

  function onEnd() {
    joyDragging = false;
  }

  canvas.addEventListener('pointerdown', onStart);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);

  // Follow mode: track pointer on main canvas when active
  $canvas.addEventListener('pointermove', (e) => {
    if (!joyFollowMode) return;
    joyX = Math.max(0, Math.min(1, e.clientX / window.innerWidth));
    joyY = Math.max(0, Math.min(1, 1 - e.clientY / window.innerHeight));
    drawJoyMap();
    onJoystickMove();
  });
}

function toggleFollowMode() {
  joyFollowMode = !joyFollowMode;
  console.log('[Joystick] Follow mode:', joyFollowMode);
  updateFollowUI();
}

function updateFollowUI() {
  if (joyFollowMode) {
    $followBadge.classList.remove('hidden');
    $joystickContainer.classList.add('follow-active');
    $followPill.classList.add('active');
  } else {
    $followBadge.classList.add('hidden');
    $joystickContainer.classList.remove('follow-active');
    $followPill.classList.remove('active');
  }
}

function onJoystickMove() {
  if (inputMode !== 'joystick') return;
  if (_rebuilding || !iml) return; // MLP mid-rebuild — skip this tick
  iml.setInput(0, joyX);
  iml.setInput(1, joyY);
  iml.process();

  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  updateHeatmap(outputs);

  syncRawParamsFromOutputs(outputs);

  // EOC Linked mode: run EOC IML with same joystick inputs
  if (imlEoc && eocChain?.nispsMode === 'linked') {
    imlEoc.setInput(0, joyX);
    imlEoc.setInput(1, joyY);
    imlEoc.process();
    const eocOutputs = imlEoc.getOutputs();
    for (let i = 0; i < eocOutputs.length; i++) {
      eocChain.setParam(i, eocOutputs[i]);
    }
  }

  // ShapeSeq: route joystick inputs to the sequence engine
  if (shapeSeqEnabled && shapeSeqEngine && shapeSeqEngine.isPlaying) {
    if (shapeSeqEngine.mlpMode.mode === 'unified') {
      // Unified mode: timbre MLP already ran — pass its outputs to the sequencer
      shapeSeqEngine.setSequenceOutputsFromTimbre(outputs);
    } else {
      // Dual mode: sequence engine runs its own MLP
      shapeSeqEngine.setSequenceInputs([joyX, joyY]);
    }
  }

  // Trail
  joyTrail.push({ x: joyX, y: joyY, t: Date.now() });
  if (joyTrail.length > 30) joyTrail.shift();
}

// ---- Output routing ----
// Synth param throttling: only send values that changed beyond a dead zone.
// Prevents ring buffer flooding (126 params × 30fps = 3780 msg/s > 512 capacity).
let _lastSentParams = new Float32Array(N_OUTPUTS);
const PARAM_DEAD_ZONE = 0.002; // ~0.2% change threshold
let _lastParamSendTime = 0;
const PARAM_SEND_INTERVAL = 50; // max ~20fps for synth param updates

function routeOutputs(outputs) {
  if (outputMode === 'synth') {
    // Modular cold-start: before the user has captured any training
    // examples, the MLP output is arbitrary — an untrained sigmoid
    // network with spread=0.6 on 512 outputs tends toward ~0, which
    // denormalises matrix cells to raw=0 and silences the default
    // patch's ADSR1→amp routing. Ignore the MLP entirely and drive the
    // engine with the default-normalised vector. Once exampleCount > 0
    // the MLP has a target to hit and resumes driving normally.
    let shiftedOutputs = outputs;
    if (activeEngine?.id === 'modular' &&
        (iml?.exampleCount ?? 0) === 0 &&
        typeof activeEngine.getDefaultNormalizedOutputs === 'function') {
      const defaults = activeEngine.getDefaultNormalizedOutputs();
      if (defaults && defaults.length === outputs.length) {
        shiftedOutputs = defaults;
      }
    }

    const overridden = new Array(shiftedOutputs.length);
    for (let i = 0; i < shiftedOutputs.length; i++) {
      overridden[i] = applyGroupOverrides(shiftedOutputs[i], i);
    }
    // Visualizer always gets every frame (it's local, no buffer)
    synthVisualizer.setParams(overridden);

    // meml-usd6: mirror live MLP outputs into Patch Bay cells when open
    if (patchBay && patchBay.isOpen() && activeEngine?.id === 'modular') {
      patchBay.updateLive(overridden);
    }

    // Engine param updates: throttle + dead-zone filter
    if (activeEngine && activeEngine.running) {
      const now = performance.now();
      if (now - _lastParamSendTime >= PARAM_SEND_INTERVAL) {
        _lastParamSendTime = now;
        const engineParamCount = activeEngine.paramCount;
        for (let i = 0; i < overridden.length && i < N_OUTPUTS; i++) {
          const v = overridden[i];
          if (Math.abs(v - _lastSentParams[i]) > PARAM_DEAD_ZONE) {
            // Only send engine params (indices before engineParamCount) to the engine
            if (i < engineParamCount) {
              activeEngine.setParam(i, v);
            }
            _lastSentParams[i] = v;
          }
        }
      }
    }

    // In Shared mode, route outputs beyond engine params to the EOC chain
    if (eocChain?.nispsMode === 'shared') {
      const engineParamCount = activeEngine?.paramCount ?? 0;
      const eocParamCount = eocChain.paramCount;
      for (let i = 0; i < eocParamCount; i++) {
        const outputIndex = engineParamCount + i;
        if (outputIndex < outputs.length) {
          eocChain.setParam(i, outputs[outputIndex]);
        }
      }
    }
  } else if (outputMode === 'midi-cc') {
    // MIDI CC output — route through overrides then send CC messages
    if (midiOutput && midiOutput.enabled && midiOutput.activeOutput) {
      const messages = [];
      for (let i = 0; i < midiCCMap.length && i < outputs.length; i++) {
        const ccParam = midiCCMap[i];
        const ov = midiCCOverrides[i];
        if (!ov || ov.frozen) {
          if (ov) messages.push({ channel: ccParam.channel, cc: ccParam.cc, value: Math.round(ov.fixedValue * 127) });
          continue;
        }
        const v = applyGroupOverride(outputs[i], ov.curve, ov.min, ov.max);
        messages.push({ channel: ccParam.channel, cc: ccParam.cc, value: Math.round(v * 127) });
      }
      midiOutput.sendBatch(messages);
    }
  } else if (outputMode === 'audio-canvas') {
    if (audioCanvas) audioCanvas.setOutputs(outputs);
  } else {
    const vis = new Array(N_VISUAL_OUTPUTS);
    for (let i = 0; i < N_VISUAL_OUTPUTS; i++) {
      const vo = visualOverrides[i];
      if (vo.frozen) {
        vis[i] = vo.fixedValue;
      } else {
        vis[i] = applyGroupOverride(outputs[i], vo.curve, vo.min, vo.max);
      }
    }
    visualizer.setParams(vis);
  }
}

// ---- Bottom sheet ----
// ---- Dock & Drawer system ----
function wireDock() {
  const dock = document.getElementById('dock');

  // Toggle drawers on dock icon click
  dock.addEventListener('click', (e) => {
    const icon = e.target.closest('.dock-icon');
    if (!icon) return;
    const drawerId = icon.dataset.drawer;

    // Special case: help opens modal instead of drawer
    if (drawerId === 'help') {
      document.getElementById('help-overlay').classList.remove('hidden');
      return;
    }

    const drawer = document.getElementById(`drawer-${drawerId}`);
    if (!drawer) return;

    const isOpen = !drawer.classList.contains('hidden');
    if (isOpen) {
      drawer.classList.add('hidden');
      icon.classList.remove('active');
    } else {
      drawer.classList.remove('hidden');
      icon.classList.add('active');
    }
  });

  // Close buttons inside drawers
  document.querySelectorAll('.drawer-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const drawerId = btn.dataset.drawer;
      const drawer = document.getElementById(`drawer-${drawerId}`);
      if (drawer) drawer.classList.add('hidden');
      const icon = dock.querySelector(`.dock-icon[data-drawer="${drawerId}"]`);
      if (icon) icon.classList.remove('active');
    });
  });

  // Follow pill toggle
  $followPill.addEventListener('click', () => {
    toggleFollowMode();
  });
}

// ---- Controls wiring ----
function wireControls() {
  // Output mode toggle (in mode drawer)
  document.querySelectorAll('#output-toggle-float .pill-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      syncOutputToggles(btn.dataset.mode);
      setOutputMode(btn.dataset.mode);
    });
  });

  // Action buttons (in training drawer)
  document.getElementById('btn-add-example').addEventListener('click', onAddExample);
  document.getElementById('btn-train').addEventListener('click', onTrain);
  document.getElementById('btn-clear').addEventListener('click', onClear);
  document.getElementById('btn-clear-examples').addEventListener('click', onClearExamples);
  document.getElementById('btn-randomize').addEventListener('click', onRandomize);

  // RL buttons
  $btnThumbsUp.addEventListener('click', onThumbsUp);
  $btnThumbsDown.addEventListener('click', onThumbsDown);

  // EOC RL buttons (Linked mode — target EOC IML directly)
  const eocRlPlus = document.getElementById('eoc-rl-plus');
  const eocRlMinus = document.getElementById('eoc-rl-minus');
  if (eocRlPlus && eocRlMinus) {
    eocRlPlus.addEventListener('click', () => {
      if (!imlEoc) return;
      const prevTarget = eocTrainingTarget;
      eocTrainingTarget = 'eoc';
      onThumbsUp();
      eocTrainingTarget = prevTarget;
      flash('eoc-rl-plus');
    });
    eocRlMinus.addEventListener('click', () => {
      if (!imlEoc) return;
      const prevTarget = eocTrainingTarget;
      eocTrainingTarget = 'eoc';
      onThumbsDown();
      eocTrainingTarget = prevTarget;
      flash('eoc-rl-minus');
    });
  }

  // Undo button
  document.getElementById('btn-undo').addEventListener('click', onUndo);

  // Presets
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => loadPreset(chip.dataset.preset));
  });

  // Initial noise ring update
  updateNoiseRing();
}

// ---- Input mode (joystick / hands) ----
function wireInputToggle() {
  document.querySelectorAll('#input-toggle .pill-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.input;
      if (mode === inputMode) return;
      setInputMode(mode);
      syncInputToggle(mode);
    });
  });
}

function syncInputToggle(mode) {
  document.querySelectorAll('#input-toggle .pill-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.input === mode)
  );
}

let _inputModeSwitching = false;
async function setInputMode(mode) {
  if (_inputModeSwitching) return;
  _inputModeSwitching = true;
  try {
    await _setInputModeInner(mode);
  } finally {
    _inputModeSwitching = false;
  }
}

async function _setInputModeInner(mode) {
  inputMode = mode;
  const $pip = document.getElementById('hand-pip');

  if (mode === 'hands') {
    iml = imlHand;
    $joystickContainer.style.display = 'none';
    $pip.classList.remove('hidden');

    if (!handTracker) {
      const $status = document.getElementById('hand-status');
      $status.textContent = 'Loading model...';

      handTracker = new HandTracker({
        videoElement: document.getElementById('hand-video'),
        overlayCanvas: document.getElementById('hand-overlay'),
        onTrackingInput: onHandInput,
        onGesture: onHandGesture,
        onConnectionChange: (active) => {
          console.log('[HandTracker] active:', active);
        },
      });

      try {
        await handTracker.start();
        $status.textContent = 'Tracking';
        $status.classList.add('tracking');
      } catch (e) {
        $status.textContent = 'Camera error';
        console.error('[HandTracker]', e);
        setInputMode('joystick');
        syncInputToggle('joystick');
        return;
      }
    } else {
      await handTracker.start();
      document.getElementById('hand-status').textContent = 'Tracking';
      document.getElementById('hand-status').classList.add('tracking');
    }

    iml.process();
    routeOutputs(iml.getOutputs());
    updateHeatmap(iml.getOutputs());
  } else {
    iml = imlJoy;
    $joystickContainer.style.display = '';
    $pip.classList.add('hidden');

    if (handTracker) {
      handTracker.stop();
      document.getElementById('hand-status').classList.remove('tracking');
    }

    iml.setInput(0, joyX);
    iml.setInput(1, joyY);
    iml.process();
    routeOutputs(iml.getOutputs());
    updateHeatmap(iml.getOutputs());
  }

  updateStatus();
  drawJoyMap();
}

function getCurrentInputs() {
  if (inputMode === 'hands' && handTracker) {
    return [...handTracker.features];
  }
  return [joyX, joyY];
}

function setCurrentInputs() {
  if (inputMode === 'hands' && handTracker) {
    const f = handTracker.features;
    for (let i = 0; i < f.length; i++) iml.setInput(i, f[i]);
  } else {
    iml.setInput(0, joyX);
    iml.setInput(1, joyY);
  }
}

function onHandInput(features) {
  if (inputMode !== 'hands') return;
  for (let i = 0; i < features.length; i++) {
    iml.setInput(i, features[i]);
  }
  iml.process();

  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  updateHeatmap(outputs);
  syncRawParamsFromOutputs(outputs);
  updateGestureIndicator();
}

function onHandGesture(gesture) {
  if (gesture === 'thumbsup') {
    onThumbsUp();
  } else if (gesture === 'thumbsdown') {
    onThumbsDown();
  }
}

function updateGestureIndicator() {
  if (!handTracker) return;
  const $indicator = document.getElementById('gesture-indicator');
  const $label = document.getElementById('gesture-label');
  const $progress = $indicator.querySelector('.gesture-ring-progress');

  if (handTracker.gestureCandidate && handTracker.gestureProgress > 0) {
    $indicator.classList.add('active');
    const circumference = 2 * Math.PI * 16;
    const offset = circumference * (1 - handTracker.gestureProgress);
    $progress.style.strokeDashoffset = offset;
    $label.textContent = handTracker.gestureCandidate === 'thumbsup' ? '+' : '\u2212';
  } else {
    $indicator.classList.remove('active');
  }

  const $status = document.getElementById('hand-status');
  if (handTracker.active) {
    if (handTracker.trackingRight && handTracker.trackingLeft) {
      $status.textContent = 'Both hands';
    } else if (handTracker.trackingRight) {
      $status.textContent = 'Tracking';
    } else {
      $status.textContent = 'No hand';
    }
    $status.classList.toggle('tracking', handTracker.trackingRight);
  }
}

function syncOutputToggles(mode) {
  document.querySelectorAll('#output-toggle-float .pill-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

async function setOutputMode(mode, { skipConfirm = false } = {}) {
  const heatmapStrip = document.getElementById('heatmap-strip');
  const synthQuickControls = document.getElementById('synth-quick-controls');
  const midiCCQuickControls = document.getElementById('midi-cc-quick-controls');
  const audioCanvasWrap = document.getElementById('audio-canvas-wrap');

  // Lazily create AudioCanvas BEFORE computing targetOutputs so that
  // outputCountForMode returns the real count (not the 12-output fallback).
  if (mode === 'audio-canvas' && !audioCanvas) {
    audioCanvas = new AudioCanvas(audioCanvasWrap);
    _ensureAudioCanvasOverrides(audioCanvas.getOutputCount());
    // Listen for dynamic output count changes (loop count changes)
    audioCanvasWrap.addEventListener('ac:outputcount-changed', async (e) => {
      if (outputMode !== 'audio-canvas') return;
      const newCount = e.detail.count;
      _ensureAudioCanvasOverrides(newCount);
      if (newCount !== N_OUTPUTS) {
        await resizeMLP(newCount);
      }
      buildHeatmap();
      updateHeatmap(iml.getOutputs());
    });
  }

  const targetOutputs = outputCountForMode(mode);
  const needsResize = targetOutputs !== N_OUTPUTS;

  // Warn about weight reset if resizing (skip during state restore)
  if (needsResize && !skipConfirm && iml.dataset.features.length > 0) {
    if (!confirm(`Switching to ${mode} mode requires ${targetOutputs} outputs (currently ${N_OUTPUTS}). This will reset training examples. Network weights will be partially preserved. Continue?`)) {
      syncOutputToggles(outputMode); // revert pill UI
      return;
    }
  }

  outputMode = mode;
  hideGroupDrawer();
  hideParamPopup();

  // Resize MLP if needed
  if (needsResize) {
    await resizeMLP(targetOutputs);
  }

  buildHeatmap();
  updateHeatmap(iml.getOutputs());

  // Hide/show audio-canvas wrap
  if (audioCanvasWrap) audioCanvasWrap.style.display = mode === 'audio-canvas' ? 'block' : 'none';

  // Show/hide ShapeSeq container (only visible in synth mode when shapeseq=1)
  const shapeSeqContainer = document.getElementById('shapeseq-container');
  if (shapeSeqContainer) {
    shapeSeqContainer.style.display = (shapeSeqEnabled && mode === 'synth') ? 'block' : 'none';
  }

  if (mode === 'synth') {
    $canvas.classList.add('hidden-canvas');
    $synthVisCanvas.classList.add('active');
    heatmapStrip.classList.add('hidden');
    synthQuickControls.classList.remove('hidden');
    if (midiCCQuickControls) midiCCQuickControls.classList.add('hidden');
    synthVisualizer.enableInteraction(true);
    const qp = document.getElementById('quick-play');
    if (qp) qp.classList.toggle('audio-needs-init', !(c15 && c15.running));
  } else if (mode === 'midi-cc') {
    $canvas.classList.add('hidden-canvas');
    $synthVisCanvas.classList.remove('active');
    heatmapStrip.classList.remove('hidden');
    synthQuickControls.classList.add('hidden');
    if (midiCCQuickControls) midiCCQuickControls.classList.remove('hidden');
    synthVisualizer.enableInteraction(false);
  } else if (mode === 'audio-canvas') {
    $canvas.classList.add('hidden-canvas');
    $synthVisCanvas.classList.remove('active');
    heatmapStrip.classList.remove('hidden');
    synthQuickControls.classList.add('hidden');
    if (midiCCQuickControls) midiCCQuickControls.classList.add('hidden');
    synthVisualizer.enableInteraction(false);
  } else {
    $canvas.classList.remove('hidden-canvas');
    $synthVisCanvas.classList.remove('active');
    heatmapStrip.classList.remove('hidden');
    synthQuickControls.classList.add('hidden');
    if (midiCCQuickControls) midiCCQuickControls.classList.add('hidden');
    synthVisualizer.enableInteraction(false);
  }

  routeOutputs(iml.getOutputs());
  buildEngineParams();
  syncRawParamsFromOutputs(iml.getOutputs());
}

function updateNoiseRing() {
  if (noiseLevel > 0.15) {
    $noiseRing.className = 'noise-ring active high';
  } else if (noiseLevel > 0.01) {
    $noiseRing.className = 'noise-ring active';
  } else {
    $noiseRing.className = 'noise-ring';
  }
}

// ---- Examples mode ----
function onAddExample() {
  const inputs = getCurrentInputs();
  const outputs = [...rawParamValues];
  iml.addExample(inputs, outputs);
  markSessionDirty();
  updateStatus();
  drawJoyMap();
  flash('btn-add-example');
}

function onTrain() {
  if (iml.isTraining) return;
  flash('btn-train');
  trainModelAsync();
}

function onRandomize() {
  iml.randomiseWeights(spreadLevel);
  markSessionDirty();
  setCurrentInputs();
  iml.process();
  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  updateHeatmap(outputs);
  syncRawParamsFromOutputs(outputs);
  noiseLevel = 0.05;
  updateStatus();
}

function onClearExamples() {
  iml.clearDataset();
  updateStatus();
  drawJoyMap();
}

function onClear() {
  iml.clearDataset();
  iml.lossHistory = [];
  iml.bestLoss = null;
  iml.totalTrainingIterations = 0;
  noiseLevel = 0.05;
  clearState();
  updateStatus();
  drawLossPlot();
  drawJoyMap();
}

// ---- Undo ----
function pushUndoSnapshot() {
  const snapshot = {
    weights: iml._getFlatWeights ? iml._getFlatWeights() : (iml.mlp ? iml.mlp.getWeights() : null),
    noiseLevel,
    exampleCount: iml.exampleCount,
  };
  if (snapshot.weights) {
    undoStack.push(snapshot);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    updateUndoButton();
  }
}

function onUndo() {
  if (undoStack.length === 0) return;
  const snapshot = undoStack.pop();
  if (iml._setFlatWeights && Array.isArray(snapshot.weights)) {
    iml._setFlatWeights(snapshot.weights);
  } else if (iml.mlp && snapshot.weights) {
    iml.mlp.setWeights(snapshot.weights);
  }
  noiseLevel = snapshot.noiseLevel;
  iml.process();
  const outputs = iml.getOutputs();
  routeOutputs(outputs);
  updateHeatmap(outputs);
  syncRawParamsFromOutputs(outputs);
  updateStatus();
  updateNoiseRing();
  updateUndoButton();
  flash('btn-undo');
}

function updateUndoButton() {
  const btn = document.getElementById('btn-undo');
  if (btn) btn.classList.toggle('has-undo', undoStack.length > 0);
}

// ---- RL mode ----

/**
 * Return the IML instance that RL feedback should target.
 * In Linked/Independent mode the user may direct feedback to the EOC IML instead.
 */
function _rlTarget() {
  const mode = eocChain?.nispsMode;
  if ((mode === 'linked' || mode === 'independent') && eocTrainingTarget === 'eoc' && imlEoc) {
    return imlEoc;
  }
  return iml;
}

function onThumbsUp() {
  const target = _rlTarget();
  if (!target || target.isTraining) return;

  pushUndoSnapshot();
  const inputs = getCurrentInputs();
  const outputs = [...rawParamValues];
  target.addExample(inputs, outputs);
  markSessionDirty();

  noiseLevel *= rlExplorationDecay;
  noiseLevel = Math.max(noiseLevel, 0.005);

  flash('btn-thumbsup');
  updateNoiseRing();
  // Only run async training on the target; synth IML uses trainModelAsync, EOC IML trains directly
  if (target === iml) {
    trainModelAsync();
  } else {
    target.trainAsync(({ loss }) => {
      updateStatus();
    });
  }
}

function onThumbsDown() {
  const target = _rlTarget();
  if (!target) return;

  pushUndoSnapshot();
  const noiseCap = 0.3 * (1 - spreadLevel) + 0.05 * spreadLevel;
  noiseLevel = Math.min(noiseLevel * 1.5, noiseCap);

  target.moveWeights(noiseLevel, spreadLevel);
  markSessionDirty();

  // Re-route outputs from whichever IML was affected
  if (target === iml) {
    const outputs = iml.getOutputs();
    routeOutputs(outputs);
    updateHeatmap(outputs);
    syncRawParamsFromOutputs(outputs);
  } else if (imlEoc && (eocChain?.nispsMode === 'linked' || eocChain?.nispsMode === 'independent')) {
    imlEoc.process();
    const eocOutputs = imlEoc.getOutputs();
    for (let i = 0; i < eocOutputs.length; i++) {
      eocChain.setParam(i, eocOutputs[i]);
    }
  }
  updateStatus();
  updateNoiseRing();
  flash('btn-thumbsdown');
}

// ---- Training ----
// Sync — used for preset loading and state restore
function trainModel() {
  return iml.train();
}

// Async — used for interactive training (thumbs-up, train button)
function trainModelAsync(onDone) {
  iml.trainAsync((res) => {
    // res may be {cancelled:true} if the IML was rebuilt mid-training.
    if (res && res.cancelled) { if (onDone) onDone(); return; }
    const { loss, outputs } = res || {};
    if (outputs) {
      routeOutputs(outputs);
      updateHeatmap(outputs);
      syncRawParamsFromOutputs(outputs);
    }
    markSessionDirty();
    updateStatus();
    drawLossPlot();
    drawJoyMap();
    if (onDone) onDone();
  });
}

// ---- Presets ----
function loadPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;

  // Visual presets have 2-element inputs — always apply to joystick IML
  imlJoy.clearDataset();
  for (const ex of preset) {
    imlJoy.addExample(ex.input, padPresetOutputs(ex.output));
  }

  // Temporarily point iml to imlJoy for training, then restore
  const prevIml = iml;
  iml = imlJoy;
  const loss = trainModel();
  iml = prevIml;

  // Show results from joystick IML
  imlJoy.setInput(0, joyX);
  imlJoy.setInput(1, joyY);
  imlJoy.process();
  const outputs = imlJoy.getOutputs();
  routeOutputs(outputs);
  updateHeatmap(outputs);
  syncRawParamsFromOutputs(outputs);
  updateStatus();
  drawLossPlot();
  drawJoyMap();
}

// ---- Status ----
function updateStatus() {
  const count = iml.exampleCount;
  const loss = iml.lastLoss;
  let text = `${count} example${count !== 1 ? 's' : ''}`;

  if (loss !== null) {
    text += ` \u00b7 loss ${loss.toFixed(5)}`;
  } else {
    text += ' \u00b7 untrained';
  }

  text += ` \u00b7 noise ${noiseLevel.toFixed(3)}`;

  $statusText.textContent = text;
  syncEngineParams();
}

// ---- Loss plot ----
function drawLossPlot() {
  const ctx = $lossCtx;
  const w = $lossCanvas.width;
  const h = $lossCanvas.height;
  const history = iml.lossHistory;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(0, 0, w, h);

  if (history.length < 2) return;

  const maxLoss = Math.max(...history.slice(-200)) || 1;
  const points = history.slice(-200);

  ctx.strokeStyle = 'rgba(255, 106, 0, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  for (let i = 0; i < points.length; i++) {
    const x = (i / (points.length - 1)) * w;
    const y = h - (points[i] / maxLoss) * h * 0.9;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ---- Raw param sliders ----
// ---- Engine Parameters (NISPS tuning) ----
function buildEngineParams() {
  if (!$engineParams) return;
  // Use a sub-container so the EngineSwitcher section (prepended) is not clobbered.
  let container = $engineParams.querySelector('.engine-tuning');
  if (!container) {
    container = document.createElement('div');
    container.className = 'engine-tuning';
    $engineParams.appendChild(container);
  }
  container.innerHTML = '';

  const params = [
    {
      label: 'Spread', key: 'spread',
      get: () => spreadLevel, set: (v) => { spreadLevel = v; },
      min: 0, max: 1, step: 0.01,
      desc: 'Weight init scale & RL noise regime (0=polarised, 1=centered)',
    },
    {
      label: 'Noise', key: 'noise',
      get: () => noiseLevel, set: (v) => { noiseLevel = v; updateNoiseRing(); },
      min: 0, max: 0.5, step: 0.001,
      desc: 'Current RL exploration noise level',
    },
    {
      label: 'RL Decay', key: 'rlDecay',
      get: () => rlExplorationDecay, set: (v) => { rlExplorationDecay = v; },
      min: 0.8, max: 1.0, step: 0.005,
      desc: 'Noise decay per thumbs-up (lower = faster convergence)',
    },
    {
      label: 'Learn Rate', key: 'lr',
      get: () => iml.learningRate, set: (v) => { iml.learningRate = v; },
      min: 0.01, max: 5.0, step: 0.01,
      desc: 'MLP training learning rate',
    },
    {
      label: 'Max Iters', key: 'maxIter',
      get: () => iml.maxIterations, set: (v) => { iml.maxIterations = Math.round(v); },
      min: 50, max: 5000, step: 50,
      desc: 'Max training iterations per train() call',
    },
    {
      label: 'Convergence', key: 'conv',
      get: () => iml.convergenceThreshold, set: (v) => { iml.convergenceThreshold = v; },
      min: 0.000001, max: 0.01, step: 0.000001,
      desc: 'Stop training when loss drops below this',
    },
  ];

  for (const p of params) {
    const row = document.createElement('div');
    row.className = 'engine-param';

    const label = document.createElement('span');
    label.className = 'engine-param-label';
    label.textContent = p.label;
    label.title = p.desc;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(p.min);
    slider.max = String(p.max);
    slider.step = String(p.step);
    slider.value = p.get();

    const val = document.createElement('span');
    val.className = 'engine-param-val';
    val.textContent = formatEngineVal(p.get(), p.step);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      p.set(v);
      val.textContent = formatEngineVal(v, p.step);
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(val);
    container.appendChild(row);

    // Store ref for live updates
    row._paramDef = p;
    row._slider = slider;
    row._val = val;
  }
}

function formatEngineVal(v, step) {
  if (step < 0.0001) return v.toExponential(1);
  if (step < 0.01) return v.toFixed(3);
  if (step < 1) return v.toFixed(2);
  return String(Math.round(v));
}

function syncEngineParams() {
  if (!$engineParams) return;
  const rows = $engineParams.querySelectorAll('.engine-param');
  rows.forEach(row => {
    const p = row._paramDef;
    if (!p) return;
    const v = p.get();
    row._slider.value = v;
    row._val.textContent = formatEngineVal(v, parseFloat(row._slider.step));
  });
}

function syncRawParamsFromOutputs(outputs) {
  rawParamValues = [...outputs];
}

// ---- Synth controls ----
function wireSynthControls() {
  const startBtn = document.getElementById('synth-start');
  const volumeSlider = document.getElementById('synth-volume');
  const arpToggle = document.getElementById('arp-toggle');
  const arpProgression = document.getElementById('arp-progression');
  const arpTempo = document.getElementById('arp-tempo');
  const arpOctaves = document.getElementById('arp-octaves');
  const arpOffset = document.getElementById('arp-offset');
  if (!startBtn || !volumeSlider || !arpToggle) return;

  startBtn.addEventListener('click', async () => {
    const quickPlay = document.getElementById('quick-play');
    if (c15.running) {
      if (shapeSeqEnabled && shapeSeqEngine) shapeSeqEngine.stop();
      arpeggiator.stop();
      arpToggle.textContent = 'Play';
      await c15.stop();
      startBtn.textContent = 'Start Audio';
      if (quickPlay) quickPlay.classList.add('audio-needs-init');
    } else {
      await activeEngine.init();
      await _startEocChain();
      if (shapeSeqEnabled) await _ensureShapeSeqInit();
      startBtn.textContent = 'Stop Audio';
      if (quickPlay) quickPlay.classList.remove('audio-needs-init');
      routeOutputs(iml.getOutputs());
    }
  });

  volumeSlider.addEventListener('input', (e) => {
    c15.setMasterVolume(parseFloat(e.target.value));
    const quickVol = document.getElementById('quick-vol');
    if (quickVol) quickVol.value = e.target.value;
  });

  arpToggle.addEventListener('click', () => {
    if (!c15.running) return;
    const isPlaying = shapeSeqEnabled
      ? (shapeSeqEngine && shapeSeqEngine.isPlaying)
      : arpeggiator.playing;
    if (isPlaying) {
      if (shapeSeqEnabled && shapeSeqEngine) shapeSeqEngine.stop();
      else arpeggiator.stop();
      arpToggle.textContent = 'Play';
    } else {
      if (shapeSeqEnabled && shapeSeqEngine) shapeSeqEngine.start();
      else arpeggiator.start();
      arpToggle.textContent = 'Stop';
    }
  });

  arpProgression.addEventListener('change', (e) => {
    arpeggiator.progression = e.target.value;
  });

  arpTempo.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    arpeggiator.bpm = val;
    document.getElementById('tempo-val').textContent = val;
    const quickBpm = document.getElementById('quick-bpm');
    const quickBpmVal = document.getElementById('quick-bpm-val');
    if (quickBpm) quickBpm.value = val;
    if (quickBpmVal) quickBpmVal.textContent = val;
  });

  arpOctaves.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    arpeggiator.octaves = val;
    document.getElementById('octaves-val').textContent = val;
  });

  arpOffset.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    arpeggiator.octaveOffset = val;
    document.getElementById('offset-val').textContent = val;
  });
}

// ---- MIDI Input ----
async function initMIDIControls() {
  const row = document.getElementById('midi-row');
  const statusRow = document.getElementById('midi-status-row');
  const toggle = document.getElementById('midi-toggle');
  const select = document.getElementById('midi-select');
  const statusEl = document.getElementById('midi-status');
  if (!row || !toggle || !select) return;

  const available = await midiInput.init();
  if (!available) return;

  row.style.display = '';

  function populateInputs() {
    const inputs = midiInput.getInputs();
    select.innerHTML = '<option value="">All Inputs</option>' +
      inputs.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
  }

  populateInputs();
  midiInput.onInputsChange = () => populateInputs();

  midiInput.onStatusChange = (msg) => {
    if (statusEl) {
      statusEl.textContent = msg;
      statusRow.style.display = '';
    }
  };

  midiInput.onCC = (cc, value) => {
    if (cc === 1) { joyX = value; onJoystickMove(); drawJoyMap(); }
    if (cc === 2) { joyY = value; onJoystickMove(); drawJoyMap(); }
  };

  toggle.addEventListener('click', () => {
    if (!c15.running) return;
    midiInput.toggle();
    toggle.textContent = midiInput.enabled ? 'Disable' : 'Enable';
    toggle.classList.toggle('playing', midiInput.enabled);
  });

  select.addEventListener('change', (e) => {
    midiInput.selectInput(e.target.value || null);
  });
}

// ---- MIDI CC Preset Application ----
async function applyMidiCCPreset(preset) {
  // Replace the CC map with preset params
  midiCCMap.length = 0;
  midiCCMap.push(...preset.params.map(p => ({ ...p })));

  // Rebuild overrides
  midiCCOverrides.length = 0;
  midiCCOverrides.push(...preset.params.map(p => ({
    min: p.min ?? 0, max: p.max ?? 1, curve: p.curve ?? 0.5,
    frozen: p.muted ?? false, fixedValue: p.fixedValue ?? 0.5,
  })));

  _generateCCColors(midiCCMap.length);
  saveCCMap(midiCCMap, midiCCStorageKey());

  // Resize MLP if in midi-cc mode
  if (outputMode === 'midi-cc') {
    await resizeMLP(midiCCMap.length);
    buildHeatmap();
    updateHeatmap(iml.getOutputs());
  }

  // Update UI
  const countEl = document.getElementById('midi-cc-count');
  if (countEl) countEl.textContent = midiCCMap.length;
  buildMidiCCParamList();

  console.log(`[NISPS] Applied MIDI CC preset: ${preset.name} (${preset.params.length} params)`);
}

// ---- MIDI CC Controls ----
async function initMIDICCControls() {
  const enableBtn = document.getElementById('midi-cc-enable-btn');
  const outputSelect = document.getElementById('midi-cc-output-select');
  const statusEl = document.getElementById('midi-cc-status');
  const countEl = document.getElementById('midi-cc-count');
  const addBtn = document.getElementById('midi-cc-add');
  const removeBtn = document.getElementById('midi-cc-remove');
  const importBtn = document.getElementById('midi-cc-import');
  const exportBtn = document.getElementById('midi-cc-export');
  const presetSelect = document.getElementById('midi-cc-preset-select');
  const fileImportBtn = document.getElementById('midi-cc-file-import');

  if (!enableBtn || !outputSelect) return;

  const available = await midiOutput.init();

  function populateOutputs() {
    const outputs = midiOutput.getOutputs();
    outputSelect.innerHTML = '<option value="">No device</option>' +
      outputs.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
  }

  if (available) {
    populateOutputs();
    midiOutput.onOutputsChange = () => populateOutputs();
  }

  midiOutput.onStatusChange = (msg) => {
    if (statusEl) statusEl.textContent = msg;
  };

  enableBtn.addEventListener('click', () => {
    midiOutput.toggle();
    enableBtn.classList.toggle('playing', midiOutput.enabled);
  });

  outputSelect.addEventListener('change', (e) => {
    midiOutput.selectOutput(e.target.value || null);
    if (e.target.value) midiOutput.enable();
    enableBtn.classList.toggle('playing', midiOutput.enabled);
  });

  // Update count display
  function updateCountDisplay() {
    if (countEl) countEl.textContent = midiCCMap.length;
  }
  updateCountDisplay();

  // Add CC param
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      midiCCMap.push(createCCParam(74, 1));
      midiCCOverrides.push({ min: 0, max: 1, curve: 0.5, frozen: false, fixedValue: 0.5 });
      _generateCCColors(midiCCMap.length);
      saveCCMap(midiCCMap, midiCCStorageKey());
      updateCountDisplay();

      // Resize MLP if we're in midi-cc mode
      if (outputMode === 'midi-cc') {
        await resizeMLP(midiCCMap.length);
        buildHeatmap();
        updateHeatmap(iml.getOutputs());
      }
    });
  }

  // Remove last CC param
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      if (midiCCMap.length <= 1) return;
      midiCCMap.pop();
      midiCCOverrides.pop();
      _generateCCColors(midiCCMap.length);
      saveCCMap(midiCCMap, midiCCStorageKey());
      updateCountDisplay();

      if (outputMode === 'midi-cc') {
        await resizeMLP(midiCCMap.length);
        buildHeatmap();
        updateHeatmap(iml.getOutputs());
      }
    });
  }

  // Export
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const json = exportCCMap(midiCCMap);
      navigator.clipboard.writeText(json).then(
        () => { if (statusEl) statusEl.textContent = 'Copied to clipboard'; },
        () => {
          // Fallback: prompt
          prompt('Copy this JSON:', json);
        }
      );
    });
  }

  // Import
  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      const json = prompt('Paste MIDI CC map JSON:');
      if (!json) return;
      const parsed = importCCMap(json);
      if (!parsed) {
        alert('Invalid MIDI CC map JSON');
        return;
      }
      midiCCMap.length = 0;
      midiCCMap.push(...parsed);
      midiCCOverrides.length = 0;
      midiCCOverrides.push(...parsed.map(p => ({
        min: p.min ?? 0, max: p.max ?? 1, curve: p.curve ?? 0.5,
        frozen: p.muted ?? false, fixedValue: p.fixedValue ?? 0.5,
      })));
      _generateCCColors(midiCCMap.length);
      saveCCMap(midiCCMap, midiCCStorageKey());
      updateCountDisplay();

      if (outputMode === 'midi-cc') {
        await resizeMLP(midiCCMap.length);
        buildHeatmap();
        updateHeatmap(iml.getOutputs());
      }
    });
  }

  // Quick preset selector (in quick controls bar)
  const quickPresetSelect = document.getElementById('midi-cc-quick-preset');
  if (quickPresetSelect) {
    quickPresetSelect.innerHTML = '<option value="">Manual</option>';
    for (const p of listMidiPresets()) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      quickPresetSelect.appendChild(opt);
    }
    quickPresetSelect.addEventListener('change', async () => {
      const id = quickPresetSelect.value;
      if (!id) return;
      try {
        const preset = await loadMidiPreset(id);
        await applyMidiCCPreset(preset);
        updateCountDisplay();
        if (statusEl) statusEl.textContent = `Loaded: ${preset.name}`;
        // Sync drawer preset selector
        if (presetSelect) presetSelect.value = id;
      } catch (err) {
        console.error('[MIDI CC] Failed to load preset:', err);
      }
    });
  }

  // Preset selector (in drawer)
  if (presetSelect) {
    // Populate with built-in presets
    presetSelect.innerHTML = '<option value="">Manual</option>';
    for (const p of listMidiPresets()) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      presetSelect.appendChild(opt);
    }
    presetSelect.addEventListener('change', async () => {
      const id = presetSelect.value;
      if (!id) return; // "Manual" selected — keep current config
      try {
        const preset = await loadMidiPreset(id);
        await applyMidiCCPreset(preset);
        updateCountDisplay();
        if (statusEl) statusEl.textContent = `Loaded: ${preset.name}`;
        // Sync quick preset selector
        if (quickPresetSelect) quickPresetSelect.value = id;
      } catch (err) {
        console.error('[MIDI CC] Failed to load preset:', err);
        if (statusEl) statusEl.textContent = `Error: ${err.message}`;
      }
    });
  }

  // File import (JSON file from disk)
  if (fileImportBtn) {
    // Create hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileImportBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const preset = await loadMidiPresetFromFile(file);
      if (!preset) {
        alert('Invalid MIDI CC preset file');
        return;
      }
      await applyMidiCCPreset(preset);
      updateCountDisplay();
      if (statusEl) statusEl.textContent = `Loaded: ${preset.name || file.name}`;
      // Reset file input so the same file can be re-selected
      fileInput.value = '';
    });
  }

  // Build the per-param editor in the drawer
  buildMidiCCParamList();
}

function buildMidiCCParamList() {
  const container = document.getElementById('midi-cc-param-list');
  if (!container) return;
  container.innerHTML = '';

  for (let i = 0; i < midiCCMap.length; i++) {
    const p = midiCCMap[i];
    const row = document.createElement('div');
    row.className = 'synth-row midi-cc-param-row';
    row.style.borderLeft = `3px solid ${MIDI_CC_PARAM_COLORS[i] || '#888'}`;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'midi-cc-param-name';
    nameSpan.textContent = `${p.name}`;
    nameSpan.style.flex = '1';
    nameSpan.style.fontSize = '0.75rem';

    const ccSpan = document.createElement('span');
    ccSpan.style.opacity = '0.6';
    ccSpan.style.fontSize = '0.65rem';
    ccSpan.textContent = `CC${p.cc} Ch${p.channel}`;

    row.appendChild(nameSpan);
    row.appendChild(ccSpan);
    container.appendChild(row);
  }
}

// ---- Gamepad ----
function wireGamepad() {
  gamepad = new GamepadInput({
    invertY: true,
    onMove: (x, y) => {
      joyX = x;
      joyY = y;
      drawJoyMap();
      onJoystickMove();
    },
    onButton: (btn) => {
      if (btn === 'lb') onThumbsDown();
      if (btn === 'rb') onThumbsUp();
      if (btn === 'a') onTrain();
      if (btn === 'x') onRandomize();
      if (btn === 'b') onClearExamples();
    },
    onConnectionChange: (connected) => {
      const el = document.getElementById('gamepad-status');
      if (el) el.textContent = connected ? 'Gamepad connected' : 'Press any button to activate gamepad';
    },
  });

  // Show hint immediately if no gamepad detected yet
  if (!gamepad.connected) {
    const el = document.getElementById('gamepad-status');
    if (el) el.textContent = 'Press any gamepad button to connect';
  }
}

// ---- Keyboard ----
function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;

    // Don't intercept keys when an input/select has focus
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.key === '1' || e.code === 'Numpad1') {
      e.preventDefault();
      onThumbsDown();
    } else if (e.key === '2' || e.code === 'Numpad2') {
      e.preventDefault();
      onThumbsUp();
    } else if (e.key === '3' || e.code === 'Numpad3') {
      e.preventDefault();
      if (imlEoc && eocChain?.nispsMode === 'linked') {
        const prevTarget = eocTrainingTarget;
        eocTrainingTarget = 'eoc';
        onThumbsDown();
        eocTrainingTarget = prevTarget;
        flash('eoc-rl-minus');
      }
    } else if (e.key === '4' || e.code === 'Numpad4') {
      e.preventDefault();
      if (imlEoc && eocChain?.nispsMode === 'linked') {
        const prevTarget = eocTrainingTarget;
        eocTrainingTarget = 'eoc';
        onThumbsUp();
        eocTrainingTarget = prevTarget;
        flash('eoc-rl-plus');
      }
    } else if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      onUndo();
    } else if (e.key === 'e' || e.key === 'E') {
      // meml-coh8: open Patch Editor (toggle). Only meaningful in synth mode.
      if (outputMode !== 'synth') return;
      if (!patchEditor) return;
      e.preventDefault();
      if (patchEditor.isOpen && patchEditor.isOpen()) {
        patchEditor.close();
      } else {
        // Prevent modal stacking: close Patch Bay if it's open.
        if (patchBay?.isOpen && patchBay.isOpen()) patchBay.close();
        patchEditor.setContext({
          engine: activeEngine,
          preset: (() => {
            const engineId = activeEngine?.id ?? 'shaper-feedback';
            const presets = getPresetsForEngine(engineId);
            return presets.find(p => p.id === activeSynthPresetId) || null;
          })(),
          sectionView: (si) => getSectionView(si),
          sectionCount: () => {
            const engineId = activeEngine?.id ?? 'shaper-feedback';
            if (engineId === 'shaper-feedback') return SYNTH_SECTIONS.length;
            return nonC15Sections.length;
          },
        });
        patchEditor.open();
      }
    } else if (e.key === 'm' || e.key === 'M') {
      // meml-coh8: open Patch Bay (toggle). Modular engine only.
      if (activeEngine?.id !== 'modular') return;
      if (!patchBay) return;
      e.preventDefault();
      if (patchBay.isOpen && patchBay.isOpen()) {
        patchBay.close();
      } else {
        // Prevent modal stacking: close Patch Editor if it's open.
        if (patchEditor?.isOpen && patchEditor.isOpen()) patchEditor.close();
        patchBay.setEngine(activeEngine);
        patchBay.open();
      }
    }
  });
}

// ---- Quick play controls ----
// ---- Synth Preset Selector ----

/**
 * Rebuild the <select> dropdown options for the current engine's presets.
 * Called on engine switch and at init time.
 */
function rebuildPresetSelector() {
  const $select = document.getElementById('synth-preset-select');
  if (!$select) return;

  const engineId = activeEngine?.id ?? 'shaper-feedback';
  const presets = getPresetsForEngine(engineId);
  const tiers = getPresetTiersForEngine(engineId);

  // Clear existing options
  $select.innerHTML = '';

  // Manual option
  const manualOpt = document.createElement('option');
  manualOpt.value = '';
  manualOpt.textContent = 'Manual';
  $select.appendChild(manualOpt);

  // Group by tier
  for (const tier of tiers) {
    const group = document.createElement('optgroup');
    group.label = tier.label;
    // meml-17mp: prefer unified `complexity`; fall back to legacy `tier` shim.
    const _presetLevel = (p) => p.complexity ?? p.tier;
    for (const preset of presets.filter(p => _presetLevel(p) === tier.tier)) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.name;
      group.appendChild(opt);
    }
    if (group.children.length > 0) {
      $select.appendChild(group);
    }
  }

  // Sync current selection
  if (activeSynthPresetId && presets.some(p => p.id === activeSynthPresetId)) {
    $select.value = activeSynthPresetId;
  } else {
    $select.value = '';
  }
}

function wireSynthPresets() {
  const $select = document.getElementById('synth-preset-select');
  if (!$select) return;

  // Build initial options for the active engine
  rebuildPresetSelector();

  $select.addEventListener('change', () => {
    const val = $select.value;
    if (val === '') {
      // "Manual" selected — clear preset tracking but don't change overrides
      activeSynthPresetId = null;
      saveState();
    } else {
      applyPreset(val);
    }
  });
}

function wireQuickPlayControls() {
  const quickPlay = document.getElementById('quick-play');
  const quickPlayIcon = document.getElementById('quick-play-icon');
  const quickVol = document.getElementById('quick-vol');
  const quickBpm = document.getElementById('quick-bpm');
  const quickBpmVal = document.getElementById('quick-bpm-val');

  if (!quickPlay || !quickPlayIcon || !quickVol || !quickBpm) return;

  const playIconSVG = '<path d="M4 2l10 6-10 6z"/>';
  const pauseIconSVG = '<rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/>';

  function updatePlayIcon() {
    const isPlaying = c15 && c15.running;
    quickPlayIcon.innerHTML = isPlaying ? pauseIconSVG : playIconSVG;
    quickPlay.classList.toggle('playing', isPlaying);
    quickPlay.classList.toggle('audio-needs-init', !isPlaying);
  }

  quickPlay.addEventListener('click', async () => {
    if (c15.running) {
      if (shapeSeqEnabled && shapeSeqEngine) shapeSeqEngine.stop();
      else arpeggiator.stop();
      await c15.stop();
      // Also update the bottom sheet controls
      const startBtn = document.getElementById('synth-start');
      const arpToggle = document.getElementById('arp-toggle');
      if (startBtn) startBtn.textContent = 'Start Audio';
      if (arpToggle) arpToggle.textContent = 'Play';
    } else {
      await activeEngine.init();
      await _startEocChain();
      if (shapeSeqEnabled) {
        await _ensureShapeSeqInit();
        if (shapeSeqEngine) shapeSeqEngine.start();
      } else {
        arpeggiator.start();
      }
      routeOutputs(iml.getOutputs());
      // Also update the bottom sheet controls
      const startBtn = document.getElementById('synth-start');
      const arpToggle = document.getElementById('arp-toggle');
      if (startBtn) startBtn.textContent = 'Stop Audio';
      if (arpToggle) arpToggle.textContent = 'Stop';
    }
    updatePlayIcon();
  });

  quickVol.addEventListener('input', (e) => {
    c15.setMasterVolume(parseFloat(e.target.value));
    // Sync with bottom sheet volume slider
    const sheetVol = document.getElementById('synth-volume');
    if (sheetVol) sheetVol.value = e.target.value;
  });

  quickBpm.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    arpeggiator.bpm = val;
    quickBpmVal.textContent = val;
    // Sync with bottom sheet tempo slider
    const sheetTempo = document.getElementById('arp-tempo');
    const sheetTempoVal = document.getElementById('tempo-val');
    if (sheetTempo) sheetTempo.value = val;
    if (sheetTempoVal) sheetTempoVal.textContent = val;
  });
}

// ---- Group Override Drawer ----
let $groupDrawer = null;
let activeDrawerSection = -1;
let drawerHideTimer = null;

// ---- Heatmap param popup ----
let $paramPopup = null;
let activePopupParam = -1;
let popupHideTimer = null;

function wireGroupDrawer() {
  // Create the drawer DOM element once
  $groupDrawer = document.createElement('div');
  $groupDrawer.className = 'group-drawer';
  $groupDrawer.innerHTML = '<div class="group-drawer-header"></div><div class="group-drawer-body"></div>';
  document.body.appendChild($groupDrawer);

  // Keep drawer open while hovering over it
  $groupDrawer.addEventListener('pointerenter', () => {
    clearTimeout(drawerHideTimer);
  });
  $groupDrawer.addEventListener('pointerleave', () => {
    drawerHideTimer = setTimeout(() => hideGroupDrawer(), 300);
  });

  // Detect hover over section labels on the synth vis canvas
  $synthVisCanvas.addEventListener('pointermove', (e) => {
    if (outputMode !== 'synth') return;
    const region = synthVisualizer.hitTestSection(e.clientX, e.clientY);
    if (region) {
      clearTimeout(drawerHideTimer);
      if (activeDrawerSection !== region.index) {
        showGroupDrawer(region);
      }
    } else {
      // Leaving section label area, delay hide
      if (activeDrawerSection >= 0) {
        drawerHideTimer = setTimeout(() => hideGroupDrawer(), 300);
      }
    }
  });

  // Also handle click for mobile
  $synthVisCanvas.addEventListener('pointerdown', (e) => {
    if (outputMode !== 'synth') return;
    const region = synthVisualizer.hitTestSection(e.clientX, e.clientY);
    if (region) {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(drawerHideTimer);
      if (activeDrawerSection === region.index) {
        hideGroupDrawer();
      } else {
        showGroupDrawer(region);
      }
    }
  }, true); // capture phase so it fires before bar interaction
}

/**
 * Uniform view of a "section" (aka param group) for the active engine.
 *
 * meml-17mp: single codepath. Sections are derived from `paramMeta.group`
 * for every engine (see `rebuildNonC15Sections`). Per-param overrides are
 * dispatched to the engine-appropriate store:
 *   - C15 (`shaper-feedback`): `groupOverrides[si].params[li]` (seeded from
 *     SYNTH_PARAM_MAP safeMin/safeMax + tame).
 *   - Faust engines (modular/additive/fm): `engineParamOverrides[startIdx+li]`.
 *
 * The `column` field (`Sound | Modulation | Routing`) comes from
 * `group-columns.js:getColumn()` and is what the Patch Editor modal
 * (meml-n3uh) will consume.
 *
 * Returns { name, color, count, startIndex, column, getCurve, setCurve,
 *           getParamName, getParamOverride } or null.
 */
function getSectionView(sectionIndex) {
  const sec = nonC15Sections[sectionIndex];
  if (!sec) return null;
  const start = sec.startIndex;
  const engineId = activeEngine?.id ?? '';
  const engineKey = engineId === 'shaper-feedback' ? 'c15' : engineId;
  const column = getGroupColumn(engineKey, sec.name);

  // Resolve storage dispatch. For C15, overrides live in groupOverrides[si].
  // For Faust engines, overrides live in the flat engineParamOverrides.
  const isC15 = engineId === 'shaper-feedback';

  const getCurve = () => {
    if (isC15) return groupOverrides[sectionIndex]?.curve ?? 0.5;
    return nonC15GroupCurves[sectionIndex] ?? 0.5;
  };
  const setCurve = (v) => {
    if (isC15) {
      if (groupOverrides[sectionIndex]) groupOverrides[sectionIndex].curve = v;
    } else {
      nonC15GroupCurves[sectionIndex] = v;
      _nonC15GroupCurveMemory.set(sec.name, v);
    }
  };
  const getParamName = (li) => {
    const pm = activeEngine?.paramMeta?.[start + li];
    return pm?.name ?? `p${start + li}`;
  };
  const getParamOverride = (li) => {
    if (isC15) return groupOverrides[sectionIndex]?.params?.[li] ?? null;
    if (!engineParamOverrides) return null;
    return engineParamOverrides[start + li];
  };

  return {
    name: sec.name,
    color: sec.color,
    count: sec.count,
    startIndex: start,
    column,
    getCurve,
    setCurve,
    getParamName,
    getParamOverride,
  };
}

function showGroupDrawer(region) {
  const view = getSectionView(region.index);
  if (!view) return;
  activeDrawerSection = region.index;

  // Header with section name
  const header = $groupDrawer.querySelector('.group-drawer-header');
  header.textContent = view.name;
  header.style.color = view.color;

  // Body: group curve + per-param rows
  const body = $groupDrawer.querySelector('.group-drawer-body');
  body.innerHTML = '';

  // -- Group master curve (draggable canvas) --
  const curveRow = document.createElement('div');
  curveRow.className = 'gd-curve-row';

  const curveLabel = document.createElement('span');
  curveLabel.className = 'gd-label';
  curveLabel.textContent = 'Group';

  const curveCanvas = document.createElement('canvas');
  curveCanvas.className = 'gd-curve-canvas';
  curveCanvas.width = 48;
  curveCanvas.height = 48;

  const curveVal = document.createElement('span');
  curveVal.className = 'gd-val';
  curveVal.textContent = view.getCurve().toFixed(2);

  function drawGroupCurvePreview() {
    _drawCurveOnCanvas(curveCanvas, view.getCurve(), view.color);
  }

  // Vertical drag on group curve — applies relative delta to all param curves
  {
    let dragging = false, startY = 0, startGroupCurve = 0, startParamCurves = [];
    curveCanvas.style.cursor = 'ns-resize';
    curveCanvas.style.touchAction = 'none';
    curveCanvas.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      dragging = true;
      startY = e.clientY;
      startGroupCurve = view.getCurve();
      startParamCurves = [];
      for (let i = 0; i < view.count; i++) {
        startParamCurves.push(view.getParamOverride(i)?.curve ?? 0.5);
      }
      curveCanvas.setPointerCapture(e.pointerId);
    });
    curveCanvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const dy = e.clientY - startY;
      const delta = dy / 80;
      const newGroup = Math.max(0, Math.min(1, startGroupCurve + delta));
      view.setCurve(newGroup);
      curveVal.textContent = newGroup.toFixed(2);
      // Apply same delta to each param, preserving relative offsets
      for (let i = 0; i < view.count; i++) {
        const pov = view.getParamOverride(i);
        if (pov) pov.curve = Math.max(0, Math.min(1, startParamCurves[i] + delta));
      }
      drawGroupCurvePreview();
      body.querySelectorAll('.gd-param-curve-canvas').forEach(c => {
        if (c._redraw) c._redraw();
      });
      routeOutputs(iml.getOutputs());
    });
    curveCanvas.addEventListener('pointerup', () => { dragging = false; });
    curveCanvas.addEventListener('pointercancel', () => { dragging = false; });
  }

  curveRow.appendChild(curveLabel);
  curveRow.appendChild(curveCanvas);
  curveRow.appendChild(curveVal);
  body.appendChild(curveRow);
  drawGroupCurvePreview();

  // -- Per-param rows --
  for (let li = 0; li < view.count; li++) {
    const pov = view.getParamOverride(li);
    if (!pov) continue;
    const paramName = view.getParamName(li);

    const row = document.createElement('div');
    row.className = 'gd-param-row';
    if (pov.muted) row.classList.add('gd-muted');

    // Name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'gd-param-name';
    nameSpan.textContent = paramName;

    // Per-param curve canvas (vertically draggable, no slider)
    const pCurveCanvas = document.createElement('canvas');
    pCurveCanvas.className = 'gd-param-curve-canvas';
    pCurveCanvas.width = 28;
    pCurveCanvas.height = 28;
    pCurveCanvas._redraw = () => _drawCurveOnCanvas(pCurveCanvas, pov.curve, view.color);

    _wireCurveDrag(pCurveCanvas, () => pov.curve, (v) => {
      pov.curve = v;
      pCurveCanvas._redraw();
      routeOutputs(iml.getOutputs());
    });
    pCurveCanvas._redraw();

    // Dual-range slider (min/max as two overlapping range inputs)
    const rangeWrap = document.createElement('div');
    rangeWrap.className = 'gd-range-wrap';

    const rangeFill = document.createElement('div');
    rangeFill.className = 'gd-range-fill';

    const minSlider = document.createElement('input');
    minSlider.type = 'range'; minSlider.min = '0'; minSlider.max = '1'; minSlider.step = '0.01';
    minSlider.value = pov.min;
    minSlider.className = 'gd-range-input gd-range-min';

    const maxSlider = document.createElement('input');
    maxSlider.type = 'range'; maxSlider.min = '0'; maxSlider.max = '1'; maxSlider.step = '0.01';
    maxSlider.value = pov.max;
    maxSlider.className = 'gd-range-input gd-range-max';

    // Value slider (shown when muted)
    const valSlider = document.createElement('input');
    valSlider.type = 'range'; valSlider.min = '0'; valSlider.max = '1'; valSlider.step = '0.01';
    valSlider.value = pov.fixedValue;
    valSlider.className = 'gd-val-slider';

    function updateRangeFill() {
      rangeFill.style.left = `${pov.min * 100}%`;
      rangeFill.style.width = `${(pov.max - pov.min) * 100}%`;
    }
    updateRangeFill();

    minSlider.addEventListener('input', () => {
      pov.min = parseFloat(minSlider.value);
      if (pov.min > pov.max) { pov.max = pov.min; maxSlider.value = pov.max; }
      updateRangeFill();
      routeOutputs(iml.getOutputs());
    });
    maxSlider.addEventListener('input', () => {
      pov.max = parseFloat(maxSlider.value);
      if (pov.max < pov.min) { pov.min = pov.max; minSlider.value = pov.min; }
      updateRangeFill();
      routeOutputs(iml.getOutputs());
    });
    valSlider.addEventListener('input', () => {
      pov.fixedValue = parseFloat(valSlider.value);
      routeOutputs(iml.getOutputs());
    });

    rangeWrap.appendChild(rangeFill);
    rangeWrap.appendChild(minSlider);
    rangeWrap.appendChild(maxSlider);

    // Mute toggle
    const muteBtn = document.createElement('button');
    muteBtn.className = 'gd-mute-btn' + (pov.muted ? ' muted' : '');
    muteBtn.textContent = pov.muted ? 'M' : 'M';
    muteBtn.title = pov.muted ? 'Unmute (re-enable NISPS control)' : 'Mute (remove from NISPS)';

    muteBtn.addEventListener('click', () => {
      pov.muted = !pov.muted;
      muteBtn.classList.toggle('muted', pov.muted);
      muteBtn.title = pov.muted ? 'Unmute (re-enable NISPS control)' : 'Mute (remove from NISPS)';
      row.classList.toggle('gd-muted', pov.muted);
      routeOutputs(iml.getOutputs());
    });

    row.appendChild(nameSpan);
    row.appendChild(pCurveCanvas);
    row.appendChild(rangeWrap);
    row.appendChild(valSlider);
    row.appendChild(muteBtn);
    body.appendChild(row);
  }

  // Position the drawer below the section label
  const canvasRect = $synthVisCanvas.getBoundingClientRect();
  const centerX = (region.left + region.right) / 2 + canvasRect.left;
  const topY = region.bottom + canvasRect.top + 4;

  const drawerWidth = 320;
  let left = centerX - drawerWidth / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - drawerWidth - 4));

  $groupDrawer.style.left = `${left}px`;
  $groupDrawer.style.top = `${topY}px`;
  $groupDrawer.classList.add('visible');
}

/** Draw a curve preview on a canvas element */
function _drawCurveOnCanvas(canvas, curveFactor, color) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(0, 0, w, h);

  // Linear reference
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w, 0);
  ctx.stroke();

  // Curve
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.min(2, w / 16);
  ctx.beginPath();
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const v = applyCurve(t, curveFactor);
    const px = t * w;
    const py = (1 - v) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

/** Wire vertical drag on a canvas to control a curve factor */
function _wireCurveDrag(canvas, getter, setter) {
  let dragging = false;
  let startY = 0;
  let startVal = 0;

  canvas.style.cursor = 'ns-resize';
  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startY = e.clientY;
    startVal = getter();
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    // Drag down = more exponential (higher curve), drag up = more logarithmic (lower curve)
    const dy = e.clientY - startY;
    const newVal = Math.max(0, Math.min(1, startVal + dy / 80));
    setter(newVal);
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
}

function hideGroupDrawer() {
  activeDrawerSection = -1;
  if ($groupDrawer) $groupDrawer.classList.remove('visible');
}

// ---- Resize ----
function onResize() {
  hideGroupDrawer();
  hideParamPopup();
  visualizer.resize();
  visualizer.initParticles();
  synthVisualizer.resize();

  // Resize joy-map canvas to match container
  const size = $joystickContainer.offsetWidth;
  if (size > 0) {
    $joyMap.width = size;
    $joyMap.height = size;
    drawJoyMap();
  }
}

// ---- Help modal ----
function wireHelp() {
  const overlay = document.getElementById('help-overlay');
  const btnClose = document.getElementById('help-close');
  const btnGotIt = document.getElementById('help-got-it');

  function hide() { overlay.classList.add('hidden'); localStorage.setItem('nisps-help-seen', '1'); }

  // Help is opened via dock icon (handled in wireDock)
  btnClose.addEventListener('click', hide);
  btnGotIt.addEventListener('click', hide);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });

  // Show on first visit
  if (!localStorage.getItem('nisps-help-seen')) overlay.classList.remove('hidden');
}

// ---- Animation ----
function animate() {
  if (gamepad) gamepad.poll();
  if (outputMode === 'synth') {
    synthVisualizer.draw();
  } else if (outputMode === 'visual') {
    visualizer.draw();
  }
  requestAnimationFrame(animate);
}

// ---- Utility ----
function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 250);
}

// ---- EOC Linked/Independent-mode IML helpers ----

/**
 * Create (or recreate) the EOC IML instance for Linked/Independent mode.
 * Uses a smaller network than the synth IML since EOC params are more independent.
 */
async function initEocIML() {
  if (imlEoc) { imlEoc.destroy(); imlEoc = null; }
  if (!eocChain || eocChain.paramCount === 0) return;
  imlEoc = await WasmIML.create(
    N_JOY_INPUTS,
    eocChain.paramCount,
    [16, 32],   // smaller network — EOC params are more independent
    1000, 1.0, 0.00001,
  );
  imlEoc.randomiseWeights(spreadLevel);
  console.log(`[EOC] IML created (${eocChain.nispsMode}) — ${eocChain.paramCount} outputs`);
}

/** Destroy the EOC IML instance (e.g. when leaving Linked/Independent mode). */
function destroyEocIML() {
  if (imlEoc) {
    imlEoc.destroy();
    imlEoc = null;
    console.log('[EOC] Linked IML destroyed');
  }
}

// ---- Persistence ----
function saveState() {
  try {
    const state = {
      features: imlJoy.dataset.features,
      labels: imlJoy.dataset.labels,
      handFeatures: imlHand.dataset.features,
      handLabels: imlHand.dataset.labels,
      noiseLevel,
      outputMode,
      inputMode,
      joyX,
      joyY,
      groupOverrides,
      visualOverrides,
      midiCCOverrides,
      audioCanvasState: audioCanvas ? audioCanvas.getState() : null,
      synthPresetId: activeSynthPresetId,
      engineId: activeEngine ? activeEngine.id : 'shaper-feedback',
      // EOC state
      eocModules: eocChain ? eocChain.modules.map(m => ({
        id: m.id,
        enabled: m.enabled,
        params: m.paramMeta.map((_, i) => m.getCurrentParamValue(i)),
      })) : [],
      eocNispsMode: eocChain ? eocChain.nispsMode : 'bypass',
      eocTrainingTarget,
      // Phase E — full modular DSP snapshot. Only stored when the active
      // engine is the modular engine. Contains raw per-label values; the
      // UI-facing state (sub-engine choice, counts, enables, exposed params)
      // lives in a separate localStorage key 'nisps-modular-state' owned by
      // modular-ui.js. On load we apply the UI state first (sub-engine swap,
      // counts) and then this dsp dict overwrites any default values.
      modularDspState: (activeEngine && activeEngine.id === 'modular' &&
                        typeof activeEngine.getState === 'function')
        ? (() => {
            const s = activeEngine.getState();
            // Strip fields already owned by Phase C's UI state key to keep a
            // single source of truth per field.
            return { version: s.version, dsp: s.dsp };
          })()
        : null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[NISPS] Failed to save state:', e);
  }
}

async function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);

    // Restore joystick IML training data (pad old 20-element labels to N_OUTPUTS)
    if (state.features && state.labels && state.features.length > 0) {
      for (let i = 0; i < state.features.length; i++) {
        imlJoy.addExample(state.features[i], padPresetOutputs(state.labels[i]));
      }
      const prevIml = iml;
      iml = imlJoy;
      trainModel();
      iml = prevIml;
    }

    // Restore hand IML training data
    if (state.handFeatures && state.handLabels && state.handFeatures.length > 0) {
      for (let i = 0; i < state.handFeatures.length; i++) {
        imlHand.addExample(state.handFeatures[i], padPresetOutputs(state.handLabels[i]));
      }
      const prevIml = iml;
      iml = imlHand;
      trainModel();
      iml = prevIml;
    }

    routeOutputs(iml.getOutputs());

    if (typeof state.noiseLevel === 'number') noiseLevel = state.noiseLevel;
    if (typeof state.joyX === 'number') joyX = state.joyX;
    if (typeof state.joyY === 'number') joyY = state.joyY;

    // Restore group overrides
    if (state.groupOverrides && Array.isArray(state.groupOverrides)) {
      for (let si = 0; si < state.groupOverrides.length && si < groupOverrides.length; si++) {
        const saved = state.groupOverrides[si];
        if (typeof saved.curve === 'number') groupOverrides[si].curve = saved.curve;
        if (Array.isArray(saved.params)) {
          for (let li = 0; li < saved.params.length && li < groupOverrides[si].params.length; li++) {
            const sp = saved.params[li], gp = groupOverrides[si].params[li];
            if (typeof sp.min === 'number') gp.min = sp.min;
            if (typeof sp.max === 'number') gp.max = sp.max;
            if (typeof sp.curve === 'number') gp.curve = sp.curve;
            if (typeof sp.muted === 'boolean') gp.muted = sp.muted;
            if (typeof sp.fixedValue === 'number') gp.fixedValue = sp.fixedValue;
          }
        }
      }
    }

    // Restore visual overrides
    if (Array.isArray(state.visualOverrides)) {
      for (let i = 0; i < state.visualOverrides.length && i < visualOverrides.length; i++) {
        const sv = state.visualOverrides[i], vo = visualOverrides[i];
        if (typeof sv.min === 'number') vo.min = sv.min;
        if (typeof sv.max === 'number') vo.max = sv.max;
        if (typeof sv.curve === 'number') vo.curve = sv.curve;
        if (typeof sv.frozen === 'boolean') vo.frozen = sv.frozen;
        if (typeof sv.fixedValue === 'number') vo.fixedValue = sv.fixedValue;
      }
    }

    // Restore MIDI CC overrides
    if (Array.isArray(state.midiCCOverrides)) {
      for (let i = 0; i < state.midiCCOverrides.length && i < midiCCOverrides.length; i++) {
        const sv = state.midiCCOverrides[i], ov = midiCCOverrides[i];
        if (typeof sv.min === 'number') ov.min = sv.min;
        if (typeof sv.max === 'number') ov.max = sv.max;
        if (typeof sv.curve === 'number') ov.curve = sv.curve;
        if (typeof sv.frozen === 'boolean') ov.frozen = sv.frozen;
        if (typeof sv.fixedValue === 'number') ov.fixedValue = sv.fixedValue;
      }
    }

    // Restore synth preset id (just track it, don't re-apply — groupOverrides already restored above)
    if (typeof state.synthPresetId === 'string') {
      activeSynthPresetId = state.synthPresetId;
    }

    // Restore audio canvas state (pan/zoom/submode)
    if (state.audioCanvasState && audioCanvas) {
      audioCanvas.setState(state.audioCanvasState);
    }

    // Restore output mode
    if (state.outputMode && state.outputMode !== outputMode) {
      await setOutputMode(state.outputMode, { skipConfirm: true });
      syncOutputToggles(outputMode);
    }

    // Note: don't auto-restore inputMode='hands' — requires camera permission

    // Restore engine selection — sync switcher highlight; deferred engine init
    // happens on first audio-start click (Faust engines require a running AudioContext).
    if (typeof state.engineId === 'string') {
      EngineSwitcher.setActive(activeEngine ? activeEngine.id : 'shaper-feedback');
    }

    // Phase E — stash modular DSP state so it can be applied once the
    // ModularEngine instance actually exists. Applied either right now (if
    // the active engine is already modular) or later from the engine-switch
    // handler when the user clicks the Modular card.
    if (state.modularDspState && typeof state.modularDspState === 'object') {
      _pendingModularDspState = state.modularDspState;
      if (activeEngine?.id === 'modular' && typeof activeEngine.setState === 'function') {
        try {
          await activeEngine.setState(_pendingModularDspState);
          _pendingModularDspState = null;
        } catch (err) {
          console.warn('[NISPS] modular setState on load failed:', err);
        }
      }
    }

    // Restore EOC chain state (modules, enabled flags, param values, nispsMode)
    if (eocChain && Array.isArray(state.eocModules) && state.eocModules.length > 0) {
      for (const saved of state.eocModules) {
        // Only add if not already in the chain
        if (!eocChain.getModule(saved.id)) {
          try {
            eocChain.addModule(moduleFactory(saved.id));
          } catch (e) {
            console.warn(`[EOC] Could not restore module '${saved.id}':`, e.message);
            continue;
          }
        }
        const mod = eocChain.getModule(saved.id);
        if (mod) {
          mod.enabled = saved.enabled ?? true;
          if (Array.isArray(saved.params)) {
            saved.params.forEach((v, i) => mod.setParam(i, v));
          }
        }
      }
    }
    if (eocChain && typeof state.eocNispsMode === 'string') {
      try { eocChain.nispsMode = state.eocNispsMode; } catch (_) { /* invalid mode in old save */ }
    }

    // Restore EOC training target
    if (state.eocTrainingTarget === 'synth' || state.eocTrainingTarget === 'eoc') {
      eocTrainingTarget = state.eocTrainingTarget;
    }

    console.log(`[NISPS] Restored ${state.features?.length || 0} joy examples, ${state.handFeatures?.length || 0} hand examples from storage`);
  } catch (e) {
    console.warn('[NISPS] Failed to load state:', e);
  }
}

// Registered at init time so session-memory.js can surface user-visible
// errors without importing DOM-aware code.
if (typeof window !== 'undefined') {
  window.__nispsShowToast = (msg) => showToast(msg);
}

function showToast(message, durationMs = 2500) {
  let toast = document.getElementById('nisps-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'nisps-toast';
    toast.className = 'nisps-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('visible'), durationMs);
}

function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[NISPS] Failed to clear state:', e);
  }
}

// ---- Start ----
document.addEventListener('DOMContentLoaded', init);
