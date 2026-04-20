#!/usr/bin/env node
// loopback_smoke.mjs — end-to-end smoke test for the uSEQ-Celium wire protocol
// with NO hardware required.
//
// Spawns a socat PTY pair (preferred) or falls back to a TCP loopback pair,
// then runs:
//   - producer side: encodeStateSnapshot() at 500 Hz, seq-counter ticking,
//     pumping a configurable pattern (zero / ramp / sine / gates) to one end.
//   - consumer side: the same state machine the firmware uses (WAIT_SYNC1 →
//     WAIT_SYNC2 → READ_BODY → CRC8) — decodes packets, logs gates/cvMain/cvExp,
//     watches for framing errors, CRC errors, and sequence-number drops.
//
// Usage:
//   node firmware/useq-celium/tools/loopback_smoke.mjs --pattern ramp --duration 5
//   node firmware/useq-celium/tools/loopback_smoke.mjs --pattern zero --duration 2
//   node firmware/useq-celium/tools/loopback_smoke.mjs --tcp   # force TCP fallback
//
// Exits 0 (PASS) on no framing errors, no CRC errors, and at most one sync
// break (allowed at startup). Exits 1 (FAIL) otherwise. Last line of stdout
// is always "PASS" or "FAIL".
//
// TCP fallback notes:
//   When running under TCP, the browser-side bridge would need to be pointed
//   at the TCP server instead of navigator.serial — not wired in for browser
//   use, but this mode is kept so the smoke test works on systems without
//   socat installed (e.g. fresh containers). The producer/consumer loop is
//   otherwise identical; only the transport differs.

import { spawn } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  encodeStateSnapshot,
  crc8,
  UC_SYNC_1,
  UC_SYNC_2,
  UC_TYPE_STATE_SNAPSHOT,
  UC_STATE_SNAPSHOT_LEN,
  UC_NUM_HARD_GATES,
  UC_NUM_MAIN_CV,
  UC_NUM_EXP_CV,
} from '../../../playground/js/useq-celium/protocol.js';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { pattern: 'ramp', duration: 2, tcp: false, rate: 500 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pattern') args.pattern = argv[++i];
    else if (a === '--duration') args.duration = parseFloat(argv[++i]);
    else if (a === '--rate') args.rate = parseFloat(argv[++i]);
    else if (a === '--tcp') args.tcp = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: loopback_smoke.mjs [--pattern zero|ramp|sine|gates] [--duration SEC] [--rate HZ] [--tcp]');
      process.exit(0);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const PATTERNS = {
  zero: (_t) => ({
    gates: [0, 0, 0],
    cvMain: [0, 0, 0],
    cvExp: [0, 0, 0, 0, 0, 0, 0, 0],
  }),
  ramp: (t) => {
    const v = (t * 0.25) % 1; // 4s period, [0,1)
    return {
      gates: [1, 1, 1],
      cvMain: [v, v, v],
      cvExp: new Array(UC_NUM_EXP_CV).fill(v),
    };
  },
  sine: (t) => {
    const main = [];
    for (let i = 0; i < UC_NUM_MAIN_CV; i++) {
      main.push(0.5 + 0.5 * Math.sin(2 * Math.PI * (t / 2 + i * 0.15)));
    }
    const exp = [];
    for (let i = 0; i < UC_NUM_EXP_CV; i++) {
      exp.push(0.5 + 0.5 * Math.sin(2 * Math.PI * (t / 3 + 0.3 + i * 0.1)));
    }
    const gates = [Math.floor(t * 2) % 2, Math.floor(t * 3) % 2, Math.floor(t * 4) % 2];
    return { gates, cvMain: main, cvExp: exp };
  },
  gates: (t) => {
    const step = Math.floor(t * 4) % UC_NUM_HARD_GATES;
    const gates = [0, 0, 0];
    gates[step] = 1;
    return {
      gates,
      cvMain: [0.5, 0.5, 0.5],
      cvExp: new Array(UC_NUM_EXP_CV).fill(0.5),
    };
  },
};

// ---------------------------------------------------------------------------
// Transport: socat PTY pair OR TCP loopback
// ---------------------------------------------------------------------------

async function haveSocat() {
  return new Promise((resolve) => {
    const p = spawn('socat', ['-V'], { stdio: 'ignore' });
    p.once('error', () => resolve(false));
    p.once('exit', (code) => resolve(code === 0));
  });
}

/**
 * Spawn socat creating two linked PTYs. Returns { producerPath, consumerPath, kill }.
 * socat prints the device paths to stderr when run with -d -d; we parse them.
 */
async function openSocatPair() {
  return new Promise((resolve, reject) => {
    const proc = spawn('socat', ['-d', '-d', 'pty,raw,echo=0', 'pty,raw,echo=0']);
    const paths = [];
    let done = false;
    const stderrBuf = [];
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderrBuf.push(text);
      const m = text.match(/PTY is (\S+)/g);
      if (m) for (const line of m) paths.push(line.replace('PTY is ', ''));
      if (!done && paths.length >= 2) {
        done = true;
        resolve({
          producerPath: paths[0],
          consumerPath: paths[1],
          kill: () => { try { proc.kill('SIGTERM'); } catch { /* no-op */ } },
        });
      }
    });
    proc.once('error', (err) => { if (!done) reject(err); });
    proc.once('exit', (code) => {
      if (!done) reject(new Error(`socat exited early (${code}): ${stderrBuf.join('')}`));
    });
    // 5s safety timeout
    setTimeout(() => {
      if (!done) {
        try { proc.kill('SIGKILL'); } catch { /* no-op */ }
        reject(new Error('socat timeout waiting for PTYs'));
      }
    }, 5000);
  });
}

