/**
 * OutputsBackendConfig — the editable, per-backend specialisation of the Outputs
 * panel (backends-spec §4) plus the named-preset bar (§5).
 *
 * Layout: ONE preset bar (save-as / restore / rename / delete, per-backend
 * namespace) on top, then a per-backend config section:
 *   - MIDI  → output-port picker, number-of-CCs, per-output CC#/channel/name.
 *   - OSC   → bridge URL + connect status + send-raw toggle, per-output path/range.
 *   - VCV/CV→ bridge URL + connect status + send-raw toggle, per-output polarity
 *             (uni 0–10 V / bipolar ±5 V). The browser drives + trains the VCV
 *             module over the same Deno bridge.
 *   - Synth/Particle/Editor → handled by ModeConfig in Drawers (no extra config here).
 *
 * Everything is editable inline; writes go through the shared MFParam store
 * (ctx.setParam) — never a second data path. The full-depth modal reuses the
 * same sections via BackendAdvanced.
 */
import { useEffect, useState } from 'react';
import type { ConsoleCtx } from '../console/types';
import type { BackendId } from './output-state';
import { defaultMidiSpec, defaultOscSpec, defaultVcvSpec } from './output-state';
import {
  applyPreset,
  deletePreset,
  getPreset,
  listPresets,
  renamePreset,
  savePreset,
  type OutputPreset,
} from '../backends/presets';
import { MIDI_DEVICES, MIDI_DEVICES_BY_ID, type MidiDeviceParam } from '../midi-devices';

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
  boxSizing: 'border-box',
};

const btn = (color: string): React.CSSProperties => ({
  fontSize: 'var(--fs-xs)',
  fontFamily: 'var(--font-mono)',
  padding: '3px 9px',
  cursor: 'pointer',
  borderRadius: 'var(--r-pill)',
  border: `1px solid ${color}`,
  background: 'transparent',
  color,
});

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: 'var(--fg-dim)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginTop: 'var(--sp-2)',
      }}
    >
      {children}
    </div>
  );
}

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

// ---- Named-preset bar (backends-spec §5) -----------------------------------

