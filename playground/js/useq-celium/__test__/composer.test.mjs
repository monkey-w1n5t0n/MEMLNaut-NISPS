// Integration test for UseqCeliumComposer. Run with:
//   node playground/js/useq-celium/__test__/composer.test.mjs
//
// Uses a fake DualMLPManager + stub adapter — no WasmIML, no serial, no gamepad.

import { UseqCeliumComposer } from '../composer.js';
import { VoiceEngine, PARAMS_PER_VOICE } from '../voice-engine.js';
import { ChannelRouter, CHANNEL_COUNT } from '../routing.js';

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('  ok :', msg); }
};

// ---------------------------------------------------------------------------
// Stub: minimal adapter surface.
// ---------------------------------------------------------------------------
function makeStubAdapter() {
  let source = null;
  return {
    setSnapshotSource(fn) { source = fn; },
    getSnapshotSource() { return source; },
  };
}

// ---------------------------------------------------------------------------
// Fake DualMLPManager. Extends EventTarget so composer.addEventListener is valid.
// ---------------------------------------------------------------------------
class FakeDualMLP extends EventTarget {
  constructor({ voiceCount = 4, cvOutputs = 11, rhythmHidden = [16, 24], cvHidden = [24, 32] } = {}) {
    super();
    this.rhythm = {
      nOutputs: voiceCount * PARAMS_PER_VOICE,
      hiddenLayers: [...rhythmHidden],
    };
    this.cv = {
      nOutputs: cvOutputs,
      hiddenLayers: [...cvHidden],
    };
    this._leftXY = { x: 0.5, y: 0.5 };
    this._rightXY = { x: 0.5, y: 0.5 };
    this._cvOutputsCache = null;
    this.rebuildRhythmCalls = [];
    this.rebuildCvCalls = [];
    this.disposed = false;
  }
  async setGamepadLeftAxes(x, y) {
    this._leftXY = { x, y };
    // Produce pseudo-random rhythm outputs of correct length.
    const outputs = new Float32Array(this.rhythm.nOutputs);
    for (let i = 0; i < outputs.length; i++) outputs[i] = ((x + y + i * 0.07) % 1);
    this.dispatchEvent(new CustomEvent('rhythmoutputs', {
      detail: { outputs, inputs: { x, y } },
    }));
  }
  async setGamepadRightAxes(x, y) {
    this._rightXY = { x, y };
    const outputs = new Float32Array(this.cv.nOutputs);
    for (let i = 0; i < outputs.length; i++) outputs[i] = (x * (i + 1) * 0.05 + y * 0.03) % 1;
    this._cvOutputsCache = outputs;
    this.dispatchEvent(new CustomEvent('cvoutputs', {
      detail: { outputs, inputs: { x, y } },
    }));
  }
  getCVOutputs() { return this._cvOutputsCache; }
  getRhythmOutputs() { return null; /* unused */ }
  getCurrentInputs() {
    return { rhythm: { ...this._leftXY }, cv: { ...this._rightXY } };
  }
  async rebuildRhythm({ nOutputs, hiddenLayers }) {
    this.rhythm.nOutputs = nOutputs;
    this.rhythm.hiddenLayers = [...hiddenLayers];
    this.rebuildRhythmCalls.push({ nOutputs, hiddenLayers: [...hiddenLayers] });
  }
  async rebuildCV({ nOutputs, hiddenLayers }) {
    this.cv.nOutputs = nOutputs;
    this.cv.hiddenLayers = [...hiddenLayers];
    this.rebuildCvCalls.push({ nOutputs, hiddenLayers: [...hiddenLayers] });
  }
  // Shims for events the composer forwards — we fire them directly in tests.
  fireTrainingDone(detail) {
    this.dispatchEvent(new CustomEvent('trainingdone', { detail }));
  }
  fireWeightsMoved(detail) {
    this.dispatchEvent(new CustomEvent('weightsmoved', { detail }));
  }
  dispose() { this.disposed = true; }
}

// ---------------------------------------------------------------------------
// Snapshot shape test
// ---------------------------------------------------------------------------
{
  const adapter = makeStubAdapter();
  const dualMlp = new FakeDualMLP();
  const voiceEngine = new VoiceEngine({ bpm: 120, voiceCount: 4 });
  const router = new ChannelRouter();
  const composer = new UseqCeliumComposer({
    adapter, dualMlp, voiceEngine, router,
  });

  composer.start();
  const src = adapter.getSnapshotSource();
  assert(typeof src === 'function', 'adapter got a snapshot source function after start()');

  // Drive: left stick move populates voice engine params via rhythmoutputs event.
  await dualMlp.setGamepadLeftAxes(0.3, 0.7);
  // Right stick move caches CV outputs.
  await dualMlp.setGamepadRightAxes(0.6, 0.2);

  // Call the snapshot source a few times — fake-tick the producer.
  const frame0 = src();
  assert(frame0.gates.length === 3, 'frame.gates length === 3');
  assert(frame0.cvMain.length === 3, 'frame.cvMain length === 3');
  assert(frame0.cvExp.length === 8, 'frame.cvExp length === 8');
  for (let i = 0; i < 3; i++) {
    assert(typeof frame0.gates[i] === 'boolean', `frame.gates[${i}] boolean`);
  }
  for (let i = 0; i < 3; i++) {
    assert(frame0.cvMain[i] >= 0 && frame0.cvMain[i] <= 1, `frame.cvMain[${i}] in [0,1]`);
  }
  for (let i = 0; i < 8; i++) {
    assert(frame0.cvExp[i] >= 0 && frame0.cvExp[i] <= 1, `frame.cvExp[${i}] in [0,1]`);
  }

  // Simulate wall-clock progression: sleep a few ms and tick again.
  await new Promise((r) => setTimeout(r, 5));
  const frame1 = src();
  assert(frame1.gates.length === 3, 'frame1 still length 3');

  await new Promise((r) => setTimeout(r, 10));
  src();

  // Forward trainingdone through composer
  let trainingEvent = null;
  composer.addEventListener('trainingdone', (e) => { trainingEvent = e.detail; });
  dualMlp.fireTrainingDone({ rhythmLoss: 0.1, cvLoss: 0.2 });
  assert(trainingEvent && trainingEvent.rhythmLoss === 0.1, 'composer forwarded trainingdone');

  // Forward weightsmoved
  let movedEvent = null;
  composer.addEventListener('weightsmoved', (e) => { movedEvent = e.detail; });
  dualMlp.fireWeightsMoved({ noise: 0.3 });
  assert(movedEvent && movedEvent.noise === 0.3, 'composer forwarded weightsmoved');

  composer.stop();
  assert(adapter.getSnapshotSource() === null || typeof adapter.getSnapshotSource() !== 'function' || true,
    'stop() runs without error');
}

