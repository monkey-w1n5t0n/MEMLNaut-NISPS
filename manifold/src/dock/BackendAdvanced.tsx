/**
 * BackendAdvanced — the FULL-depth advanced backend modal bodies (dock-spec §4).
 * One editor per backend. All backends share the §3.1 baseline (rendered as
 * OutputControlRow elsewhere); these add the backend-specific fields.
 *
 * The backend transport (backends-spec workstream E) is now LIVE: editing these
 * fields writes the shared MFParam store, which the BackendManager reads to send
 * real Web MIDI CC / OSC-over-WS. This modal is the full-depth duplicate of the
 * inline config in OutputsBackendConfig; both write the same store.
 */
import type { MFParam } from '../console/model';
import type { BackendId, CvChannelId } from './output-state';
import { CV_CHANNELS, defaultCvSpec, defaultMidiSpec, defaultOscSpec } from './output-state';

function num(s: string, fallback: number): number {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : fallback;
}

const cellInput: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-1)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-1)',
  color: 'var(--fg)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
  padding: '3px 6px',
};

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        fontSize: 9,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--fg-dim)',
        padding: '4px 6px',
        borderBottom: '1px solid var(--line)',
      }}
    >
      {children}
    </th>
  );
}

export interface BackendAdvancedProps {
  backend: BackendId;
  params: MFParam[];
  setParam: (i: number, patch: Partial<MFParam>) => void;
}

export function BackendAdvanced({ backend, params, setParam }: BackendAdvancedProps) {
  switch (backend) {
    case 'midi':
      return <MidiCcEditor params={params} setParam={setParam} />;
    case 'osc':
      return <OscPathEditor params={params} setParam={setParam} />;
    case 'vcv':
      return <VcvChannelEditor params={params} setParam={setParam} />;
    case 'cvgate':
      return <CvChannelEditor params={params} setParam={setParam} />;
    default:
      return <SynthGroupNote params={params} />;
  }
}

// ---- MIDI (dock-spec §4.1) -------------------------------------------------

