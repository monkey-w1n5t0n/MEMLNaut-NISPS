/**
 * Sequencer clock Web Worker. Owns the tempo clock (16th-note steps, absolute
 * performance.now targets so timer jitter never accumulates), runs the active
 * generator and writes note on/off straight into the shared synth ring.
 *
 * main -> worker: init {ring}, settings {settings}, params {p}, start, stop, dispose
 * worker -> main: step {index, note, velocity, gate}
 */
import { RingBufferWriter } from '../synth/ring';
import { SequencerCore } from './sequencer-core';
import type { SequencerSettings } from './types';

export type ClockMessage =
  | { type: 'init'; ring: SharedArrayBuffer }
  | { type: 'settings'; settings: SequencerSettings }
  | { type: 'params'; p: Float32Array }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'dispose' };

export type ClockReply = {
  type: 'step';
  index: number;
  note: number | null;
  velocity: number;
  gate: number;
};

const ctx = self as unknown as {
  postMessage(m: ClockReply): void;
  onmessage: ((e: MessageEvent<ClockMessage>) => void) | null;
  close(): void;
};

let core: SequencerCore | null = null;
let pending: SequencerSettings | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (!core) return;
  const next = core.pump(performance.now());
  if (next === Infinity) return;
  timer = setTimeout(schedule, Math.max(0, next - performance.now()));
}

ctx.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      core = new SequencerCore(new RingBufferWriter(m.ring), (r) =>
        ctx.postMessage({ type: 'step', ...r }),
      );
      if (pending) core.setSettings(pending);
      break;
    case 'settings':
      pending = m.settings;
      core?.setSettings(m.settings);
      break;
    case 'params':
      core?.setParams(m.p);
      break;
    case 'start':
      core?.start(performance.now());
      schedule();
      break;
    case 'stop':
      core?.stop();
      schedule();
      break;
    case 'dispose':
      core?.stop();
      if (timer !== null) clearTimeout(timer);
      core = null;
      ctx.close();
      break;
  }
};