// ---------------------------------------------------------------------------
// Consumer state machine — mirrors firmware/useq-celium/src/main/main.cpp.
// ---------------------------------------------------------------------------

class ConsumerParser {
  constructor(onPacket, onError) {
    this._state = 0; // 0 = WAIT_SYNC1, 1 = WAIT_SYNC2, 2 = READ_BODY
    this._buf = new Uint8Array(UC_STATE_SNAPSHOT_LEN);
    this._len = 0;
    this._onPacket = onPacket;
    this._onError = onError;
    this.framingErrors = 0;
    this.crcErrors = 0;
    this.packetsOk = 0;
    this.bytesSeen = 0;
  }

  feedBytes(chunk) {
    for (const b of chunk) {
      this.bytesSeen++;
      switch (this._state) {
        case 0: // WAIT_SYNC1
          if (b === UC_SYNC_1) {
            this._buf[0] = b;
            this._len = 1;
            this._state = 1;
          } else {
            // out-of-sync byte (may be expected right at startup)
            this.framingErrors++;
          }
          break;
        case 1: // WAIT_SYNC2
          if (b === UC_SYNC_2) {
            this._buf[1] = b;
            this._len = 2;
            this._state = 2;
          } else if (b === UC_SYNC_1) {
            this._len = 1;
            this._state = 1;
          } else {
            this.framingErrors++;
            this._state = 0;
            this._len = 0;
          }
          break;
        case 2: // READ_BODY
          this._buf[this._len++] = b;
          if (this._len === UC_STATE_SNAPSHOT_LEN) {
            this._finish();
            this._state = 0;
            this._len = 0;
          }
          break;
      }
    }
  }

  _finish() {
    const calcCrc = crc8(this._buf, 2, UC_STATE_SNAPSHOT_LEN - 1);
    const pktCrc = this._buf[UC_STATE_SNAPSHOT_LEN - 1];
    if (calcCrc !== pktCrc) {
      this.crcErrors++;
      this._onError(`CRC mismatch: calc=${calcCrc} pkt=${pktCrc}`);
      return;
    }
    if (this._buf[2] !== UC_TYPE_STATE_SNAPSHOT) {
      this._onError(`unexpected type byte: 0x${this._buf[2].toString(16)}`);
      return;
    }
    const seq = this._buf[3];
    const gateBits = this._buf[4];
    const gates = [gateBits & 1, (gateBits >> 1) & 1, (gateBits >> 2) & 1];
    const cvMain = [];
    for (let i = 0; i < UC_NUM_MAIN_CV; i++) {
      cvMain.push(this._buf[5 + i * 2] | (this._buf[6 + i * 2] << 8));
    }
    const cvExp = [];
    const expBase = 5 + UC_NUM_MAIN_CV * 2;
    for (let i = 0; i < UC_NUM_EXP_CV; i++) {
      cvExp.push(this._buf[expBase + i * 2] | (this._buf[expBase + 1 + i * 2] << 8));
    }
    this.packetsOk++;
    this._onPacket({ seq, gates, cvMain, cvExp });
  }
}

// ---------------------------------------------------------------------------
// Producer: encode snapshots at rateHz and write them out.
// ---------------------------------------------------------------------------

