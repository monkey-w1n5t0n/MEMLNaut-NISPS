/**
 * e2e tests for f02-signal-bus.
 * Validates:
 *   VAL-PROJ-004: Signal bus creates topics, emit/receive, match() wildcards,
 *                  equals:false semantics (every emit triggers subscribers)
 */
import { test, expect, Page } from '@playwright/test';
import { loadSolidApp } from './helpers';

test.describe('Signal Bus', () => {

  test('VAL-PROJ-004a: createTopic creates a named topic and emit triggers subscriber', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const bus = (window as any).__nispsBus;
      const received: number[] = [];

      const topic = bus.createTopic<number>('test-emit');
      const unsub = topic.subscribe((val: number) => received.push(val));

      topic.emit(42);
      topic.emit(99);

      unsub();

      return { received };
    });

    expect(result.received).toEqual([42, 99]);
  });

  test('VAL-PROJ-004b: emit with identical data triggers subscriber every time (equals:false)', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const bus = (window as any).__nispsBus;
      let callCount = 0;
      const received: string[] = [];

      const topic = bus.createTopic<string>('test-equals');
      const unsub = topic.subscribe((val: string) => {
        callCount++;
        received.push(val);
      });

      // Emit the same value 3 times
      topic.emit('hello');
      topic.emit('hello');
      topic.emit('hello');

      unsub();

      return { callCount, received };
    });

    expect(result.callCount).toBe(3);
    expect(result.received).toEqual(['hello', 'hello', 'hello']);
  });

  test('VAL-PROJ-004c: match() with wildcards merges multiple topics', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const bus = (window as any).__nispsBus;
      const received: { topic: string; value: number }[] = [];

      // Create three topics
      bus.createTopic<number>('ml.loss');
      bus.createTopic<number>('ml.outputs');
      bus.createTopic<number>('ui.state');

      // Subscribe to all 'ml.*' topics via wildcard match
      const unsub = bus.match<number>('ml.*', (value: number, topicName: string) => {
        received.push({ topic: topicName, value });
      });

      // Emit on different topics
      bus.getTopic<number>('ml.loss')!.emit(0.5);
      bus.getTopic<number>('ml.outputs')!.emit(0.8);
      bus.getTopic<number>('ui.state')!.emit(0.3);

      unsub();

      return { received };
    });

    // Should have received from ml.loss and ml.outputs but NOT ui.state
    expect(result.received).toHaveLength(2);
    expect(result.received[0]).toEqual({ topic: 'ml.loss', value: 0.5 });
    expect(result.received[1]).toEqual({ topic: 'ml.outputs', value: 0.8 });
  });

  test('match() with nested wildcards matches deeply', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const bus = (window as any).__nispsBus;
      const received: string[] = [];

      bus.createTopic<number>('a.b.c');
      bus.createTopic<number>('a.b.d');
      bus.createTopic<number>('a.x.y');
      bus.createTopic<number>('z.b.c');

      const unsub = bus.match<number>('a.b.*', (val: number, name: string) => {
        received.push(name);
      });

      bus.getTopic<number>('a.b.c')!.emit(1);
      bus.getTopic<number>('a.b.d')!.emit(2);
      bus.getTopic<number>('a.x.y')!.emit(3);
      bus.getTopic<number>('z.b.c')!.emit(4);

      unsub();

      return { received };
    });

    expect(result.received).toEqual(['a.b.c', 'a.b.d']);
  });

  test('match() with double wildcard ** matches all levels', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const bus = (window as any).__nispsBus;
      const received: string[] = [];

      bus.createTopic<number>('a.b.c');
      bus.createTopic<number>('a.b');
      bus.createTopic<number>('a');

      const unsub = bus.match<number>('a.**', (val: number, name: string) => {
        received.push(name);
      });

      bus.getTopic<number>('a')!.emit(1);
      bus.getTopic<number>('a.b')!.emit(2);
      bus.getTopic<number>('a.b.c')!.emit(3);

      unsub();

      return { received };
    });

    // ** should match 'a' itself and all descendants
    expect(result.received).toEqual(['a', 'a.b', 'a.b.c']);
  });

  test('unsubscribe stops further emissions', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const bus = (window as any).__nispsBus;
      const received: number[] = [];

      const topic = bus.createTopic<number>('test-unsub');
      const unsub = topic.subscribe((val: number) => received.push(val));

      topic.emit(1);
      topic.emit(2);

      unsub();

      topic.emit(3);
      topic.emit(4);

      return { received };
    });

    expect(result.received).toEqual([1, 2]);
  });

  test('multiple subscribers on same topic all fire', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const bus = (window as any).__nispsBus;
      const received1: number[] = [];
      const received2: number[] = [];

      const topic = bus.createTopic<number>('test-multi');

      const unsub1 = topic.subscribe((val: number) => received1.push(val));
      const unsub2 = topic.subscribe((val: number) => received2.push(val * 10));

      topic.emit(5);

      unsub1();
      unsub2();

      return { received1, received2 };
    });

    expect(result.received1).toEqual([5]);
    expect(result.received2).toEqual([50]);
  });

  test('topic() reads current value', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const bus = (window as any).__nispsBus;

      const topic = bus.createTopic<number>('test-read');
      topic.emit(42);

      const val = topic();

      return { val };
    });

    expect(result.val).toBe(42);
  });

  test('getTopic returns undefined for non-existent topic', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const bus = (window as any).__nispsBus;
      return { exists: bus.getTopic('non-existent') !== undefined };
    });

    expect(result.exists).toBe(false);
  });

  test('match() fires for topics created after match call', async ({ page }) => {
    await loadSolidApp(page);

    const result = await page.evaluate(() => {
      const bus = (window as any).__nispsBus;
      const received: string[] = [];

      // Set up match before the topic exists
      const unsub = bus.match<number>('dynamic.*', (val: number, name: string) => {
        received.push(name);
      });

      // Now create the topic and emit
      bus.createTopic<number>('dynamic.one');
      bus.getTopic<number>('dynamic.one')!.emit(1);

      // Create another matching topic
      bus.createTopic<number>('dynamic.two');
      bus.getTopic<number>('dynamic.two')!.emit(2);

      unsub();

      return { received };
    });

    expect(result.received).toEqual(['dynamic.one', 'dynamic.two']);
  });
});
