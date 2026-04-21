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

  // Panic (now async — returns once the immediate zero packet has been
  // written or skipped).
  await adapter.panic();
  assert(adapter.panicked === true, 'adapter.panicked is true after panic()');

  const panicSrc = adapter.producer._sourceFn;
  const zeros = panicSrc();
  assert(zeros.gates.every((g) => g === false || g === 0), 'panic zeros: all gates falsy');
  assert(zeros.cvMain.every((v) => v === 0), 'panic zeros: cvMain all 0');
  assert(zeros.cvExp.every((v) => v === 0), 'panic zeros: cvExp all 0');

  // Calling panic twice is idempotent — still zeros.
  await adapter.panic();
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
  await adapter.panic();
  adapter.resume();
  assert(events.length === 2 && events[0] === true && events[1] === false,
    'onPanicChange emits [true, false] on panic then resume');

  unsub();
  await adapter.panic();
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
  await adapter.panic();
  const src = adapter.producer._sourceFn;
  const z = src();
  assert(z && z.cvMain.every((v) => v === 0), 'panic pre-activate yields zeros');
  assert(adapter.panicked === true, 'panic pre-activate sets panicked flag');
}

// ---------------------------------------------------------------------------
// Test 4 (H1): panic() ordering — no non-zero packet lands AFTER the zero.
//
// Inject a fake bridge that records every writePacket and artificially delays
// the FIRST write so we can simulate an in-flight producer write at the moment
// panic() is invoked. We then assert the LAST recorded write is a zero packet.
// ---------------------------------------------------------------------------
{
  // FakeBridge mirrors the surface the adapter + producer touch: writePacket,
  // flush, disconnect, addEventListener (no-op for connectionchange).
  class FakeBridge extends EventTarget {
    constructor() {
      super();
      this.writes = [];      // [{ts, firstByte, isZero}]
      this._currentWrite = null;
      this._delayFirst = true;
    }
    async writePacket(bytes) {
      const ts = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const firstByte = bytes[0];
      // Detect a zero-payload by sniffing CV bytes (offset 6..28). All zero?
      let allZero = true;
      for (let i = 6; i < bytes.length - 1; i++) {
        if (bytes[i] !== 0) { allZero = false; break; }
      }
      const entry = { ts, firstByte, isZero: allZero };
      this.writes.push(entry);

      // First write: artificially defer to the next microtask so panic() races
      // against an in-flight write.
      const delay = this._delayFirst;
      this._delayFirst = false;
      const p = (async () => {
        if (delay) await Promise.resolve();
        // No actual transport.
      })();
      this._currentWrite = p;
      try {
        await p;
      } finally {
        if (this._currentWrite === p) this._currentWrite = null;
      }
    }
    async flush() {
      const pending = this._currentWrite;
      if (!pending) return;
      try { await pending; } catch { /* swallow */ }
    }
    async disconnect() { /* no-op */ }
    get connected() { return true; }
  }

  const adapter = new UseqCeliumAdapter();
  await adapter.init(null);

  // Replace bridge + connected flag so producer.writePacket flows into FakeBridge.
  // Also retarget the producer's bridge reference (it captured the original
  // in its constructor).
  const fake = new FakeBridge();
  adapter._bridge = fake;
  adapter._connected = true;
  adapter.producer._bridge = fake;

  // Register a non-zero source so producer-issued ticks have distinctive bytes.
  const nonZeroSource = () => ({
    gates: [1, 0, 1],
    cvMain: [1234, 2345, 3456],
    cvExp: [100, 200, 300, 400, 500, 600, 700, 800],
  });
  adapter.setSnapshotSource(nonZeroSource);

  // Hand-fire one producer tick to put a write in-flight without waiting for
  // setInterval. We bypass start() to keep the test deterministic.
  adapter.producer._tick();
  assert(fake.writes.length === 1 && fake.writes[0].isZero === false,
    'in-flight producer write is non-zero before panic');

  // Now panic — synchronously initiates teardown + drain + zero write.
  await adapter.panic();

  // The LAST write must be a zero packet, and no non-zero write may appear
  // after the first zero.
  let firstZeroIdx = -1;
  for (let i = 0; i < fake.writes.length; i++) {
    if (fake.writes[i].isZero) { firstZeroIdx = i; break; }
  }
  assert(firstZeroIdx >= 0, 'panic emitted at least one zero packet');
  for (let i = firstZeroIdx; i < fake.writes.length; i++) {
    assert(fake.writes[i].isZero === true,
      `no non-zero write after the first zero (index ${i})`);
  }
  assert(fake.writes[fake.writes.length - 1].isZero === true,
    'last recorded write is a zero packet');
}

// ---------------------------------------------------------------------------
// Test 5 (H2): activate/deactivate AbortController removes DOM listeners.
// ---------------------------------------------------------------------------
{
  // Stub a minimal document so adapter.activate() can wire the keydown
  // listener via { signal }. We don't actually need to dispatch events — just
  // assert that the abort signal was tripped after deactivate().
  const adapter = new UseqCeliumAdapter();

  // Create a fake drawer + dualMlp + composer dependencies via the same
  // shortcut as Tests 1/2: skip activate(), test deactivate of an empty
  // _activateAbort instead. The simplest valid assertion of the contract:
  // after deactivate(), _activateAbort is null and aborted in earlier cycles
  // does not re-trigger anything.

  // Cycle 1: simulate activation by setting up the abort controller manually
  // (mirrors what activate() does), then deactivate().
  adapter._activated = true;
  adapter._activateAbort = new AbortController();
  const sig1 = adapter._activateAbort.signal;
  await adapter.deactivate();
  assert(sig1.aborted === true, 'cycle 1: signal aborted after deactivate');
  assert(adapter._activateAbort === null, 'cycle 1: _activateAbort cleared');

  // Cycle 2: do it again; ensure no leakage / no error.
  adapter._activated = true;
  adapter._activateAbort = new AbortController();
  const sig2 = adapter._activateAbort.signal;
  await adapter.deactivate();
  assert(sig2.aborted === true, 'cycle 2: signal aborted after deactivate');
  assert(sig2 !== sig1, 'cycle 2: fresh signal (not the cycle-1 instance)');
}

// ---------------------------------------------------------------------------
if (failed) { console.error(`\n${failed} test(s) failed.`); process.exit(1); }
console.log('\nall ok');