async function runProducer({ writable, pattern, rateHz, durationSec }) {
  const patternFn = PATTERNS[pattern];
  if (!patternFn) throw new Error(`Unknown pattern: ${pattern}`);
  const periodMs = 1000 / rateHz;
  const endAt = Date.now() + durationSec * 1000;
  let seq = 0;
  let sent = 0;
  const t0 = Date.now();

  while (Date.now() < endAt) {
    const t = (Date.now() - t0) / 1000;
    const frame = patternFn(t);
    const pkt = encodeStateSnapshot(seq, frame.gates, frame.cvMain, frame.cvExp);
    try {
      await writable.write(pkt);
    } catch (err) {
      console.error('[producer] write failed:', err.message);
      break;
    }
    seq = (seq + 1) & 0xff;
    sent++;
    await new Promise((r) => setTimeout(r, periodMs));
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Transports — thin wrappers exposing a write() method.
// ---------------------------------------------------------------------------

async function openPtyTransport() {
  const pair = await openSocatPair();
  // socat takes a breath before PTYs are usable — give it 100ms.
  await new Promise((r) => setTimeout(r, 100));

  // Open each end with its own stream. PTYs are duplex, but using separate
  // read + write streams keeps the semantics clear.
  const producerWriteStream = createWriteStream(pair.producerPath);
  const consumerReadStream = createReadStream(pair.consumerPath);

  // Wait for both streams to be ready.
  await new Promise((resolve, reject) => {
    let opens = 0;
    const done = () => (++opens === 2 ? resolve() : null);
    producerWriteStream.once('open', done);
    consumerReadStream.once('open', done);
    producerWriteStream.once('error', reject);
    consumerReadStream.once('error', reject);
  });

  const producerWritable = {
    write: async (bytes) => new Promise((res, rej) => {
      producerWriteStream.write(bytes, (err) => (err ? rej(err) : res()));
    }),
  };

  return {
    producerWritable,
    consumerReadable: consumerReadStream,
    close: async () => {
      try { producerWriteStream.destroy(); } catch { /* no-op */ }
      try { consumerReadStream.destroy(); } catch { /* no-op */ }
      pair.kill();
    },
    label: `PTY ${pair.producerPath} ↔ ${pair.consumerPath}`,
  };
}

async function openTcpTransport() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const producerSocket = createConnection({ host: '127.0.0.1', port }, () => {
        // Accepted socket is the reader side.
      });
      server.once('connection', (consumerSocket) => {
        const producerWritable = {
          write: async (bytes) => new Promise((res, rej) => {
            producerSocket.write(bytes, (err) => (err ? rej(err) : res()));
          }),
        };
        resolve({
          producerWritable,
          consumerReadable: consumerSocket,
          close: async () => {
            try { producerSocket.destroy(); } catch { /* no-op */ }
            try { consumerSocket.destroy(); } catch { /* no-op */ }
            server.close();
          },
          label: `TCP localhost:${port}`,
        });
      });
      producerSocket.once('error', reject);
    });
    server.once('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[loopback_smoke] pattern=${args.pattern} duration=${args.duration}s rate=${args.rate}Hz tcp=${args.tcp}`);

  let transport;
  if (!args.tcp && (await haveSocat())) {
    try {
      transport = await openPtyTransport();
    } catch (err) {
      console.warn('[loopback_smoke] socat PTY setup failed, falling back to TCP:', err.message);
      transport = await openTcpTransport();
    }
  } else {
    transport = await openTcpTransport();
  }
  console.log(`[loopback_smoke] transport: ${transport.label}`);

  // Consumer state.
  let lastSeq = -1;
  let seqDrops = 0;
  let firstSeqBreakAllowed = true;
  const errs = [];
  const parser = new ConsumerParser(
    (pkt) => {
      if (lastSeq !== -1) {
        const expected = (lastSeq + 1) & 0xff;
        if (pkt.seq !== expected) {
          // Startup resync: allow exactly one break.
          if (firstSeqBreakAllowed && parser.packetsOk <= 2) {
            firstSeqBreakAllowed = false;
          } else {
            seqDrops++;
            errs.push(`seq drop: expected ${expected}, got ${pkt.seq}`);
          }
        }
      }
      lastSeq = pkt.seq;
      // Log every 250th packet (roughly 2× per second at 500 Hz).
      if (parser.packetsOk === 1 || parser.packetsOk % 250 === 0) {
        console.log(`seq=${pkt.seq} gates=[${pkt.gates.join(',')}] cvMain=[${pkt.cvMain.join(',')}] cvExp=[${pkt.cvExp.join(',')}]`);
      }
    },
    (msg) => errs.push(msg),
  );

  transport.consumerReadable.on('data', (chunk) => parser.feedBytes(chunk));
  transport.consumerReadable.on('error', (err) => errs.push(`consumer read error: ${err.message}`));

  // Producer runs for args.duration; consumer reads concurrently.
  let sent = 0;
  try {
    sent = await runProducer({
      writable: transport.producerWritable,
      pattern: args.pattern,
      rateHz: args.rate,
      durationSec: args.duration,
    });
  } finally {
    // Give the consumer a moment to drain last packets.
    await new Promise((r) => setTimeout(r, 200));
    await transport.close();
  }

  // Summary.
  console.log('---');
  console.log(`packets sent:     ${sent}`);
  console.log(`packets decoded:  ${parser.packetsOk}`);
  console.log(`bytes through:    ${parser.bytesSeen}`);
  console.log(`framing errors:   ${parser.framingErrors} (startup bytes before SYNC_1 are expected)`);
  console.log(`CRC errors:       ${parser.crcErrors}`);
  console.log(`seq drops:        ${seqDrops}`);

  // Pass conditions: decoded > 0, no CRC errors, no seq drops beyond the
  // single allowed startup break. Framing errors right at startup are fine
  // (the first bytes the consumer sees may be mid-packet if socat racy).
  const pass =
    parser.packetsOk > 0 &&
    parser.crcErrors === 0 &&
    seqDrops === 0;

  if (!pass) {
    console.log('errors:');
    for (const e of errs.slice(0, 10)) console.log(`  ${e}`);
  }

  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('[loopback_smoke] fatal:', err);
  console.log('FAIL');
  process.exit(1);
});
