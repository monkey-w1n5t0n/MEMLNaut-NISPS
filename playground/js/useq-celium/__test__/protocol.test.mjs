// Sanity check for the wire format encoder. Run with:
//   node playground/js/useq-celium/__test__/protocol.test.mjs

import {
  UC_STATE_SNAPSHOT_LEN,
  UC_SYNC_1,
  UC_SYNC_2,
  UC_TYPE_STATE_SNAPSHOT,
  crc8,
  encodeStateSnapshot,
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

// --- CRC8 vectors (poly 0x07, init 0x00) ---------------------------------
// Computed by hand / cross-checked against standard SMBus CRC8 tables.
assert(crc8(new Uint8Array([])) === 0x00, 'crc8(empty) == 0x00');
assert(crc8(new Uint8Array([0x00])) === 0x00, 'crc8([0x00]) == 0x00');
assert(
  crc8(new Uint8Array([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39])) === 0xf4,
  'crc8("123456789") == 0xF4',
);

// --- StateSnapshot layout -----------------------------------------------
{
  const gates = [1, 0, 1];
  const cvMain = [0.0, 0.5, 1.0];
  const cvExp = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const pkt = encodeStateSnapshot(42, gates, cvMain, cvExp);

  assert(pkt.length === UC_STATE_SNAPSHOT_LEN, `length == ${UC_STATE_SNAPSHOT_LEN}`);
  assert(pkt[0] === UC_SYNC_1, 'sync1');
  assert(pkt[1] === UC_SYNC_2, 'sync2');
  assert(pkt[2] === UC_TYPE_STATE_SNAPSHOT, 'type');
  assert(pkt[3] === 42, 'seq');
  assert(pkt[4] === 0b101, 'gate bits = 0b101');

  // CV main channel 0 = 0.0 → u16 0 at offset 5..6
  assert(pkt[5] === 0x00 && pkt[6] === 0x00, 'cv_main[0] = 0');
  // CV main channel 2 = 1.0 → u16 65535 at offset 9..10
  assert(pkt[9] === 0xff && pkt[10] === 0xff, 'cv_main[2] = 0xFFFF (LE)');

  // CRC verification
  const expected = crc8(pkt, 2, 27);
  assert(pkt[27] === expected, 'crc8 matches');
}

// --- Round-trip round-off -----------------------------------------------
{
  const pkt = encodeStateSnapshot(0, [0, 0, 0], [0.5, 0.5, 0.5], new Array(8).fill(0.5));
  // 0.5 * 65535 = 32767.5 → rounds to 32768 (0x8000)
  const dv = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
  assert(dv.getUint16(5, true) === 32768, '0.5 → 0x8000');
}

// --- Clamping ------------------------------------------------------------
{
  const pkt = encodeStateSnapshot(0, [0, 0, 0], [-1, 2, NaN], new Array(8).fill(0));
  const dv = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
  assert(dv.getUint16(5, true) === 0, '-1 clamped to 0');
  assert(dv.getUint16(7, true) === 0xffff, '2 clamped to 65535');
  assert(dv.getUint16(9, true) === 0, 'NaN → 0');
}

if (failed) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log('\nall ok');
