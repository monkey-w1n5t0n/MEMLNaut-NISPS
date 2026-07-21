#!/usr/bin/env bun
/**
 * MEMLNaut mode-schema codegen.
 *
 * Reads:   schemas/schema.json (Draft 2020-12 meta-schema for modes)
 *          schemas/modes/*.json (one file per mode)
 *
 * Writes:  nisps/modes/generated/<mode_id>_schema.hpp
 *          nisps/modes/generated/schema_types.hpp
 *          manifold/src/modes/generated/<mode_id>_schema.ts
 *          manifold/src/modes/generated/types.ts
 *          manifold/src/modes/generated/index.ts
 *
 * (The TS target moved playground → manifold at P5 of
 * docs/specs/plans/one-core-engine-refactor.md.)
 *
 * Per-mode C++ headers also emit (simplification 2026-07, S1/S5/S6/S25):
 *   - `k<Mode>Schema`  — the `nisps::ParamSchema` aggregate; each mode's
 *     `param_schema()` becomes a one-line `return generated::k<Mode>Schema;`
 *     instead of hand-assembling the same 12-field struct.
 *   - `<Mode>MLP`      — the mode's `nisps::ml::MLP<...>` net-shape alias,
 *     built from the constants above instead of a second hand-typed copy of
 *     the dims in nisps/modes/*.hpp.
 * The TS `index.ts` also emits `ALL_MODE_SCHEMAS` (every mode schema, in
 * generation order) so manifold's mode catalogue no longer hand-imports each
 * schema by name — see manifold/src/console/model.ts's `SCHEMA_MODES` overlay.
 *
 * Idempotent: regenerating the same schemas yields byte-identical output.
 * Exits non-zero on validation failure.
 */

import { writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type AnySchemaObject } from "ajv/dist/2020.js";
import { ensureDir, readJSON, toPascalCase, cppStringLit, tsStringLit } from "./lib.ts";

// ----- Types ----------------------------------------------------------------

type Curve = "linear" | "exp" | "log" | "square" | "sqrt" | "sigmoid" | "cubic";

interface ModeSchema {
  $schema?: string;
  _note?: string;
  mode_id: string;
  engine_id: string;
  ml: {
    input_channels: string[];
    input_size: number;
    hidden_layers: number[];
    output_size: number;
    default_spread: number;
  };
  params: Array<{
    name: string;
    label: string;
    min: number;
    max: number;
    default: number;
    curve: Curve;
    group: string;
    _note?: string;
  }>;
  voice_spaces: string[];
  ui: {
    primary_input: "xy_pad" | "joystick" | "sliders" | "audio_in" | "midi_in" | "none";
    show_voice_space_selector: boolean;
    show_synth_visualizer: boolean;
  };
}

/**
 * The ONE global training-hyperparameter default (schemas/ml_defaults.json,
 * validated against schemas/ml_defaults.schema.json) — NOT per-mode, unlike
 * everything else in ModeSchema. See S26 (docs/specs/recon/
 * simplification-audit-2026-07.md): learning_rate/max_iterations/min_error
 * used to be duplicated per-mode (identically, unread at runtime) plus
 * hardcoded separately in nisps/ml/mlp.hpp, manifold/src/engine/wasm-iml.ts,
 * and vcv/src/iml.hpp. Now declared once here and consumed by
 * `nisps::ml::MLPCore`'s `TrainConfig` default member initialisers.
 */
interface MlTrainDefaults {
  $schema?: string;
  _note?: string;
  learning_rate: number;
  max_iterations: number;
  min_error: number;
}

