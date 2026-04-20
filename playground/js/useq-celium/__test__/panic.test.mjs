// Panic-path tests for UseqCeliumAdapter.
//
// Run with:
//   node playground/js/useq-celium/__test__/panic.test.mjs
//
// Verifies that after adapter.panic(), the producer's snapshot source yields
// an all-zero frame, and that resume() restores the composer's source. Fakes
// the DualMLPManager + VoiceEngine the same way composer.test.mjs does — no
// WASM, no serial, no DOM.

import { UseqCeliumAdapter } from '../adapter.js';
import { UseqCeliumComposer } from '../composer.js';
import { VoiceEngine, PARAMS_PER_VOICE } from '../voice-engine.js';
import { ChannelRouter } from '../routing.js';

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('  ok :', msg); }
};

// ---------------------------------------------------------------------------
// Fake DualMLPManager — EventTarget + minimal surface, as in composer.test.mjs.
// ---------------------------------------------------------------------------
class FakeDualMLP extends EventTarget {
  constructor({ voiceCount = 4, cvOutputs = 11, rhythmHidden = [16, 24], cvHidden = [24, 32] } = {}) {
    super();
    this.rhythm = { nOutputs: voiceCount * PARAMS_PER_VOICE, hiddenLayers: [...rhythmHidden] };
    this.cv = { nOutputs: cvOutputs, hiddenLayers: [...cvHidden] };
    this._cvCache = new Float32Array(cvOutputs).fill(0.5); // non-zero so we can detect zeros clearly
  }
  async setGamepadLeftAxes(_x, _y) { /* no-op */ }
  async setGamepadRightAxes(_x, _y) { /* no-op */ }
  getCVOutputs() { return this._cvCache; }
  async rebuildRhythm({ nOutputs, hiddenLayers }) { this.rhythm = { nOutputs, hiddenLayers: [...hiddenLayers] }; }
  async rebuildCV({ nOutputs, hiddenLayers }) { this.cv = { nOutputs, hiddenLayers: [...hiddenLayers] }; }
  dispose() {}
}

// ---------------------------------------------------------------------------
// Helper: build an adapter wired to a composer but with NO real bridge.
// activate() is skipped so we don't need a DOM; instead we manually construct
// the pipeline, as a-app.js would.
// ---------------------------------------------------------------------------
function buildWiredAdapter() {
  const adapter = new UseqCeliumAdapter();
  // init() creates producer+bridge. In Node, the bridge is inert (no
  // navigator.serial) but construction + producer.setSource works fine.
  // Avoid awaiting init since we want a plain sync setup — instead construct
  // the producer path ourselves via setSnapshotSource pre-init, then init later.
  return adapter;
}

// ---------------------------------------------------------------------------
// Test 1: panic() replaces the snapshot source with a zero source.
// ---------------------------------------------------------------------------
{
  const adapter = buildWiredAdapter();
  await adapter.init(null);

  const dualMlp = new FakeDualMLP();
  const voiceEngine = new VoiceEngine({ bpm: 120, voiceCount: 4 });
  const router = new ChannelRouter();
  const composer = new UseqCeliumComposer({ adapter, dualMlp, voiceEngine, router });
  // Directly expose composer as the composition — simulate what activate() does.
  adapter._composer = composer;
  composer.start();

  // Sanity: producer has a source function now.
  const src0 = adapter.producer._sourceFn;
  assert(typeof src0 === 'function', 'producer.sourceFn set after composer.start');

  // Drive a frame: router.compute merges voice-gates + cv-mlp outputs.
  const before = src0();
  assert(before && before.gates && before.gates.length === 3, 'pre-panic frame has gates[3]');
  assert(before.cvMain.length === 3 && before.cvExp.length === 8, 'pre-panic frame has cvMain[3]+cvExp[8]');

  // Panic.
  adapter.panic();
  assert(adapter.panicked === true, 'adapter.panicked is true after panic()');

  const panicSrc = adapter.producer._sourceFn;
  const zeros = panicSrc();
  assert(zeros.gates.every((g) => g === false || g === 0), 'panic zeros: all gates falsy');
  assert(zeros.cvMain.every((v) => v === 0), 'panic zeros: cvMain all 0');
  assert(zeros.cvExp.every((v) => v === 0), 'panic zeros: cvExp all 0');

  // Calling panic twice is idempotent — still zeros.
  adapter.panic();
  const zeros2 = adapter.producer._sourceFn();
  assert(zeros2.cvMain.every((v) => v === 0), 'panic() idempotent — still zeros');

  // Resume: composer is bounced; source is re-registered.
  adapter.resume();
  assert(adapter.panicked === false, 'adapter.panicked is false after resume()');
  const after = adapter.producer._sourceFn();
  assert(typeof after === 'object' && Array.isArray(after.gates), 'post-resume frame is a normal snapshot');

  // After resume the snapshot should NOT be the zero function identity.
  assert(adapter.producer._sourceFn !== panicSrc, 'post-resume source is not the zero function');

  composer.stop();
}

// ---------------------------------------------------------------------------
// Test 2: onPanicChange callback fires on panic + resume.
// ---------------------------------------------------------------------------
{
  const adapter = buildWiredAdapter();
  await adapter.init(null);

  const dualMlp = new FakeDualMLP();
  const voiceEngine = new VoiceEngine({ bpm: 120, voiceCount: 4 });
  const router = new ChannelRouter();
  const composer = new UseqCeliumComposer({ adapter, dualMlp, voiceEngine, router });
  adapter._composer = composer;
  composer.start();

  const events = [];
  const unsub = adapter.onPanicChange((state) => events.push(state));
  adapter.panic();
  adapter.resume();
  assert(events.length === 2 && events[0] === true && events[1] === false,
    'onPanicChange emits [true, false] on panic then resume');

  unsub();
  adapter.panic();
  assert(events.length === 2, 'unsubscribed callback no longer fires');

  composer.stop();
}

// ---------------------------------------------------------------------------
// Test 3: panic() works before activate() — zero source registered even with
// no composer attached.
// ---------------------------------------------------------------------------
{
  const adapter = new UseqCeliumAdapter();
  await adapter.init(null);
  adapter.panic();
  const src = adapter.producer._sourceFn;
  const z = src();
  assert(z && z.cvMain.every((v) => v === 0), 'panic pre-activate yields zeros');
  assert(adapter.panicked === true, 'panic pre-activate sets panicked flag');
}

// ---------------------------------------------------------------------------
if (failed) { console.error(`\n${failed} test(s) failed.`); process.exit(1); }
console.log('\nall ok');
