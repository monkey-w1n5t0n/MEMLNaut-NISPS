/**
 * OutputRouter — maps dual MLP outputs to 14 hardware outputs
 * with dynamic CV/Gate assignment.
 *
 * Hardware outputs (14 total):
 *   Main uSEQ: a1, a2, a3 (CV/PWM 11-bit), d1, d2, d3 (digital gate only)
 *   Expander:  e1-e8 (CV/PWM 11-bit)
 *
 * Serial output order: [a1, a2, a3, d1, d2, d3, e1, e2, e3, e4, e5, e6, e7, e8]
 */

// Output definitions with hardware properties
const OUTPUT_DEFS = [
  { id: 'a1', index: 0, cvCapable: true, toggleable: true },
  { id: 'a2', index: 1, cvCapable: true, toggleable: true },
  { id: 'a3', index: 2, cvCapable: true, toggleable: true },
  { id: 'd1', index: 3, cvCapable: false, toggleable: false },
  { id: 'd2', index: 4, cvCapable: false, toggleable: false },
  { id: 'd3', index: 5, cvCapable: false, toggleable: false },
  { id: 'e1', index: 6, cvCapable: true, toggleable: true },
  { id: 'e2', index: 7, cvCapable: true, toggleable: true },
  { id: 'e3', index: 8, cvCapable: true, toggleable: true },
  { id: 'e4', index: 9, cvCapable: true, toggleable: true },
  { id: 'e5', index: 10, cvCapable: true, toggleable: true },
  { id: 'e6', index: 11, cvCapable: true, toggleable: true },
  { id: 'e7', index: 12, cvCapable: true, toggleable: true },
  { id: 'e8', index: 13, cvCapable: true, toggleable: true },
];

