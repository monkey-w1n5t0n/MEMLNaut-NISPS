// ratio-seq.js — ES module
// Faithful JS port of RatioSeq Euclidean rhythm algorithm from MEMLCelium firmware

function ratioSeq(phasor, phaseOffset, ratioSum, ratios, pulseWidth) {
  let offsetPhase = phaseOffset + phasor;
  if (offsetPhase >= 1.0) offsetPhase -= 1.0;

  const phaseAdj = ratioSum * offsetPhase;
  let accumulatedSum = 0;
  let lastAccumulatedSum = 0;

  for (const ratio of ratios) {
    accumulatedSum += ratio;
    if (phaseAdj <= accumulatedSum) {
      const beatPhase = (phaseAdj - lastAccumulatedSum) / (accumulatedSum - lastAccumulatedSum);
      return beatPhase <= pulseWidth;
    }
    lastAccumulatedSum = accumulatedSum;
  }
  return false;
}

function scaleRatio(val) {
  return Math.floor(val * 3) + 1;
}

const PHASOR_MULS = [1, 2, 4, 8];
function scalePhasorMul(val) {
  return PHASOR_MULS[Math.floor(val * 3.999999)];
}

function scalePulseWidth(val) {
  return val * 0.9 + 0.05;
}

function scaleAmpRatio(val) {
  return Math.floor(val * 3) + 1;
}

class SequenceState {
  constructor() {
    this.ratios = [1, 1, 1];
    this.ratioSum = 3;
    this.phasorMul = 1;
    this.phaseOffset = 0;
    this.pulseWidth = 0.5;
    this.ampRatios = [1, 1];
    this.ampRatioSum = 2;
    this.lastGate = false;
  }
}

export class RatioSeqEngine {
  constructor({ numSequences = 3, bpm = 120, beatsPerBar = 4 } = {}) {
    this._bpm = bpm;
    this._beatsPerBar = beatsPerBar;
    this._barPhase = 0;
    this._lastTimeSec = null;
    this._numSequences = numSequences;
    this._sequences = [];
    for (let i = 0; i < numSequences; i++) {
      this._sequences.push(new SequenceState());
    }
  }

  setSequenceParams(seqIndex, params) {
    const seq = this._sequences[seqIndex];
    if (!seq) return;

    const { ratios, phasorMul, phaseOffset, pulseWidth, ampRatios } = params;

    seq.ratios[0] = scaleRatio(ratios[0]);
    seq.ratios[1] = scaleRatio(ratios[1]);
    seq.ratios[2] = scaleRatio(ratios[2]);
    seq.ratioSum = seq.ratios[0] + seq.ratios[1] + seq.ratios[2];

    seq.phasorMul = scalePhasorMul(phasorMul);
    seq.phaseOffset = Math.floor(phaseOffset * this._beatsPerBar) / this._beatsPerBar;
    seq.pulseWidth = scalePulseWidth(pulseWidth);

    seq.ampRatios[0] = scaleAmpRatio(ampRatios[0]);
    seq.ampRatios[1] = scaleAmpRatio(ampRatios[1]);
    seq.ampRatioSum = seq.ampRatios[0] + seq.ampRatios[1];
  }

  setBpm(bpm) {
    this._bpm = bpm;
  }

  tick(timeSec) {
    if (this._lastTimeSec === null) {
      this._lastTimeSec = timeSec;
      return this._sequences.map(() => ({ gate: 0, velocity: 0, noteOn: false, noteOff: false }));
    }

    const dt = timeSec - this._lastTimeSec;
    this._lastTimeSec = timeSec;

    this._barPhase += (this._bpm / 60) * dt / this._beatsPerBar;
    this._barPhase %= 1.0;

    const results = [];

    for (let i = 0; i < this._numSequences; i++) {
      const seq = this._sequences[i];

      let seqPhasor = this._barPhase * seq.phasorMul;
      seqPhasor = ((seqPhasor + seq.phaseOffset) % 1.0 + 1.0) % 1.0;

      const trig = ratioSeq(seqPhasor, seq.phaseOffset, seq.ratioSum, seq.ratios, seq.pulseWidth);
      const highAmp = ratioSeq(seqPhasor, seq.phaseOffset, seq.ampRatioSum, seq.ampRatios, 0.5);

      const gate = trig ? 1 : 0;
      const velocity = trig ? (highAmp ? 1.0 : 64 / 127) : 0;
      const noteOn = trig && !seq.lastGate;
      const noteOff = !trig && seq.lastGate;

      seq.lastGate = trig;

      results.push({ gate, velocity, noteOn, noteOff });
    }

    return results;
  }

  getBarPhase() {
    return this._barPhase;
  }

  setNumSequences(n) {
    n = Math.max(1, Math.min(4, n));
    while (this._sequences.length < n) {
      this._sequences.push(new SequenceState());
    }
    this._numSequences = n;
  }
}
