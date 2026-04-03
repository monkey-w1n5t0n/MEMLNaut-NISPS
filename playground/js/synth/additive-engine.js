import { FaustEngineBase } from './faust-engine-base.js';

export class AdditiveEngine extends FaustEngineBase {
  constructor() {
    super({
      id:            'additive',
      displayName:   'Additive',
      wasmUrl:       'faust/additive.wasm',
      jsonUrl:       'faust/additive.json',
      workletUrl:    'faust/additive-processor.js',
      processorName: 'additive-processor',
    });
  }
}
