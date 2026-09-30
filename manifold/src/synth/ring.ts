/**
 * Note/parameter ring buffer shared between producers (main thread, sequencer
 * worker) and the Powerful Synth Engine's AudioWorklet.
 *
 * Layout (Float32 view over a SharedArrayBuffer; Int32 view over the same
 * bytes for the atomic header): [writeIdx, readIdx, count, ...messages],
 * each message = [type, id, value, reserved]. Multi-producer safe via CAS on
 * writeIdx. The worklet is the only consumer. Ported verbatim from the old
 * playground bridge; the wire format MUST match `public/psynth/worklet-processor.js`.
 *
 * This file has no DOM/Worklet dependencies so it can be imported from a Worker.
 */

export const RING_MESSAGE = { PARAMETER: 0, NOTE_ON: 1, NOTE_OFF: 2 } as const;
export const RING_HEADER_SIZE = 3;
export const RING_MESSAGE_SIZE = 4;
export const RING_CAPACITY = 512;

/** Bytes needed for a ring SharedArrayBuffer. */
export const RING_BYTES = (RING_HEADER_SIZE + RING_CAPACITY * RING_MESSAGE_SIZE) * 4;

export function createRingBuffer(): SharedArrayBuffer {
  const sab = new SharedArrayBuffer(RING_BYTES);
  new Float32Array(sab).fill(0);
  return sab;
}

export class RingBufferWriter {
  private readonly f32: Float32Array;
  private readonly i32: Int32Array;

  constructor(readonly sharedBuffer: SharedArrayBuffer) {
    this.f32 = new Float32Array(sharedBuffer);
    this.i32 = new Int32Array(sharedBuffer);
  }

  write(type: number, id: number, value: number): boolean {
    for (let attempt = 0; attempt < 4; attempt++) {
      const writeIdx = Atomics.load(this.i32, 0);
      const readIdx = Atomics.load(this.i32, 1);
      const next = (writeIdx + 1) % RING_CAPACITY;
      if (next === readIdx) return false; // full
      if (Atomics.compareExchange(this.i32, 0, writeIdx, next) === writeIdx) {
        const off = RING_HEADER_SIZE + writeIdx * RING_MESSAGE_SIZE;
        this.f32[off] = type;
        this.f32[off + 1] = id;
        this.f32[off + 2] = value;
        this.f32[off + 3] = 0;
        Atomics.add(this.i32, 2, 1);
        return true;
      }
    }
    return false; // contention too high
  }

  writeParameter(hardwareId: number, value: number): boolean {
    return this.write(RING_MESSAGE.PARAMETER, hardwareId, value);
  }
  noteOn(note: number, velocity: number): boolean {
    return this.write(RING_MESSAGE.NOTE_ON, note, velocity);
  }
  noteOff(note: number, velocity = 0): boolean {
    return this.write(RING_MESSAGE.NOTE_OFF, note, velocity);
  }
}
