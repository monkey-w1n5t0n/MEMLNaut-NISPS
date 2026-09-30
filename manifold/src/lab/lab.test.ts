/**
 * ML lab invariants (bun test). The lab's value is that a (config, seed) pair
 * replays exactly and that it drives the product's real controller — so those
 * are what is pinned here, plus the product bug the lab found.
 */
import { describe, expect, test } from 'bun:test';
import { createEngine } from '../engine/engine-api';
import { FeedbackController } from '../feedback/controller';
import { loadModule } from '../../scripts/lab/load-module';
import { VirtualClock } from './clock';
import { runEpisode } from './episode';
import { canon, configKey, PRESETS, SHIPPED, type LabConfig } from './settings';
import { planGrid, planOat, planPresets, recommend } from './sweep';

describe('VirtualClock', () => {
  test('fires intervals in time order and honours clearInterval', () => {
    const c = new VirtualClock();
    const log: string[] = [];
    const a = c.setInterval(() => log.push(`a${c.now()}`), 10);
    c.setInterval(() => log.push(`b${c.now()}`), 15);
    c.advance(30);
    expect(log).toEqual(['a10', 'b15', 'a20', 'a30', 'b30']);
    c.clearInterval(a);
    c.advance(15);
    expect(log.slice(5)).toEqual(['b45']);
    expect(c.now()).toBe(45);
  });
});

describe('episodes', () => {
  test('a (config, seed) pair replays bit-identically', async () => {
    const spec = { config: { ...SHIPPED }, seed: 7, goal: 'taste' as const, persona: 'casual' };
    const a = await runEpisode(spec, loadModule);
    const b = await runEpisode(spec, loadModule);
    expect(b.score).toBe(a.score);
    expect(b.curve).toEqual(a.curve);
    expect(b.counts).toEqual(a.counts);
  });

  test('the geometric replay runs in virtual time between gestures', async () => {
    const off = await runEpisode({ config: { ...SHIPPED, geoUpdatesPerSecond: 0 }, seed: 3, goal: 'place', persona: 'patient' }, loadModule);
    const on = await runEpisode({ config: { ...SHIPPED }, seed: 3, goal: 'place', persona: 'patient' }, loadModule);
    expect(on.counts.dislike).toBeGreaterThan(0);
    expect(on.errEnd).not.toBe(off.errEnd);
  });

  test('one-at-a-time plan pairs every config on the same episodes', () => {
    const plan = planOat({ seeds: 2, goals: ['place'], personas: ['casual'] }, ['nudgeStddev']);
    const perConfig = plan.specs.length / plan.configs.length;
    expect(perConfig).toBe(2);
    expect(recommend([]).recs).toEqual([]);
  });

  test('every episode reports lurch and retention', async () => {
    const r = await runEpisode({ config: { ...SHIPPED, feedbackMode: 'explore-and-place' }, seed: 2, goal: 'taste', persona: 'casual' }, loadModule);
    expect(r.lurch).toBeGreaterThanOrEqual(0);
    expect(r.nLiked).toBeGreaterThan(0);
    expect(r.likeErr).not.toBeNull();
  });
});

describe('configs', () => {
  test('a knob that does nothing is pinned, so behaviourally equal configs are one config', () => {
    const a: LabConfig = { ...SHIPPED } as LabConfig;
    // Background rates do nothing under burst learning; the like lr does nothing under background.
    expect(configKey({ ...a, bgHz: 25 })).toBe(configKey(a));
    const bg: LabConfig = { ...a, likeMode: 'background' };
    expect(configKey({ ...bg, learningRate: 0.5 })).toBe(configKey(bg));
    expect(configKey({ ...bg, bgHz: 25 })).not.toBe(configKey(bg));
    // Dislike settings do nothing in explore-and-place.
    const ep: LabConfig = { ...a, feedbackMode: 'explore-and-place' };
    expect(canon({ ...ep, geoLearningRate: 0.03 }).geoLearningRate).toBe(SHIPPED.geoLearningRate);
  });

  test('presets and grids build without duplicate configs', () => {
    const o = { seeds: 2, goals: ['place' as const], personas: ['casual'] };
    const cs = planPresets(PRESETS, o).configs.map(configKey);
    expect(new Set(cs).size).toBe(cs.length);
    const g = planGrid(o, 'learningRate', 'optimMaxAdjLr').configs.map(configKey);
    expect(new Set(g).size).toBe(g.length);
  });
});

