#!/usr/bin/env bash
# residue_census.sh — THE FROZEN RAW-EXCEPTION RESIDUE CENSUS (pattern set v1.0)
#
# 🚨 WHY THIS FILE EXISTS
# The raw-exception residue count was measured four times and produced four
# mutually incomparable numbers:
#
#     B13 estimate          ~12 TS / ~10 PY
#     A2  (RM-CLOSEOUT)     62 occ / 57 files TS · 51 occ / 24 files PY
#     B3  (RM-CLOSEOUT)     80 occ / 72 files TS · 60 occ / 28 files PY
#     A2  (RM-VERIFY)       85 TS / 85 PY
#
# Nobody ever froze a pattern set, so no two of those measured the same thing.
# The trajectory never converged because it was never the same trajectory.
# THE REPEATED UNDERCOUNT IS THE FINDING, NOT THE NUMBERS.
#
# This script is the fix: ONE explicit, versioned, committed pattern set and a
# one-command re-runner, so the NEXT measurement is comparable to this one.
#
# Usage:   bash scripts/residue_census.sh            # summary
#          bash scripts/residue_census.sh --files    # + per-pattern file lists
#          bash scripts/residue_census.sh --code-only# strip obvious comment lines
#
# Exit 0 always — this is a census, not a gate. It must never block a commit.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 0

PATTERN_SET_VERSION="1.0"
SHOW_FILES=0; CODE_ONLY=0
for a in "$@"; do
  case "$a" in --files) SHOW_FILES=1 ;; --code-only) CODE_ONLY=1 ;; esac
done

# ── THE CORPUS (stated, not implied — an unstated exclusion is how four counts diverged)
#   INCLUDED: git-tracked *.ts *.tsx *.py
#   EXCLUDED: node_modules/ .next/ venv/ (never tracked anyway)
#             *.d.ts   — type declarations carry no runtime error path
#             docs/    — prose, not shipped code
#             tests/   — a test's raw exception is diagnostic output, not a user surface
#   COUNTED SEPARATELY, NEVER FOLDED IN:
#             gateway/*.js — the THIRD LANGUAGE LAYER. Node, outside src/, and
#             structurally invisible to a TSX sweep, a PY sweep AND a whole-src/
#             sweep. B12 measured that 11 of 14 gateway error codes are minted
#             here. Folding it into the TS number would hide it again.
ts_corpus() { git ls-files '*.ts' '*.tsx' | grep -vE '\.d\.ts$|^docs/|^tests/'; }
py_corpus() { git ls-files '*.py'         | grep -vE '^docs/|^tests/'; }
gw_corpus() { git ls-files 'gateway/*.js'; }

# ── THE PATTERN SET v1.0 — every regex, stated ────────────────────────────────
# TypeScript / TSX
TS_P1='String\(\s*(e|err|error|exc)\s*\)'          # raw exception stringified
TS_P2='\b(e|err|error|exc)\.message\b'             # exception message extracted
TS_P3='\$\{\s*(e|err|error|exc)\s*\}'              # exception into a template literal
TS_P4='instanceof Error\s*\?'                      # the message-or-String idiom
# Python
PY_P1='str\(\s*(e|exc|err|ex)\s*\)'                # raw exception stringified
PY_P2='type\(\s*(e|exc|err)\s*\)\.__name__'        # exception class name into text
PY_P3='\{\s*(e|exc|err)\s*\}'                      # exception into an f-string
# Denominators (context, not residue)
TS_D1='catch\s*\(\s*(e|err|exc)\s*\)'
PY_D1='except\s+\w*(Exception|Error)[^:]*\bas\s+\w+'

# 🚨 DELIBERATELY NOT EXCLUDED: comment and docstring bodies.
#    Stripping them needs a parser; a REGEX strip is exactly the defect RD-C4
#    measured in the VM guard suite (it scanned docstring bodies as code and
#    blocked files for documenting their own compliance). An over-count you
#    DECLARE is honest; an under-count you don't is not. --code-only gives the
#    lower bound by dropping lines whose first non-space char is # // or *.

