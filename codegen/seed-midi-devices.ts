#!/usr/bin/env bun
/**
 * One-time seed: derive canonical MIDI device templates (schemas/midi_devices/*.json)
 * from the verified research artifact synth-midi-cc.json.
 *
 * Only the CC-controllable devices are emitted (has_midi_cc === true). For each,
 * every {cc, name} becomes a param with a stable snake_case `id` (slugified from the
 * label, de-duplicated by appending _cc<NN>), min/max from the device value range,
 * a neutral default, and a coarse `group` assigned by keyword heuristic.
 *
 * Re-runnable and idempotent. Edit the emitted schemas/midi_devices/*.json afterwards
 * if you want to hand-tune labels, groups, ranges, or defaults — they are the canonical
 * source consumed by codegen/generate-midi-devices.ts. synth-midi-cc.json stays as the
 * human-readable provenance/sources document.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const RESEARCH_PATH = join(REPO_ROOT, "synth-midi-cc.json");
const OUT_DIR = join(REPO_ROOT, "schemas", "midi_devices");

const DEFAULT_VALUE = 64; // neutral midpoint; only used when a param is "fixed", not ML-driven

// Map research `name` -> canonical device_id + default channel. Only these are seeded.
const DEVICE_MAP: Record<string, { device_id: string; channel: number }> = {
  "Moog Sub 37": { device_id: "moog_sub37", channel: 1 },
  "Creamware Pro-12 ASB": { device_id: "creamware_pro12_asb", channel: 1 },
  "Elektron Analog Keys": { device_id: "elektron_analog_keys", channel: 1 },
  "ASM Hydrasynth": { device_id: "asm_hydrasynth", channel: 1 },
  "Roland JD-800": { device_id: "roland_jd800", channel: 1 },
  "Moog Sub Phatty": { device_id: "moog_sub_phatty", channel: 1 },
};

function slugify(label: string): string {
  // Drop parenthetical notes, lowercase, non-alnum -> _, collapse, trim.
  let s = label.replace(/\([^)]*\)/g, " ").toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
  if (s.length === 0) s = "param";
  if (!/^[a-z]/.test(s)) s = "p_" + s;
  return s;
}

function groupFor(label: string): string {
  const l = label.toLowerCase();
  const has = (...ks: string[]) => ks.some(k => l.includes(k));
  if (has("arp", "arpeggiat")) return "arp";
  if (has("env", "attack", "decay", "sustain", "release", " adsr", "adr", "hold", "delay time")) return "env";
  if (has("lfo")) return "lfo";
  if (has("filter", "cutoff", "resonance", "res ", " res", "multidrive", "poles", "keytrack", "kb track")) return "filter";
  if (has("delay", "reverb", "chorus", "flanger", "fx", "wet", "dry")) return "fx";
  if (has("macro", "mod ", "mutator", "ring mod", " mod", "modulation", "wheel", "aftertouch")) return "mod";
  if (has("osc", "vco", "wave", "pitch", "tune", "freq", "sub", "noise", "detune", "sync", "cent", "octave", "glide", "portamento")) return "osc";
  if (has("vol", "level", "pan", "mix", "amp", "output")) return "mix";
  return "global";
}

interface ResearchParam { cc: number; name: string }
interface ResearchSynth {
  name: string;
  manufacturer: string;
  year?: number;
  has_midi_cc: boolean;
  cc_parameters: ResearchParam[];
}
interface Research { synths: ResearchSynth[] }

function main(): number {
  const research = JSON.parse(readFileSync(RESEARCH_PATH, "utf8")) as Research;
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  let count = 0;
  for (const synth of research.synths) {
    const map = DEVICE_MAP[synth.name];
    if (!map) continue; // skip non-CC / out-of-scope devices
    if (!synth.has_midi_cc || synth.cc_parameters.length === 0) continue;

    const seenIds = new Set<string>();
    const params = synth.cc_parameters.map(p => {
      let id = slugify(p.name);
      if (seenIds.has(id)) id = `${id}_cc${p.cc}`;
      while (seenIds.has(id)) id = `${id}_x`;
      seenIds.add(id);
      return {
        id,
        cc: p.cc,
        label: p.name,
        min: 0,
        max: 127,
        default: DEFAULT_VALUE,
        group: groupFor(p.name),
      };
    });

    const device = {
      $schema: "../midi_device.schema.json",
      device_id: map.device_id,
      name: synth.name,
      manufacturer: synth.manufacturer,
      ...(synth.year ? { year: synth.year } : {}),
      midi: {
        default_channel: map.channel,
        value_range: [0, 127],
      },
      params,
    };

    const out = join(OUT_DIR, `${map.device_id}.json`);
    writeFileSync(out, JSON.stringify(device, null, 2) + "\n");
    count++;
    console.log(`  ${map.device_id}: ${params.length} params`);
  }

  console.log(`OK  seeded ${count} device template(s) -> ${OUT_DIR}`);
  return 0;
}

process.exit(main());
