/**
 * SplitStage — input and output given EQUAL prominence, side by side. Left =
 * Manifold (input), right = OutputStage (output field). Ported from `SplitStage.jsx`.
 */
import { Manifold } from './Manifold';
import { OutputStage } from './OutputStage';
import type { MFParam } from './model';
import type { FeedbackMarker, Pin } from './types';

export interface SplitStageProps {
  pos: [number, number];
  onMove: (x: number, y: number) => void;
  noiseCap: number;
  pins: Pin[];
  markers?: FeedbackMarker[];
  variant?: 'rectangular' | 'circular';
  follow: boolean;
  onLongPress: (p: [number, number]) => void;
  params: MFParam[];
  values: number[];
  onChange: (i: number, patch: Partial<MFParam>) => void;
}

export function SplitStage({
  pos,
  onMove,
  noiseCap,
  pins,
  markers = [],
  variant = 'rectangular',
  follow,
  onLongPress,
  params,
  values,
  onChange,
}: SplitStageProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      <div
        style={{ flex: 1, position: 'relative', borderRight: '1px solid var(--line)', minWidth: 0 }}
      >
        <Manifold
          pos={pos}
          onMove={onMove}
          noiseCap={noiseCap}
          pins={pins}
          markers={markers}
          variant={variant}
          follow={follow}
          onLongPress={onLongPress}
        />
      </div>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <OutputStage params={params} values={values} onChange={onChange} compact />
      </div>
    </div>
  );
}
