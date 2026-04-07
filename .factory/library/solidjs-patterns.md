# SolidJS Patterns

Patterns and conventions for the SolidJS migration.

**What belongs here:** SolidJS-specific patterns, reactivity gotchas, store design patterns.
**What does NOT belong here:** General architecture (use architecture.md), environment details (use environment.md).

---

## Store vs Signal Decision

| Data Type | Use | Why |
|-----------|-----|-----|
| Float32Array outputs | `createSignal` | Store proxies break typed arrays |
| Structured config | `createStore` | Fine-grained reactivity on nested properties |
| Opaque handles (IML, engines) | Module-scope variables | Not reactive — referenced imperatively |
| Event streams | Signal bus topic | `equals: false` for event semantics |

## Reactive Inference Pattern

```typescript
// Inference runs when inputs change, NOT on rAF
createEffect(() => {
  const x = inputState.joyX;
  const y = inputState.joyY;
  const iml = getActiveIml();
  if (!iml) return;
  iml.setInput(0, x);
  iml.setInput(1, y);
  iml.process();
  setOutputs(new Float32Array(iml.getOutputs()));
});
```

## Canvas Component Pattern

```typescript
const MyCanvas = () => {
  let canvasRef: HTMLCanvasElement;
  const data = bus.topic<Float32Array>('output.visual');

  onMount(() => {
    const ctx = canvasRef.getContext('2d')!;
    let raf: number;
    const loop = () => {
      const d = data();
      if (d) renderFrame(ctx, d);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return <canvas ref={canvasRef!} />;
};
```

## Provider Pattern

```typescript
const MLContext = createContext<MLStore>();
export const MLProvider = (props: { children: any }) => {
  const [outputs, setOutputs] = createSignal(new Float32Array(126));
  const [mlState, setMlState] = createStore({ /* ... */ });
  const store = { outputs, setOutputs, mlState, setMlState };
  return <MLContext.Provider value={store}>{props.children}</MLContext.Provider>;
};
export const useML = () => useContext(MLContext)!;
```

## Debug Probe (Synchronous)

```typescript
// Must bypass SolidJS batching for sync probe
if (urlParams.debug) {
  window.__nisps = {
    setInputs: (x, y) => {
      batch(() => {
        setInputState({ joyX: x, joyY: y });
      });
      // Imperative: run inference directly
      iml.setInput(0, x);
      iml.setInput(1, y);
      iml.process();
      setOutputs(new Float32Array(iml.getOutputs()));
    },
    getOutputs: () => Array.from(outputs()),
    // ... etc
  };
}
```

## CSS Pattern

```css
/* Per-component CSS files, no framework */
.component-name {
  /* Use CSS custom properties from root */
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
}
```

## Worker Cleanup

```typescript
// Always clean up workers
onCleanup(() => {
  trainingWorker?.terminate();
  arpeggiatorWorker?.terminate();
  imlJoy?.destroy();
  imlHand?.destroy();
});
```

## Key Gotchas

1. **Store proxies and typed arrays**: NEVER put Float32Array in a store. Use createSignal.
2. **equals: false**: Required for bus topics. Every emit triggers subscribers even with same data.
3. **CSS animations**: Use classList toggling on stable DOM nodes. Don't use `<Show>` for animated elements.
4. **EOC resize cascade**: Cannot be a reactive effect (needs confirmation dialog). Use pending action pattern.
5. **Probe synchrony**: All probe methods must be synchronous. Use batch() + imperative IML calls.
6. **Idle inference waste**: Don't run inference on rAF. Use reactive createEffect on inputs.
