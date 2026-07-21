/**
 * Console — shared chrome. Ported from `shared-ui.jsx`.
 *
 * AltitudeNav and CompactAxis were deleted 2026-07 (simplification audit S15) —
 * both were part of the dead focus/altitude system (setFocus was never called;
 * Manifold ships a single "composite" altitude). MiniMeters survives — it is
 * the live glanceable output readout used by CompositeStage's minimap.
 */
import { GROUP_COLOR } from './model';
import type { MFParam } from './model';

/** MiniMeters — glanceable read-only output bars (no interaction). */
export function MiniMeters({ params, values }: { params: MFParam[]; values: number[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
      {values.map((v, i) => (
        <div
          key={i}
          title={`${params[i]?.name}: ${v.toFixed(2)}`}
          style={{
            width: 5,
            height: '100%',
            background: 'var(--bg-2)',
            borderRadius: 1,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: `${v * 100}%`,
              background: `var(${GROUP_COLOR[params[i]?.group] || '--accent'})`,
              opacity: 0.3 + v * 0.6,
            }}
          />
        </div>
      ))}
    </div>
  );
}
