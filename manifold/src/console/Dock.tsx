/**
 * The Console dock — right-edge 48px rail + one mutually-exclusive drawer with
 * three depth states (Peek 320 / Expand 520 / Full modal).
 *
 * RESTRUCTURED (operator dock restructure):
 *   - TOP, pinned: the **Mode** selector — the active OUTPUT BACKEND/target
 *     (Particle System / MIDI / OSC / Built-in Synth / MEMLNaut Editor). Opens a
 *     popover listing the five with the current marked. NEVER shows "C15".
 *   - BELOW: the five drawer icons (Learning, Inputs, Outputs, Settings, Help),
 *     **vertically centred in the remaining rail space** like a macOS dock — the
 *     Mode button is a fixed top element; the drawer group is centred in the
 *     leftover height (flex column with the group in a flex:1 centred wrapper).
 *
 * Icons are monochrome inline-SVG (icons.tsx), currentColor-driven: focused =
 * --accent (orange), unfocused = the Settings unfocused colour. When monochrome
 * is OFF the prior glyphs are used.
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { DRAWERS } from './Drawers';
import type { ConsoleCtx, DrawerDepth, DrawerKey, OutputMode } from './types';
import { OUTPUT_MODES } from './output-mode';
import { useSettings, unfocusedIconCss } from '../settings/settings-store';
import {
  ModeIcon,
  ParticleIcon,
  MidiIcon,
  OscIcon,
  SynthIcon,
  EditorIcon,
  SandwichIcon,
  CloseIcon,
  ExpandIcon,
  GLYPH_FALLBACK,
} from './icons';
import type { IconProps } from './icons';

const dockMini: CSSProperties = {
  width: 26,
  height: 24,
  borderRadius: 'var(--r-1)',
  border: '1px solid var(--line)',
  background: 'var(--bg-2)',
  color: 'var(--fg-mute)',
  cursor: 'pointer',
  fontSize: 11,
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/** Per-Mode icon + fallback glyph. */
const MODE_ICON: Record<OutputMode, { Icon: (p: IconProps) => JSX.Element; glyph: string }> = {
  particles: { Icon: ParticleIcon, glyph: GLYPH_FALLBACK.particles },
  midi: { Icon: MidiIcon, glyph: GLYPH_FALLBACK.midi },
  osc: { Icon: OscIcon, glyph: GLYPH_FALLBACK.osc },
  synth: { Icon: SynthIcon, glyph: GLYPH_FALLBACK.synth },
  editor: { Icon: EditorIcon, glyph: GLYPH_FALLBACK.editor },
};

