/** Sequencer tests (run with `bun test`): scales, generators and the pure core. */
import { expect, test } from 'bun:test';
import { euclidHit, pulsesFor } from './gen-euclid-turing';
import { REST_THRESHOLD } from './gen-steps';
import { GENERATORS, slotCount } from './generators';
import { SequencerCore, type NoteSink } from './sequencer-core';
import { SCALES, buildNotePool, quantiseToPool } from './scales';
import {
  DEFAULT_SEQUENCER_SETTINGS,
  SEQ_SLOTS,
  type GeneratorId,
  type SequencerSettings,
  type StepEvent,
} from './types';

const settings = (o: Partial<SequencerSettings> = {}): SequencerSettings => ({
  ...DEFAULT_SEQUENCER_SETTINGS,
  ...o,
});
const params = (v = 0.5) => new Float32Array(SEQ_SLOTS).fill(v);
const IDS: GeneratorId[] = ['euclid-turing', 'walker', 'steps'];

function run(id: GeneratorId, s: SequencerSettings, p: Float32Array, n: number): StepEvent[] {
  const st = GENERATORS[id].create(s.seed);
  const out: StepEvent[] = [];
  for (let i = 0; i < n; i++) out.push({ ...st.step(i, p, s) });
  return out;
}

test('scales: every scale starts at 0 and ascends within an octave', () => {
  for (const sc of Object.values(SCALES)) {
    expect(sc.intervals[0]).toBe(0);
    for (let i = 1; i < sc.intervals.length; i++) {
      expect(sc.intervals[i]).toBeGreaterThan(sc.intervals[i - 1]);
    }
    expect(sc.intervals[sc.intervals.length - 1]).toBeLessThan(12);
  }
});

test('note pool: sorted, spans octaves from C3, respects root and offset', () => {
  const pool = buildNotePool(settings({ scale: 'major', root: 2, octaveRange: 2, octaveOffset: 1 }));
  expect(pool.length).toBe(14);
  expect(pool[0]).toBe(48 + 2 + 12);
  expect([...pool].sort((a, b) => a - b)).toEqual(pool);
  expect(buildNotePool(settings({ scale: 'major', octaveRange: 1 })).length).toBe(7);
});

test('note pool is clamped to MIDI range', () => {
  const pool = buildNotePool(settings({ scale: 'chromatic', root: 11, octaveRange: 4, octaveOffset: 3 }));
  expect(Math.max(...pool)).toBeLessThanOrEqual(127);
  expect(Math.min(...pool)).toBeGreaterThanOrEqual(0);
});

test('quantiseToPool hits the ends and clamps', () => {
  const pool = [60, 62, 64, 67];
  expect(quantiseToPool(0, pool)).toBe(60);
  expect(quantiseToPool(1, pool)).toBe(67);
  expect(quantiseToPool(-1, pool)).toBe(60);
  expect(quantiseToPool(2, pool)).toBe(67);
});

test('euclid: E(3,8) has three pulses; rotation keeps the count', () => {
  for (const rot of [0, 1, 5]) {
    let hits = 0;
    for (let i = 0; i < 8; i++) if (euclidHit(i, 3, 8, rot)) hits++;
    expect(hits).toBe(3);
  }
  expect(pulsesFor(0, 16)).toBe(2);
  expect(pulsesFor(1, 16)).toBe(16);
});

test('generators: deterministic per seed, differ across seeds', () => {
  for (const id of IDS) {
    const s = settings({ generator: id, seed: 7 });
    const p = params();
    for (let i = 0; i < SEQ_SLOTS; i++) p[i] = 0.3 + 0.07 * i;
    const a = run(id, s, p, 64);
    expect(run(id, s, p, 64)).toEqual(a);
    if (id !== 'steps') expect(run(id, { ...s, seed: 8 }, p, 64)).not.toEqual(a);
  }
});

test('generators: every note is in the pool, velocity and gate are in range', () => {
  for (const id of IDS) {
    for (const v of [0.2, 0.5, 0.9]) {
      const s = settings({ generator: id, scale: 'dorian', root: 3, steps: 12 });
      const pool = new Set(buildNotePool(s));
      for (const e of run(id, s, params(v), 96)) {
        if (e.note !== null) expect(pool.has(e.note)).toBe(true);
        expect(e.velocity).toBeGreaterThan(0);
        expect(e.velocity).toBeLessThanOrEqual(1);
        expect(e.gate).toBeGreaterThanOrEqual(0.05);
        expect(e.gate).toBeLessThanOrEqual(1);
      }
    }
  }
});

test('generators: rests happen and notes happen', () => {
  for (const id of IDS) {
    const p = params(0.5);
    p[1] = 0.05;
    p[5] = 0.05;
    const ev = run(id, settings({ generator: id }), p, 64);
    expect(ev.some((e) => e.note === null)).toBe(true);
    expect(ev.some((e) => e.note !== null)).toBe(true);
  }
});

test('density floor: even with minimum outputs euclid and walker keep playing', () => {
  const s = settings({ generator: 'euclid-turing' });
  const ev = run('euclid-turing', s, params(0), 64);
  expect(ev.filter((e) => e.note !== null).length).toBeGreaterThanOrEqual(8);
  const w = run('walker', settings({ generator: 'walker' }), params(1), 64);
  expect(w.filter((e) => e.note !== null).length).toBeGreaterThanOrEqual(32);
});

