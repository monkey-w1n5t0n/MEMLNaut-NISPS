/**
 * curve-audit.ts — mechanically derive, from `nisps/engines/*.hpp` source,
 * which response curve each engine applies to each NN-output slot, per voice
 * space.
 *
 * WHY THIS IS A SOURCE-LEVEL CHECK
 * --------------------------------
 * "The curve" is not observable from engine output. A voice space maps a
 * normalised param into engine state as `base + f(p) * scale` and then that
 * state goes through DSP. Given only audio out you cannot separate `f` from
 * `base`/`scale`/the DSP, and the engines expose no accessor for the mapped
 * state. So the only place the curve exists as a fact is the arithmetic in
 * `apply_*()` / `set_params()` / `process()` — and that is what this module
 * reads.
 *
 * The contract it enforces is deliberately narrow and total:
 *
 *   square  <=> the engine multiplies the param slot by itself
 *   sqrt    <=> the engine passes the param slot through std::sqrt
 *   linear  <=> anything else (including quantisation, sin() combination and
 *               stepped lookup tables — those are not expressible in the
 *               `Curve` enum and are declared `linear` by definition)
 *
 * Everything it cannot reduce is a HARD ERROR, never a silent "linear". That
 * is the property that makes the derived table trustworthy: a new voice space,
 * a new idiom, or a renamed helper trips the check instead of quietly
 * under-reporting. A regex over `p[N] * p[N]` would miss the `const float v =
 * p[…]; v * v` form (verb_fx), the `sq()` implicit-counter lambda
 * (memlcelium), loop-generated indices (verb_fx) and `smooth_params_[N]`
 * (xiasri) — every one of those is live in this codebase today.
 *
 * Consumed by codegen/tests/curve_drift_test.ts, which asserts the schemas'
 * declared curves (params[].curve + per-voice-space overrides) match.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Curve =
  | "linear"
  | "exp"
  | "log"
  | "square"
  | "sqrt"
  | "sigmoid"
  | "cubic";

/** Identifiers that alias the NN-output vector inside an engine. */
const ACCESSORS = ["params", "p", "smooth_params_", "nn_outputs_"] as const;
const ACCESSOR_RE = new RegExp(`\\b(${ACCESSORS.join("|")})\\s*\\[`);

export interface EngineCurves {
  engineId: string;
  file: string;
  nParams: number;
  /** Names from the engine's `kVoiceSpaceNames`, or null when it has none. */
  voiceSpaceNames: string[] | null;
  /** curves[voiceSpaceIndex][paramIndex]. One row when there is no enum. */
  curves: Curve[][];
}

export class CurveAuditError extends Error {}

function fail(where: string, msg: string): never {
  throw new CurveAuditError(`[curve-audit] ${where}: ${msg}`);
}

// ---------------------------------------------------------------------------
// Lexical helpers
// ---------------------------------------------------------------------------

