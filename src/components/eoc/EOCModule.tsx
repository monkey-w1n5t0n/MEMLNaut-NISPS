/**
 * EOCModuleCard — Single effect module row within the EOC chain list.
 *
 * Shows:
 *   - Module display name
 *   - Param count badge (e.g. "8p")
 *   - Bypass toggle button (On / Off)
 *   - Remove button (×)
 *
 * Props:
 *   id          — module.id (passed through to callbacks)
 *   displayName — human label
 *   paramCount  — number of parameters exposed
 *   enabled     — current bypass state
 *   onToggle    — called when bypass button is clicked
 *   onRemove    — called when remove button is clicked
 */

export interface EOCModuleCardProps {
  id: string;
  displayName: string;
  paramCount: number;
  enabled: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function EOCModuleCard(props: EOCModuleCardProps) {
  function handleToggle(): void {
    props.onToggle(props.id);
  }

  function handleRemove(): void {
    props.onRemove(props.id);
  }

  return (
    <div class={`eoc-module-card${props.enabled ? '' : ' bypassed'}`} data-module-id={props.id}>
      <span class="eoc-module-name">{props.displayName}</span>

      <span class="eoc-module-badge" title="param count">
        {props.paramCount}p
      </span>

      <button
        class={`eoc-bypass-btn ${props.enabled ? 'on' : 'off'}`}
        title={props.enabled ? 'Click to bypass' : 'Click to enable'}
        onClick={handleToggle}
      >
        {props.enabled ? 'On' : 'Off'}
      </button>

      <button
        class="eoc-remove-btn"
        title={`Remove ${props.displayName}`}
        onClick={handleRemove}
      >
        ×
      </button>
    </div>
  );
}
