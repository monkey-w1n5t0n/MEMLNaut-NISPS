import { expect, test } from 'bun:test';
import { Spine } from '../src/engine/spine';
import type { WasmIML } from '../src/engine/wasm-iml';
import { InputLayer } from '../src/inputs/input-layer';
import { XYPadSource } from '../src/inputs/xy-pad-source';

function makeFakeIml(outputSize = 20): WasmIML {
  return {
    architecture: {
      inputSize: 2,
      hidden: [0, 0, 0] as [number, number, number],
      outputSize,
      numLayers: 3,
    },
    setInputConfig: () => {},
    setOutputConfig: () => {},
    setOutputFreezeMask: () => {},
    resetInput: () => {},
    resetOutput: () => {},
    processInput: (x: number, y: number) => ({ x, y, frozen: false }),
    setInput: () => {},
    processInto: (buf: Float32Array) => buf.fill(0.25),
    processOutput: () => {},
  } as unknown as WasmIML;
}

test('live inference publishes through the output channel without notifying state subscribers', () => {
  const spine = new Spine();
  spine.attach(makeFakeIml(), null);
  spine.setState({ outputSize: 20 });
  let stateNotifications = 0;
  let outputNotifications = 0;
  spine.subscribe(() => stateNotifications++);
  spine.subscribeOutputs(() => outputNotifications++);

  spine.setInputs([0.2, 0.8]);
  spine.setInputs([0.3, 0.7]);

  expect(stateNotifications).toBe(0);
  expect(outputNotifications).toBe(1);
  expect(spine.outputVersion()).toBe(2);
  expect(Array.from(spine.outputs())).toEqual(new Array(20).fill(0.25));
});

test('InputLayer reuses its reduced input vector across animation frames', () => {
  const layer = new InputLayer();
  const source = new XYPadSource();
  const writes: ReadonlyArray<number>[] = [];
  layer.attach({
    architecture: { inputSize: 2 },
    setInputs: (values) => writes.push(values),
  });
  layer.setSources([source]);

  source.pushAxes(0.2, 0.8);
  layer.frame();
  source.pushAxes(0.3, 0.7);
  layer.frame();

  expect(writes).toHaveLength(2);
  expect(writes[0]).toBe(writes[1]);
  expect(Array.from(writes[1])).toEqual(
    Array.from(new Float32Array([0.3, 0.7])),
  );
});
