/**
 * BackendManager.setActive regression (simplification audit L19): a switch
 * requested while another is already in flight must NOT be silently dropped.
 * Run with `bun test tests/backend-manager-switch.test.ts` (see NOTE at the
 * bottom of this file re: `bun run test` wiring).
 */
import { expect, test } from 'bun:test';
import { BackendManager, type ManagerEngine } from '../src/backends/manager';
import type { BackendContext, BackendStatus, OutputBackend } from '../src/backends/backend';
import type { BackendId } from '../src/dock/output-state';

function makeCtx(): BackendContext {
  return { modeId: 'test', outputCount: 0, mappings: [], names: [] };
}

function makeEngine(): ManagerEngine {
  return {
    subscribe: () => () => {},
    routedOutput: () => null,
    audio: { setMuted: () => {} },
  };
}

/** A fake backend whose `start()` can be held open until the test releases it,
 *  so we can deterministically land a second `setActive` call WHILE the first
 *  is still in flight. */
class FakeBackend implements OutputBackend {
  readonly id: BackendId;
  startCalls = 0;
  teardownCalls = 0;
  sent: number[][] = [];
  private release: (() => void) | null = null;
  private hold: boolean;

  constructor(id: BackendId, hold = false) {
    this.id = id;
    this.hold = hold;
  }

  isAvailable(): boolean {
    return true;
  }

  async start(_ctx: BackendContext): Promise<void> {
    this.startCalls++;
    if (this.hold) {
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }
  }

  /** Let a held `start()` resolve (simulates the backend becoming ready). */
  releaseStart(): void {
    this.release?.();
    this.release = null;
  }

  async teardown(): Promise<void> {
    this.teardownCalls++;
  }

  send(routed: Float32Array): void {
    this.sent.push(Array.from(routed));
  }

  status(): BackendStatus {
    return { state: 'ready', message: 'fake' };
  }

  onStatusChange(): () => void {
    return () => {};
  }
}

test('a switch requested mid-switch is queued and applied, not dropped (L19)', async () => {
  const midi = new FakeBackend('midi', /* hold */ true);
  const osc = new FakeBackend('osc');
  const manager = new BackendManager(makeEngine(), { midi, osc });
  manager.setContext(makeCtx());

  // Kick off a switch to 'midi' whose start() we hold open, simulating a
  // switch genuinely in flight (e.g. an async backend.start()).
  const first = manager.setActive('midi');

  // While 'midi' is still starting, request 'osc'. Pre-fix this silently
  // returned (BackendManager.setActive:131 `if (... || this.switching) return`)
  // and 'osc' was never applied once 'midi' finished starting.
  const second = manager.setActive('osc');

  expect(manager.getActiveId()).toBe('midi'); // still mid-switch
  midi.releaseStart();
  await first;
  await second;
  // Give the queued re-run (kicked off in setActive's `finally`) a tick to
  // settle — its own start() is not held, so one microtask flush suffices.
  await Promise.resolve();
  await Promise.resolve();

  expect(manager.getActiveId()).toBe('osc');
  expect(osc.startCalls).toBe(1);
});

test('rapid repeated switches to the SAME pending id only apply it once', async () => {
  const midi = new FakeBackend('midi', /* hold */ true);
  const osc = new FakeBackend('osc');
  const manager = new BackendManager(makeEngine(), { midi, osc });
  manager.setContext(makeCtx());

  const first = manager.setActive('midi');
  void manager.setActive('osc');
  void manager.setActive('osc'); // repeated request for the same pending id
  void manager.setActive('osc');

  midi.releaseStart();
  await first;
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(manager.getActiveId()).toBe('osc');
  // Only ONE extra switch should have actually run (no repeated re-queueing
  // beyond the single pending slot — the infinite-loop guard).
  expect(osc.startCalls).toBe(1);
});

test('capacity slots are not forwarded beyond the active output-card count', async () => {
  let notify: (() => void) | null = null;
  const engine: ManagerEngine = {
    subscribe: (cb) => {
      notify = cb;
      return () => {};
    },
    routedOutput: () => new Float32Array([0.1, 0.2, 0.3, 0.4]),
    audio: { setMuted: () => {} },
  };
  const midi = new FakeBackend('midi');
  const manager = new BackendManager(engine, { midi });
  manager.setContext({
    modeId: 'test',
    outputCount: 2,
    mappings: [],
    names: [],
  });
  await manager.setActive('midi');
  notify!();

  expect(midi.sent).toEqual([
    Array.from(new Float32Array([0.1, 0.2])),
  ]);
});

// NOTE: `manifold/package.json`'s `test` script is `bun test src
// tests/pipeline-golden.test.ts` — an explicit file list, not a directory
// glob, so this file (like any other new file under tests/) is NOT picked up
// by `bun run test` as currently wired. Verified directly with
// `bun test tests/backend-manager-switch.test.ts`. Wiring `tests/` in as a
// whole is a one-line package.json change outside this group's file scope
// (see the handoff note in the accompanying report).
