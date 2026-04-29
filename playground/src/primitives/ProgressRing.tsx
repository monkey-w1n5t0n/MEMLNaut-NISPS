import { Component, createMemo } from 'solid-js';

export interface ProgressRingProps {
  /** 0..1 fraction. */
  progress: () => number;
  /** Diameter in px. Default 32. */
  size?: number;
  /** Stroke color. Default --accent. */
  color?: string;
  /** Stroke width. Default size/10. */
  strokeWidth?: number;
  /** Show numeric percent in middle. */
  showLabel?: boolean;
  ariaLabel?: string;
}

export const ProgressRing: Component<ProgressRingProps> = (props) => {
  const size = () => props.size ?? 32;
  const strokeWidth = () => props.strokeWidth ?? Math.max(2, Math.round(size() / 10));
  const radius = () => (size() - strokeWidth()) / 2;
  const circumference = () => 2 * Math.PI * radius();
  const progress = () => Math.max(0, Math.min(1, props.progress()));
  const offset = createMemo(() => circumference() * (1 - progress()));
  const color = () => props.color ?? 'var(--accent)';

  return (
    <svg
      width={size()}
      height={size()}
      viewBox={`0 0 ${size()} ${size()}`}
      role="progressbar"
      aria-valuenow={Math.round(progress() * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={props.ariaLabel ?? 'progress'}
    >
      <circle
        cx={size() / 2}
        cy={size() / 2}
        r={radius()}
        stroke="var(--bg-3)"
        stroke-width={strokeWidth()}
        fill="none"
      />
      <circle
        cx={size() / 2}
        cy={size() / 2}
        r={radius()}
        stroke={color()}
        stroke-width={strokeWidth()}
        fill="none"
        stroke-dasharray={`${circumference()}`}
        stroke-dashoffset={`${offset()}`}
        stroke-linecap="round"
        transform={`rotate(-90 ${size() / 2} ${size() / 2})`}
        style={{ transition: 'stroke-dashoffset 120ms linear' }}
      />
      {props.showLabel && (
        <text
          x={size() / 2}
          y={size() / 2}
          dominant-baseline="central"
          text-anchor="middle"
          font-family="var(--font-mono)"
          font-size={`${Math.round(size() / 3.5)}`}
          fill="var(--fg-mute)"
        >
          {Math.round(progress() * 100)}
        </text>
      )}
    </svg>
  );
};
