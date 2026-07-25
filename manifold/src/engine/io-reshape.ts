/**
 * Identity-aware I/O migration for the runtime-shaped MLP.
 *
 * A dimension map is destination-first: `map[newIndex]` is the old dimension
 * whose meaning survives there, or `null` for a newly-created dimension.
 * Keeping this algebra in one framework-neutral module prevents card order,
 * flat-weight layout, and example migration from becoming three independent
 * sources of truth.
 */
import type { MLArchitecture } from './types';

export type DimensionMap = ReadonlyArray<number | null>;
export type ExampleResizePolicy = 'adapt' | 'clear';
export type NetworkResizePolicy = 'capacity' | 'exact';

export interface IoMigration {
  inputMap?: DimensionMap;
  outputMap?: DimensionMap;
  examples: ExampleResizePolicy;
  addedInputValue: number;
  addedOutputValue: number;
}

/** Fill the inactive tail of an active dimension map with unused old slots. */
export function completeDimensionMap(
  active: DimensionMap,
  newSize: number,
  oldSize: number,
): Array<number | null> {
  const out = Array.from({ length: newSize }, (_, i) => active[i] ?? null);
  const used = new Set<number>();
  for (const oldIndex of out) {
    if (oldIndex !== null && oldIndex >= 0 && oldIndex < oldSize) used.add(oldIndex);
  }
  const spare: number[] = [];
  for (let i = 0; i < oldSize; ++i) if (!used.has(i)) spare.push(i);
  let next = 0;
  for (let i = active.length; i < newSize && next < spare.length; ++i) {
    out[i] = spare[next++];
  }
  return out;
}

function prefixMap(size: number, oldSize: number): Array<number | null> {
  return Array.from({ length: size }, (_, i) => (i < oldSize ? i : null));
}

interface FlatLayout {
  dims: [number, number, number, number, number];
  weightOffsets: [number, number, number, number];
  biasOffsets: [number, number, number, number];
}

function flatLayout(arch: MLArchitecture): FlatLayout {
  const dims: FlatLayout['dims'] = [
    arch.inputSize,
    arch.hidden[0],
    arch.hidden[1],
    arch.hidden[2],
    arch.outputSize,
  ];
  const weightOffsets: number[] = [];
  let offset = 0;
  for (let layer = 0; layer < 4; ++layer) {
    weightOffsets.push(offset);
    offset += dims[layer] * dims[layer + 1];
  }
  const biasOffsets: number[] = [];
  for (let layer = 0; layer < 4; ++layer) {
    biasOffsets.push(offset);
    offset += dims[layer + 1];
  }
  return {
    dims,
    weightOffsets: weightOffsets as FlatLayout['weightOffsets'],
    biasOffsets: biasOffsets as FlatLayout['biasOffsets'],
  };
}

/**
 * Overlay all surviving semantic coordinates from `oldWeights` onto the
 * freshly-initialised destination weights. Hidden layers retain prefix
 * identity; input columns and output rows follow the supplied maps.
 */
export function remapFlatWeights(
  oldWeights: Float32Array,
  oldArch: MLArchitecture,
  freshWeights: Float32Array,
  newArch: MLArchitecture,
  inputMap?: DimensionMap,
  outputMap?: DimensionMap,
): Float32Array {
  const src = flatLayout(oldArch);
  const dst = flatLayout(newArch);
  const maps: Array<Array<number | null>> = [
    Array.from(inputMap ?? prefixMap(newArch.inputSize, oldArch.inputSize)),
    prefixMap(newArch.hidden[0], oldArch.hidden[0]),
    prefixMap(newArch.hidden[1], oldArch.hidden[1]),
    prefixMap(newArch.hidden[2], oldArch.hidden[2]),
    Array.from(outputMap ?? prefixMap(newArch.outputSize, oldArch.outputSize)),
  ];
  const out = new Float32Array(freshWeights);

  for (let layer = 0; layer < 4; ++layer) {
    const oldIn = src.dims[layer];
    const oldOut = src.dims[layer + 1];
    const newIn = dst.dims[layer];
    const newOut = dst.dims[layer + 1];
    const inputIndices = maps[layer];
    const outputIndices = maps[layer + 1];
    for (let node = 0; node < newOut; ++node) {
      const oldNode = outputIndices[node];
      if (oldNode === null || oldNode < 0 || oldNode >= oldOut) continue;
      for (let input = 0; input < newIn; ++input) {
        const oldInput = inputIndices[input];
        if (oldInput === null || oldInput < 0 || oldInput >= oldIn) continue;
        out[dst.weightOffsets[layer] + node * newIn + input] =
          oldWeights[src.weightOffsets[layer] + oldNode * oldIn + oldInput];
      }
      out[dst.biasOffsets[layer] + node] = oldWeights[src.biasOffsets[layer] + oldNode];
    }
  }
  return out;
}

/** Remap one feature/label vector, filling genuinely new dimensions neutrally. */
export function remapVector(
  source: ArrayLike<number>,
  map: DimensionMap | undefined,
  newSize: number,
  placeholder: number,
): Float32Array {
  const indices = map ?? prefixMap(newSize, source.length);
  const out = new Float32Array(newSize);
  for (let i = 0; i < newSize; ++i) {
    const oldIndex = indices[i];
    out[i] =
      oldIndex !== null && oldIndex >= 0 && oldIndex < source.length
        ? source[oldIndex]
        : placeholder;
  }
  return out;
}

/** Decide whether an arity edit needs a real network reconstruction. */
export function resizeTarget(
  activeCount: number,
  currentCapacity: number,
  policy: NetworkResizePolicy,
): number | null {
  const wanted = Math.max(1, Math.floor(activeCount));
  if (policy === 'exact') return wanted === currentCapacity ? null : wanted;
  return wanted > currentCapacity ? wanted : null;
}
