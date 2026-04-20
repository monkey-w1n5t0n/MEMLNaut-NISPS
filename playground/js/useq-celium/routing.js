// Per-channel routing for uSEQ-Celium browser mode.
//
// 14 output channels in a fixed order:
//   idx 0..2  — hard gates   (binary)
//   idx 3..5  — main CV      (continuous [0,1])
//   idx 6..13 — expander CV  (continuous [0,1])
//
// Each channel has a mode + source. The router takes voice-engine output
// (gates/velocities) + the CV-MLP output vector and produces a wire-ready
// StateSnapshot input: { gates: boolean[3], cvMain: number[3], cvExp: number[8] }.
//
// Design notes:
//   - Pure logic, no DOM, no events. Held by the composer; mutated by the
//     routing-ui. Snapshotted for session persistence.
//   - Missing / out-of-range sources collapse to 0 so a mis-configured channel
//     never crashes the producer loop.
//   - Validation happens at set-time (setChannelConfig throws on bad combos).
//     compute() is fast-path only — it trusts the stored configs.

export const CHANNEL_COUNT = 14;
export const HARD_GATE_COUNT = 3;
export const CV_COUNT = 11; // 3 main + 8 exp
export const MAIN_CV_COUNT = 3;
export const EXP_CV_COUNT = 8;

// Voice / MLP limits — kept in sync with VoiceEngine.PARAMS_PER_VOICE and
// DualMLPManager's cv arch default. 4 voices max, 11 CV outputs max.
const MAX_VOICES = 4;
const MAX_CV_MLP = CV_COUNT;

const VALID_GATE_MODES = new Set(['gate']);
const VALID_CV_MODES = new Set(['continuous', 'dynamic-gate']);

/** Is this channel index a hard gate? */
function isGateIdx(idx) { return idx >= 0 && idx < HARD_GATE_COUNT; }
/** Is this channel index a CV (main or exp)? */
function isCvIdx(idx) { return idx >= HARD_GATE_COUNT && idx < CHANNEL_COUNT; }

/**
 * Parse a source string. Returns { kind: 'voice'|'cv-mlp'|'static'|'none', idx } or null.
 * @param {string} src
 */
function parseSource(src) {
  if (src === 'none') return { kind: 'none', idx: -1 };
  if (src === 'static') return { kind: 'static', idx: -1 };
  const mVoice = /^voice-(\d+)$/.exec(src);
  if (mVoice) return { kind: 'voice', idx: parseInt(mVoice[1], 10) };
  const mCv = /^cv-mlp-(\d+)$/.exec(src);
  if (mCv) return { kind: 'cv-mlp', idx: parseInt(mCv[1], 10) };
  return null;
}

/**
 * Validate + normalise a channel config. Throws on invalid combos.
 * @param {number} channelIdx
 * @param {object} cfg
 * @returns {object} a frozen, validated config
 */
function validateConfig(channelIdx, cfg) {
  if (!cfg || typeof cfg !== 'object') {
    throw new Error(`ChannelRouter: channel ${channelIdx} config must be an object`);
  }
  const { mode, source } = cfg;
  const parsed = typeof source === 'string' ? parseSource(source) : null;

  if (isGateIdx(channelIdx)) {
    if (!VALID_GATE_MODES.has(mode)) {
      throw new Error(`ChannelRouter: gate channel ${channelIdx} mode must be 'gate', got '${mode}'`);
    }
    // Valid gate sources: voice-N or none
    if (!parsed || (parsed.kind !== 'voice' && parsed.kind !== 'none')) {
      throw new Error(`ChannelRouter: gate channel ${channelIdx} source must be 'voice-N' or 'none', got '${source}'`);
    }
    if (parsed.kind === 'voice' && (parsed.idx < 0 || parsed.idx >= MAX_VOICES)) {
      throw new Error(`ChannelRouter: gate channel ${channelIdx} voice index ${parsed.idx} out of range [0,${MAX_VOICES - 1}]`);
    }
    return Object.freeze({ mode: 'gate', source });
  }

  if (isCvIdx(channelIdx)) {
    if (!VALID_CV_MODES.has(mode)) {
      throw new Error(`ChannelRouter: cv channel ${channelIdx} mode must be 'continuous' or 'dynamic-gate', got '${mode}'`);
    }
    if (mode === 'continuous') {
      if (!parsed || (parsed.kind !== 'cv-mlp' && parsed.kind !== 'static')) {
        throw new Error(`ChannelRouter: cv channel ${channelIdx} continuous source must be 'cv-mlp-N' or 'static', got '${source}'`);
      }
      if (parsed.kind === 'cv-mlp' && (parsed.idx < 0 || parsed.idx >= MAX_CV_MLP)) {
        throw new Error(`ChannelRouter: cv channel ${channelIdx} cv-mlp index ${parsed.idx} out of range [0,${MAX_CV_MLP - 1}]`);
      }
      const out = { mode: 'continuous', source };
      if (parsed.kind === 'static') {
        const sv = Number.isFinite(cfg.staticValue) ? cfg.staticValue : 0;
        out.staticValue = Math.max(0, Math.min(1, sv));
      }
      return Object.freeze(out);
    }
    // dynamic-gate
    if (!parsed || parsed.kind !== 'voice') {
      throw new Error(`ChannelRouter: cv channel ${channelIdx} dynamic-gate source must be 'voice-N', got '${source}'`);
    }
    if (parsed.idx < 0 || parsed.idx >= MAX_VOICES) {
      throw new Error(`ChannelRouter: cv channel ${channelIdx} voice index ${parsed.idx} out of range [0,${MAX_VOICES - 1}]`);
    }
    return Object.freeze({ mode: 'dynamic-gate', source });
  }

  throw new Error(`ChannelRouter: invalid channel index ${channelIdx}`);
}

