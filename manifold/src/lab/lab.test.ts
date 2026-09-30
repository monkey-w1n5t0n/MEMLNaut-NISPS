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
import { SHIPPED } from './settings';
import { planOat, recommend } from './sweep';

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
