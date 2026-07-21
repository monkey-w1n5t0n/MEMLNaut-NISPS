/**
 * Shared helpers for the two codegen drivers (generate.ts — mode schemas —
 * and generate-midi-devices.ts — MIDI device templates).
 *
 * The two drivers stay separate FILES on purpose: they read different schema
 * directories, validate against different meta-schemas, write to different
 * output dirs, and generate.ts's golden test (codegen/tests/golden_test.ts)
 * must not depend on MIDI-device schema state. None of that requires
 * duplicating these small string/fs helpers — they carry no per-driver
 * behaviour, so they live here once (ST12, simplification 2026-07).
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";

/** Create a directory (and parents) if it doesn't already exist. */
export function ensureDir(d: string): void {
  if (!existsSync(d)) {
    mkdirSync(d, { recursive: true });
  }
}

/** Read and JSON-parse a file. */
export function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Convert snake_case to PascalCase.
 * "paf_synth" -> "PafSynth", "memlcelium" -> "Memlcelium"
 */
export function toPascalCase(snake: string): string {
  return snake
    .split("_")
    .map(s => (s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)))
    .join("");
}

/**
 * Escape a string literal for embedding into a C++ string.
 * We expect ASCII identifiers + label text only; quote and backslash are escaped.
 */
export function cppStringLit(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * Escape a string for a TS single-line single-quoted literal.
 */
export function tsStringLit(s: string): string {
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}
