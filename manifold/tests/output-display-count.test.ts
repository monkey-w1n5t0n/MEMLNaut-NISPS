import { expect, test } from 'bun:test';
import { outputDisplayCount } from '../src/console/output-mode';

test('the active MIDI CC count controls the presented output count', () => {
  expect(outputDisplayCount('midi', 33, { midi: 8 })).toBe(8);
  expect(outputDisplayCount('midi', 33, { midi: 16 })).toBe(16);
});

test('the selector supports configured counts for any output mode', () => {
  expect(outputDisplayCount('osc', 33, { osc: 5 })).toBe(5);
  expect(outputDisplayCount('synth', 33)).toBe(33);
});

test('configured output counts are integral and capped by available model outputs', () => {
  expect(outputDisplayCount('midi', 12, { midi: 99 })).toBe(12);
  expect(outputDisplayCount('midi', 12, { midi: 4.9 })).toBe(4);
  expect(outputDisplayCount('midi', 12, { midi: -2 })).toBe(0);
});
