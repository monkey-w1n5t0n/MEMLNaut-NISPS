import { expect, test } from 'bun:test';
import type { BackendContext, OutputMapping } from './backend';
import { PowerfulSynthBackend, type SynthSink } from './psynth-backend';
import { presetHeldValues, presetOutputCount, presetParamSpecs } from '../synth/preset-model';
import { RING_HEADER_SIZE, RING_MESSAGE, RING_MESSAGE_SIZE, RingBufferWriter, createRingBuffer } from '../synth/ring';

// Web Audio does not exist under bun; stub the availability probe.
const g = globalThis as Record<string, unknown>;
g.AudioContext ??= class {};
g.AudioWorkletNode ??= class {};

/** Fake synth that writes into a real ring so the wire format is exercised. */
function fakeSynth() {
  const ring = createRingBuffer();
  const w = new RingBufferWriter(ring);
  const f32 = new Float32Array(ring);
  const i32 = new Int32Array(ring);
  // The rig owns the synth's audio lifecycle, so the backend sees it already running.
  const synth: SynthSink = {
    isRunning: true,
    setParamByHardwareId(id: number, v: number) {
      w.writeParameter(id, v);
    },
  };
  const messages = () => {
    const n = i32[0];
    const out: { type: number; id: number; value: number }[] = [];
    for (let k = 0; k < n; k++) {
      const off = RING_HEADER_SIZE + k * RING_MESSAGE_SIZE;
      out.push({ type: f32[off], id: f32[off + 1], value: f32[off + 2] });
    }
    return out;
  };
  const clear = () => {
    i32[0] = 0;
    i32[1] = 0;
    i32[2] = 0;
  };
  return { synth, messages, clear };
}

const live = (min = 0, max = 1, curve = 0.5): OutputMapping => ({
  state: 'live',
  muted: false,
  min,
  max,
  curve,
  fixedValue: 0.5,
});

function ctxFor(n: number, mk: (i: number) => OutputMapping = () => live()): BackendContext {
  return {
    modeId: 't',
    outputCount: n,
    mappings: Array.from({ length: n }, (_, i) => mk(i)),
    names: Array.from({ length: n }, (_, i) => `o${i}`),
  };
}

/** Bypass the throttle gate (tests may poke lastSendMs). */
const open = (b: PowerfulSynthBackend) => ((b as unknown as { lastSendMs: number }).lastSendMs = -1e9);

test('start writes held values once for the preset', async () => {
  const { synth, messages } = fakeSynth();
  const b = new PowerfulSynthBackend(synth);
  (synth as { isRunning: boolean }).isRunning = false;
  b.setPreset('beginner-1'); // synth not running yet → nothing written
  expect(messages().length).toBe(0);
  const n = presetOutputCount('beginner-1');
  await b.start(ctxFor(n));
  expect(b.status().state).toBe('connecting'); // waits for the rig to start the synth
  (synth as { isRunning: boolean }).isRunning = true;
  await b.start(ctxFor(n));
  const held = presetHeldValues('beginner-1');
  const msgs = messages();
  expect(msgs.length).toBe(held.length);
  expect(msgs[0]).toMatchObject({ type: RING_MESSAGE.PARAMETER, id: held[0].id });
  expect(msgs[0].value).toBeCloseTo(held[0].value, 6);
  expect(b.status().state).toBe('ready');
});

test('send maps output i to the preset param, shaped by the mapping', async () => {
  const { synth, messages, clear } = fakeSynth();
  const b = new PowerfulSynthBackend(synth);
  b.setPreset('beginner-1');
  const specs = presetParamSpecs('beginner-1');
  await b.start(ctxFor(specs.length, () => live(0.2, 0.7)));
  clear();
  open(b);
  b.send(new Float32Array(specs.length).fill(0.5));
  const msgs = messages();
  expect(msgs.length).toBe(specs.length);
  expect(msgs[0].id).toBe(specs[0].id);
  expect(msgs[0].value).toBeCloseTo(0.45, 6);
  expect(msgs[14].id).toBe(specs[14].id);
});

test('only changed params are written and the dead-zone is respected', async () => {
  const { synth, messages, clear } = fakeSynth();
  const b = new PowerfulSynthBackend(synth);
  b.setPreset('beginner-1');
  const n = presetOutputCount('beginner-1');
  await b.start(ctxFor(n));
  const frame = new Float32Array(n).fill(0.3);
  clear();
  open(b);
  b.send(frame);
  expect(messages().length).toBe(n);

  clear();
  open(b);
  frame[2] += 0.001; // inside dead-zone
  frame[3] += 0.05; // outside
  b.send(frame);
  const msgs = messages();
  expect(msgs.length).toBe(1);
  expect(msgs[0].id).toBe(presetParamSpecs('beginner-1')[3].id);

  clear();
  open(b);
  b.send(frame); // unchanged
  expect(messages().length).toBe(0);
});

test('throttle drops frames inside 50 ms', async () => {
  const { synth, messages, clear } = fakeSynth();
  const b = new PowerfulSynthBackend(synth);
  b.setPreset('beginner-1');
  const n = presetOutputCount('beginner-1');
  await b.start(ctxFor(n));
  clear();
  open(b);
  b.send(new Float32Array(n).fill(0.1));
  const first = messages().length;
  b.send(new Float32Array(n).fill(0.9)); // immediately after → dropped
  expect(messages().length).toBe(first);
});

test('off and muted outputs are skipped; fixed outputs use fixedValue', async () => {
  const { synth, messages, clear } = fakeSynth();
  const b = new PowerfulSynthBackend(synth);
  b.setPreset('beginner-1');
  const n = presetOutputCount('beginner-1');
  const ctx = ctxFor(n, (i) => {
    const m = live();
    if (i === 0) m.state = 'off';
    if (i === 1) m.muted = true;
    if (i === 2) {
      m.state = 'fixed';
      m.fixedValue = 0.25;
    }
    return m;
  });
  await b.start(ctx);
  clear();
  open(b);
  b.send(new Float32Array(n).fill(0.8));
  const msgs = messages();
  expect(msgs.length).toBe(n - 2);
  const ids = presetParamSpecs('beginner-1').map((s) => s.id);
  expect(msgs.some((m) => m.id === ids[0] || m.id === ids[1])).toBe(false);
  expect(msgs.find((m) => m.id === ids[2])!.value).toBeCloseTo(0.25, 6);
});

test('teardown leaves the synth running (the rig owns audio)', async () => {
  const { synth } = fakeSynth();
  const b = new PowerfulSynthBackend(synth);
  b.setPreset('beginner-1');
  await b.start(ctxFor(15));
  await b.teardown();
  expect(synth.isRunning).toBe(true);
  expect(b.status().state).toBe('idle');
});