// ----- Path resolution ------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SCHEMAS_DIR = join(REPO_ROOT, "schemas");
const MODES_DIR = join(SCHEMAS_DIR, "modes");
const META_SCHEMA_PATH = join(SCHEMAS_DIR, "schema.json");
const ML_DEFAULTS_PATH = join(SCHEMAS_DIR, "ml_defaults.json");
const ML_DEFAULTS_SCHEMA_PATH = join(SCHEMAS_DIR, "ml_defaults.schema.json");
const CPP_OUT_DIR = join(REPO_ROOT, "nisps", "modes", "generated");
// The training defaults are an ML fact, not a mode fact, and `nisps/ml` sits
// BELOW `nisps/modes` in the layering MAP.md documents — emitting them into
// modes/generated/ would make mlp.hpp include upward. They get their own
// output dir on the C++ side. The TS side has no such layering to respect, so
// it keeps everything generated under one directory.
const CPP_ML_OUT_DIR = join(REPO_ROOT, "nisps", "ml", "generated");
const TS_OUT_DIR = join(REPO_ROOT, "manifold", "src", "modes", "generated");

// ----- Helpers --------------------------------------------------------------
// ensureDir/readJSON/toPascalCase/cppStringLit/tsStringLit now live in
// ./lib.ts (ST12, shared with generate-midi-devices.ts).

/**
 * Convert mode_id to UPPER_SNAKE for #define guards.
 */
function toUpperSnake(snake: string): string {
  return snake.toUpperCase();
}

/**
 * Format a float literal for C++ ensuring `.f` suffix and explicit decimal point.
 * Required by the perf contract (architecture §3.3).
 */
function cppFloatLit(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`non-finite float: ${n}`);
  }
  // toFixed ensures a decimal point; trim trailing zeros but keep at least one digit
  let s = n.toString();
  if (!s.includes(".") && !s.includes("e") && !s.includes("E")) {
    s += ".0";
  }
  return s + "f";
}

function cppCurveEnum(c: Curve): string {
  // Curve enum lives in nisps/core/math.hpp (namespace `nisps`), lowercase per architecture spec.
  // Re-exported as `nisps::modes::generated::Curve` via `using Curve = ::nisps::Curve;`.
  switch (c) {
    case "linear": return "Curve::linear";
    case "exp":    return "Curve::exp";
    case "log":    return "Curve::log";
    case "square": return "Curve::square";
    case "sqrt":   return "Curve::sqrt";
    case "sigmoid":return "Curve::sigmoid";
    case "cubic":  return "Curve::cubic";
  }
}

const AUTOGEN_BANNER_CPP = (sourceFile: string): string =>
  `// AUTOGENERATED — do not edit. Source: schemas/modes/${sourceFile}. ` +
  `Run \`bun run codegen/generate.ts\` to regenerate.\n`;

const AUTOGEN_BANNER_TS = (sourceFile: string): string =>
  `// AUTOGENERATED — do not edit. Source: schemas/modes/${sourceFile}. ` +
  `Run \`bun run codegen/generate.ts\` to regenerate.\n`;

// ----- Shared types emission -----------------------------------------------

