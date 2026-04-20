// Tests for MLPManager. Run with:
//   node playground/js/useq-celium/__test__/mlp-manager.test.mjs
//
// WasmIML can't be loaded under Node (needs fetch + WASM). We inject a fake
// via the `_wasmImlFactory` constructor option to exercise MLPManager without
// touching any browser-only APIs.

import { MLPManager } from '../mlp-manager.js';

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('  ok :', msg); }
};
const assertEqF = (a, b, eps, msg) => assert(Math.abs(a - b) < (eps ?? 1e-9), `${msg} (|${a} - ${b}|)`);

// ---------------------------------------------------------------------------
// Fake WasmIML — matches the subset of the surface MLPManager uses.
// ---------------------------------------------------------------------------

function computeWeightCount(nInputs, hiddenLayers, nOutputs) {
  // Match WasmIML's bias convention: input layer has nInputs + 1 (bias).
  // Each subsequent layer l has layerSizes[l] * (layerSizes[l-1] + 1) weights.
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
    // Seed deterministic-ish weights so round-trip tests are meaningful.
    this._weights = new Array(this._weightCount);
    let seed = 1;
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
    // Deterministic "forward pass": each output = (x*i + y*(i+1)) wrapped into [0,1]
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
    // Simulate async training.
    return new Promise((resolve) => {
      setTimeout(() => {
        const loss = this._examples.length > 0 ? 0.123 : null;
        if (cb && loss !== null) cb({ loss, outputs: [...this._outputs] });
        resolve(loss);
      }, 0);
    });
  }
  randomiseWeights(_spread) {
    for (let i = 0; i < this._weightCount; i++) this._weights[i] = Math.random() * 2 - 1;
  }
  moveWeights(_speed, _spread, _pinMask) {
    for (let i = 0; i < this._weightCount; i++) this._weights[i] *= 0.95;
  }
  _getFlatWeights() { return [...this._weights]; }
  _setFlatWeights(flat) {
    for (let i = 0; i < this._weightCount && i < flat.length; i++) this._weights[i] = flat[i];
  }
  destroy() { this._destroyed = true; this.destroyCount++; }
}

