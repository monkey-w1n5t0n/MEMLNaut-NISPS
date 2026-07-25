import { expect, test } from 'bun:test';
import {
  FLOW_COLOR_BUCKETS,
  FlowFieldVisualizer,
  N_FLOW_PARTICLES,
} from '../src/console/flow-field';

interface FakeContext {
  fillStyles: string[];
  fillCount: number;
  arcCount: number;
  fillStyle: string;
  setTransform(): void;
  scale(): void;
  fillRect(): void;
  beginPath(): void;
  moveTo(): void;
  arc(): void;
  fill(): void;
}

function makeContext(): FakeContext {
  const ctx = {
    fillStyles: [] as string[],
    fillCount: 0,
    arcCount: 0,
    setTransform() {},
    scale() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    arc() {
      ctx.arcCount++;
    },
    fill() {
      ctx.fillCount++;
    },
  } as FakeContext;
  Object.defineProperty(ctx, 'fillStyle', {
    set(value: string) {
      ctx.fillStyles.push(value);
    },
    get() {
      return ctx.fillStyles.at(-1) ?? '';
    },
  });
  return ctx;
}

test('particle draw batches dynamic colours instead of parsing one HSL string per particle', () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    value: { devicePixelRatio: 1 },
    configurable: true,
  });

  try {
    const ctx = makeContext();
    const canvas = {
      getContext: () => ctx,
      getBoundingClientRect: () => ({ width: 640, height: 480 }),
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement;
    const visualizer = new FlowFieldVisualizer(canvas);

    ctx.fillStyles.length = 0;
    ctx.fillCount = 0;
    ctx.arcCount = 0;
    visualizer.draw();

    expect(ctx.arcCount).toBe(N_FLOW_PARTICLES);
    expect(ctx.fillCount).toBe(FLOW_COLOR_BUCKETS);
    expect(ctx.fillStyles.filter((value) => value.startsWith('hsl('))).toHaveLength(
      FLOW_COLOR_BUCKETS,
    );
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: previousWindow,
        configurable: true,
      });
    }
  }
});
