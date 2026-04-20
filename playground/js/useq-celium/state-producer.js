// StateProducer — drives a fixed-rate loop that encodes StateSnapshot packets
// and hands them to UseqSerialBridge.
//
// Design notes:
//   - setInterval, not requestAnimationFrame: rAF throttles when the tab is
//     blurred or the drawer covers the canvas. We want steady ~500Hz state
//     output regardless of render cadence.
//   - sourceFn is fully injectable so later agents can plug in a real CV/gate
//     producer (ratioSeq / phasor / MLP routing / whatever). The default
//     emits all zeros so the plumbing is observable end-to-end with nothing
//     upstream wired in yet.
//   - If the bridge write rejects repeatedly, tear down the connection rather
//     than silently burning CPU on a dead port.
//
// See docs/useq-celium/protocol.md for the packet layout.

import {
  UC_NUM_HARD_GATES,
  UC_NUM_MAIN_CV,
  UC_NUM_EXP_CV,
  encodeStateSnapshot,
} from './protocol.js';

const DEFAULT_RATE_HZ = 500;
const MAX_CONSECUTIVE_FAILURES = 5;

/** The zeros source. Always safe, no closure captures. */
function defaultSource() {
  return {
    gates: [0, 0, 0],
    cvMain: [0, 0, 0],
    cvExp: [0, 0, 0, 0, 0, 0, 0, 0],
  };
}

export class StateProducer {
  /**
   * @param {import('./serial-bridge.js').UseqSerialBridge} bridge
   * @param {() => {gates:number[], cvMain:number[], cvExp:number[]}} [sourceFn]
   * @param {number} [rateHz=500]
   */
  constructor(bridge, sourceFn = defaultSource, rateHz = DEFAULT_RATE_HZ) {
    this._bridge = bridge;
    this._sourceFn = sourceFn || defaultSource;
    this._rateHz = rateHz;
    this._timer = null;
    this._seq = 0;
    this._consecutiveFailures = 0;
    this._writeInFlight = false;
  }

  get running() {
    return this._timer !== null;
  }

  /**
   * EXTENSION POINT (opus47): later agents can call this to plug in a real
   * CV/gate producer. The function is called once per tick and must return
   * an object shaped like `{gates: number[3], cvMain: number[3], cvExp: number[8]}`.
   * Undefined/null fields fall back to zeros.
   */
  setSource(sourceFn) {
    this._sourceFn = sourceFn || defaultSource;
  }

  /** Begin polling at the configured rate. No-op if already running. */
  start() {
    if (this._timer !== null) return;
    this._seq = 0;
    this._consecutiveFailures = 0;
    const periodMs = Math.max(1, Math.round(1000 / this._rateHz));
    this._timer = setInterval(() => this._tick(), periodMs);
  }

  /** Stop polling. Safe to call multiple times. */
  stop() {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._writeInFlight = false;
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  _tick() {
    // Skip if a write is still in flight — backpressure on the port would
    // otherwise stack up promises unboundedly.
    if (this._writeInFlight) return;

    let frame;
    try {
      frame = this._sourceFn() || defaultSource();
    } catch (err) {
      console.warn('[StateProducer] sourceFn threw, using zeros:', err);
      frame = defaultSource();
    }

    const gates = _coerceArray(frame.gates, UC_NUM_HARD_GATES);
    const cvMain = _coerceArray(frame.cvMain, UC_NUM_MAIN_CV);
    const cvExp = _coerceArray(frame.cvExp, UC_NUM_EXP_CV);

    let pkt;
    try {
      pkt = encodeStateSnapshot(this._seq, gates, cvMain, cvExp);
    } catch (err) {
      console.error('[StateProducer] encode failed:', err);
      return;
    }

    this._seq = (this._seq + 1) & 0xff;

    this._writeInFlight = true;
    this._bridge.writePacket(pkt)
      .then(() => {
        this._writeInFlight = false;
        this._consecutiveFailures = 0;
      })
      .catch((err) => {
        this._writeInFlight = false;
        this._consecutiveFailures++;
        console.warn(
          `[StateProducer] write failed (${this._consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
          err,
        );
        if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error('[StateProducer] too many consecutive failures — stopping and disconnecting');
          this.stop();
          // Best-effort bridge teardown; swallow any downstream errors.
          Promise.resolve(this._bridge.disconnect()).catch(() => {});
        }
      });
  }
}

/**
 * Ensure a value is a fixed-length array of numbers. Zero-fills missing
 * entries so a partially-specified source still yields a valid packet.
 * @param {any} v
 * @param {number} len
 * @returns {number[]}
 */
function _coerceArray(v, len) {
  const out = new Array(len).fill(0);
  if (!v) return out;
  for (let i = 0; i < len && i < v.length; i++) {
    const n = v[i];
    out[i] = typeof n === 'number' ? n : (n ? 1 : 0);
  }
  return out;
}