function emitSchemaTypesHpp(): string {
  return [
    "// AUTOGENERATED — do not edit. Run `bun run codegen/generate.ts` to regenerate.",
    "// Shared C++ types for generated mode schemas.",
    "//",
    "// `Curve` is the authoritative enum from nisps/core/math.hpp; we re-export it",
    "// into this namespace so generated headers can refer to plain `Curve::linear`.",
    "//",
    "// `ParamSchema` lives in the top-level `nisps` namespace, not",
    "// `nisps::modes::generated`: nisps/core/concepts.hpp forward-declares",
    "// `nisps::ParamSchema` and requires `T::param_schema()` to return",
    "// `const nisps::ParamSchema&`, so the definition has to match that",
    "// forward declaration exactly (S5, one-core simplification 2026-07).",
    "#ifndef NISPS_GENERATED_SCHEMA_TYPES_HPP",
    "#define NISPS_GENERATED_SCHEMA_TYPES_HPP",
    "",
    "#include <array>",
    "#include <cstddef>",
    "#include <span>",
    "#include <string_view>",
    "",
    "#include \"../../core/math.hpp\"",
    "",
    "namespace nisps::modes::generated {",
    "",
    "using Curve = ::nisps::Curve;",
    "",
    "struct Param {",
    "    std::string_view name;",
    "    std::string_view label;",
    "    float min;",
    "    float max;",
    "    float default_value;",
    "    Curve curve;",
    "    std::string_view group;",
    "};",
    "",
    "struct MLConfig {",
    "    std::size_t input_size;",
    "    std::size_t output_size;",
    "    float default_spread;",
    "};",
    "",
    "enum class PrimaryInput : unsigned char {",
    "    XYPad = 0,",
    "    Joystick,",
    "    Sliders,",
    "    AudioIn,",
    "    MidiIn,",
    "    None,",
    "};",
    "",
    "struct UIConfig {",
    "    PrimaryInput primary_input;",
    "    bool show_voice_space_selector;",
    "    bool show_synth_visualizer;",
    "};",
    "",
    "}  // namespace nisps::modes::generated",
    "",
    "namespace nisps {",
    "",
    "// View-style aggregate satisfying the `nisps::Mode` concept's",
    "// `param_schema()` requirement. All members are spans/views into",
    "// compile-time generated arrays; codegen emits one",
    "// `inline constexpr ParamSchema k<Mode>Schema` per mode (see the",
    "// per-mode <mode_id>_schema.hpp in this directory).",
    "struct ParamSchema {",
    "    std::string_view                                    mode_id;",
    "    std::string_view                                    engine_id;",
    "    std::span<const std::string_view>                   input_channels;",
    "    std::size_t                                         input_size;",
    "    std::span<const std::size_t>                        hidden_layers;",
    "    std::size_t                                         output_size;",
    "    float                                                default_spread;",
    "    std::span<const ::nisps::modes::generated::Param>    params;",
    "    std::span<const std::string_view>                    voice_spaces;",
    "    ::nisps::modes::generated::UIConfig                  ui;",
    "};",
    "",
    "}  // namespace nisps",
    "",
    "#endif  // NISPS_GENERATED_SCHEMA_TYPES_HPP",
    "",
  ].join("\n");
}

function emitSharedTsTypes(): string {
  return [
    "// AUTOGENERATED — do not edit. Run `bun run codegen/generate.ts` to regenerate.",
    "// Shared TypeScript types for generated mode schemas.",
    "",
    "export type Curve =",
    "  | 'linear'",
    "  | 'exp'",
    "  | 'log'",
    "  | 'square'",
    "  | 'sqrt'",
    "  | 'sigmoid'",
    "  | 'cubic';",
    "",
    "export type PrimaryInput =",
    "  | 'xy_pad'",
    "  | 'joystick'",
    "  | 'sliders'",
    "  | 'audio_in'",
    "  | 'midi_in'",
    "  | 'none';",
    "",
    "export interface Param {",
    "  readonly name: string;",
    "  readonly label: string;",
    "  readonly min: number;",
    "  readonly max: number;",
    "  readonly default: number;",
    "  readonly curve: Curve;",
    "  readonly group: string;",
    "}",
    "",
    "export interface MLConfig {",
    "  readonly input_channels: readonly string[];",
    "  readonly input_size: number;",
    "  readonly hidden_layers: readonly number[];",
    "  readonly output_size: number;",
    "  readonly default_spread: number;",
    "}",
    "",
    "export interface UIConfig {",
    "  readonly primary_input: PrimaryInput;",
    "  readonly show_voice_space_selector: boolean;",
    "  readonly show_synth_visualizer: boolean;",
    "}",
    "",
    "export interface ModeSchema {",
    "  readonly mode_id: string;",
    "  readonly engine_id: string;",
    "  readonly ml: MLConfig;",
    "  readonly params: readonly Param[];",
    "  readonly voice_spaces: readonly string[];",
    "  readonly ui: UIConfig;",
    "}",
    "",
  ].join("\n");
}

// ----- Per-mode C++ emission ------------------------------------------------

