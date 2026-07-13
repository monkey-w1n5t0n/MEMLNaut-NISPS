#!/usr/bin/env bun
/**
 * Golden test: re-runs codegen and asserts that the freshly-generated
 * paf_synth_schema.hpp is byte-identical to the snapshot in
 * codegen/tests/golden/.
 *
 * (The TS golden case was removed with the playground target at P1 of
 * docs/specs/plans/one-core-engine-refactor.md; it returns in P5 against
 * manifold/src/modes/generated/. The golden/paf_synth_schema.ts snapshot is
 * kept as the P5 template reference.)
 *
 * If you change the codegen template intentionally, regenerate the goldens:
 *   bun run generate.ts
 *   cp ../nisps/modes/generated/paf_synth_schema.hpp tests/golden/
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main as runGenerate } from "../generate.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const GOLDEN_DIR = join(__dirname, "golden");

interface Case {
  name: string;
  generatedPath: string;
  goldenPath: string;
}

const CASES: Case[] = [
  {
    name: "paf_synth_schema.hpp",
    generatedPath: join(REPO_ROOT, "nisps", "modes", "generated", "paf_synth_schema.hpp"),
    goldenPath: join(GOLDEN_DIR, "paf_synth_schema.hpp"),
  },
];

function diff(name: string, expected: string, actual: string): string {
  const e = expected.split("\n");
  const a = actual.split("\n");
  const out: string[] = [];
  out.push(`mismatch in ${name}:`);
  const maxLen = Math.max(e.length, a.length);
  let mismatches = 0;
  for (let i = 0; i < maxLen; i++) {
    if (e[i] !== a[i]) {
      mismatches++;
      if (mismatches <= 10) {
        out.push(`  L${i + 1}:`);
        out.push(`    expected: ${JSON.stringify(e[i] ?? "<EOF>")}`);
        out.push(`    actual  : ${JSON.stringify(a[i] ?? "<EOF>")}`);
      }
    }
  }
  if (mismatches > 10) {
    out.push(`  ... and ${mismatches - 10} more line mismatches`);
  }
  return out.join("\n");
}

function run(): number {
  console.log("running codegen…");
  const code = runGenerate();
  if (code !== 0) {
    console.error(`codegen exited ${code}; aborting golden test`);
    return code;
  }

  let failed = 0;
  for (const c of CASES) {
    if (!existsSync(c.goldenPath)) {
      console.error(`MISSING golden file: ${c.goldenPath}`);
      failed++;
      continue;
    }
    if (!existsSync(c.generatedPath)) {
      console.error(`MISSING generated file: ${c.generatedPath}`);
      failed++;
      continue;
    }
    const expected = readFileSync(c.goldenPath, "utf8");
    const actual = readFileSync(c.generatedPath, "utf8");
    if (expected !== actual) {
      console.error(diff(c.name, expected, actual));
      failed++;
    } else {
      console.log(`  ok ${c.name}`);
    }
  }

  // Idempotency check: re-run codegen, files must still match goldens.
  console.log("re-running codegen for idempotency check…");
  const code2 = runGenerate();
  if (code2 !== 0) {
    console.error(`second codegen run exited ${code2}; aborting`);
    return code2;
  }
  for (const c of CASES) {
    if (!existsSync(c.goldenPath) || !existsSync(c.generatedPath)) continue;
    const expected = readFileSync(c.goldenPath, "utf8");
    const actual = readFileSync(c.generatedPath, "utf8");
    if (expected !== actual) {
      console.error(`idempotency: ${c.name} drifted on second run`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} golden test(s) failed.`);
    return 1;
  }
  console.log("\nall golden tests passed.");
  return 0;
}

process.exit(run());