function ModeSelector({
  outputMode,
  setOutputMode,
  mono,
}: {
  outputMode: OutputMode;
  setOutputMode: (m: OutputMode) => void;
  mono: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = OUTPUT_MODES.find((m) => m.id === outputMode) ?? OUTPUT_MODES[0];
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Mode: ${active.label}`}
        style={{
          width: 40,
          height: 40,
          borderRadius: 'var(--r-2)',
          border: '1px solid var(--accent)',
          background: 'rgba(255,106,0,0.12)',
          color: 'var(--accent)',
          cursor: 'pointer',
          fontSize: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {mono ? <ModeIcon /> : '⊞'}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 'calc(100% + 8px)',
            width: 240,
            background: 'var(--glass)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid var(--glass-line)',
            borderRadius: 'var(--r-2)',
            boxShadow: 'var(--shadow-2)',
            padding: 6,
            zIndex: 80,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--fg-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              padding: '6px 8px 2px',
            }}
          >
            Mode · output target
          </div>
          {OUTPUT_MODES.map((m) => {
            const on = m.id === outputMode;
            const { Icon, glyph } = MODE_ICON[m.id];
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setOutputMode(m.id);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  textAlign: 'left',
                  background: on ? 'var(--bg-3)' : 'transparent',
                  border: 0,
                  borderRadius: 'var(--r-1)',
                  padding: '6px 8px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-sm)',
                  color: on ? 'var(--accent)' : 'var(--fg)',
                }}
              >
                <span
                  style={{
                    width: 18,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: on ? 'var(--accent)' : 'var(--fg-mute)',
                  }}
                >
                  {mono ? <Icon size={16} /> : glyph}
                </span>
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface DockProps {
  ctx: ConsoleCtx;
  active: DrawerKey | null;
  setActive: (k: DrawerKey | null) => void;
  depth: DrawerDepth;
  setDepth: (d: DrawerDepth) => void;
  /** Sandwich (parameter-landscape) centre-stage toggle. */
  sandwich: boolean;
  setSandwich: (v: boolean) => void;
}

const ORDER: DrawerKey[] = ['learn', 'inputs', 'route', 'settings', 'help'];

export function Dock({ ctx, active, setActive, depth, setDepth, sandwich, setSandwich }: DockProps) {
  const { settings } = useSettings();
  const mono = settings.monochromeIcons;
  const restColour = unfocusedIconCss(settings.unfocusedIconColour);

  const iconBtn = (key: DrawerKey) => {
    const s = DRAWERS[key];
    const on = active === key;
    return (
      <button
        key={key}
        type="button"
        title={s.label}
        onClick={() => {
          setActive(on ? null : key);
          setDepth('peek');
        }}
        style={{
          position: 'relative',
          width: 40,
          height: 40,
          borderRadius: 'var(--r-2)',
          cursor: 'pointer',
          border: `1px solid ${on ? 'var(--accent)' : 'transparent'}`,
          background: on ? 'rgba(255,106,0,0.14)' : 'transparent',
          // Focused = accent; unfocused = the Settings unfocused colour.
          color: on ? 'var(--accent)' : mono ? restColour : 'var(--fg-mute)',
          fontSize: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background var(--dur-fast), color var(--dur-fast)',
        }}
      >
        {mono ? s.icon : s.glyph}
        {key === 'learn' && active !== 'learn' && ctx.exploring && (
          <span
            style={{
              position: 'absolute',
              top: 5,
              right: 6,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--accent-2)',
              boxShadow: '0 0 6px var(--accent-2)',
            }}
          />
        )}
      </button>
    );
  };

  const width = depth === 'expand' ? 520 : 320;
  const full = depth === 'full';
  const section = active ? DRAWERS[active] : null;

  return (
    <>
      {section && (
        <aside
          style={
            full
              ? {
                  position: 'fixed',
                  inset: 0,
                  zIndex: 90,
                  background: 'var(--glass)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  padding: 'var(--sp-6)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--sp-3)',
                }
              : {
                  position: 'absolute',
                  top: 0,
                  right: 48,
                  bottom: 0,
                  width,
                  zIndex: 35,
                  background: 'var(--glass)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  borderLeft: '1px solid var(--glass-line)',
                  boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
                  padding: 'var(--sp-4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--sp-2)',
                  overflow: 'auto',
                  animation: 'mfDrawerIn var(--dur-med) var(--ease-console)',
                }
          }
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-2)',
              borderBottom: '1px solid var(--glass-line)',
              paddingBottom: 'var(--sp-2)',
            }}
          >
            <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>
              {mono ? section.icon : <span style={{ fontSize: 'var(--fs-md)' }}>{section.glyph}</span>}
            </span>
            <h3 style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--fg)' }}>{section.label}</h3>
            <span
              style={{
                fontSize: 10,
                color: 'var(--fg-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginLeft: 4,
              }}
            >
              {depth}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {!full && (
                <button
                  type="button"
                  title={depth === 'peek' ? 'More' : 'Peek'}
                  onClick={() => setDepth(depth === 'peek' ? 'expand' : 'peek')}
                  style={dockMini}
                >
                  <ExpandIcon size={12} />
                </button>
              )}
              <button
                type="button"
                title="Open full"
                onClick={() => setDepth(full ? 'peek' : 'full')}
                style={dockMini}
              >
                <ExpandIcon size={12} />
              </button>
              <button type="button" title="Close" onClick={() => setActive(null)} style={dockMini}>
                <CloseIcon size={12} />
              </button>
            </div>
          </header>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--sp-2)',
              flex: 1,
              ...(full ? { maxWidth: 720 } : {}),
            }}
          >
            {section.render(ctx, depth)}
          </div>
        </aside>
      )}

      <nav
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 48,
          zIndex: 36,
          background: 'var(--glass)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderLeft: '1px solid var(--glass-line)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '8px 0',
        }}
      >
        {/* Mode button — pinned at the TOP of the rail. */}
        <ModeSelector outputMode={ctx.outputMode} setOutputMode={ctx.setOutputMode} mono={mono} />
        {/* Drawer group — vertically centred in the remaining rail height. */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--sp-2)',
          }}
        >
          {ORDER.map(iconBtn)}
        </div>
        {/* Sandwich toggle — pinned at the BOTTOM of the rail. */}
        <button
          type="button"
          title="Parameter sandwich (layer view)"
          onClick={() => setSandwich(!sandwich)}
          style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--r-2)',
            cursor: 'pointer',
            border: `1px solid ${sandwich ? 'var(--accent)' : 'transparent'}`,
            background: sandwich ? 'rgba(255,106,0,0.14)' : 'transparent',
            color: sandwich ? 'var(--accent)' : mono ? restColour : 'var(--fg-mute)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background var(--dur-fast), color var(--dur-fast)',
          }}
        >
          {mono ? <SandwichIcon /> : '≣'}
        </button>
      </nav>
    </>
  );
}