function stripComments(src: string): string {
  // Block comments first, then line comments. No string literals in these
  // files contain `//` or `/*` (checked: the only literals are identifiers).
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Index of the `)`/`}`/`]` matching the opener at `open`. */
function matchBracket(src: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const close = pairs[src[open]!];
  if (!close) fail("matchBracket", `not an opener at ${open}: ${src[open]}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === src[open]) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  fail("matchBracket", `unbalanced ${src[open]} at ${open}`);
}

/** Body text (between braces, exclusive) of `<name>(...) ... { ... }`. */
function functionBody(src: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const argOpen = m.index + m[0].length - 1;
    let argClose: number;
    try {
      argClose = matchBracket(src, argOpen);
    } catch {
      continue;
    }
    // Between `)` and `{` only qualifiers may appear (noexcept, const, ->…).
    const between = src.slice(argClose + 1, src.indexOf("{", argClose) + 1);
    if (!/^[\s\w:&*<>,]*\{$/.test(between)) continue;
    const braceOpen = src.indexOf("{", argClose);
    if (braceOpen < 0) continue;
    return src.slice(braceOpen + 1, matchBracket(src, braceOpen));
  }
  return null;
}

/** Formal parameter names of `<name>(...)`, in order. */
function functionParams(src: string, name: string): string[] | null {
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const argOpen = m.index + m[0].length - 1;
    let argClose: number;
    try {
      argClose = matchBracket(src, argOpen);
    } catch {
      continue;
    }
    const between = src.slice(argClose + 1, src.indexOf("{", argClose) + 1);
    if (!/^[\s\w:&*<>,]*\{$/.test(between)) continue;
    const args = src.slice(argOpen + 1, argClose).trim();
    if (args === "") return [];
    return args.split(",").map((a) => {
      const t = a.trim().replace(/\[\s*\]$/, "");
      const w = t.match(/([A-Za-z_]\w*)\s*$/);
      return w ? w[1]! : t;
    });
  }
  return null;
}

/** Split arguments of a call at top nesting level. */
function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of text) {
    if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
    else if (c === ")" || c === "]" || c === "}" || c === ">") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim() !== "" || out.length > 0) out.push(cur);
  return out.map((s) => s.trim());
}

// ---------------------------------------------------------------------------
// Integer expression evaluation (array indices, loop bounds, ternary guards)
// ---------------------------------------------------------------------------

/**
 * Evaluate a compile-time integer expression. Constants from the engine
 * (`static constexpr std::size_t kX = …`) are substituted first. Anything the
 * strict character whitelist rejects is a hard error — never a guess.
 */
function evalInt(expr: string, consts: Map<string, number>, where: string): number {
  let e = expr;
  for (let pass = 0; pass < 8; pass++) {
    const before = e;
    for (const [k, v] of consts) {
      e = e.replace(new RegExp(`\\b${k}\\b`, "g"), `(${v})`);
    }
    if (e === before) break;
  }
  e = e.replace(/(\d)[uU]\b/g, "$1");
  e = e.replace(/static_cast<[^>]*>/g, "");
  if (!/^[\d\s+\-*/%()]+$/.test(e)) {
    fail(where, `non-constant integer expression ${JSON.stringify(expr)}`);
  }
  // eslint-disable-next-line no-new-func
  const v = Function(`"use strict"; return (${e});`)() as number;
  if (!Number.isInteger(v)) fail(where, `non-integer index ${expr} -> ${v}`);
  return v;
}

/** Evaluate a boolean guard, or null when it is not compile-time constant. */
function evalBool(expr: string, consts: Map<string, number>): boolean | null {
  let e = expr.trim();
  while (e.startsWith("(") && matchBracket(e, 0) === e.length - 1) {
    e = e.slice(1, -1).trim();
  }
  for (let pass = 0; pass < 8; pass++) {
    const before = e;
    for (const [k, v] of consts) e = e.replace(new RegExp(`\\b${k}\\b`, "g"), `(${v})`);
    if (e === before) break;
  }
  e = e.replace(/(\d)[uU]\b/g, "$1");
  if (!/^[\d\s+\-*/%()<>=!&|]+$/.test(e)) return null;
  try {
    // eslint-disable-next-line no-new-func
    return Boolean(Function(`"use strict"; return (${e});`)());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Body normalisation: inline helpers -> unroll loops -> flatten braces
// ---------------------------------------------------------------------------

interface EngineFile {
  src: string;
  path: string;
  consts: Map<string, number>;
  /** member name -> std::array element count, for range-for unrolling. */
  arrayLens: Map<string, number>;
}

function loadEngine(path: string): EngineFile {
  const src = stripComments(readFileSync(path, "utf8"));
  const consts = new Map<string, number>();
  // `static constexpr std::size_t kFoo = <expr>;` — resolved in declaration
  // order so later constants may refer to earlier ones.
  const cre = /static\s+constexpr\s+std::size_t\s+(\w+)\s*=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = cre.exec(src))) {
    try {
      consts.set(m[1]!, evalInt(m[2]!, consts, path));
    } catch {
      /* not an integer constant we can use; ignore */
    }
  }
  const arrayLens = new Map<string, number>();
  const are = /std::array\s*<\s*[^,<>]+(?:<[^>]*>)?\s*,\s*([^>]+)>\s*(\w+)/g;
  while ((m = are.exec(src))) {
    try {
      arrayLens.set(m[2]!, evalInt(m[1]!, consts, path));
    } catch {
      /* dynamic length; ignore */
    }
  }
  return { src, path, consts, arrayLens };
}

/**
 * Replace `name(args);` statements whose `name` is a method defined in the
 * same file with that method's body, substituting formals for actuals.
 */
const KEYWORD_CALLS = new Set(["if", "for", "while", "switch", "return", "sizeof", "static_cast"]);

/** Locate the next bare `name(args);` statement whose `name` is defined here. */
function findInlinableCall(
  body: string,
  eng: EngineFile,
  from: number
): { start: number; end: number; name: string; args: string } | null {
  const callRe = /(?:^|[;{}])\s*([a-z_]\w*)\s*\(/g;
  callRe.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(body))) {
    const name = m[1]!;
    callRe.lastIndex = m.index + m[0].length - 1;
    if (KEYWORD_CALLS.has(name)) continue;
    const open = m.index + m[0].length - 1;
    let close: number;
    try {
      close = matchBracket(body, open);
    } catch {
      continue;
    }
    const rest = body.slice(close + 1);
    if (rest.trimStart()[0] !== ";") continue;
    if (functionBody(eng.src, name) === null) continue;
    const semi = body.indexOf(";", close);
    return { start: m.index + (/[;{}]/.test(m[0][0]!) ? 1 : 0), end: semi + 1, name, args: body.slice(open + 1, close) };
  }
  return null;
}

function inlineCalls(body: string, eng: EngineFile, seen: Set<string>, where: string): string {
  let text = body;
  for (let guard = 0; guard < 256; guard++) {
    const hit = findInlinableCall(text, eng, 0);
    if (!hit) return text;
    if (seen.has(hit.name)) fail(where, `recursive inline of ${hit.name}()`);
    const callee = functionBody(eng.src, hit.name)!;
    const formals = functionParams(eng.src, hit.name) ?? [];
    const actuals = splitArgs(hit.args);
    let inner = inlineCalls(callee, eng, new Set([...seen, hit.name]), `${where}>${hit.name}`);
    formals.forEach((f, i) => {
      const a = actuals[i];
      if (a === undefined || f === a) return;
      inner = inner.replace(new RegExp(`\\b${f}\\b`, "g"), `(${a})`);
    });
    text = text.slice(0, hit.start) + ` { ${inner} } ` + text.slice(hit.end);
  }
  fail(where, "helper inlining did not converge");
}

/** Unroll `for` loops with compile-time trip counts, brace-stripping bodies. */
function unrollLoops(body: string, eng: EngineFile, where: string): string {
  let text = body;
  for (let pass = 0; pass < 64; pass++) {
    const idx = text.search(/\bfor\s*\(/);
    if (idx < 0) return text;
    const open = text.indexOf("(", idx);
    const close = matchBracket(text, open);
    const header = text.slice(open + 1, close);

    // Body: either a braced block or a single statement.
    let bodyStart = close + 1;
    while (/\s/.test(text[bodyStart] ?? "")) bodyStart++;
    let inner: string;
    let bodyEnd: number;
    if (text[bodyStart] === "{") {
      const b = matchBracket(text, bodyStart);
      inner = text.slice(bodyStart + 1, b);
      bodyEnd = b + 1;
    } else {
      const semi = text.indexOf(";", bodyStart);
      if (semi < 0) fail(where, "for-loop body has no terminator");
      inner = text.slice(bodyStart, semi + 1);
      bodyEnd = semi + 1;
    }

    let expansion = "";
    const counted = header.match(
      /^\s*(?:std::size_t|int|std::uint\d+_t|auto)\s+(\w+)\s*=\s*([^;]+);\s*\1\s*<\s*([^;]+);\s*\+\+\1\s*$/
    );
    const ranged = header.match(/^\s*(?:const\s+)?auto\s*[&*]?\s*\w+\s*:\s*(\w+)\s*$/);
    if (counted) {
      const v = counted[1]!;
      const lo = evalInt(counted[2]!, eng.consts, where);
      const hi = evalInt(counted[3]!, eng.consts, where);
      for (let i = lo; i < hi; i++) {
        expansion += ` ${inner.replace(new RegExp(`\\b${v}\\b`, "g"), `(${i})`)} `;
      }
    } else if (ranged) {
      const n = eng.arrayLens.get(ranged[1]!);
      if (n === undefined) fail(where, `range-for over ${ranged[1]} with unknown length`);
      for (let i = 0; i < n; i++) expansion += ` ${inner} `;
    } else {
      fail(where, `unrecognised for-loop header ${JSON.stringify(header.trim())}`);
    }
    text = text.slice(0, idx) + expansion + text.slice(bodyEnd);
  }
  fail(where, "for-loop unrolling did not converge");
}

/**
 * Remove `switch (voice_space_) { … }` — each voice space is analysed against
 * its own dispatch target, so keeping the switch would merge all of them.
 * Any OTHER switch is deliberately left in place: brace-flattening turns its
 * arms into straight-line statements, and if two arms disagree about a param's
 * curve that surfaces as a conflict rather than a silent pick.
 */
function dropVoiceSpaceSwitch(body: string, where: string): string {
  let text = body;
  for (;;) {
    const m = text.match(/\bswitch\s*\(\s*voice_space_\s*\)/);
    if (!m || m.index === undefined) return text;
    const open = text.indexOf("(", m.index);
    const close = matchBracket(text, open);
    let braceOpen = close + 1;
    while (/\s/.test(text[braceOpen] ?? "")) braceOpen++;
    if (text[braceOpen] !== "{") fail(where, "switch (voice_space_) without a block");
    text = text.slice(0, m.index) + " " + text.slice(matchBracket(text, braceOpen) + 1);
  }
}

/**
 * Extract `auto NAME = [&]() { const float X = params[i++]; return EXPR; };`
 * lambdas (memlcelium's `sq()`), returning the curve each application yields.
 * Any other lambda shape is a hard error.
 */
function extractCounterLambdas(body: string, where: string): { text: string; lambdas: Map<string, Curve> } {
  const lambdas = new Map<string, Curve>();
  let text = body;
  for (;;) {
    const m = text.match(/\bauto\s+(\w+)\s*=\s*\[[^\]]*\]\s*\(/);
    if (!m || m.index === undefined) return { text, lambdas };
    const name = m[1]!;
    const parenOpen = text.indexOf("(", m.index + m[0].length - 1);
    const parenClose = matchBracket(text, parenOpen);
    let braceOpen = parenClose + 1;
    while (/\s/.test(text[braceOpen] ?? "")) braceOpen++;
    if (text[braceOpen] !== "{") fail(where, `lambda ${name} without a body`);
    const braceClose = matchBracket(text, braceOpen);
    const inner = text.slice(braceOpen + 1, braceClose).trim();
    const shape = inner.match(
      /^const\s+float\s+(\w+)\s*=\s*params\s*\[\s*i\+\+\s*\]\s*;\s*return\s+([^;]+);$/
    );
    if (!shape) {
      fail(where, `lambda ${name} has an unrecognised body: ${JSON.stringify(inner)}`);
    }
    const v = shape[1]!;
    const ret = shape[2]!.replace(/\s+/g, " ").trim();
    let curve: Curve;
    if (ret === `${v} * ${v}`) curve = "square";
    else if (ret === `std::sqrt(${v})`) curve = "sqrt";
    else if (ret === v) curve = "linear";
    else fail(where, `lambda ${name} returns an unrecognised form: ${JSON.stringify(ret)}`);
    lambdas.set(name, curve);
    let end = braceClose + 1;
    while (/[\s;]/.test(text[end] ?? "")) end++;
    text = text.slice(0, m.index) + " " + text.slice(end);
  }
}

/** Strip every remaining brace; loops are unrolled and switches dropped by now. */
function flattenBraces(text: string): string {
  return text.replace(/[{}]/g, " ");
}

function splitStatements(text: string): string[] {
  return text
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s !== "");
}

// ---------------------------------------------------------------------------
// Ternary reduction + accessor classification
// ---------------------------------------------------------------------------

/** Collapse `cond ? a : b` where `cond` is compile-time constant. */
function reduceTernaries(stmt: string, consts: Map<string, number>): string {
  let text = stmt;
  for (let pass = 0; pass < 32; pass++) {
    // Innermost `?` first: the one with no further `?` before its `:`.
    const q = text.lastIndexOf("?");
    if (q < 0) return text;
    // Condition: scan left to the nearest unbalanced `(`, or `=`/`,`/start.
    let depth = 0;
    let condStart = 0;
    for (let i = q - 1; i >= 0; i--) {
      const c = text[i]!;
      if (c === ")" || c === "]") depth++;
      else if (c === "(" || c === "[") {
        if (depth === 0) {
          condStart = i + 1;
          break;
        }
        depth--;
      } else if (depth === 0 && (c === "=" || c === ",")) {
        condStart = i + 1;
        break;
      }
    }
    // Matching `:` at the same nesting depth.
    depth = 0;
    let colon = -1;
    for (let i = q + 1; i < text.length; i++) {
      const c = text[i]!;
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") {
        if (depth === 0) break;
        depth--;
      } else if (c === ":" && depth === 0 && text[i + 1] !== ":" && text[i - 1] !== ":") {
        colon = i;
        break;
      }
    }
    if (colon < 0) return text;
    // End of the false branch: unbalanced `)`/`]`/`,` or end of statement.
    depth = 0;
    let end = text.length;
    for (let i = colon + 1; i < text.length; i++) {
      const c = text[i]!;
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") {
        if (depth === 0) {
          end = i;
          break;
        }
        depth--;
      } else if (c === "," && depth === 0) {
        end = i;
        break;
      }
    }
    const cond = text.slice(condStart, q);
    const t = text.slice(q + 1, colon);
    const f = text.slice(colon + 1, end);
    const v = evalBool(cond, consts);
    // When the guard is not constant, keep BOTH branches: an accessor that is
    // squared in one and sqrt'd in the other then surfaces as a conflict.
    const repl = v === null ? `( ${cond} ) * ( ${t} ) * ( ${f} )` : v ? `( ${t} )` : `( ${f} )`;
    text = text.slice(0, condStart) + repl + text.slice(end);
  }
  return text;
}

/** Operand immediately to the left of `at` (balanced group, or a bare term). */
function leftOperand(text: string, at: number): { start: number; text: string } | null {
  let i = at - 1;
  while (i >= 0 && /\s/.test(text[i]!)) i--;
  if (i < 0) return null;
  if (text[i] === ")" || text[i] === "]") {
    // Walk back over the balanced group, then over any leading identifier
    // (so `p[3]` and `std::sqrt(x)` come back whole).
    let depth = 0;
    let j = i;
    const open = text[i] === ")" ? "(" : "[";
    for (; j >= 0; j--) {
      if (text[j] === text[i]) depth++;
      else if (text[j] === open) {
        depth--;
        if (depth === 0) break;
      }
    }
    if (j < 0) return null;
    let k = j - 1;
    while (k >= 0 && /[\w:]/.test(text[k]!)) k--;
    return { start: k + 1, text: text.slice(k + 1, i + 1) };
  }
  let j = i;
  while (j >= 0 && /[\w.:]/.test(text[j]!)) j--;
  if (j === i) return null;
  return { start: j + 1, text: text.slice(j + 1, i + 1) };
}

/** Operand immediately to the right of `at`. */
function rightOperand(text: string, at: number): { end: number; text: string } | null {
  let i = at + 1;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  if (i >= text.length) return null;
  let j = i;
  while (j < text.length && /[\w:]/.test(text[j]!)) j++;
  if (j < text.length && (text[j] === "(" || text[j] === "[")) {
    const close = matchBracket(text, j);
    return { end: close + 1, text: text.slice(i, close + 1) };
  }
  if (j === i) return null;
  return { end: j, text: text.slice(i, j) };
}

/** True when `text` is exactly one param-slot read, modulo parens/whitespace. */
function isBareAccessor(text: string): boolean {
  let t = text.trim();
  while (t.startsWith("(") && matchBracket(t, 0) === t.length - 1) t = t.slice(1, -1).trim();
  const m = t.match(new RegExp(`^(?:${ACCESSORS.join("|")})\\s*\\[`));
  if (!m) return false;
  return matchBracket(t, t.indexOf("[")) === t.length - 1;
}

/** Every accessor index appearing in `text`. */
function accessorIndices(text: string, consts: Map<string, number>, where: string): number[] {
  const out: number[] = [];
  const re = new RegExp(`\\b(${ACCESSORS.join("|")})\\s*\\[`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(text, open);
    out.push(evalInt(text.slice(open + 1, close), consts, where));
    re.lastIndex = close;
  }
  return out;
}

/**
 * Classify every accessor occurrence in one expression.
 *
 * `sqrt` is recognised as `std::sqrt(<expr containing exactly the accessors>)`;
 * `square` as `X * X` for textually identical operands containing accessors.
 * Recognised occurrences are blanked so they are not re-counted as linear.
 */
function classifyExpr(expr: string, consts: Map<string, number>, where: string): Map<number, Curve> {
  const found = new Map<number, Curve>();
  const note = (idx: number, c: Curve) => {
    const prev = found.get(idx);
    if (prev !== undefined && prev !== c) {
      fail(where, `param ${idx} is both ${prev} and ${c} in one expression: ${expr}`);
    }
    found.set(idx, c);
  };
  let text = expr;

  // 1. std::sqrt(...)
  for (;;) {
    const m = text.match(/\bstd::sqrt\s*\(/);
    if (!m || m.index === undefined) break;
    const open = text.indexOf("(", m.index);
    const close = matchBracket(text, open);
    const inner = text.slice(open + 1, close);
    const idxs = accessorIndices(inner, consts, where);
    if (idxs.length > 0) {
      // A sqrt over a compound expression is not a per-param sqrt curve — the
      // same reasoning as the self-product rule below. None exists today, so
      // this is a hard error rather than a silent demotion; if one ever
      // appears the author must decide what the declaration should say.
      if (!isBareAccessor(inner)) fail(where, `std::sqrt over a compound expression: ${inner}`);
      note(idxs[0]!, "sqrt");
      text = text.slice(0, m.index) + " __X__ " + text.slice(close + 1);
    } else {
      text = text.slice(0, m.index) + " __X__ " + text.slice(close + 1);
    }
  }

  // 2. X * X, where X is one bare param slot (possibly parenthesised because
  //    it arrived via an alias). A self-product over a COMPOUND expression —
  //    e.g. paf_synth Elderstar's `factor * factor` where
  //    `factor = 1.f + (p[17] + p[27] * 0.2f)` — is deliberately NOT a
  //    per-param square: no single slot is multiplied by itself, and the
  //    `Curve` enum has no way to say "this slot is one term inside a squared
  //    sum". Those slots fall through to `linear`, which is what the schemas
  //    declare. The rule is explicit, not a silent fallback.
  for (let from = 0; ; ) {
    let hit = false;
    for (let i = from; i < text.length; i++) {
      if (text[i] !== "*") continue;
      const l = leftOperand(text, i);
      const r = rightOperand(text, i);
      if (!l || !r) continue;
      if (l.text.replace(/\s+/g, "") !== r.text.replace(/\s+/g, "")) continue;
      const idxs = accessorIndices(l.text, consts, where);
      if (idxs.length === 0) continue;
      if (idxs.length !== 1 || !isBareAccessor(l.text)) {
        from = i + 1;
        hit = true;
        break;
      }
      note(idxs[0]!, "square");
      text = text.slice(0, l.start) + " __X__ " + text.slice(r.end);
      from = 0;
      hit = true;
      break;
    }
    if (!hit) break;
  }

  // 3. anything left is linear
  for (const idx of accessorIndices(text, consts, where)) note(idx, "linear");
  return found;
}

// ---------------------------------------------------------------------------
// Body analysis
// ---------------------------------------------------------------------------

interface Analysis {
  /** assignment target -> curves contributed by the latest write to it. */
  targets: Map<string, Map<number, Curve>>;
}

const ALIAS_DECL = /^(?:static\s+)?const\s+(?:float|std::size_t|int|auto)\s+(\w+)\s*=\s*(.*)$/;
const COUNTER_DECL = /^(?:std::size_t|int)\s+(\w+)\s*=\s*(\d+)u?$/;

function analyseBody(
  rawBody: string,
  eng: EngineFile,
  where: string,
  state: Analysis,
  stmtSeq: { n: number }
): void {
  let text = inlineCalls(rawBody, eng, new Set(), where);
  text = dropVoiceSpaceSwitch(text, where);
  text = unrollLoops(text, eng, where);
  const { text: noLambda, lambdas } = extractCounterLambdas(text, where);
  text = flattenBraces(noLambda);

  const aliases = new Map<string, { rhs: string; used: boolean }>();
  let counterName: string | null = null;
  let counter = 0;

  for (const rawStmt of splitStatements(text)) {
    let stmt = rawStmt;

    // Sequential dialect: `params[i++]` and counter lambdas consume the next
    // slot, left to right, and are rewritten into the ordinary indexed form.
    if (counterName !== null) {
      const seqRe = new RegExp(
        `params\\s*\\[\\s*${counterName}\\+\\+\\s*\\]|\\b(${[...lambdas.keys()].join("|") || "\\u0000"})\\s*\\(\\s*\\)`,
        "g"
      );
      stmt = stmt.replace(seqRe, (whole, lam?: string) => {
        const idx = counter++;
        if (lam) {
          const c = lambdas.get(lam)!;
          if (c === "square") return `params[${idx}] * params[${idx}]`;
          if (c === "sqrt") return `std::sqrt(params[${idx}])`;
          return `params[${idx}]`;
        }
        return `params[${idx}]`;
      });
    }
    if (/\+\+\s*\]/.test(stmt)) {
      fail(where, `post-increment index with no active counter: ${stmt}`);
    }

    const counterM = stmt.match(COUNTER_DECL);
    if (counterM && !ACCESSOR_RE.test(stmt)) {
      counterName = counterM[1]!;
      counter = Number(counterM[2]!);
      continue;
    }

    // Substitute live aliases (longest name first so `p1v` beats `p`).
    for (const [name, a] of [...aliases].sort((x, y) => y[0].length - x[0].length)) {
      const re = new RegExp(`\\b${name}\\b`, "g");
      if (re.test(stmt)) {
        // Not a use if this statement redeclares it.
        const decl = stmt.match(ALIAS_DECL);
        if (decl && decl[1] === name && !new RegExp(`\\b${name}\\b`).test(decl[2]!)) continue;
        stmt = stmt.replace(re, `(${a.rhs})`);
        a.used = true;
      }
    }

    const aliasM = stmt.match(ALIAS_DECL);
    if (aliasM) {
      const name = aliasM[1]!;
      const prev = aliases.get(name);
      if (prev && !prev.used && ACCESSOR_RE.test(prev.rhs)) {
        fail(where, `alias ${name} carrying a param was shadowed before use`);
      }
      aliases.set(name, { rhs: aliasM[2]!, used: false });
      continue;
    }

    if (!ACCESSOR_RE.test(stmt)) continue;

    const reduced = reduceTernaries(stmt, eng.consts);
    const eq = topLevelAssign(reduced);
    if (eq === null) {
      // A call statement or return: unique key, never overwritten.
      state.targets.set(`${where}#${stmtSeq.n++}`, classifyExpr(reduced, eng.consts, where));
      continue;
    }
    const lhs = reduced.slice(0, eq).trim();
    const rhs = reduced.slice(eq + 1);
    // Pure copy between two aliases of the NN vector carries no curve.
    if (isPureCopy(lhs, rhs, eng.consts, where)) continue;
    if (ACCESSOR_RE.test(lhs)) {
      fail(where, `assignment INTO the param vector with arithmetic: ${reduced}`);
    }
    state.targets.set(lhs.replace(/^(?:const\s+)?(?:float|auto)\s+/, ""), classifyExpr(rhs, eng.consts, where));
  }

  for (const [name, a] of aliases) {
    if (!a.used && ACCESSOR_RE.test(a.rhs)) {
      fail(where, `alias ${name} carrying a param was never used`);
    }
  }
}

/** Index of a top-level `=` that is an assignment (not ==, +=, <=, …). */
function topLevelAssign(stmt: string): number | null {
  let depth = 0;
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt[i]!;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "=" && depth === 0) {
      if (stmt[i + 1] === "=") return null;
      if ("=!<>+-*/&|%".includes(stmt[i - 1] ?? "")) return null;
      return i;
    }
  }
  return null;
}