function emitModeHpp(schema: ModeSchema, sourceFile: string): string {
  const guard = `NISPS_GENERATED_${toUpperSnake(schema.mode_id)}_SCHEMA_HPP`;
  const constName = `k${toPascalCase(schema.mode_id)}`;
  const lines: string[] = [];

  lines.push(AUTOGEN_BANNER_CPP(sourceFile).trimEnd());
  lines.push(`#ifndef ${guard}`);
  lines.push(`#define ${guard}`);
  lines.push("");
  lines.push("#include \"schema_types.hpp\"");
  lines.push("#include \"../../ml/mlp.hpp\"");
  lines.push("");
  lines.push("namespace nisps::modes::generated {");
  lines.push("");
  // mode_id and engine_id
  lines.push(`inline constexpr std::string_view ${constName}ModeId = ${cppStringLit(schema.mode_id)};`);
  lines.push(`inline constexpr std::string_view ${constName}EngineId = ${cppStringLit(schema.engine_id)};`);
  lines.push("");

  // input channels
  lines.push(`inline constexpr std::array<std::string_view, ${schema.ml.input_channels.length}> ${constName}InputChannels = {{`);
  for (const ch of schema.ml.input_channels) {
    lines.push(`    ${cppStringLit(ch)},`);
  }
  lines.push("}};");
  lines.push("");

  // hidden layers
  lines.push(`inline constexpr std::array<std::size_t, ${schema.ml.hidden_layers.length}> ${constName}HiddenLayers = {{`);
  for (const h of schema.ml.hidden_layers) {
    lines.push(`    ${h}u,`);
  }
  lines.push("}};");
  lines.push("");

  // ML config
  lines.push(`inline constexpr MLConfig ${constName}MLConfig = {`);
  lines.push(`    ${schema.ml.input_size}u,`);
  lines.push(`    ${schema.ml.output_size}u,`);
  lines.push(`    ${cppFloatLit(schema.ml.default_spread)},`);
  lines.push("};");
  lines.push("");

  // params
  lines.push(`inline constexpr std::size_t ${constName}ParamCount = ${schema.params.length}u;`);
  lines.push(`inline constexpr std::array<Param, ${constName}ParamCount> ${constName}Params = {{`);
  for (const p of schema.params) {
    lines.push("    Param{");
    lines.push(`        ${cppStringLit(p.name)},`);
    lines.push(`        ${cppStringLit(p.label)},`);
    lines.push(`        ${cppFloatLit(p.min)},`);
    lines.push(`        ${cppFloatLit(p.max)},`);
    lines.push(`        ${cppFloatLit(p.default)},`);
    lines.push(`        ${cppCurveEnum(p.curve)},`);
    lines.push(`        ${cppStringLit(p.group)},`);
    lines.push("    },");
  }
  lines.push("}};");
  lines.push("");

  // voice spaces
  lines.push(`inline constexpr std::size_t ${constName}VoiceSpaceCount = ${schema.voice_spaces.length}u;`);
  if (schema.voice_spaces.length > 0) {
    lines.push(`inline constexpr std::array<std::string_view, ${constName}VoiceSpaceCount> ${constName}VoiceSpaces = {{`);
    for (const v of schema.voice_spaces) {
      lines.push(`    ${cppStringLit(v)},`);
    }
    lines.push("}};");
  } else {
    // empty arrays of size 0 are technically allowed in C++; but std::array<T,0> is fine
    lines.push(`inline constexpr std::array<std::string_view, 0> ${constName}VoiceSpaces = {};`);
  }
  lines.push("");

  // UI
  let primary: string;
  switch (schema.ui.primary_input) {
    case "xy_pad":   primary = "PrimaryInput::XYPad"; break;
    case "joystick": primary = "PrimaryInput::Joystick"; break;
    case "sliders":  primary = "PrimaryInput::Sliders"; break;
    case "audio_in": primary = "PrimaryInput::AudioIn"; break;
    case "midi_in":  primary = "PrimaryInput::MidiIn"; break;
    case "none":     primary = "PrimaryInput::None"; break;
  }
  lines.push(`inline constexpr UIConfig ${constName}UI = {`);
  lines.push(`    ${primary},`);
  lines.push(`    ${schema.ui.show_voice_space_selector ? "true" : "false"},`);
  lines.push(`    ${schema.ui.show_synth_visualizer ? "true" : "false"},`);
  lines.push("};");
  lines.push("");

  // Net-shape alias (S6/S25): the mode's MLP<> template args, built from the
  // constants above rather than hand-typed a second time in nisps/modes/*.hpp.
  const modeMlpName = `${toPascalCase(schema.mode_id)}MLP`;
  lines.push(
    `using ${modeMlpName} = ::nisps::ml::MLP<` +
      `${constName}MLConfig.input_size, ` +
      `${constName}HiddenLayers[0], ${constName}HiddenLayers[1], ${constName}HiddenLayers[2], ` +
      `${constName}MLConfig.output_size>;`
  );
  lines.push("");

  // ParamSchema aggregate (S5): the one-line `param_schema()` body every mode
  // used to hand-assemble as a private `kSchema` positional-init block.
  lines.push(`inline constexpr ::nisps::ParamSchema ${constName}Schema = {`);
  lines.push(`    ${constName}ModeId,`);
  lines.push(`    ${constName}EngineId,`);
  lines.push(`    std::span<const std::string_view>(${constName}InputChannels),`);
  lines.push(`    ${constName}MLConfig.input_size,`);
  lines.push(`    std::span<const std::size_t>(${constName}HiddenLayers),`);
  lines.push(`    ${constName}MLConfig.output_size,`);
  lines.push(`    ${constName}MLConfig.default_spread,`);
  lines.push(`    std::span<const Param>(${constName}Params),`);
  lines.push(`    std::span<const std::string_view>(${constName}VoiceSpaces),`);
  lines.push(`    ${constName}UI,`);
  lines.push("};");
  lines.push("");

  lines.push("}  // namespace nisps::modes::generated");
  lines.push("");
  lines.push(`#endif  // ${guard}`);
  lines.push("");

  return lines.join("\n");
}

