import { FaustEngineBase } from './faust-engine-base.js';

export class FMEngine extends FaustEngineBase {
  constructor() {
    super({
      id:            'fm',
      displayName:   'FM Matrix',
      wasmUrl:       'faust/fm-matrix.wasm',
      jsonUrl:       'faust/fm-matrix.json',
      workletUrl:    'faust/fm-matrix-processor.js',
      processorName: 'fm-matrix-processor',
    });
  }
}
