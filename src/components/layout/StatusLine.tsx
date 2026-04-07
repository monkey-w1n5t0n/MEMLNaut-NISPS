/**
 * StatusLine — Floating status bar showing example count, loss state, and noise level.
 *
 * Text format: "N examples · loss X.XXXXX · noise X.XXX"
 * Or "N examples · untrained" when no training has occurred.
 *
 * Reactively watches exampleCountSignal, lastLossSignal, and noiseLevel.
 */

import { createEffect } from 'solid-js';
import type { MLStore } from '../../stores/ml-store';

export interface StatusLineProps {
  mlStore: MLStore;
}

export default function StatusLine(props: StatusLineProps) {
  // Reactive status text — watches all relevant signals
  const statusText = () => {
    const count = props.mlStore.exampleCountSignal();
    const loss = props.mlStore.lastLossSignal();
    const noise = props.mlStore.noiseLevel();

    let text = `${count} example${count !== 1 ? 's' : ''}`;

    if (loss !== null) {
      text += ` \u00b7 loss ${loss.toFixed(5)}`;
    } else {
      text += ' \u00b7 untrained';
    }

    text += ` \u00b7 noise ${noise.toFixed(3)}`;

    return text;
  };

  return (
    <div class="status-line" id="status-line">
      <span id="status-text">{statusText()}</span>
    </div>
  );
}