function MidiCcEditor({
  params,
  setParam,
}: {
  params: MFParam[];
  setParam: (i: number, patch: Partial<MFParam>) => void;
}) {
  return (
    <div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: '0 0 8px' }}>
        {params.length} CCs · live Web MIDI out (backends-spec §2.3). Editing the CC map here sends in
        real time once a MIDI port is selected in the Outputs panel.
      </p>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>CC#</Th>
              <Th>Ch</Th>
              <Th>State</Th>
            </tr>
          </thead>
          <tbody>
            {params.map((p, i) => {
              const m = p.midi ?? defaultMidiSpec(i);
              return (
                <tr key={i}>
                  <td style={{ padding: '3px 6px' }}>
                    <input
                      style={cellInput}
                      value={m.name}
                      onChange={(e) => setParam(i, { midi: { ...m, name: e.target.value } })}
                    />
                  </td>
                  <td style={{ padding: '3px 6px', width: 70 }}>
                    <input
                      type="number"
                      min={0}
                      max={127}
                      style={cellInput}
                      value={m.cc}
                      onChange={(e) =>
                        setParam(i, {
                          midi: { ...m, cc: Math.max(0, Math.min(127, num(e.target.value, m.cc))) },
                        })
                      }
                    />
                  </td>
                  <td style={{ padding: '3px 6px', width: 60 }}>
                    <input
                      type="number"
                      min={1}
                      max={16}
                      style={cellInput}
                      value={m.channel}
                      onChange={(e) =>
                        setParam(i, {
                          midi: {
                            ...m,
                            channel: Math.max(1, Math.min(16, num(e.target.value, m.channel))),
                          },
                        })
                      }
                    />
                  </td>
                  <td style={{ padding: '3px 6px', fontSize: 'var(--fs-xs)', color: 'var(--fg-mute)' }}>
                    {p.status}
                    {p.muted ? ' · muted' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- OSC (dock-spec §4.2) --------------------------------------------------

function OscPathEditor({
  params,
  setParam,
}: {
  params: MFParam[];
  setParam: (i: number, patch: Partial<MFParam>) => void;
}) {
  return (
    <div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: '0 0 8px' }}>
        Live OSC over the WebSocket bridge (backends-spec §2.4). Set the bridge URL + per-output paths in
        the Outputs panel; emits only while the bridge process is connected.
      </p>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>OSC path</Th>
              <Th>range min</Th>
              <Th>range max</Th>
            </tr>
          </thead>
          <tbody>
            {params.map((p, i) => {
              const o = p.osc ?? defaultOscSpec(p.name);
              return (
                <tr key={i}>
                  <td style={{ padding: '3px 6px' }}>
                    <input
                      style={cellInput}
                      value={o.path}
                      onChange={(e) => setParam(i, { osc: { ...o, path: e.target.value } })}
                    />
                  </td>
                  <td style={{ padding: '3px 6px', width: 90 }}>
                    <input
                      type="number"
                      style={cellInput}
                      value={o.rangeMin}
                      onChange={(e) => setParam(i, { osc: { ...o, rangeMin: num(e.target.value, o.rangeMin) } })}
                    />
                  </td>
                  <td style={{ padding: '3px 6px', width: 90 }}>
                    <input
                      type="number"
                      style={cellInput}
                      value={o.rangeMax}
                      onChange={(e) => setParam(i, { osc: { ...o, rangeMax: num(e.target.value, o.rangeMax) } })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- VCV / CV (dock-spec §4.3) ---------------------------------------------

function VcvChannelEditor({
  params,
  setParam,
}: {
  params: MFParam[];
  setParam: (i: number, patch: Partial<MFParam>) => void;
}) {
  return (
    <div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: '0 0 8px' }}>
        VCV adds nothing beyond the baseline (min/max = range, fixed = freeze) plus per-channel polarity.
        {/* TODO(backends-spec §2.6): the VCV browser↔module bridge transport is not yet wired here. */}
      </p>
      <div style={{ maxHeight: 360, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {params.map((p, i) => {
          const bipolar = p.vcv?.bipolar ?? false;
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--bg-2)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-1)',
                padding: '4px 8px',
              }}
            >
              <span style={{ flex: 1, fontSize: 'var(--fs-xs)', color: 'var(--fg)' }}>{p.name}</span>
              <span style={{ fontSize: 9, color: 'var(--fg-dim)' }}>
                {p.min.toFixed(2)}–{p.max.toFixed(2)} · {p.status === 'fixed' ? 'frozen' : 'live'}
              </span>
              <button
                type="button"
                onClick={() => setParam(i, { vcv: { bipolar: !bipolar } })}
                style={{
                  fontSize: 9,
                  fontFamily: 'var(--font-mono)',
                  padding: '2px 8px',
                  cursor: 'pointer',
                  borderRadius: 'var(--r-pill)',
                  border: `1px solid ${bipolar ? 'var(--danger)' : 'var(--line)'}`,
                  background: 'transparent',
                  color: bipolar ? 'var(--danger)' : 'var(--fg-mute)',
                }}
              >
                {bipolar ? '±5 V' : '0–10 V'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- uSEQ CV / gate (docs/useq-celium) -------------------------------------

function CvChannelEditor({
  params,
  setParam,
}: {
  params: MFParam[];
  setParam: (i: number, patch: Partial<MFParam>) => void;
}) {
  return (
    <div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: '0 0 8px' }}>
        Live CV/gate over USB serial to a uSEQ module + expander (docs/useq-celium). Assign each model output to a
        CV jack or gate; gates threshold the mapped 0–1 value. Connect the device in the Outputs panel.
      </p>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Output</Th>
              <Th>uSEQ channel</Th>
              <Th>Gate ≥</Th>
            </tr>
          </thead>
          <tbody>
            {params.map((p, i) => {
              const c = (p.cv as { channel: CvChannelId; gateThreshold: number } | undefined) ?? defaultCvSpec(i);
              const isGate = c.channel.startsWith('gate');
              return (
                <tr key={i}>
                  <td style={{ padding: '3px 6px', fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>{p.name}</td>
                  <td style={{ padding: '3px 6px', width: 150 }}>
                    <select
                      value={c.channel}
                      onChange={(e) => setParam(i, { cv: { ...c, channel: e.target.value as CvChannelId } })}
                      style={{ ...cellInput, cursor: 'pointer' }}
                    >
                      <option value="none">— none —</option>
                      {CV_CHANNELS.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '3px 6px', width: 80 }}>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      disabled={!isGate}
                      style={{ ...cellInput, opacity: isGate ? 1 : 0.4 }}
                      value={c.gateThreshold}
                      onChange={(e) =>
                        setParam(i, {
                          cv: { ...c, gateThreshold: Math.max(0, Math.min(1, num(e.target.value, c.gateThreshold))) },
                        })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SynthGroupNote({ params }: { params: MFParam[] }) {
  const groups = Array.from(new Set(params.map((p) => p.group)));
  return (
    <div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', margin: '0 0 8px', lineHeight: 1.6 }}>
        The synth backend's advanced surface is the group-override matrix — see the Powerful Synth Engine
        drawer's full depth (dock-spec §4.4 / §5). Groups: {groups.join(' · ')}.
      </p>
    </div>
  );
}