function fakeFactory(nInputs, nOutputs, hiddenLayers) {
  return Promise.resolve(new FakeWasmIML(nInputs, nOutputs, hiddenLayers));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// --- Construction + init -------------------------------------------------
{
  const m = new MLPManager({
    role: 'rhythm',
    nInputs: 2,
    nOutputs: 4,
    hiddenLayers: [8, 8],
    _wasmImlFactory: fakeFactory,
  });
  assert(m.role === 'rhythm', 'role set');
  assert(m._ready === false, 'not ready before init');
  let readyEvent = false;
  m.addEventListener('ready', () => { readyEvent = true; });
  await m.init();
  assert(m._ready === true, 'ready after init()');
  assert(readyEvent, "'ready' event fired");

  // --- Infer returns a Float32Array of right length -----------------------
  const out = await m.infer([0.3, 0.7]);
  assert(out instanceof Float32Array, 'infer returns Float32Array');
  assert(out.length === 4, 'infer output length == nOutputs');
  assert(m.getLastOutputs() === out, 'getLastOutputs caches same instance');

  // --- Example tracking ----------------------------------------------------
  assert(m.exampleCount() === 0, 'exampleCount starts at 0');
  m.addExample([0.2, 0.4], [0, 1, 0, 0.5]);
  assert(m.exampleCount() === 1, 'exampleCount advances after addExample');
  m.addExample([0.1, 0.9], [0.9, 0.1, 0, 0]);
  assert(m.exampleCount() === 2, 'exampleCount advances again');

  // --- train() resolves with { loss: number } -----------------------------
  const { loss } = await m.train();
  assert(typeof loss === 'number' && Number.isFinite(loss), `train resolves with a finite number (got ${loss})`);

  // --- clearExamples resets local counter ---------------------------------
  m.clearExamples();
  assert(m.exampleCount() === 0, 'clearExamples resets counter');

  // --- exportState / importState round-trip -------------------------------
  const snap = m.exportState();
  assert(snap.arch.nInputs === 2, 'snapshot.arch.nInputs');
  assert(snap.arch.nOutputs === 4, 'snapshot.arch.nOutputs');
  assert(JSON.stringify(snap.arch.hiddenLayers) === '[8,8]', 'snapshot.arch.hiddenLayers');
  assert(snap.weights instanceof Float32Array, 'snapshot.weights is Float32Array');
  assert(snap.weights.length > 0, 'snapshot.weights non-empty');

  // Scramble, then import — weights should match snapshot again.
  m.randomiseWeights();
  const scrambled = m.exportState();
  let differ = false;
  for (let i = 0; i < snap.weights.length; i++) {
    if (Math.abs(scrambled.weights[i] - snap.weights[i]) > 1e-9) { differ = true; break; }
  }
  assert(differ, 'randomise changed weights');

  await m.importState(snap);
  const restored = m.exportState();
  let allEqual = true;
  for (let i = 0; i < snap.weights.length; i++) {
    if (Math.abs(restored.weights[i] - snap.weights[i]) > 1e-9) { allEqual = false; break; }
  }
  assert(allEqual, 'importState restores weights');

  // --- rebuild disposes old instance --------------------------------------
  const oldIml = m._iml;
  assert(oldIml.destroyCount === 0, 'old instance not yet destroyed');
  let rebuildEvent = false;
  m.addEventListener('rebuild', () => { rebuildEvent = true; });
  await m.rebuild({ nOutputs: 6, hiddenLayers: [12] });
  assert(oldIml.destroyCount === 1, 'rebuild called destroy on old instance');
  assert(m._iml !== oldIml, 'rebuild swapped instance');
  assert(m.nOutputs === 6, 'rebuild updated nOutputs');
  assert(JSON.stringify(m.hiddenLayers) === '[12]', 'rebuild updated hiddenLayers');
  assert(m.exampleCount() === 0, 'rebuild cleared example count');
  assert(m.getLastOutputs() === null, 'rebuild cleared cached outputs');
  assert(rebuildEvent, "'rebuild' event fired");

  // Infer still works post-rebuild with new shape.
  const out2 = await m.infer([0.5, 0.5]);
  assert(out2.length === 6, 'infer after rebuild has new output length');

  // --- dispose idempotency + teardown ------------------------------------
  const finalIml = m._iml;
  m.dispose();
  assert(finalIml.destroyCount === 1, 'dispose destroyed current instance');
  m.dispose();
  assert(finalIml.destroyCount === 1, 'dispose is idempotent (destroyCount unchanged)');

  // Ops after dispose throw.
  let threw = false;
  try { await m.infer([0, 0]); } catch { threw = true; }
  assert(threw, 'infer after dispose throws');
}

// --- importState with arch change rebuilds --------------------------------
{
  const m = new MLPManager({
    role: 'cv',
    nInputs: 2,
    nOutputs: 3,
    hiddenLayers: [4],
    _wasmImlFactory: fakeFactory,
  });
  await m.init();
  const origIml = m._iml;

  const foreign = {
    arch: { nInputs: 2, nOutputs: 11, hiddenLayers: [24, 32] },
    weights: new Float32Array(computeWeightCount(2, [24, 32], 11)).fill(0.25),
  };
  await m.importState(foreign);
  assert(m.nOutputs === 11, 'importState with different arch updated nOutputs');
  assert(JSON.stringify(m.hiddenLayers) === '[24,32]', 'importState updated hiddenLayers');
  assert(origIml.destroyCount === 1, 'importState with arch change disposed old instance');
  const got = m.exportState();
  assert(got.weights.length === foreign.weights.length, 'importState installed new weights shape');
  let allQuarter = true;
  for (let i = 0; i < foreign.weights.length; i++) {
    if (Math.abs(got.weights[i] - 0.25) > 1e-6) { allQuarter = false; break; }
  }
  assert(allQuarter, 'importState wrote all 0.25 weights');

  m.dispose();
}

// --- Ops before init throw -------------------------------------------------
{
  const m = new MLPManager({
    role: 'rhythm',
    nInputs: 2,
    nOutputs: 2,
    hiddenLayers: [4],
    _wasmImlFactory: fakeFactory,
  });
  let threw = false;
  try { await m.infer([0, 0]); } catch { threw = true; }
  assert(threw, 'infer before init throws');
  threw = false;
  try { m.addExample([0, 0], [0, 0]); } catch { threw = true; }
  assert(threw, 'addExample before init throws');
}

// --- Constructor validation ------------------------------------------------
{
  let threw = false;
  try { new MLPManager({ nOutputs: 4, hiddenLayers: [4] }); } catch { threw = true; }
  assert(threw, 'constructor without role throws');
  threw = false;
  try { new MLPManager({ role: 'x', nOutputs: 0, hiddenLayers: [4] }); } catch { threw = true; }
  assert(threw, 'constructor with nOutputs=0 throws');
  threw = false;
  try { new MLPManager({ role: 'x', nOutputs: 4, hiddenLayers: [] }); } catch { threw = true; }
  assert(threw, 'constructor with empty hiddenLayers throws');
  threw = false;
  try { new MLPManager({ role: 'x', nOutputs: 4, hiddenLayers: [4, -1] }); } catch { threw = true; }
  assert(threw, 'constructor with negative hidden dim throws');
}

// ---------------------------------------------------------------------------
if (failed) { console.error(`\n${failed} test(s) failed.`); process.exit(1); }
console.log('\nall ok');