// ----- Per-mode TS emission -------------------------------------------------

function emitModeTs(schema: ModeSchema, sourceFile: string): string {
  const constName = `${toPascalCase(schema.mode_id)}Schema`;
  const paramTypeName = `${toPascalCase(schema.mode_id)}Params`;
  const lines: string[] = [];

  lines.push(AUTOGEN_BANNER_TS(sourceFile).trimEnd());
  lines.push("import type { ModeSchema } from './types';");
  lines.push("");

  // Per-param object type (a record of param name -> number)
  lines.push(`export interface ${paramTypeName} {`);
  for (const p of schema.params) {
    lines.push(`  readonly ${p.name}: number;`);
  }
  lines.push("}");
  lines.push("");

  // Const schema
  lines.push(`export const ${constName}: ModeSchema = {`);
  lines.push(`  mode_id: ${tsStringLit(schema.mode_id)},`);
  lines.push(`  engine_id: ${tsStringLit(schema.engine_id)},`);
  lines.push("  ml: {");
  lines.push("    input_channels: [");
  for (const ch of schema.ml.input_channels) {
    lines.push(`      ${tsStringLit(ch)},`);
  }
  lines.push("    ],");
  lines.push(`    input_size: ${schema.ml.input_size},`);
  lines.push("    hidden_layers: [");
  for (const h of schema.ml.hidden_layers) {
    lines.push(`      ${h},`);
  }
  lines.push("    ],");
  lines.push(`    output_size: ${schema.ml.output_size},`);
  lines.push(`    default_spread: ${schema.ml.default_spread},`);
  lines.push("  },");
  lines.push("  params: [");
  for (const p of schema.params) {
    lines.push("    {");
    lines.push(`      name: ${tsStringLit(p.name)},`);
    lines.push(`      label: ${tsStringLit(p.label)},`);
    lines.push(`      min: ${p.min},`);
    lines.push(`      max: ${p.max},`);
    lines.push(`      default: ${p.default},`);
    lines.push(`      curve: ${tsStringLit(p.curve)},`);
    lines.push(`      group: ${tsStringLit(p.group)},`);
    lines.push("    },");
  }
  lines.push("  ],");
  if (schema.voice_spaces.length === 0) {
    lines.push("  voice_spaces: [],");
  } else {
    lines.push("  voice_spaces: [");
    for (const v of schema.voice_spaces) {
      lines.push(`    ${tsStringLit(v)},`);
    }
    lines.push("  ],");
  }
  lines.push("  ui: {");
  lines.push(`    primary_input: ${tsStringLit(schema.ui.primary_input)},`);
  lines.push(`    show_voice_space_selector: ${schema.ui.show_voice_space_selector},`);
  lines.push(`    show_synth_visualizer: ${schema.ui.show_synth_visualizer},`);
  lines.push("  },");
  lines.push("};");
  lines.push("");

  return lines.join("\n");
}