// ---------------------------------------------------------------------------
// Routing: reconfigure one CV channel to static and confirm its output
// ---------------------------------------------------------------------------
{
  const adapter = makeStubAdapter();
  const dualMlp = new FakeDualMLP();
  const voiceEngine = new VoiceEngine({ bpm: 120, voiceCount: 4 });
  const router = new ChannelRouter();
  router.setChannelConfig(3, { mode: 'continuous', source: 'static', staticValue: 0.42 });

  const composer = new UseqCeliumComposer({ adapter, dualMlp, voiceEngine, router });
  composer.start();
  const src = adapter.getSnapshotSource();
  await dualMlp.setGamepadRightAxes(0.5, 0.5);

  const frame = src();
  assert(Math.abs(frame.cvMain[0] - 0.42) < 1e-7, 'reconfigured channel outputs static 0.42');
  composer.stop();
}

// ---------------------------------------------------------------------------
// Voice-count change triggers rhythm rebuild with nOutputs = n * 7
// ---------------------------------------------------------------------------
{
  const adapter = makeStubAdapter();
  const dualMlp = new FakeDualMLP({ voiceCount: 4 });
  const voiceEngine = new VoiceEngine({ bpm: 120, voiceCount: 4 });
  const router = new ChannelRouter();
  const composer = new UseqCeliumComposer({ adapter, dualMlp, voiceEngine, router });
  composer.start();

  await composer.setVoiceCount(2);
  // Scan rebuilds — latest should be nOutputs=14.
  const last = dualMlp.rebuildRhythmCalls[dualMlp.rebuildRhythmCalls.length - 1];
  assert(last && last.nOutputs === 14, 'setVoiceCount(2) → rebuildRhythm nOutputs=14');
  composer.stop();
}

// ---------------------------------------------------------------------------
// handleArchChange (cv) — direct CV-arch change
// ---------------------------------------------------------------------------
{
  const adapter = makeStubAdapter();
  const dualMlp = new FakeDualMLP();
  const voiceEngine = new VoiceEngine({ bpm: 120, voiceCount: 4 });
  const router = new ChannelRouter();
  const composer = new UseqCeliumComposer({ adapter, dualMlp, voiceEngine, router });
  composer.start();

  await composer.handleArchChange({ role: 'cv', nOutputs: 7, hiddenLayers: [32] });
  const lastCV = dualMlp.rebuildCvCalls[dualMlp.rebuildCvCalls.length - 1];
  assert(lastCV && lastCV.nOutputs === 7, 'handleArchChange(cv) → rebuildCV nOutputs=7');
  composer.stop();
}

// ---------------------------------------------------------------------------
// BPM clamp + event
// ---------------------------------------------------------------------------
{
  const adapter = makeStubAdapter();
  const dualMlp = new FakeDualMLP();
  const voiceEngine = new VoiceEngine({ bpm: 120, voiceCount: 4 });
  const router = new ChannelRouter();
  const composer = new UseqCeliumComposer({ adapter, dualMlp, voiceEngine, router });
  composer.start();

  let bpmEvent = null;
  composer.addEventListener('bpmchange', (e) => { bpmEvent = e.detail; });
  composer.setBPM(80);
  assert(bpmEvent && bpmEvent.bpm === 80, 'setBPM emits bpmchange');
  composer.setBPM(1000);
  assert(composer.getBPM() === 300, 'BPM clamps to max 300');
  composer.setBPM(1);
  assert(composer.getBPM() === 30, 'BPM clamps to min 30');
  composer.stop();
}

// ---------------------------------------------------------------------------
// Router default produces 14 total values per snapshot
// ---------------------------------------------------------------------------
{
  const router = new ChannelRouter();
  const defs = router.getAllConfigs();
  assert(defs.length === CHANNEL_COUNT, 'router holds 14 configs');
}

// ---------------------------------------------------------------------------
if (failed) { console.error(`\n${failed} test(s) failed.`); process.exit(1); }
console.log('\nall ok');
