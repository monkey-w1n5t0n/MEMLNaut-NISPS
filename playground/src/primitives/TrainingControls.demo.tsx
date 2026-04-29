import { Component, createSignal } from 'solid-js';
import { TrainingControls } from './TrainingControls';

export const TrainingControlsDemo: Component = () => {
  const [count, setCount] = createSignal(3);
  const [loss, setLoss] = createSignal<number | null>(0.0123);
  const [busy, setBusy] = createSignal(false);
  const [stack, setStack] = createSignal<number[]>([]);

  const train = () => {
    setBusy(true);
    setTimeout(() => {
      setLoss(Math.random() * 0.05);
      setBusy(false);
    }, 250);
  };

  return (
    <TrainingControls
      onTrain={train}
      onRandomize={() => setLoss(0.5)}
      onThumbsUp={() => { setStack((s) => [...s, count()]); setCount((c) => c + 1); train(); }}
      onThumbsDown={() => { setStack((s) => [...s, count()]); setLoss((l) => (l ?? 0) * 1.4); }}
      onUndo={() => { const prev = [...stack()]; const v = prev.pop(); if (v !== undefined) setCount(v); setStack(prev); }}
      exampleCount={count}
      lastLoss={loss}
      busy={busy}
      canUndo={() => stack().length > 0}
    />
  );
};
