/** Generator registry. */
import { euclidTuringGenerator } from './gen-euclid-turing';
import { stepsGenerator } from './gen-steps';
import { walkerGenerator } from './gen-walker';
import type { Generator, GeneratorId } from './types';

export const GENERATORS: Record<GeneratorId, Generator> = {
  'euclid-turing': euclidTuringGenerator,
  walker: walkerGenerator,
  steps: stepsGenerator,
};

/** Number of MLP outputs the generator uses. */
export function slotCount(id: GeneratorId): number {
  return GENERATORS[id].slots.length;
}