function emitTsIndex(modeIds: string[]): string {
  const lines: string[] = [];
  lines.push("// AUTOGENERATED — do not edit. Run `bun run codegen/generate.ts` to regenerate.");
  lines.push("// Re-exports every generated mode schema.");
  lines.push("");
  lines.push("import type { ModeSchema } from './types';");
  for (const id of modeIds) {
    lines.push(`import { ${toPascalCase(id)}Schema } from './${id}_schema';`);
  }
  lines.push("");
  lines.push("export * from './types';");
  for (const id of modeIds) {
    lines.push(`export * from './${id}_schema';`);
  }
  lines.push("");
  // Mechanically-derived mode-identity registry (S1): every generated mode
  // schema, in generation (mode_id-sorted) order. NOT display order — that
  // ordering is hand-curated overlay truth (manifold/src/console/model.ts's
  // `SCHEMA_MODES`).
  lines.push(
    "/** Every generated mode schema, mode_id-sorted. Mechanically-derived mode-identity truth. */"
  );
  lines.push("export const ALL_MODE_SCHEMAS: readonly ModeSchema[] = [");
  for (const id of modeIds) {
    lines.push(`  ${toPascalCase(id)}Schema,`);
  }
  lines.push("];");
  lines.push("");
  return lines.join("\n");
}

// ----- Global ML-defaults emission (S26) ------------------------------------
// The ONE learning_rate/max_iterations/min_error default (schemas/ml_defaults.
// json), NOT per-mode — emitted once, alongside schema_types.hpp/types.ts,
// rather than once per mode file like everything else in this module.

const AUTOGEN_BANNER_ML_DEFAULTS = (lang: "C++" | "TS"): string =>
  `// AUTOGENERATED (${lang}) — do not edit. Source: schemas/ml_defaults.json. ` +
  "Run `bun run codegen/generate.ts` to regenerate.";

function emitMlDefaultsHpp(d: MlTrainDefaults): string {
  return [
    AUTOGEN_BANNER_ML_DEFAULTS("C++"),
    "// The ONE global training-hyperparameter default, shared by every mode on",
    "// every platform (firmware/WASM/VCV) — see docs/specs/recon/",
    "// simplification-audit-2026-07.md S26. Consumed by",
    "// nisps::ml::MLPCore::TrainConfig's default member initialisers",
    "// (nisps/ml/mlp.hpp); nisps_ml_set_train_config() and",
    "// nisps::ml::MLPCore::set_train_config() make it runtime-overridable.",
    "#ifndef NISPS_ML_GENERATED_ML_DEFAULTS_HPP",
    "#define NISPS_ML_GENERATED_ML_DEFAULTS_HPP",
    "",
    "#include <cstddef>",
    "",
    "namespace nisps::ml::generated {",
    "",
    "struct MlTrainDefaults {",
    "    float       learning_rate;",
    "    std::size_t max_iterations;",
    "    float       min_error;",
    "};",
    "",
    "inline constexpr MlTrainDefaults kMlTrainDefaults = {",
    `    ${cppFloatLit(d.learning_rate)},`,
    `    ${d.max_iterations}u,`,
    `    ${cppFloatLit(d.min_error)},`,
    "};",
    "",
    "}  // namespace nisps::ml::generated",
    "",
    "#endif  // NISPS_ML_GENERATED_ML_DEFAULTS_HPP",
    "",
  ].join("\n");
}

