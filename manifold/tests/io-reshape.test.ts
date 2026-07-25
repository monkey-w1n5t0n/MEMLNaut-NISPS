import { expect, test } from 'bun:test';
import type { MLArchitecture } from '../src/engine/types';
import {
  completeDimensionMap,
  remapFlatWeights,
  remapVector,
  resizeTarget,
} from '../src/engine/io-reshape';

function arch(inputSize: number, outputSize: number): MLArchitecture {
  return { inputSize, hidden: [2, 2, 2], outputSize, numLayers: 4, maxExamples: 8 };
}

test('capacity policy only reconstructs when active I/O exceeds capacity', () => {
  expect(resizeTarget(2, 8, 'capacity')).toBeNull();
  expect(resizeTarget(9, 8, 'capacity')).toBe(9);
  expect(resizeTarget(2, 8, 'exact')).toBe(2);
  expect(resizeTarget(8, 8, 'exact')).toBeNull();
});

test('a middle deletion keeps surviving identities and moves unused slots to the tail', () => {
  expect(completeDimensionMap([0, 2], 4, 4)).toEqual([0, 2, 1, 3]);
});

test('example vectors remove deleted dimensions and fill additions with placeholders', () => {
  expect(Array.from(remapVector([10, 20, 30], [0, 2], 2, -1))).toEqual([10, 30]);
  expect(Array.from(remapVector([10, 20], [0, null, 1], 3, 0.5))).toEqual([10, 0.5, 20]);
});

test('weight remap preserves an arbitrary output row and bias by identity', () => {
  const oldArch = arch(2, 3);
  const newArch = arch(2, 2);
  // 4 layers: weights 4 + 4 + 4 + 6, then biases 2 + 2 + 2 + 3 = 27.
  const oldWeights = Float32Array.from({ length: 27 }, (_, i) => i + 1);
  const freshWeights = new Float32Array(24).fill(-1);
  const remapped = remapFlatWeights(
    oldWeights,
    oldArch,
    freshWeights,
    newArch,
    undefined,
    [0, 2],
  );
  // Final-layer weights begin at 12. Old rows: [13,14], [15,16], [17,18].
  expect(Array.from(remapped.slice(12, 16))).toEqual([13, 14, 17, 18]);
  // Destination output biases are the final two entries; old output biases
  // are [25,26,27], so output identity 2 must retain 27 rather than 26.
  expect(Array.from(remapped.slice(22, 24))).toEqual([25, 27]);
});
