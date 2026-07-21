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
#   2. FAIL: heap allocation primitives anywhere under nisps/ EXCEPT
#      nisps/wasm/ (the host/browser binding layer, where heap is legitimate).
#      Exclusion-based on purpose: a newly added nisps/ subdirectory is
#      scanned by default instead of silently skipped (an older include-list
#      missed nisps/pipeline/ and nisps/core/ entirely). Forbidden patterns:
#        - allocating STL containers (std::vector/string/deque/list/map/set/
#          unordered_*/function; std::string_view is fine and not matched)
#        - std::make_unique / std::make_shared
#        - `new` in any spelling (`new T`, `new(...)`, nothrow, placement)
#        - C allocators: malloc/calloc/realloc/aligned_alloc/strdup/strndup
#      Comments and string literals are STRIPPED before matching (incl.
#      multi-line /* */ blocks), so a real allocation with a trailing comment
#      cannot hide, and prose mentioning std::vector cannot false-flag.
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
    # Heap primitives forbidden in the platform-neutral core (see header §2).
    # Perl regex, applied AFTER comment/string stripping below.
    local pat='\bstd::(vector|string|deque|list|forward_list|map|multimap|set|multiset|unordered_map|unordered_set|function)\b|\bmake_(unique|shared)\b|\bnew[ \t]*\(|\bnew[ \t]+[A-Za-z_:]|\b(malloc|calloc|realloc|aligned_alloc|strdup|strndup)[ \t]*\('

    # Everything under nisps/ except the wasm/ binding layer, tests, and
    # build artifacts. Exclusion-based so new subdirectories are covered by
    # default.
    local files
    mapfile -t files < <(find "$NISPS_DIR" -type f \( -name '*.hpp' -o -name '*.cpp' \) \
        -not -path '*/wasm/*' \
        -not -path '*/tests/*' \
        -not -path '*/build/*' | sort)

    local hits="" file file_hits
    for file in "${files[@]}"; do
        # SOLE allowlisted file (see header §2); guarded by the
        # NISPS_TARGET_EMBEDDED check below.
        if [[ "$file" == "$NISPS_DIR/ml/dynamic_storage.hpp" ]]; then
            continue
        fi
        # Strip string literals, then // and /* */ comments (with cross-line
        # block-comment state), THEN match — a trailing `// grow buffer`
        # comment can no longer hide a real allocation on the same line.
        file_hits=$(NISPS_HEAP_PAT="$pat" perl -ne '
            my $line = $_;
            chomp $line;
            $line =~ s{"(?:[^"\\]|\\.)*"}{""}g;          # string literals
            if ($in_block) {
                if ($line =~ s{^.*?\*/}{}) { $in_block = 0; } else { next; }
            }
            while (1) {
                my $pl = index($line, "//");
                my $pb = index($line, "/*");
                last if $pl < 0 && $pb < 0;
                if ($pb < 0 || ($pl >= 0 && $pl < $pb)) {
                    $line = substr($line, 0, $pl);       # // line comment
                    last;
                }
                my $pe = index($line, "*/", $pb + 2);
                if ($pe < 0) {                           # /* opens a block
                    $line = substr($line, 0, $pb);
                    $in_block = 1;
                    last;
                }
                $line = substr($line, 0, $pb) . " " . substr($line, $pe + 2);
            }
            if ($line =~ /$ENV{NISPS_HEAP_PAT}/o) {
                $line =~ s/^\s+//;
                print "$ARGV:$.: $line\n";
            }
        ' "$file" 2>/dev/null || true)
        if [[ -n "$file_hits" ]]; then
            hits+="$file_hits"$'\n'
        fi
    done
    hits="${hits%$'\n'}"

    if [[ -n "$hits" ]]; then
        echo "[lint-cpp] FAIL: heap allocation in nisps/ core:"
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
