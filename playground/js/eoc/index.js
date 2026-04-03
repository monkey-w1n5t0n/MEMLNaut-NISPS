// eoc/index.js — barrel re-export for the End-of-Chain effects system.
//
// Import from here to get the full EOC API:
//   import { EOCModule, EOCChain } from './eoc/index.js';

export { EOCModule }         from './eoc-module.js';
export { EOCChain }          from './eoc-chain.js';
export { EQModule }          from './modules/eq-module.js';
export { CompressorModule }  from './modules/compressor-module.js';
export { ReverbModule }      from './modules/reverb-module.js';
