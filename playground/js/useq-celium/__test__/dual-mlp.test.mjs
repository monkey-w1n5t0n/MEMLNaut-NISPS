// Tests for DualMLPManager. Run with:
//   node playground/js/useq-celium/__test__/dual-mlp.test.mjs
//
// Uses a shared FakeWasmIML (copied from mlp-manager.test.mjs so this file
// is self-contained) injected via _wasmImlFactory.

import { DualMLPManager } from '../dual-mlp.js';

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('  ok :', msg); }
};

// ---------------------------------------------------------------------------
// Fake WasmIML (same surface as mlp-manager.test.mjs)
// ---------------------------------------------------------------------------

function computeWeightCount(nInputs, hiddenLayers, nOutputs) {
  const layerSizes = [nInputs + 1, ...hiddenLayers, nOutputs];
  let count = 0;
  for (let l = 1; l < layerSizes.length; l++) {
    count += layerSizes[l] * (layerSizes[l - 1] + 1);
  }
  return count;
}

class FakeWasmIML {
  constructor(nInputs, nOutputs, hiddenLayers) {
    this.nInputs = nInputs;
    this.nOutputs = nOutputs;
    this.hiddenLayers = [...hiddenLayers];
    this._inputs = new Array(nInputs).fill(0.5);
    this._outputs = new Array(nOutputs).fill(0);
    this._examples = [];
    this._destroyed = false;
    this._weightCount = computeWeightCount(nInputs, hiddenLayers, nOutputs);
    this._weights = new Array(this._weightCount);
    let seed = 7;
    for (let i = 0; i < this._weightCount; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      this._weights[i] = (seed / 233280) * 2 - 1;
    }
    this.destroyCount = 0;
  }
  setInputs(vals) {
    for (let i = 0; i < this.nInputs; i++) this._inputs[i] = vals[i] ?? 0;
  }
  process() {
    const x = this._inputs[0] ?? 0;
    const y = this._inputs[1] ?? 0;
    for (let i = 0; i < this.nOutputs; i++) {
      const v = Math.abs(Math.sin(x * (i + 1) + y * (i + 2)));
      this._outputs[i] = Math.max(0, Math.min(1, v));
    }
  }
  getOutputs() { return this._outputs; }
  addExample(inputs, outputs) {
    this._examples.push({ inputs: [...inputs], outputs: [...outputs] });
  }
  clearDataset() { this._examples.length = 0; }
  trainAsync(cb) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const loss = this._examples.length > 0 ? 0.05 : null;
        if (cb && loss !== null) cb({ loss, outputs: [...this._outputs] });
        resolve(loss);
      }, 0);
    });
  }
  randomiseWeights(_spread) {
    for (let i = 0; i < this._weightCount; i++) this._weights[i] = Math.random() * 2 - 1;
  }
  moveWeights(_s, _sp, _pm) {
    for (let i = 0; i < this._weightCount; i++) this._weights[i] *= 0.95;
  }
  _getFlatWeights() { return [...this._weights]; }
  _setFlatWeights(f) {
    for (let i = 0; i < this._weightCount && i < f.length; i++) this._weights[i] = f[i];
  }
  destroy() { this._destroyed = true; this.destroyCount++; }
}

