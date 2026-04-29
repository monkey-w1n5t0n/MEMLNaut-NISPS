import { Component, createSignal, onCleanup, onMount } from 'solid-js';
import { LossPlot } from './LossPlot';

export const LossPlotDemo: Component = () => {
  const [history, setHistory] = createSignal<number[]>([]);

  let timer: ReturnType<typeof setInterval>;
  let i = 0;
  onMount(() => {
    timer = setInterval(() => {
      i += 1;
      const v = 0.5 * Math.exp(-i * 0.04) + 0.005 + 0.02 * Math.random();
      setHistory((h) => {
        const next = [...h, v];
        return next.slice(-200);
      });
    }, 80);
  });
  onCleanup(() => clearInterval(timer));

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
      <LossPlot history={history} log />
      <button type="button" onClick={() => { setHistory([]); i = 0; }}>Reset</button>
    </div>
  );
};