export class ChannelRouter {
  /**
   * @param {object[]|null} initialConfigs  array of 14 per-channel configs; null → defaults
   */
  constructor(initialConfigs = null) {
    this._configs = new Array(CHANNEL_COUNT);
    const src = initialConfigs || ChannelRouter.sensibleDefaults();
    this.importConfigs(src);
  }

  /**
   * Build the default routing:
   *   gate0..2  → voice 0..2
   *   cvMain0..2 → cv-mlp 0..2 continuous
   *   cvExp0..7  → cv-mlp 3..10 continuous
   * @returns {object[]}
   */
  static sensibleDefaults() {
    const out = new Array(CHANNEL_COUNT);
    for (let i = 0; i < HARD_GATE_COUNT; i++) {
      out[i] = { mode: 'gate', source: `voice-${i}` };
    }
    for (let i = 0; i < CV_COUNT; i++) {
      out[HARD_GATE_COUNT + i] = { mode: 'continuous', source: `cv-mlp-${i}` };
    }
    return out;
  }

  /**
   * Replace a single channel's config. Validates + throws on invalid combos.
   */
  setChannelConfig(channelIdx, cfg) {
    if (!Number.isInteger(channelIdx) || channelIdx < 0 || channelIdx >= CHANNEL_COUNT) {
      throw new Error(`ChannelRouter.setChannelConfig: channel ${channelIdx} out of range`);
    }
    this._configs[channelIdx] = validateConfig(channelIdx, cfg);
  }

  /** Return a (plain) copy of the channel's config. */
  getChannelConfig(channelIdx) {
    if (!Number.isInteger(channelIdx) || channelIdx < 0 || channelIdx >= CHANNEL_COUNT) {
      throw new Error(`ChannelRouter.getChannelConfig: channel ${channelIdx} out of range`);
    }
    return { ...this._configs[channelIdx] };
  }

  /** Return a snapshot array of all configs. */
  getAllConfigs() {
    return this._configs.map((c) => ({ ...c }));
  }

  /**
   * Replace all configs at once. Validates each; on any failure the router
   * is left in its prior state.
   */
  importConfigs(configs) {
    if (!Array.isArray(configs) || configs.length !== CHANNEL_COUNT) {
      throw new Error(`ChannelRouter.importConfigs: expected array of length ${CHANNEL_COUNT}, got ${configs?.length}`);
    }
    const validated = new Array(CHANNEL_COUNT);
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      validated[i] = validateConfig(i, configs[i]);
    }
    for (let i = 0; i < CHANNEL_COUNT; i++) this._configs[i] = validated[i];
  }

  /**
   * Produce wire-ready inputs for encodeStateSnapshot.
   *
   * @param {{gates: boolean[]|number[], velocities: number[]}} voiceState
   *   from voiceEngine.tick()
   * @param {Float32Array|number[]|null} cvOutputs
   *   length 11, values in [0,1], from dualMlp.getCVOutputs() — may be null
   *   before first right-stick move
   * @returns {{gates: boolean[], cvMain: number[], cvExp: number[]}}
   *   gates:  length 3, booleans
   *   cvMain: length 3, values in [0,1]
   *   cvExp:  length 8, values in [0,1]
   */
  compute(voiceState, cvOutputs) {
    const vGates = voiceState?.gates || null;
    const vVels = voiceState?.velocities || null;
    const voiceCount = vGates ? vGates.length : 0;

    const gates = new Array(HARD_GATE_COUNT);
    const cvMain = new Array(MAIN_CV_COUNT);
    const cvExp = new Array(EXP_CV_COUNT);

    for (let idx = 0; idx < CHANNEL_COUNT; idx++) {
      const cfg = this._configs[idx];
      const value = this._evalChannel(cfg, vGates, vVels, voiceCount, cvOutputs, idx);

      if (idx < HARD_GATE_COUNT) {
        // Binary gate output
        gates[idx] = !!value;
      } else if (idx < HARD_GATE_COUNT + MAIN_CV_COUNT) {
        cvMain[idx - HARD_GATE_COUNT] = clamp01(value);
      } else {
        cvExp[idx - HARD_GATE_COUNT - MAIN_CV_COUNT] = clamp01(value);
      }
    }

    return { gates, cvMain, cvExp };
  }

  // ---------------------------------------------------------------------------
  _evalChannel(cfg, vGates, vVels, voiceCount, cvOutputs, channelIdx) {
    if (!cfg) return 0;
    const parsed = parseSource(cfg.source);
    if (!parsed) return 0;

    if (cfg.mode === 'gate') {
      // Hard gate channel
      if (parsed.kind === 'none') return 0;
      if (parsed.kind === 'voice') {
        const vi = parsed.idx;
        if (vi >= voiceCount) return 0;
        return vGates && vGates[vi] ? 1 : 0;
      }
      return 0;
    }

    if (cfg.mode === 'continuous') {
      if (parsed.kind === 'static') {
        return Number.isFinite(cfg.staticValue) ? cfg.staticValue : 0;
      }
      if (parsed.kind === 'cv-mlp') {
        if (!cvOutputs) return 0;
        const v = cvOutputs[parsed.idx];
        return Number.isFinite(v) ? v : 0;
      }
      return 0;
    }

    if (cfg.mode === 'dynamic-gate') {
      if (parsed.kind !== 'voice') return 0;
      const vi = parsed.idx;
      if (vi >= voiceCount) return 0;
      if (!vGates || !vGates[vi]) return 0;
      const vel = vVels ? vVels[vi] : 0;
      return Number.isFinite(vel) ? vel : 0;
    }

    return 0;
  }
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
