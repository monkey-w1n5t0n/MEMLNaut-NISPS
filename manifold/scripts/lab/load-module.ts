/**
 * Node/bun loader for the committed nisps WASM (manifold/public/nisps.{js,wasm}),
 * for the lab CLI. Same indirect-eval technique as tests/wasm-load.ts: the
 * Emscripten glue is MODULARIZE output without ES exports.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NispsModule, NispsModuleFactory } from '../../src/engine/types';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
let factory: NispsModuleFactory | null = null;
let binary: Uint8Array | null = null;

export function loadModule(): Promise<NispsModule> {
  if (!factory) {
    const src = readFileSync(join(pub, 'nisps.js'), 'utf8');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    factory = new Function('module', 'exports',
      `${src}\n;return typeof createNispsModule === 'function' ? createNispsModule : null;`,
    )({ exports: {} }, {}) as NispsModuleFactory;
    if (typeof factory !== 'function') throw new Error('[lab] createNispsModule not found in public/nisps.js');
    binary = readFileSync(join(pub, 'nisps.wasm'));
  }
  return factory({ wasmBinary: binary! });
}