function isPureCopy(lhs: string, rhs: string, consts: Map<string, number>, where: string): boolean {
  const l = lhs.trim();
  const r = rhs.trim();
  if (!ACCESSOR_RE.test(l) || !ACCESSOR_RE.test(r)) return false;
  const li = accessorIndices(l, consts, where);
  const ri = accessorIndices(r, consts, where);
  if (li.length !== 1 || ri.length !== 1 || li[0] !== ri[0]) return false;
  // RHS must be nothing but the accessor.
  return new RegExp(`^(?:${ACCESSORS.join("|")})\\s*\\[[^\\]]*\\]$`).test(r);
}

// ---------------------------------------------------------------------------
// Engine-level extraction
// ---------------------------------------------------------------------------

function parseVoiceSpaces(eng: EngineFile): { enumNames: string[]; displayNames: string[] } | null {
  const em = eng.src.match(/enum\s+class\s+VoiceSpace\s*:[^{]*\{/);
  if (!em || em.index === undefined) return null;
  const open = eng.src.indexOf("{", em.index);
  const inner = eng.src.slice(open + 1, matchBracket(eng.src, open));
  const enumNames = inner
    .split(",")
    .map((s) => s.split("=")[0]!.trim())
    .filter((s) => s !== "" && s !== "Count");
  const nm = eng.src.match(/kVoiceSpaceNames\s*=\s*\{/);
  if (!nm || nm.index === undefined) fail(eng.path, "VoiceSpace enum without kVoiceSpaceNames");
  const nOpen = eng.src.indexOf("{", nm.index);
  const nInner = eng.src.slice(nOpen + 1, matchBracket(eng.src, nOpen));
  const displayNames = [...nInner.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
  if (displayNames.length !== enumNames.length) {
    fail(eng.path, `VoiceSpace enum has ${enumNames.length} entries but kVoiceSpaceNames has ${displayNames.length}`);
  }
  return { enumNames, displayNames };
}

/** enum name -> the `apply_*` function the dispatch switch routes it to. */
function parseDispatch(eng: EngineFile, enumNames: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const re = /case\s+VoiceSpace::(\w+)\s*:\s*(?:\{\s*)?(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(eng.src))) {
    if (m[1] === "Count") continue;
    out.set(m[1]!, m[2]!);
  }
  for (const n of enumNames) {
    if (!out.has(n)) fail(eng.path, `VoiceSpace::${n} has no dispatch case`);
  }
  return out;
}

function collectCurves(state: Analysis, nParams: number, where: string): Curve[] {
  const merged = new Map<number, Curve>();
  for (const contrib of state.targets.values()) {
    for (const [idx, c] of contrib) {
      if (idx < 0 || idx >= nParams) fail(where, `param index ${idx} out of range (0..${nParams - 1})`);
      const prev = merged.get(idx);
      if (prev !== undefined && prev !== c) {
        fail(where, `param ${idx} is mapped both ${prev} and ${c} within one voice space`);
      }
      merged.set(idx, c);
    }
  }
  const row: Curve[] = new Array(nParams).fill("linear");
  for (const [idx, c] of merged) row[idx] = c;
  return row;
}

export function auditEngine(path: string): EngineCurves {
  const eng = loadEngine(path);
  const idm = eng.src.match(/engine_id\(\)\s*noexcept\s*\{\s*return\s*"([^"]+)"/);
  if (!idm) fail(path, "no engine_id()");
  const engineId = idm[1]!;
  const nParams = eng.consts.get("kNParams") ?? 0;

  const vs = parseVoiceSpaces(eng);
  const setParams = functionBody(eng.src, "set_params");
  const process = functionBody(eng.src, "process");

  if (nParams === 0) {
    return { engineId, file: path, nParams: 0, voiceSpaceNames: null, curves: [[]] };
  }

  if (vs === null) {
    const state: Analysis = { targets: new Map() };
    const seq = { n: 0 };
    if (setParams) analyseBody(setParams, eng, `${engineId}:set_params`, state, seq);
    if (process) analyseBody(process, eng, `${engineId}:process`, state, seq);
    return {
      engineId,
      file: path,
      nParams,
      voiceSpaceNames: null,
      curves: [collectCurves(state, nParams, engineId)],
    };
  }

  const dispatch = parseDispatch(eng, vs.enumNames);
  const curves: Curve[][] = [];
  for (const name of vs.enumNames) {
    const fn = dispatch.get(name)!;
    const body = functionBody(eng.src, fn);
    if (body === null) fail(path, `dispatch target ${fn}() has no body`);
    const state: Analysis = { targets: new Map() };
    const seq = { n: 0 };
    const where = `${engineId}:${name}`;
    if (setParams) analyseBody(setParams, eng, `${where}/set_params`, state, seq);
    analyseBody(body, eng, where, state, seq);
    curves.push(collectCurves(state, nParams, where));
  }
  return { engineId, file: path, nParams, voiceSpaceNames: vs.displayNames, curves };
}

export function auditAllEngines(enginesDir: string): Map<string, EngineCurves> {
  const out = new Map<string, EngineCurves>();
  for (const f of readdirSync(enginesDir).filter((f) => f.endsWith(".hpp")).sort()) {
    const res = auditEngine(join(enginesDir, f));
    if (out.has(res.engineId)) fail(enginesDir, `duplicate engine_id ${res.engineId}`);
    out.set(res.engineId, res);
  }
  return out;
}