test('euclid + walker resolve to the root at the end of every loop', () => {
  for (const id of ['euclid-turing', 'walker'] as const) {
    const s = settings({ generator: id, steps: 8, scale: 'major', root: 5 });
    const ev = run(id, s, params(0.5), 8 * 6);
    for (let loop = 0; loop < 6; loop++) {
      const notes = ev.slice(loop * 8, loop * 8 + 8).filter((e) => e.note !== null);
      expect(notes[notes.length - 1].note! % 12).toBe(5);
    }
  }
});

test('walker leaps are capped', () => {
  const s = settings({ generator: 'walker', steps: 16, scale: 'chromatic' });
  const ev = run('walker', s, params(1), 200).filter((e) => e.note !== null);
  for (let i = 1; i < ev.length; i++) {
    // Loop-end resolution may move further; only check consecutive mid-loop moves loosely.
    expect(Math.abs(ev[i].note! - ev[i - 1].note!)).toBeLessThanOrEqual(12);
  }
});

test('euclid leaps are capped at a fifth away from loop resolution', () => {
  const s = settings({ generator: 'euclid-turing', steps: 16, scale: 'chromatic', octaveRange: 3 });
  const p = params(0.5);
  p[3] = 1;
  const ev = run('euclid-turing', s, p, 16 * 8);
  let prev: number | null = null;
  ev.forEach((e, i) => {
    if (e.note === null) return;
    const resolving = e.note % 12 === 0;
    if (prev !== null && !resolving) expect(Math.abs(e.note - prev)).toBeLessThanOrEqual(7);
    prev = e.note;
    void i;
  });
});

test('steps: slots map to positions; below threshold is a rest', () => {
  const p = params(0);
  p[0] = 1;
  p[2] = REST_THRESHOLD + 0.2;
  const s = settings({ generator: 'steps', steps: 8 });
  const ev = run('steps', s, p, 8);
  expect(ev[0].note).not.toBeNull();
  expect(ev[1].note).toBeNull();
  expect(ev[2].note).not.toBeNull();
  // 16 steps: step i uses slot floor(i / 2).
  const ev16 = run('steps', settings({ generator: 'steps', steps: 16 }), p, 16);
  expect(ev16[0].note).toBe(ev16[1].note);
  expect(ev16[2].note).toBeNull();
  expect(ev16[4].note).not.toBeNull();
});

test('slotCount matches slots', () => {
  for (const id of IDS) {
    expect(slotCount(id)).toBe(GENERATORS[id].slots.length);
    expect(slotCount(id)).toBeLessThanOrEqual(SEQ_SLOTS);
  }
});

function makeCore() {
  const log: string[] = [];
  const sink: NoteSink = {
    noteOn: (n) => log.push(`on${n}`),
    noteOff: (n) => log.push(`off${n}`),
  };
  const steps: number[] = [];
  const core = new SequencerCore(sink, (r) => steps.push(r.index));
  return { core, log, steps };
}

test('core: steps fire on the 16th grid and every noteOn gets a noteOff', () => {
  const { core, log, steps } = makeCore();
  core.setSettings(settings({ generator: 'steps', bpm: 120, gate: 1 }));
  core.setParams(params(0.8));
  core.start(1000);
  core.pump(1000);
  expect(steps).toEqual([0]);
  expect(core.pump(1000)).toBe(1125); // 120 bpm => 125 ms per 16th
  core.pump(1125 * 1 + 1000);
  for (let t = 1000; t < 3000; t += 10) core.pump(t);
  expect(steps.length).toBe(Math.ceil(2000 / 125));
  core.stop();
  const ons = log.filter((l) => l.startsWith('on')).length;
  const offs = log.filter((l) => l.startsWith('off')).length;
  expect(offs).toBe(ons);
  for (let i = 0; i < log.length; i++) {
    if (log[i].startsWith('on') && i > 0) expect(log[i - 1].startsWith('off')).toBe(true);
  }
});

test('core: stop releases held note; tempo change applies on next step', () => {
  const { core, log, steps } = makeCore();
  core.setSettings(settings({ generator: 'steps', bpm: 120, gate: 1 }));
  core.setParams(params(0.8));
  core.start(0);
  core.pump(0);
  core.setSettings(settings({ generator: 'steps', bpm: 60, gate: 1 }));
  expect(core.pump(0)).toBe(125); // step 0 already scheduled at old tempo
  core.pump(125);
  expect(core.pump(125)).toBe(125 + 250);
  core.stop();
  expect(log[log.length - 1].startsWith('off')).toBe(true);
  expect(core.pump(1e6)).toBe(Infinity);
  expect(steps.length).toBe(2);
});

test('core: changing seed resets the pattern index', () => {
  const { core, steps } = makeCore();
  core.setSettings(settings({ bpm: 120 }));
  core.start(0);
  for (let t = 0; t <= 400; t += 10) core.pump(t);
  core.setSettings(settings({ bpm: 120, seed: 99 }));
  core.pump(500);
  expect(steps[steps.length - 1]).toBe(0);
});

test('core: params are smoothed, not applied instantly', () => {
  const { core, log } = makeCore();
  core.setSettings(settings({ generator: 'steps', steps: 8, bpm: 240 }));
  core.setParams(params(0.5));
  core.start(0);
  core.pump(0);
  core.setParams(params(1));
  core.pump(62.5);
  const top = Math.max(...buildNotePool(settings()));
  expect(log.filter((l) => l.startsWith('on')).pop()).not.toBe(`on${top}`);
});