function emitMlDefaultsTs(d: MlTrainDefaults): string {
  return [
    AUTOGEN_BANNER_ML_DEFAULTS("TS"),
    "// The ONE global training-hyperparameter default, shared by every mode on",
    "// every platform — see docs/specs/recon/simplification-audit-2026-07.md S26.",
    "// Consumed by WasmIML's train()/trainAsync() default parameters and",
    "// EngineApi's learningRate/maxIterations options (manifold/src/engine/).",
    "",
    "export interface MlTrainDefaults {",
    "  readonly learningRate: number;",
    "  readonly maxIterations: number;",
    "  readonly minError: number;",
    "}",
    "",
    "export const ML_TRAIN_DEFAULTS: MlTrainDefaults = {",
    `  learningRate: ${d.learning_rate},`,
    `  maxIterations: ${d.max_iterations},`,
    `  minError: ${d.min_error},`,
    "};",
    "",
  ].join("\n");
}

// ----- Driver --------------------------------------------------------------

function main(): number {
  // 1. Load and compile meta-schema
  if (!existsSync(META_SCHEMA_PATH)) {
    console.error(`error: meta-schema not found at ${META_SCHEMA_PATH}`);
    return 1;
  }
  const metaSchema = readJSON<AnySchemaObject>(META_SCHEMA_PATH);

  // We pass strict:false because the meta-schema uses `_note` fields that aren't
  // in the JSON Schema vocab itself; the meta-schema explicitly allows them via
  // `additionalProperties` rules.
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    allowUnionTypes: true,
  });
  const validate = ajv.compile<ModeSchema>(metaSchema);

  // 1b. Load, compile, and validate the ONE global ML training default
  // (schemas/ml_defaults.json against schemas/ml_defaults.schema.json — S26,
  // NOT per-mode, so it lives outside the modeFiles loop below).
  if (!existsSync(ML_DEFAULTS_SCHEMA_PATH)) {
    console.error(`error: ml-defaults meta-schema not found at ${ML_DEFAULTS_SCHEMA_PATH}`);
    return 1;
  }
  if (!existsSync(ML_DEFAULTS_PATH)) {
    console.error(`error: ml-defaults data not found at ${ML_DEFAULTS_PATH}`);
    return 1;
  }
  const mlDefaultsSchema = readJSON<AnySchemaObject>(ML_DEFAULTS_SCHEMA_PATH);
  const validateMlDefaults = ajv.compile<MlTrainDefaults>(mlDefaultsSchema);
  const mlDefaultsRaw = readJSON<unknown>(ML_DEFAULTS_PATH);
  if (!validateMlDefaults(mlDefaultsRaw)) {
    console.error(`error: ${ML_DEFAULTS_PATH}: schema validation failed:`);
    for (const err of validateMlDefaults.errors ?? []) {
      console.error(`  ${err.instancePath || "<root>"} ${err.message}`);
    }
    return 1;
  }
  const mlDefaults = mlDefaultsRaw as MlTrainDefaults;

  // 2. Discover all mode schemas
  if (!existsSync(MODES_DIR)) {
    console.error(`error: modes directory not found at ${MODES_DIR}`);
    return 1;
  }
  const modeFiles = readdirSync(MODES_DIR)
    .filter(f => f.endsWith(".json"))
    .sort();  // deterministic order

  if (modeFiles.length === 0) {
    console.error(`error: no mode schemas in ${MODES_DIR}`);
    return 1;
  }

  // 3. Validate + parse all
  const schemas: Array<{ source: string; schema: ModeSchema }> = [];
  let errorCount = 0;
  for (const f of modeFiles) {
    const path = join(MODES_DIR, f);
    let raw: unknown;
    try {
      raw = readJSON<unknown>(path);
    } catch (e) {
      console.error(`error: ${f}: parse: ${(e as Error).message}`);
      errorCount++;
      continue;
    }
    if (!validate(raw)) {
      console.error(`error: ${f}: schema validation failed:`);
      for (const err of validate.errors ?? []) {
        console.error(`  ${err.instancePath || "<root>"} ${err.message}`);
      }
      errorCount++;
      continue;
    }
    const schema = raw as ModeSchema;
    // Cross-field consistency checks
    if (schema.params.length !== schema.ml.output_size) {
      console.error(
        `error: ${f}: params.length (${schema.params.length}) != ml.output_size (${schema.ml.output_size})`
      );
      errorCount++;
      continue;
    }
    if (schema.ml.input_channels.length !== schema.ml.input_size) {
      console.error(
        `error: ${f}: ml.input_channels.length (${schema.ml.input_channels.length}) != ml.input_size (${schema.ml.input_size})`
      );
      errorCount++;
      continue;
    }
    // Firmware-fit check (one-core-engine P5): the fixed firmware MLP template
    // is exactly 4 layers (3 hidden); the browser's runtime-shaped MLP caps
    // every dimension at 4096 (bindings kMaxDim).
    if (schema.ml.hidden_layers.length !== 3) {
      console.error(
        `error: ${f}: ml.hidden_layers must have exactly 3 entries ` +
        `(fixed 4-layer topology); got ${schema.ml.hidden_layers.length}`
      );
      errorCount++;
      continue;
    }
    {
      const dims = [schema.ml.input_size, ...schema.ml.hidden_layers, schema.ml.output_size];
      const bad = dims.find(d => d <= 0 || d > 4096);
      if (bad !== undefined) {
        console.error(`error: ${f}: ml dimension ${bad} outside (0, 4096]`);
        errorCount++;
        continue;
      }
    }
    schemas.push({ source: f, schema });
  }
  if (errorCount > 0) {
    console.error(`\n${errorCount} schema(s) failed; aborting codegen.`);
    return 1;
  }

  // 4. Emit C++ outputs
  ensureDir(CPP_OUT_DIR);
  writeFileSync(join(CPP_OUT_DIR, "schema_types.hpp"), emitSchemaTypesHpp());
  ensureDir(CPP_ML_OUT_DIR);
  writeFileSync(join(CPP_ML_OUT_DIR, "ml_defaults.hpp"), emitMlDefaultsHpp(mlDefaults));
  for (const { source, schema } of schemas) {
    const out = join(CPP_OUT_DIR, `${schema.mode_id}_schema.hpp`);
    writeFileSync(out, emitModeHpp(schema, source));
  }

  // 5. Emit TS outputs
  ensureDir(TS_OUT_DIR);
  writeFileSync(join(TS_OUT_DIR, "types.ts"), emitSharedTsTypes());
  writeFileSync(join(TS_OUT_DIR, "ml_defaults.ts"), emitMlDefaultsTs(mlDefaults));
  for (const { source, schema } of schemas) {
    const out = join(TS_OUT_DIR, `${schema.mode_id}_schema.ts`);
    writeFileSync(out, emitModeTs(schema, source));
  }
  writeFileSync(
    join(TS_OUT_DIR, "index.ts"),
    emitTsIndex(schemas.map(s => s.schema.mode_id).sort())
  );

  // 6. Report
  console.log(`OK  ${schemas.length} mode schema(s) processed.`);
  console.log(`    C++ -> ${CPP_OUT_DIR}`);
  console.log(`    TS  -> ${TS_OUT_DIR}`);
  for (const { schema } of schemas) {
    console.log(
      `    - ${schema.mode_id}: ${schema.params.length} params, ` +
        `${schema.voice_spaces.length} voice space(s), ` +
        `MLP ${schema.ml.input_size}->[${schema.ml.hidden_layers.join(",")}]->${schema.ml.output_size}`
    );
  }

  return 0;
}

// Allow `import` without running when used as a library (e.g. for tests).
const isMain = (() => {
  if (typeof process === "undefined") return false;
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return resolve(argv1) === fileURLToPath(import.meta.url);
})();

if (isMain) {
  process.exit(main());
}

export { main };