describe('optimiser (the "learning rate does nothing" finding)', () => {
  // 12 fixed examples on the real boot net; how well does one like-train fit them?
  async function fitError(opts: Record<string, unknown>): Promise<number> {
    const eng = await createEngine({ seed: 5, persist: false, loadModule, spread: 0, ...opts });
    eng.reshape({ inputSize: 2, outputSize: 33, hidden: [10, 10, 14] }, 0); // ConsoleApp's boot reshape
    let st = 12345;
    const rnd = () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296);
    const xs: number[][] = [];
    const ys: number[][] = [];
    for (let i = 0; i < 12; i++) {
      xs.push([rnd(), rnd()]);
      ys.push(Array.from({ length: 33 }, () => 0.1 + 0.8 * rnd()));
      eng.addExample(xs[i]!, ys[i]!);
    }
    eng.train();
    const out = eng.inferBatch(xs as unknown as [number, number][]);
    let e = 0;
    for (let i = 0; i < 12; i++) {
      let a = 0;
      for (let j = 0; j < 33; j++) a += (out[i * 33 + j]! - ys[i]![j]!) ** 2;
      e += Math.sqrt(a);
    }
    eng.dispose();
    return e / 12;
  }

  test('at the shipped step cap the learning rate is (nearly) inert', async () => {
    const shipped = await fitError({});
    // Not bit-identical: the first few steps, with large gradients, do get
    // normalised. After that the cap of 1 binds every step, so lr 1 -> 0.001
    // (a 1000x change) moves the fit by well under 1%.
    for (const lr of [0.1, 0.01, 0.001]) {
      expect(Math.abs((await fitError({ learningRate: lr })) - shipped) / shipped).toBeLessThan(0.02);
    }
  });

  test('lifting the cap makes the learning rate real, and the fit far better (and survives reshape)', async () => {
    const shipped = await fitError({});
    const fixed = await fitError({ learningRate: 0.003, optim: { maxAdjLr: 1e6 } });
    expect(fixed).toBeLessThan(shipped / 3);
  });
});

describe('background learning (opt-in)', () => {
  test('a like only stores; the mapping then drifts toward it as virtual time passes', async () => {
    const eng = await createEngine({ seed: 3, persist: false, loadModule, spread: 0, optim: { maxAdjLr: 1e6 } });
    eng.reshape({ inputSize: 2, outputSize: 8, hidden: [8, 8, 8] }, 0);
    const clock = new VirtualClock();
    const fc = new FeedbackController(eng, { scheduler: clock, backgroundLearning: { hz: 100, lr: 0.003, ms: 2000 } });
    fc.setMode('geometric-dislike');
    const target = new Float32Array(8).fill(0.9);
    const dist = () => {
      const o = eng.inferBatch([[0.4, 0.4]]);
      let a = 0;
      for (let j = 0; j < 8; j++) a += (o[j]! - target[j]!) ** 2;
      return Math.sqrt(a);
    };
    const before = dist();
    fc.like([0.4, 0.4], target);
    expect(dist()).toBe(before); // nothing trained on the press
    clock.advance(500);
    const mid = dist();
    expect(mid).toBeLessThan(before);
    clock.advance(3000);
    expect(dist()).toBeLessThan(mid);
    expect(clock.pending).toBe(0); // it stops itself after `ms`
    fc.dispose();
    eng.dispose();
  });
});

describe('FeedbackController (found by the lab)', () => {
  test('a controller that boots in explore-and-place really explores', async () => {
    const eng = await createEngine({ seed: 1, persist: false, loadModule, spread: 0 });
    eng.reshape({ inputSize: 2, outputSize: 8, hidden: [6, 6, 6] }, 0);
    const fc = new FeedbackController(eng); // initial mode: explore-and-place
    const before = Array.from(eng.inferBatch([[0.3, 0.3]]));
    fc.enterExplore();
    const scratch = Array.from(eng.inferBatch([[0.3, 0.3]]));
    expect(scratch).not.toEqual(before);
    fc.dispose();
    eng.dispose();
  });
});
