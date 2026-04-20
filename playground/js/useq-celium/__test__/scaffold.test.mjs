// Scaffold tests for the uSEQ-Celium browser-mode plumbing.
//
// Run with:
//   node playground/js/useq-celium/__test__/scaffold.test.mjs
//
// Checks that:
//   - each scaffolded module parses + exports its intended surface
//   - encodeStateSnapshot produces a 28-byte packet with expected preamble
//   - UseqSerialBridge.isSupported() returns false under Node (no WebSerial)
//     which we treat as a pass — real support is verified in the browser.
//
// Browser-only APIs (Node has no `window`/`navigator.serial`/`setInterval` on
// globalThis actually — setInterval is available; but we never start the
// producer here so that path stays dormant).

import { UseqCeliumAdapter }  from '../adapter.js';
import { UseqSerialBridge }   from '../serial-bridge.js';
import { StateProducer }      from '../state-producer.js';
import {
  encodeStateSnapshot,
  UC_STATE_SNAPSHOT_LEN,
  UC_SYNC_1,
  UC_SYNC_2,
  UC_TYPE_STATE_SNAPSHOT,
  UC_NUM_HARD_GATES,
  UC_NUM_MAIN_CV,
  UC_NUM_EXP_CV,
} from '../protocol.js';

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('  ok :', msg);
  }
};

// ---------------------------------------------------------------------------
// Adapter surface
// ---------------------------------------------------------------------------
{
  const adapter = new UseqCeliumAdapter();
  assert(adapter.id === 'useq-celium', 'adapter.id == useq-celium');
  assert(adapter.displayName === 'uSEQ-Celium', 'adapter.displayName == uSEQ-Celium');
  assert(Array.isArray(adapter.paramMeta) && adapter.paramMeta.length === 0, 'paramMeta is empty array (plumbing stage)');
  assert(adapter.paramCount === 0, 'paramCount = 0');

  // Expected methods
  for (const m of [
    'init', 'stop', 'dispose', 'connect', 'disconnect',
    'setParam', 'noteOn', 'noteOff',
    'onConnectionChange', 'setSnapshotSource', 'getOutputNode',
  ]) {
    assert(typeof adapter[m] === 'function', `adapter has method ${m}()`);
  }

  // Static feature-detect should be false under Node (no navigator.serial)
  assert(UseqCeliumAdapter.isSupported() === false,
    'UseqCeliumAdapter.isSupported() false in Node — ok');

  // setParam is a no-op stub; verify it doesn't throw
  adapter.setParam(0, 0.5);
  assert(true, 'setParam() no-op before routing wires up (no throw)');

  // onConnectionChange returns an unsubscribe function
  const unsub = adapter.onConnectionChange(() => {});
  assert(typeof unsub === 'function', 'onConnectionChange returns unsubscribe fn');
  unsub();

  // setSnapshotSource stashes the source even if init hasn't been called
  adapter.setSnapshotSource(() => ({ gates: [0,0,0], cvMain: [0,0,0], cvExp: new Array(8).fill(0) }));
  assert(true, 'setSnapshotSource callable pre-init');
}

// ---------------------------------------------------------------------------
// Serial bridge surface
// ---------------------------------------------------------------------------
{
  assert(UseqSerialBridge.isSupported() === false,
    'UseqSerialBridge.isSupported() false in Node — ok');

  const bridge = new UseqSerialBridge();
  assert(bridge.connected === false, 'new bridge starts disconnected');
  assert(typeof bridge.connect === 'function', 'bridge.connect()');
  assert(typeof bridge.disconnect === 'function', 'bridge.disconnect()');
  assert(typeof bridge.writePacket === 'function', 'bridge.writePacket()');
  assert(typeof bridge.addEventListener === 'function', 'bridge is EventTarget (addEventListener)');

  // disconnect is idempotent when not connected
  await bridge.disconnect();
  assert(true, 'disconnect() idempotent when not connected');
}

// ---------------------------------------------------------------------------
// StateProducer surface
// ---------------------------------------------------------------------------
{
  const fakeBridge = {
    writePacket: async () => {},
    disconnect: async () => {},
  };
  const producer = new StateProducer(fakeBridge, undefined, 500);
  assert(producer.running === false, 'producer starts not running');
  assert(typeof producer.start === 'function', 'producer.start()');
  assert(typeof producer.stop === 'function', 'producer.stop()');
  assert(typeof producer.setSource === 'function', 'producer.setSource()');
  // stop() before start() is a no-op
  producer.stop();
  assert(true, 'producer.stop() no-op before start()');
}

// ---------------------------------------------------------------------------
// Protocol sanity — reconfirm packet length + preamble so downstream work
// can rely on it.
// ---------------------------------------------------------------------------
{
  const pkt = encodeStateSnapshot(
    0,
    new Array(UC_NUM_HARD_GATES).fill(0),
    new Array(UC_NUM_MAIN_CV).fill(0),
    new Array(UC_NUM_EXP_CV).fill(0),
  );
  assert(pkt instanceof Uint8Array, 'encodeStateSnapshot returns Uint8Array');
  assert(pkt.length === 28, 'packet length == 28');
  assert(pkt.length === UC_STATE_SNAPSHOT_LEN, 'length matches UC_STATE_SNAPSHOT_LEN');
  assert(pkt[0] === UC_SYNC_1 && pkt[1] === UC_SYNC_2, 'sync bytes present');
  assert(pkt[2] === UC_TYPE_STATE_SNAPSHOT, 'type byte present');
}

// ---------------------------------------------------------------------------
if (failed) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log('\nall ok');
