#!/usr/bin/env bash
# scripts/lint-cpp.sh — repository-local lint pass for nisps/.
#
# Three checks, each reported but with different severity:
#
#   1. WARN: float literals without `.f` suffix in nisps/**/*.hpp.
#      Skipped: comments, string literals, template arg pack expansions like
#      `<2u, 10u, 14u>` (those are unsigned, not floats).
#      Skipped: hex floats (which use `0x...p...`), since the `.f` rule only
#      applies to decimal literals consumed at runtime.
#      Warns; non-zero only if NISPS_LINT_STRICT=1.
#
#   2. FAIL: heap allocation primitives in audio paths (nisps/dsp/, nisps/engines/,
#      nisps/ml/, nisps/modes/). Forbidden patterns:
#        - std::vector
#        - bare `new ` / `new(`
#        - malloc(
#      Files matching */tests/* are exempt — they are host-only.
#      SOLE allowlisted file: nisps/ml/dynamic_storage.hpp — the runtime-shaped
#      MLP storage (one arena allocation at construction). It is compile-time
#      excluded from RP2350 builds (#error under NISPS_TARGET_EMBEDDED); a
#      companion check below FAILS if that guard ever disappears, so heap can
#      not leak into firmware through the allowlist.
#
#   3. FAIL: `#include <Arduino.h>` anywhere under nisps/. The C++ core MUST
#      NOT pull in Arduino headers — those break the WASM build.
#
# Exits 0 on no failures, 1 on any FAIL, 2 on script error.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NISPS_DIR="$ROOT/nisps"
STRICT="${NISPS_LINT_STRICT:-0}"

if [[ ! -d "$NISPS_DIR" ]]; then
    echo "[lint-cpp] $NISPS_DIR not found" >&2
    exit 2
fi

warns=0
fails=0

# ---------------------------------------------------------------------------
# 1. Float-literal `.f` audit — warn-only by default.
# ---------------------------------------------------------------------------
# A "float literal" we care about: a decimal number with a fractional part or
# exponent, NOT followed by 'f' or 'F', not part of a wider identifier or
# template arg. Examples we want to flag:
#   `1.0`        ← bad
#   `0.5`        ← bad (very common; would write `0.5f`)
#   `1e3`        ← bad
#   `2.5e-3`     ← bad
# Examples we DON'T want to flag:
#   `0.5f` `1.0F`     ← already correct
#   `0u` `100u`        ← integer
#   `0x1.0p3f`         ← hex float, already has suffix
#   `// rate = 0.5`    ← in a comment
#   `Layer<2u, 10u>`   ← integer template args
#
# Strategy: grep for the regex, then post-filter false positives.

audit_float_suffix() {
    local hits
    # Find all .hpp files (skip tests/ and wasm/ directories).
    mapfile -t files < <(find "$NISPS_DIR" -type f -name '*.hpp' \
        -not -path '*/tests/*' \
        -not -path '*/wasm/*' \
        -not -path '*/build/*')
    if [[ ${#files[@]} -eq 0 ]]; then return; fi

    # Use perl for the regex magic — bash + grep can't easily do the
    # negative-lookbehind / lookahead we need. We process one file at a
    # time so `$.` is per-file, not cumulative across the file list.
    hits=""
    for file in "${files[@]}"; do
        local file_hits
        file_hits=$(perl -ne '
            my $line = $_;
            $line =~ s{//.*$}{};       # strip line comments
            $line =~ s{"(?:[^"\\]|\\.)*"}{""}g;  # strip string literals
            while ($line =~ m{
                (?<![A-Za-z0-9_\.])
                (
                    (?: \d+ \. \d+ )
                  | (?: \. \d+ )
                  | (?: \d+ \. (?!\d) )
                  | (?: \d+ [eE] [+-]? \d+ )
                )
                (?! [fFlL] )
                (?! [A-Za-z0-9_\.] )
            }xg) {
                my $match = $1;
                if ($match =~ /[.eE]/) {
                    print "$ARGV:$.: $match\n";
                }
            }
        ' "$file" 2>/dev/null || true)
        if [[ -n "$file_hits" ]]; then
            hits+="$file_hits"$'\n'
        fi
    done
    hits="${hits%$'\n'}"

    if [[ -n "$hits" ]]; then
        local count
        count=$(echo "$hits" | wc -l)
        echo "[lint-cpp] WARN: $count float literal(s) without .f suffix:"
        echo "$hits" | head -20 | sed 's/^/  /'
        if [[ $count -gt 20 ]]; then
            echo "  ... and $((count - 20)) more"
        fi
        warns=$((warns + count))
    fi
}

# ---------------------------------------------------------------------------
# 2. Heap-alloc audit — fail.
# ---------------------------------------------------------------------------
audit_heap_alloc() {
    local subdirs=("$NISPS_DIR/dsp" "$NISPS_DIR/engines" "$NISPS_DIR/ml" "$NISPS_DIR/modes")
    local pat='\bstd::vector\b|\bnew[ \t]*\(|\bnew[ \t]+[A-Za-z_]|\bmalloc[ \t]*\('
    local hits
    hits=$(grep -REn "$pat" \
        --include='*.hpp' --include='*.cpp' \
        --exclude-dir=build --exclude-dir=tests \
        --exclude='dynamic_storage.hpp' \
        "${subdirs[@]}" 2>/dev/null \
        | grep -v ' *//' \
        || true)
    if [[ -n "$hits" ]]; then
        echo "[lint-cpp] FAIL: heap allocation in audio path:"
        echo "$hits" | sed 's/^/  /'
        fails=$((fails + 1))
    fi

    # The allowlist above is only sound while dynamic_storage.hpp is
    # structurally excluded from embedded builds. Fail hard if the guard goes.
    local dyn="$NISPS_DIR/ml/dynamic_storage.hpp"
    if [[ -f "$dyn" ]] && ! grep -q 'NISPS_TARGET_EMBEDDED' "$dyn"; then
        echo "[lint-cpp] FAIL: $dyn lost its NISPS_TARGET_EMBEDDED #error guard"
        fails=$((fails + 1))
    fi
}

# ---------------------------------------------------------------------------
# 3. Arduino.h audit — fail.
# ---------------------------------------------------------------------------
audit_arduino_include() {
    local hits
    hits=$(grep -REn '#[ \t]*include[ \t]+<Arduino\.h>' \
        --include='*.hpp' --include='*.cpp' \
        "$NISPS_DIR" 2>/dev/null || true)
    if [[ -n "$hits" ]]; then
        echo "[lint-cpp] FAIL: Arduino.h included in nisps/ (would break WASM):"
        echo "$hits" | sed 's/^/  /'
        fails=$((fails + 1))
    fi
}

audit_float_suffix
audit_heap_alloc
audit_arduino_include

if [[ $fails -gt 0 ]]; then
    echo "[lint-cpp] $fails FAIL"
    exit 1
fi

if [[ $warns -gt 0 ]]; then
    if [[ "$STRICT" == "1" ]]; then
        echo "[lint-cpp] strict mode: treating $warns warning(s) as failures"
        exit 1
    fi
    echo "[lint-cpp] $warns warning(s); pass"
else
    echo "[lint-cpp] clean"
fi
exit 0
