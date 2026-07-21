#!/usr/bin/env bun
/**
 * Curve drift check — the schemas' declared response curves must equal what
 * `nisps/engines/*.hpp` actually does, per voice space.
 *
 * WHY THIS CHECK IS SOURCE-LEVEL, NOT BEHAVIOURAL
 * -----------------------------------------------
 * You cannot observe "the curve" from engine output. A voice space maps a
 * normalised slot into engine state as `base + f(p) * scale` and the state
 * then disappears into DSP; without independently knowing `base`/`scale` (and
 * the DSP transfer function) there is no way to recover `f` from audio. The
 * engines expose no accessor for the mapped state, and adding one would mean
 * editing engine internals to make a declaration checkable — the tail wagging
 * the dog. So the fact lives in the arithmetic, and that is what we read.
 *
 * The upside of being source-level: it verifies the WHOLE table (9 modes, 26
 * voice spaces, 344 params) rather than the handful of code paths any
 * behavioural harness would reach. The parity harness, for contrast, only
 * exercises PAFSynth + ChannelStrip at all-params-0.5.
 *
 * It fails loudly on three separate classes of drift:
 *   1. a declared curve that disagrees with the engine,
 *   2. a schema voice-space list that disagrees with the engine's
 *      `kVoiceSpaceNames` (order matters — the schema index IS the enum
 *      ordinal that `ModeBase::set_voice_space` casts to),
 *   3. an engine idiom the extractor cannot reduce (codegen/curve-audit.ts
 *      raises rather than guessing "linear").
 *
 * It checks the JSON schemas AND the generated TypeScript, so a codegen bug
 * that drops the table cannot pass.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditAllEngines, CurveAuditError, type Curve } from "../curve-audit.ts";
import { ALL_MODE_SCHEMAS, effectiveCurve } from "../../manifold/src/modes/generated/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const MODES_DIR = join(REPO_ROOT, "schemas", "modes");
const ENGINES_DIR = join(REPO_ROOT, "nisps", "engines");

type VoiceSpaceDecl = string | { name: string; curve_overrides: Record<string, Curve> };
interface JsonModeSchema {
  mode_id: string;
  engine_id: string;
  params: Array<{ name: string; curve: Curve }>;
  voice_spaces: VoiceSpaceDecl[];
}

const vsName = (v: VoiceSpaceDecl): string => (typeof v === "string" ? v : v.name);

/** Resolve the JSON declaration into curves[voiceSpace][param]. */
function declaredCurves(s: JsonModeSchema): Curve[][] {
  const defaults = s.params.map((p) => p.curve);
  const byName = new Map(s.params.map((p, i) => [p.name, i] as const));
  const rows = s.voice_spaces.length === 0 ? [null] : s.voice_spaces;
  return rows.map((v) => {
    const row = [...defaults];
    if (v && typeof v !== "string") {
      for (const [name, c] of Object.entries(v.curve_overrides)) {
        row[byName.get(name)!] = c;
      }
    }
    return row;
  });
}

function run(): number {
  const problems: string[] = [];
  let engines;
  try {
    engines = auditAllEngines(ENGINES_DIR);
  } catch (e) {
    if (e instanceof CurveAuditError) {
      console.error(`\nFAILED to read the engines' curve arithmetic:\n  ${e.message}\n`);
      console.error(
        "The extractor refuses to guess. Either the engine grew an idiom\n" +
          "codegen/curve-audit.ts does not model, or a voice space lost its\n" +
          "dispatch case. Teach the extractor, do not weaken it.\n"
      );
      return 1;
    }
    throw e;
  }

  const tsByModeId = new Map(ALL_MODE_SCHEMAS.map((m) => [m.mode_id, m] as const));
  let checkedModes = 0;
  let checkedSlots = 0;

  for (const f of readdirSync(MODES_DIR).filter((n) => n.endsWith(".json")).sort()) {
    const s = JSON.parse(readFileSync(join(MODES_DIR, f), "utf8")) as JsonModeSchema;
    const eng = engines.get(s.engine_id);
    if (!eng) {
      problems.push(`${f}: engine_id ${JSON.stringify(s.engine_id)} matches no engine in nisps/engines/`);
      continue;
    }

    // (2) voice-space identity. Index i in the schema IS VoiceSpace ordinal i.
    if (eng.voiceSpaceNames !== null) {
      const declared = s.voice_spaces.map(vsName);
      if (JSON.stringify(declared) !== JSON.stringify(eng.voiceSpaceNames)) {
        problems.push(
          `${f}: voice_spaces disagree with ${eng.file}'s kVoiceSpaceNames\n` +
            `      schema: ${JSON.stringify(declared)}\n` +
            `      engine: ${JSON.stringify(eng.voiceSpaceNames)}`
        );
        continue;
      }
    } else if (s.voice_spaces.length > 1) {
      problems.push(
        `${f}: declares ${s.voice_spaces.length} voice spaces but ${eng.file} has no VoiceSpace enum`
      );
      continue;
    }

    // An engine with no params of its own (NoOpEngine, engine_id "thru") maps
    // nothing: the mode's outputs are MIDI CCs it emits itself, unshaped.
    const allLinear: Curve[] = s.params.map(() => "linear");
    const actual =
      eng.nParams === 0
        ? [allLinear]
        : eng.voiceSpaceNames !== null
          ? eng.curves
          : [eng.curves[0]!];

    if (eng.nParams !== 0 && eng.nParams !== s.params.length) {
      problems.push(`${f}: ${s.params.length} params but ${eng.engineId} has kNParams = ${eng.nParams}`);
      continue;
    }

    // (1) the declared table, from the JSON…
    const declared = declaredCurves(s);
    // …and independently from the generated TypeScript, so a codegen bug that
    // drops or mis-indexes the table is caught too.
    const ts = tsByModeId.get(s.mode_id);
    if (!ts) {
      problems.push(`${f}: no generated TypeScript schema for mode_id ${s.mode_id}`);
      continue;
    }

    const nVs = Math.max(declared.length, 1);
    for (let vs = 0; vs < nVs; vs++) {
      const expect = actual.length === 1 ? actual[0]! : actual[vs]!;
      for (let i = 0; i < s.params.length; i++) {
        checkedSlots++;
        const label = `${s.mode_id}[${vsName(s.voice_spaces[vs] ?? "-")}].${s.params[i]!.name} (slot ${i})`;
        if (declared[vs]![i] !== expect[i]) {
          problems.push(
            `${label}: schema says ${declared[vs]![i]}, ${eng.file} applies ${expect[i]}`
          );
        }
        const fromTs = effectiveCurve(ts, vs, i);
        if (fromTs !== declared[vs]![i]) {
          problems.push(
            `${label}: generated TS says ${fromTs}, schemas/modes/${f} says ${declared[vs]![i]}`
          );
        }
      }
    }
    checkedModes++;
  }

  if (problems.length > 0) {
    console.error(`\ncurve drift: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      "\nThe schemas' `curve` fields are DESCRIPTIVE: they record what the\n" +
        "engine already does. If an engine's arithmetic changed on purpose,\n" +
        "update schemas/modes/*.json (params[].curve for the default, or the\n" +
        "voice space's curve_overrides for a deviation) and re-run codegen.\n" +
        "Do NOT change the engine to match the declaration.\n"
    );
    return 1;
  }

  console.log(
    `curve drift: ok — ${checkedModes} modes, ${checkedSlots} (voice space x param) slots ` +
      `cross-checked against nisps/engines/ source.`
  );
  return 0;
}

process.exit(run());