const fakeFactory = (nIn, nOut, hidden) => Promise.resolve(new FakeWasmIML(nIn, nOut, hidden));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// --- init creates both MLPs ------------------------------------------------
{
  const d = new DualMLPManager({
    rhythmArch: { nOutputs: 4, hiddenLayers: [8, 8] },
    cvArch:     { nOutputs: 11, hiddenLayers: [12] },
    _wasmImlFactory: fakeFactory,
  });
  assert(d.rhythm && d.cv, 'has both rhythm and cv managers');
  let readyEvent = false;
  d.addEventListener('ready', () => { readyEvent = true; });
  await d.init();
  assert(d._ready === true, 'ready after init');
  assert(d.rhythm._ready && d.cv._ready, 'both sub-managers ready');
  assert(readyEvent, "'ready' event fired");

  // Before any setGamepad calls, outputs are null.
  assert(d.getRhythmOutputs() === null, 'rhythm outputs null before first infer');
  assert(d.getCVOutputs() === null, 'cv outputs null before first infer');

  // --- Left stick → only rhythm outputs change -----------------------------
  let rhythmOutputsEvent = null;
  let cvOutputsEvent = null;
  d.addEventListener('rhythmoutputs', (e) => { rhythmOutputsEvent = e.detail; });
  d.addEventListener('cvoutputs', (e) => { cvOutputsEvent = e.detail; });

  await d.setGamepadLeftAxes(0.2, 0.8);
  assert(d.getRhythmOutputs() !== null, 'left stick populated rhythm outputs');
  assert(d.getRhythmOutputs().length === 4, 'rhythm outputs length == 4');
  assert(d.getCVOutputs() === null, 'left stick did NOT populate cv outputs');
  assert(rhythmOutputsEvent && rhythmOutputsEvent.inputs.x === 0.2, 'rhythmoutputs event fired with input x=0.2');
  assert(cvOutputsEvent === null, 'cvoutputs event did NOT fire');

  // --- Right stick → only cv outputs change --------------------------------
  await d.setGamepadRightAxes(0.9, 0.1);
  assert(d.getCVOutputs() !== null, 'right stick populated cv outputs');
  assert(d.getCVOutputs().length === 11, 'cv outputs length == 11');
  assert(cvOutputsEvent && cvOutputsEvent.inputs.x === 0.9, 'cvoutputs event fired');

  // getCurrentInputs reflects both sticks.
  const inp = d.getCurrentInputs();
  assert(inp.rhythm.x === 0.2 && inp.rhythm.y === 0.8, 'currentInputs.rhythm');
  assert(inp.cv.x === 0.9 && inp.cv.y === 0.1, 'currentInputs.cv');

  // --- thumbsUp → addExample on both + trainingdone event ------------------
  let doneEvent = null;
  d.addEventListener('trainingdone', (e) => { doneEvent = e.detail; });
  const preR = d.rhythm.exampleCount();
  const preC = d.cv.exampleCount();
  const result = await d.thumbsUp();
  assert(d.rhythm.exampleCount() === preR + 1, 'thumbsUp added rhythm example');
  assert(d.cv.exampleCount() === preC + 1, 'thumbsUp added cv example');
  assert(doneEvent !== null, "'trainingdone' event fired");
  assert(typeof result.rhythmLoss === 'number', 'result.rhythmLoss is a number');
  assert(typeof result.cvLoss === 'number', 'result.cvLoss is a number');

  // --- thumbsDown → jitters both + weightsmoved event ---------------------
  const rBefore = d.rhythm.exportState().weights.slice();
  const cBefore = d.cv.exportState().weights.slice();
  let movedEvent = null;
  d.addEventListener('weightsmoved', (e) => { movedEvent = e.detail; });
  await d.thumbsDown(0.3);
  const rAfter = d.rhythm.exportState().weights;
  const cAfter = d.cv.exportState().weights;
  let rChanged = false, cChanged = false;
  for (let i = 0; i < rBefore.length; i++) if (Math.abs(rBefore[i] - rAfter[i]) > 1e-9) { rChanged = true; break; }
  for (let i = 0; i < cBefore.length; i++) if (Math.abs(cBefore[i] - cAfter[i]) > 1e-9) { cChanged = true; break; }
  assert(rChanged, 'thumbsDown modified rhythm weights');
  assert(cChanged, 'thumbsDown modified cv weights');
  assert(movedEvent && movedEvent.noise === 0.3, "'weightsmoved' event fired with noise");

  // --- rebuildRhythm only affects rhythm -----------------------------------
  const cvImlBefore = d.cv._iml;
  const rhythmImlBefore = d.rhythm._iml;
  await d.rebuildRhythm({ nOutputs: 2, hiddenLayers: [16] });
  assert(d.rhythm._iml !== rhythmImlBefore, 'rebuildRhythm swapped rhythm instance');
  assert(d.cv._iml === cvImlBefore, 'rebuildRhythm did NOT touch cv instance');
  assert(d.rhythm.nOutputs === 2, 'rhythm nOutputs updated');
  assert(d.cv.nOutputs === 11, 'cv nOutputs unchanged');

  // --- rebuildCV only affects cv -------------------------------------------
  const rhythmImlBefore2 = d.rhythm._iml;
  await d.rebuildCV({ nOutputs: 7, hiddenLayers: [20] });
  assert(d.rhythm._iml === rhythmImlBefore2, 'rebuildCV did NOT touch rhythm instance');
  assert(d.cv.nOutputs === 7, 'cv nOutputs updated');

  // --- clearExamples clears both -------------------------------------------
  // Re-infer to populate outputs, then capture with thumbsUp.
  await d.setGamepadLeftAxes(0.4, 0.6);
  await d.setGamepadRightAxes(0.4, 0.6);
  await d.thumbsUp();
  assert(d.rhythm.exampleCount() > 0 && d.cv.exampleCount() > 0, 'both have examples after thumbsUp');
  d.clearExamples();
  assert(d.rhythm.exampleCount() === 0, 'clearExamples cleared rhythm');
  assert(d.cv.exampleCount() === 0, 'clearExamples cleared cv');

  // --- exportSession / importSession round-trip ----------------------------
  const session = d.exportSession();
  assert(session.version === 1, 'session.version == 1');
  assert(session.rhythm && session.cv, 'session contains both rhythm and cv');

  // Randomise then restore.
  d.rhythm.randomiseWeights();
  d.cv.randomiseWeights();
  await d.importSession(session);
  const afterR = d.rhythm.exportState().weights;
  const afterC = d.cv.exportState().weights;
  let rEq = true, cEq = true;
  for (let i = 0; i < session.rhythm.weights.length; i++) {
    if (Math.abs(afterR[i] - session.rhythm.weights[i]) > 1e-6) { rEq = false; break; }
  }
  for (let i = 0; i < session.cv.weights.length; i++) {
    if (Math.abs(afterC[i] - session.cv.weights[i]) > 1e-6) { cEq = false; break; }
  }
  assert(rEq, 'importSession restored rhythm weights');
  assert(cEq, 'importSession restored cv weights');

  d.dispose();
  assert(d._disposed === true, 'dispose marks disposed');
}

// --- Constructor validation ------------------------------------------------
{
  let threw = false;
  try { new DualMLPManager({ cvArch: { nOutputs: 4, hiddenLayers: [4] } }); } catch { threw = true; }
  assert(threw, 'constructor without rhythmArch throws');
  threw = false;
  try { new DualMLPManager({ rhythmArch: { nOutputs: 4, hiddenLayers: [4] } }); } catch { threw = true; }
  assert(threw, 'constructor without cvArch throws');
}

// ---------------------------------------------------------------------------
if (failed) { console.error(`\n${failed} test(s) failed.`); process.exit(1); }
console.log('\nall ok');
