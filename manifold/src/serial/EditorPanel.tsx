/**
 * EditorPanel — the MEMLNaut Editor mode panel (Web Serial). Shows a Connect
 * button (gated behind a user click), connection status, and placeholder
 * configure / save / restore controls over USB serial.
 *
 * STUB: the protocol is not yet implemented (memlnaut-serial.ts). The save /
 * restore buttons call the stubbed methods and surface a clear "not yet wired"
 * note. Do NOT auto-connect.
 *
 * British spelling in copy.
 */
import { useSyncExternalStore } from 'react';
import { Button } from '../primitives';
import { getMemlnautSerial, type SerialState } from './memlnaut-serial';

const STATUS_COPY: Record<SerialState['status'], { label: string; colour: string }> = {
  unsupported: { label: 'Web Serial unavailable', colour: 'var(--danger)' },
  disconnected: { label: 'Disconnected', colour: 'var(--fg-mute)' },
  connecting: { label: 'Connecting…', colour: 'var(--accent-2)' },
  connected: { label: 'Connected', colour: 'var(--good)' },
  error: { label: 'Error', colour: 'var(--danger)' },
};

export function EditorPanel() {
  const serial = getMemlnautSerial();
  const state = useSyncExternalStore(
    serial.subscribe.bind(serial),
    () => serial.getState(),
    () => serial.getState(),
  );
  const status = STATUS_COPY[state.status];
  const connected = state.status === 'connected';
  const supported = state.status !== 'unsupported';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: status.colour,
            boxShadow: `0 0 8px ${status.colour}`,
          }}
        />
        <span style={{ fontSize: 'var(--fs-sm)', color: status.colour, fontFamily: 'var(--font-mono)' }}>
          {status.label}
        </span>
      </div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
        {state.message}
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!connected ? (
          <Button
            size="sm"
            variant="primary"
            disabled={!supported || state.status === 'connecting'}
            onClick={() => void serial.connect()}
          >
            Connect
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void serial.disconnect()}>
            Disconnect
          </Button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', opacity: connected ? 1 : 0.4 }}>
        <Button size="sm" variant="secondary" disabled={!connected} onClick={() => void serial.getSettings()}>
          Configure
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!connected}
          onClick={() => void serial.saveModel(new Float32Array(0))}
        >
          Save to device
        </Button>
        <Button size="sm" variant="secondary" disabled={!connected} onClick={() => void serial.restoreModel()}>
          Restore from device
        </Button>
      </div>
      <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
        {/* TODO(memlnaut-serial): the USB-serial protocol (configure / save /
            restore) is not yet implemented — these controls open the connection
            but do not transfer a model yet. */}
        Configure / save / restore are scaffolded — the USB-serial protocol is not
        yet implemented, so they do not transfer a model yet.
      </p>
    </div>
  );
}