# scan_occ / scan_files — the ONLY two places the corpus is read, so --code-only
# cannot silently no-op. (It did exactly that in this script's first draft: the
# strip helper was defined and never wired in, so the flag printed identical
# totals while claiming to have filtered. That is the false-success class this
# very census exists to count — caught here, recorded rather than quietly fixed.)
scan_occ() { # $1=regex $2=corpus-fn
  if [ "$CODE_ONLY" = "1" ]; then
    $2 | while IFS= read -r f; do
      sed -E '/^[[:space:]]*(#|\/\/|\*|\/\*)/d' "$f" 2>/dev/null | grep -Poh "$1" 2>/dev/null
    done | wc -l
  else
    $2 | xargs -r grep -Poh "$1" 2>/dev/null | wc -l
  fi
}
scan_files() { # $1=regex $2=corpus-fn
  if [ "$CODE_ONLY" = "1" ]; then
    $2 | while IFS= read -r f; do
      if sed -E '/^[[:space:]]*(#|\/\/|\*|\/\*)/d' "$f" 2>/dev/null | grep -Pq "$1" 2>/dev/null; then echo "$f"; fi
    done
  else
    $2 | xargs -r grep -Pl "$1" 2>/dev/null
  fi
}

count() { # $1=label $2=regex $3=corpus-fn
  local occ files
  occ=$(scan_occ "$2" "$3")
  files=$(scan_files "$2" "$3" | wc -l)
  printf '  %-38s occ=%-6s files=%s\n' "$1" "$occ" "$files"
  [ "$SHOW_FILES" = "1" ] && scan_files "$2" "$3" | sed 's/^/      /'
  echo "$occ" >> "$TMP_TOTAL"
}

TMP_TOTAL=$(mktemp); trap 'rm -f "$TMP_TOTAL"' EXIT

echo "RESIDUE CENSUS — pattern set v${PATTERN_SET_VERSION}"
echo "repo=$(pwd)  HEAD=$(git rev-parse --short HEAD)  code_only=${CODE_ONLY}"
echo "corpus: TS=$(ts_corpus | wc -l) files · PY=$(py_corpus | wc -l) files · gateway/*.js=$(gw_corpus | wc -l) files"
echo
echo "TypeScript / TSX"
: > "$TMP_TOTAL"
count "P1 String(e)"            "$TS_P1" ts_corpus
count "P2 e.message"            "$TS_P2" ts_corpus
count "P3 \${e}"                "$TS_P3" ts_corpus
count "P4 instanceof Error ?"   "$TS_P4" ts_corpus
TS_TOTAL=$(awk '{s+=$1} END {print s+0}' "$TMP_TOTAL")
printf '  %-38s occ=%s\n' "TS TOTAL" "$TS_TOTAL"
printf '  %-38s occ=%s   (context)\n' "D1 catch(e) sites" \
  "$(ts_corpus | xargs -r grep -Poh "$TS_D1" 2>/dev/null | wc -l)"

echo
echo "Python"
: > "$TMP_TOTAL"
count "P1 str(e)"               "$PY_P1" py_corpus
count "P2 type(e).__name__"     "$PY_P2" py_corpus
count "P3 {e} in an f-string"   "$PY_P3" py_corpus
PY_TOTAL=$(awk '{s+=$1} END {print s+0}' "$TMP_TOTAL")
printf '  %-38s occ=%s\n' "PY TOTAL" "$PY_TOTAL"
printf '  %-38s occ=%s   (context)\n' "D1 except ... as e sites" \
  "$(py_corpus | xargs -r grep -Poh "$PY_D1" 2>/dev/null | wc -l)"

echo
echo "gateway/*.js — THIRD LANGUAGE LAYER, reported separately, NEVER folded in"
: > "$TMP_TOTAL"
count "P1 String(e)"            "$TS_P1" gw_corpus
count "P2 e.message"            "$TS_P2" gw_corpus
count "P3 \${e}"                "$TS_P3" gw_corpus

echo
echo "🚨 The four historical numbers (~12/~10 · 62/57+51/24 · 80/72+60/28 · 85/85)"
echo "   are INCOMPARABLE to this one and to each other: none of them froze a"
echo "   corpus, an exclusion list, or a regex set, and none stated whether it"
echo "   counted occurrences or files. Compare only v${PATTERN_SET_VERSION} to v${PATTERN_SET_VERSION}."
exit 0