// Gate assignment priority for extra sequences beyond d1-d3
const GATE_PRIORITY = ['a1', 'a2', 'a3', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'];

const MAX_SEQUENCES = 4;
const PARAMS_PER_SEQUENCE = 8;
const SEQ_PARAM_NAMES = ['ratio1', 'ratio2', 'ratio3', 'phasorMul', 'phaseOffset', 'pulseWidth', 'ampRatio1', 'ampRatio2'];

export class OutputRouter {
  constructor() {
    // Build lookup map
    this._outputMap = new Map();
    for (const def of OUTPUT_DEFS) {
      this._outputMap.set(def.id, { ...def, mode: def.toggleable ? 'cv' : 'gate' });
    }
    // d1-d3 are always gate
    this._outputMap.get('d1').mode = 'gate';
    this._outputMap.get('d2').mode = 'gate';
    this._outputMap.get('d3').mode = 'gate';

    this._callbacks = [];
    // Pre-allocate output buffer for routeOutputs hot path
    this._outputBuffer = new Float32Array(14);

    // Compute initial routing
    this._routing = null;
    this._recompute();
  }

  setOutputMode(outputId, mode) {
    const output = this._outputMap.get(outputId);
    if (!output) throw new Error(`Unknown output: ${outputId}`);
    if (!output.toggleable) throw new Error(`Output ${outputId} cannot be toggled (always gate)`);
    if (mode !== 'cv' && mode !== 'gate') throw new Error(`Invalid mode: ${mode}`);

    // Check max sequences constraint
    if (mode === 'gate' && output.mode !== 'gate') {
      const currentGateCount = this._countGateOutputs();
      if (currentGateCount >= MAX_SEQUENCES) {
        throw new Error(`Cannot add more gate outputs: maximum ${MAX_SEQUENCES} sequences reached`);
      }
    }

    if (output.mode === mode) return;
    output.mode = mode;
    this._recompute();
    this._notifyChange();
  }

  getOutputMode(outputId) {
    const output = this._outputMap.get(outputId);
    if (!output) throw new Error(`Unknown output: ${outputId}`);
    return output.mode;
  }

  isToggleable(outputId) {
    const output = this._outputMap.get(outputId);
    if (!output) throw new Error(`Unknown output: ${outputId}`);
    return output.toggleable;
  }

  getRouting() {
    return this._routing;
  }

  getMlpArchitectures() {
    const numSeqs = this.numSequences;
    const numVel = this.numVelocityOutputs;
    const numCv = this.numCvOutputs;

    // Rhythm MLP output labels
    const rhythmLabels = [];
    for (const entry of this._routing.outputs) {
      if (entry.mode === 'gate') {
        const si = entry.seqIndex;
        for (const name of SEQ_PARAM_NAMES) {
          rhythmLabels.push(`seq${si}_${name}`);
        }
      }
    }
    // Velocity outputs come after all sequence params
    for (const entry of this._routing.outputs) {
      if (entry.mode === 'gate' && entry.hasVelocity) {
        rhythmLabels.push(`seq${entry.seqIndex}_velocity`);
      }
    }

    // CV MLP output labels
    const cvLabels = [];
    for (const entry of this._routing.outputs) {
      if (entry.mode === 'cv') {
        cvLabels.push(`${entry.id}_cv`);
      }
    }

    return {
      rhythm: {
        inputs: 2,
        outputs: PARAMS_PER_SEQUENCE * numSeqs + numVel,
        hiddenLayers: [16, 24],
        outputLabels: rhythmLabels,
      },
      cv: {
        inputs: 2,
        outputs: numCv,
        hiddenLayers: [16, 24, 32],
        outputLabels: cvLabels,
      },
    };
  }

  getParamMeta() {
    const meta = [];
    const routing = this.getRouting();
    for (const entry of routing.outputs) {
      if (entry.mode === 'gate') {
        const groupName = `Seq ${entry.seqIndex + 1} (${entry.id})`;
        for (let i = 0; i < PARAMS_PER_SEQUENCE; i++) {
          meta.push({ group: groupName, name: `${entry.id} ${SEQ_PARAM_NAMES[i]}` });
        }
      }
    }
    for (const entry of routing.outputs) {
      if (entry.mode === 'gate' && entry.hasVelocity) {
        meta.push({ group: `Vel ${entry.seqIndex + 1} (${entry.id})`, name: `${entry.id} velocity` });
      }
    }
    for (const entry of routing.outputs) {
      if (entry.mode === 'cv') {
        meta.push({ group: 'CV', name: `${entry.id} cv` });
      }
    }
    return meta;
  }

  getModeBitmask() {
    let bitmask = 0;
    for (const def of OUTPUT_DEFS) {
      const output = this._outputMap.get(def.id);
      if (output.mode === 'gate') {
        bitmask |= (1 << def.index);
      }
    }
    return bitmask;
  }

  routeOutputs(rhythmOutputs, cvOutputs, gateStates) {
    const buf = this._outputBuffer;
    let cvIdx = 0;

    for (const entry of this._routing.outputs) {
      if (entry.mode === 'cv') {
        buf[entry.index] = cvOutputs[cvIdx++];
      } else {
        const gs = gateStates[entry.seqIndex];
        if (entry.cvCapable) {
          // Velocity gate: velocity * gate
          buf[entry.index] = gs.gate ? gs.velocity : 0;
        } else {
          // Binary gate: 0 or 1
          buf[entry.index] = gs.gate ? 1 : 0;
        }
      }
    }

    return buf;
  }

  get numSequences() {
    return this._countGateOutputs();
  }

  get numCvOutputs() {
    let count = 0;
    for (const output of this._outputMap.values()) {
      if (output.mode === 'cv') count++;
    }
    return count;
  }

  get numVelocityOutputs() {
    let count = 0;
    for (const output of this._outputMap.values()) {
      if (output.mode === 'gate' && output.cvCapable) count++;
    }
    return count;
  }

  onChange(callback) {
    this._callbacks.push(callback);
    return () => {
      const idx = this._callbacks.indexOf(callback);
      if (idx !== -1) this._callbacks.splice(idx, 1);
    };
  }

  // --- Private ---

  _countGateOutputs() {
    let count = 0;
    for (const output of this._outputMap.values()) {
      if (output.mode === 'gate') count++;
    }
    return count;
  }

  _recompute() {
    // Assign sequence indices to gate outputs
    // d1=0, d2=1, d3=2, then by gate priority order
    const gateOutputs = [];
    // Fixed gates first
    for (const id of ['d1', 'd2', 'd3']) {
      const o = this._outputMap.get(id);
      if (o.mode === 'gate') gateOutputs.push(o);
    }
    // Then toggleable gates in priority order
    for (const id of GATE_PRIORITY) {
      const o = this._outputMap.get(id);
      if (o.mode === 'gate') gateOutputs.push(o);
    }

    const seqAssignment = new Map();
    for (let i = 0; i < gateOutputs.length; i++) {
      seqAssignment.set(gateOutputs[i].id, i);
    }

    // Build routing table in serial output order
    const outputs = [];
    let cvMlpIndex = 0;
    let rhythmMlpBaseIndex = 0;

    for (const def of OUTPUT_DEFS) {
      const output = this._outputMap.get(def.id);
      const entry = {
        id: def.id,
        index: def.index,
        mode: output.mode,
        cvCapable: def.cvCapable,
        mlp: output.mode === 'cv' ? 'cv' : 'rhythm',
      };

      if (output.mode === 'cv') {
        entry.mlpOutputIndex = cvMlpIndex++;
      } else {
        const si = seqAssignment.get(def.id);
        entry.seqIndex = si;
        entry.mlpOutputIndex = si * PARAMS_PER_SEQUENCE;
        entry.hasVelocity = def.cvCapable;
      }

      outputs.push(entry);
    }

    this._routing = { outputs };
  }

  _notifyChange() {
    if (this._callbacks.length === 0) return;
    const payload = {
      routing: this._routing,
      rhythmArch: this.getMlpArchitectures().rhythm,
      cvArch: this.getMlpArchitectures().cv,
      modeBitmask: this.getModeBitmask(),
    };
    for (const cb of this._callbacks) {
      cb(payload);
    }
  }
}