function PresetBar({ ctx, backend }: { ctx: ConsoleCtx; backend: BackendId }) {
  const [presets, setPresets] = useState<OutputPreset[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');

  const refresh = () => setPresets(listPresets(backend));
  useEffect(() => {
    refresh();
    setSelected('');
    setName('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend]);

  const backendSettings = (): Record<string, unknown> => {
    if (backend === 'midi') return { outputId: ctx.midiOutputId, ccCount: ctx.midiCcCount };
    if (backend === 'osc') return { url: ctx.oscUrl, sendRaw: ctx.oscSendRaw };
    if (backend === 'vcv') return { url: ctx.vcvUrl, sendRaw: ctx.vcvSendRaw };
    return {};
  };

  const applySettings = (s?: Record<string, unknown>) => {
    if (!s) return;
    if (backend === 'midi') {
      if ('outputId' in s) ctx.setMidiOutputId((s.outputId as string | null) ?? null);
      if ('ccCount' in s) ctx.setMidiCcCount(Number(s.ccCount) || ctx.midiCcCount);
    } else if (backend === 'osc') {
      if ('url' in s) ctx.setOscUrl(String(s.url));
      if ('sendRaw' in s) ctx.setOscSendRaw(Boolean(s.sendRaw));
    } else if (backend === 'vcv') {
      if ('url' in s) ctx.setVcvUrl(String(s.url));
      if ('sendRaw' in s) ctx.setVcvSendRaw(Boolean(s.sendRaw));
    }
  };

  const doSave = () => {
    const n = name.trim();
    if (!n) return;
    savePreset(backend, n, ctx.params, backendSettings());
    refresh();
    setSelected(n);
  };
  const doRestore = (n: string) => {
    const p = getPreset(backend, n);
    if (!p) return;
    ctx.setParams(applyPreset(ctx.params, p));
    applySettings(p.settings);
  };
  const doDelete = () => {
    if (!selected) return;
    deletePreset(backend, selected);
    refresh();
    setSelected('');
  };
  const doRename = () => {
    const to = name.trim();
    if (!selected || !to) return;
    if (renamePreset(backend, selected, to)) {
      refresh();
      setSelected(to);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        alignItems: 'center',
        padding: '6px 8px',
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-1)',
      }}
    >
      <span style={{ fontSize: 9, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Presets · {backend}
      </span>
      <input
        style={{ ...cellInput, width: 120, flex: '0 0 auto' }}
        placeholder="preset name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="button" style={btn('var(--accent)')} onClick={doSave} disabled={!name.trim()}>
        Save as
      </button>
      <select
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          if (e.target.value) doRestore(e.target.value);
        }}
        style={{ ...cellInput, width: 'auto', flex: '0 0 auto', cursor: 'pointer' }}
      >
        <option value="">restore…</option>
        {presets.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      <button type="button" style={btn('var(--fg-mute)')} onClick={doRename} disabled={!selected || !name.trim()}>
        Rename
      </button>
      <button type="button" style={btn('var(--danger)')} onClick={doDelete} disabled={!selected}>
        Delete
      </button>
    </div>
  );
}

// ---- Device template picker (synth-midi-cc templates) ----------------------

/**
 * Pick an external synth (e.g. Moog Sub 37), see its parameters BY NAME, tick the
 * ones to control, and "Apply" — this fills the per-output CC table (CC#, channel,
 * name) from the device template and sets the CC count. Pure local state + the
 * existing setParam/setMidiCcCount; the applied result lives in the shared params
 * store, so it is saved/restored by the named-preset bar like any other config.
 */
function DeviceTemplatePicker({ ctx }: { ctx: ConsoleCtx }) {
  const [deviceId, setDeviceId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const device = deviceId ? MIDI_DEVICES_BY_ID[deviceId] : undefined;
  const limit = ctx.params.length; // engine output count caps how many CCs we can drive

  const pickDevice = (id: string) => {
    setDeviceId(id);
    setSelected(new Set());
  };
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectFirst = (n: number) => {
    if (!device) return;
    setSelected(new Set(device.params.slice(0, n).map((p) => p.id)));
  };

  const apply = () => {
    if (!device) return;
    const chosen = device.params.filter((p) => selected.has(p.id)).slice(0, limit);
    if (chosen.length === 0) return;
    ctx.setMidiCcCount(chosen.length);
    chosen.forEach((p, i) =>
      ctx.setParam(i, {
        name: p.label,
        midi: { cc: p.cc, channel: device.default_channel, name: p.label, value: 0 },
      }),
    );
  };

  // Stable, first-seen-order grouping for the checklist.
  const groups: { group: string; params: MidiDeviceParam[] }[] = [];
  if (device) {
    const byGroup = new Map<string, MidiDeviceParam[]>();
    for (const p of device.params) {
      if (!byGroup.has(p.group)) {
        const arr: MidiDeviceParam[] = [];
        byGroup.set(p.group, arr);
        groups.push({ group: p.group, params: arr });
      }
      byGroup.get(p.group)!.push(p);
    }
  }

  const willApply = device ? Math.min(selected.size, limit) : 0;
  const overflow = selected.size > limit;

  return (
    <>
      <SectionLabel>Device template</SectionLabel>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={deviceId}
          onChange={(e) => pickDevice(e.target.value)}
          style={{ ...cellInput, width: 'auto', cursor: 'pointer' }}
        >
          <option value="">— manual (no template) —</option>
          {MIDI_DEVICES.map((d) => (
            <option key={d.device_id} value={d.device_id}>
              {d.name} · {d.params.length} params
            </option>
          ))}
        </select>
        {device && (
          <>
            <button type="button" style={btn('var(--fg-mute)')} onClick={() => selectFirst(Math.min(limit, device.params.length))}>
              Select first {Math.min(limit, device.params.length)}
            </button>
            <button type="button" style={btn('var(--fg-mute)')} onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button type="button" style={btn('var(--accent)')} onClick={apply} disabled={willApply === 0}>
              Apply {willApply} → outputs
            </button>
          </>
        )}
      </div>
      {device && (
        <>
          <p style={{ fontSize: 9, color: overflow ? 'var(--warn)' : 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
            {device.manufacturer} · default ch {device.default_channel} · {selected.size} selected
            {overflow ? ` (only the first ${limit} will map — engine has ${limit} outputs)` : ''}. Tick the parameters
            the model should drive, then Apply. You can still tweak CC#/channel below.
          </p>
          <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-1)', padding: '4px 6px' }}>
            {groups.map(({ group, params }) => (
              <div key={group} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 9, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 0 2px' }}>
                  {group}
                </div>
                {params.map((p) => (
                  <label
                    key={p.id}
                    style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-xs)', padding: '1px 0', cursor: 'pointer' }}
                  >
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                    <span style={{ flex: 1 }}>{p.label}</span>
                    <span style={{ color: 'var(--fg-mute)', fontFamily: 'var(--font-mono)' }}>CC {p.cc}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ---- MIDI config (backends-spec §2.3 / §4.1) -------------------------------

function MidiConfig({ ctx }: { ctx: ConsoleCtx }) {
  const s = ctx.backendStatus;
  const statusColor =
    s.state === 'ready' ? 'var(--good)' : s.state === 'error' || s.state === 'unavailable' ? 'var(--danger)' : 'var(--warn)';
  return (
    <>
      <SectionLabel>MIDI output</SectionLabel>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={ctx.midiOutputId ?? ''}
          onChange={(e) => ctx.setMidiOutputId(e.target.value || null)}
          onFocus={ctx.refreshMidiPorts}
          style={{ ...cellInput, width: 'auto', cursor: 'pointer' }}
        >
          <option value="">— pick output port —</option>
          {ctx.midiPorts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>
          CCs
          <input
            type="number"
            min={1}
            max={ctx.params.length}
            value={ctx.midiCcCount}
            onChange={(e) =>
              ctx.setMidiCcCount(Math.max(1, Math.min(ctx.params.length, num(e.target.value, ctx.midiCcCount))))
            }
            style={{ ...cellInput, width: 60 }}
          />
        </label>
        <span style={{ fontSize: 9, color: statusColor }}>{s.message}</span>
      </div>

      <DeviceTemplatePicker ctx={ctx} />

      <SectionLabel>Per-output CC · name · channel</SectionLabel>
      <div style={{ maxHeight: 320, overflow: 'auto' }}>
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
            {ctx.params.slice(0, ctx.midiCcCount).map((p, i) => {
              const m = p.midi ?? defaultMidiSpec(i);
              return (
                <tr key={i}>
                  <td style={{ padding: '3px 6px' }}>
                    <input
                      style={cellInput}
                      value={m.name}
                      onChange={(e) => ctx.setParam(i, { midi: { ...m, name: e.target.value } })}
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
                        ctx.setParam(i, { midi: { ...m, cc: Math.max(0, Math.min(127, num(e.target.value, m.cc))) } })
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
                        ctx.setParam(i, {
                          midi: { ...m, channel: Math.max(1, Math.min(16, num(e.target.value, m.channel))) },
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
    </>
  );
}

// ---- OSC config (backends-spec §2.4 / §4.2) --------------------------------

function OscConfig({ ctx }: { ctx: ConsoleCtx }) {
  const s = ctx.backendStatus;
  const statusColor = s.state === 'ready' ? 'var(--good)' : s.state === 'connecting' ? 'var(--warn)' : 'var(--danger)';
  const [draftUrl, setDraftUrl] = useState(ctx.oscUrl);
  useEffect(() => setDraftUrl(ctx.oscUrl), [ctx.oscUrl]);
  return (
    <>
      <SectionLabel>OSC bridge</SectionLabel>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          style={{ ...cellInput, width: 200 }}
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onBlur={() => ctx.setOscUrl(draftUrl)}
          placeholder="ws://localhost:8765"
        />
        <button type="button" style={btn('var(--accent)')} onClick={() => ctx.setOscUrl(draftUrl)}>
          Connect
        </button>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>
          <input type="checkbox" checked={ctx.oscSendRaw} onChange={(e) => ctx.setOscSendRaw(e.target.checked)} />
          send raw 0..1
        </label>
        <span style={{ fontSize: 9, color: statusColor }}>{s.message}</span>
      </div>
      <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
        The Deno OSC bridge process must be running locally (see manifold/osc-bridge). The browser sends over
        WebSocket; the bridge encodes OSC and forwards over UDP.
      </p>

      <SectionLabel>Per-output address · physical range</SectionLabel>
      <div style={{ maxHeight: 320, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>OSC path</Th>
              <Th>range min</Th>
              <Th>range max</Th>
            </tr>
          </thead>
          <tbody>
            {ctx.params.map((p, i) => {
              const o = p.osc ?? defaultOscSpec(p.name);
              return (
                <tr key={i}>
                  <td style={{ padding: '3px 6px' }}>
                    <input
                      style={cellInput}
                      value={o.path}
                      onChange={(e) => ctx.setParam(i, { osc: { ...o, path: e.target.value } })}
                    />
                  </td>
                  <td style={{ padding: '3px 6px', width: 90 }}>
                    <input
                      type="number"
                      style={cellInput}
                      value={o.rangeMin}
                      onChange={(e) => ctx.setParam(i, { osc: { ...o, rangeMin: num(e.target.value, o.rangeMin) } })}
                    />
                  </td>
                  <td style={{ padding: '3px 6px', width: 90 }}>
                    <input
                      type="number"
                      style={cellInput}
                      value={o.rangeMax}
                      onChange={(e) => ctx.setParam(i, { osc: { ...o, rangeMax: num(e.target.value, o.rangeMax) } })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---- VCV / CV config (backends-spec §2.6 / §4.3) ---------------------------

function VcvConfig({ ctx }: { ctx: ConsoleCtx }) {
  const s = ctx.backendStatus;
  const statusColor = s.state === 'ready' ? 'var(--good)' : s.state === 'connecting' ? 'var(--warn)' : 'var(--danger)';
  const [draftUrl, setDraftUrl] = useState(ctx.vcvUrl);
  useEffect(() => setDraftUrl(ctx.vcvUrl), [ctx.vcvUrl]);
  return (
    <>
      <SectionLabel>VCV bridge</SectionLabel>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          style={{ ...cellInput, width: 200 }}
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onBlur={() => ctx.setVcvUrl(draftUrl)}
          placeholder="ws://localhost:8765"
        />
        <button type="button" style={btn('var(--accent)')} onClick={() => ctx.setVcvUrl(draftUrl)}>
          Connect
        </button>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>
          <input type="checkbox" checked={ctx.vcvSendRaw} onChange={(e) => ctx.setVcvSendRaw(e.target.checked)} />
          send raw 0..1
        </label>
        <span style={{ fontSize: 9, color: statusColor }}>{s.message}</span>
      </div>
      <p style={{ fontSize: 9, color: 'var(--fg-dim)', margin: 0, lineHeight: 1.6 }}>
        The VCV Rack NISPS module AND the Deno OSC bridge (manifold/osc-bridge) must both be running. The browser drives
        the module's inputs and forwards the verdict loop (thumbs up/down, explore-and-place) over the bridge, so the
        module's embedded net trains in lock-step. Default module UDP port 7001.
      </p>

      <SectionLabel>Per-output polarity</SectionLabel>
      <div style={{ maxHeight: 320, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>output</Th>
              <Th>range</Th>
            </tr>
          </thead>
          <tbody>
            {ctx.params.map((p, i) => {
              const v = p.vcv ?? defaultVcvSpec();
              return (
                <tr key={i}>
                  <td style={{ padding: '3px 6px', fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>{p.name}</td>
                  <td style={{ padding: '3px 6px', width: 110 }}>
                    <button
                      type="button"
                      onClick={() => ctx.setParam(i, { vcv: { bipolar: !v.bipolar } })}
                      style={{
                        ...btn(v.bipolar ? 'var(--danger)' : 'var(--fg-mute)'),
                        width: '100%',
                      }}
                    >
                      {v.bipolar ? '±5 V' : '0–10 V'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---- Public entry ----------------------------------------------------------

export interface OutputsBackendConfigProps {
  ctx: ConsoleCtx;
  backend: BackendId;
}

/** The specialised, editable per-backend config + preset bar for the Outputs panel. */
export function OutputsBackendConfig({ ctx, backend }: OutputsBackendConfigProps) {
  // MIDI / OSC / VCV carry a config + preset surface here; synth/particle/editor
  // config is rendered by ModeConfig in Drawers. The full-depth BackendAdvanced
  // modal reuses the same per-channel sections.
  if (backend !== 'midi' && backend !== 'osc' && backend !== 'vcv') return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <PresetBar ctx={ctx} backend={backend} />
      {backend === 'midi' ? <MidiConfig ctx={ctx} /> : backend === 'osc' ? <OscConfig ctx={ctx} /> : <VcvConfig ctx={ctx} />}
    </div>
  );
}

export { PresetBar as OutputPresetBar };

/** Tiny status pill for the Outputs drawer header. */
export function BackendStatusChip({ ctx }: { ctx: ConsoleCtx }) {
  const s = ctx.backendStatus;
  if (s.state === 'idle') return null;
  const color =
    s.state === 'ready'
      ? 'var(--good)'
      : s.state === 'error' || s.state === 'unavailable'
        ? 'var(--danger)'
        : 'var(--warn)';
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: 'var(--font-mono)',
        color,
        border: `1px solid ${color}`,
        borderRadius: 'var(--r-pill)',
        padding: '2px 8px',
      }}
      title={s.message}
    >
      {s.message}
    </span>
  );
}
