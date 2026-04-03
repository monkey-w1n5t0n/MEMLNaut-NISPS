// eoc/index.js — barrel re-export for the End-of-Chain effects system.
//
// Import from here to get the full EOC API:
//   import { EOCModule, EOCChain } from './eoc/index.js';

export { EOCModule }         from './eoc-module.js';
export { EOCChain }          from './eoc-chain.js';

// Effect module implementations
export { EQModule }          from './modules/eq-module.js';
export { CompressorModule }  from './modules/compressor-module.js';
export { ReverbModule }      from './modules/reverb-module.js';
export { DelayModule }       from './modules/delay-module.js';
export { SaturationModule }  from './modules/saturation-module.js';
export { MasterModule }      from './modules/master-module.js';
