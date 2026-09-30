import { expect, test } from 'bun:test';
import { SYNTH_PARAM_MAP, applyCurve, applyGroupOverride, findSynthParam } from './psynth-params';
import { SYNTH_PRESETS } from './psynth-presets';
import { listPresets, mapOutputToParam, presetHeldValues, presetOutputCount, presetParamSpecs } from './preset-model';

test('param map has 126 unique params', () => {
  expect(SYNTH_PARAM_MAP.length).toBe(126);
  expect(new Set(SYNTH_PARAM_MAP.map((p) => p.name)).size).toBe(126);
  expect(new Set(SYNTH_PARAM_MAP.map((p) => p.id)).size).toBe(126);
});

test('13 presets across 4 tiers with the expected active counts', () => {
  expect(SYNTH_PRESETS.length).toBe(13);
  expect(listPresets().map((g) => g.presets.length)).toEqual([4, 4, 3, 2]);
  const counts = Object.fromEntries(SYNTH_PRESETS.map((p) => [p.id, presetOutputCount(p.id)]));
  expect(counts['beginner-1']).toBe(15);
  expect(counts['expert-1']).toBe(126);
  expect(counts['expert-2']).toBe(126);
});

test('every active and overridden name exists; spec count matches', () => {
  for (const p of SYNTH_PRESETS) {
    for (const n of p.active ?? []) expect(findSynthParam(n)).toBeDefined();
    for (const n of Object.keys(p.overrides)) expect(findSynthParam(n)).toBeDefined();
    for (const n of Object.keys(p.mutedOverrides)) expect(findSynthParam(n)).toBeDefined();
    const specs = presetParamSpecs(p.id);
    expect(specs.length).toBe(presetOutputCount(p.id));
    expect(specs.length + presetHeldValues(p.id).length).toBe(126);
  }
});

test('specs keep preset order and apply overrides', () => {
  const specs = presetParamSpecs('beginner-1');
  expect(specs[0].name).toBe('Env_A_Att');
  expect(specs[14].name).toBe('Reverb_Mix');
  expect(specs[0]).toMatchObject({ min: 0.2, max: 0.7, curve: 0.6, group: 'Env A' });
});

test('no override falls back to the tame range and linear curve', () => {
  const specs = presetParamSpecs('expert-1');
  const s = specs.find((x) => x.name === 'Osc_A_PM_Self')!;
  expect(s.min).toBeCloseTo(0.2);
  expect(s.max).toBeCloseTo(0.8);
  expect(s.curve).toBe(0.5);
  const free = presetParamSpecs('expert-1', 0).find((x) => x.name === 'Osc_A_PM_Self')!;
  expect([free.min, free.max]).toEqual([0, 1]);
  const plain = specs.find((x) => x.name === 'Env_A_Att')!;
  expect([plain.min, plain.max]).toEqual([0, 1]);
});

test('held values are defaults (no mutedOverrides in shipped presets) and exclude controlled params', () => {
  const held = presetHeldValues('beginner-1');
  expect(held.length).toBe(111);
  expect(held.find((h) => h.name === 'Env_A_Att')).toBeUndefined();
  const sv = held.find((h) => h.name === 'SV_Flt_Spread')!;
  expect(sv.value).toBe(findSynthParam('SV_Flt_Spread')!.defaultValue);
  expect(presetHeldValues('expert-1').length).toBe(0);
  expect(presetHeldValues('nope')).toEqual([]);
});

test('value mapping matches the old applyCurve / applyGroupOverride math', () => {
  const spec = { min: 0.2, max: 0.7, curve: 0.6 };
  for (const raw of [0, 0.25, 0.5, 1]) {
    const expected = 0.2 + Math.pow(raw, Math.pow(2, 4 * (0.6 - 0.5))) * 0.5;
    expect(mapOutputToParam(spec, raw)).toBeCloseTo(expected, 12);
    expect(mapOutputToParam(spec, raw)).toBe(applyGroupOverride(raw, 0.6, 0.2, 0.7));
  }
  expect(applyCurve(0.3, 0.5)).toBe(0.3);
  expect(applyCurve(2, 1)).toBe(1); // clamped
  expect(mapOutputToParam({ min: 0, max: 1, curve: 0 }, 0.5)).toBeCloseTo(Math.pow(0.5, 0.25));
});
