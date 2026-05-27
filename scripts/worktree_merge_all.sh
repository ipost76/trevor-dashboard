#!/bin/bash
# Merge ALL pending worktrees into master in trevor-dashboard. Auto-discovers branches.
#
# Usage:
#   bash scripts/worktree_merge_all.sh [--restart SERVICE_NAME] [--dry-run]
#
# Behaviour:
#   1. Lists every worktree NOT on master (auto-detects feat/*, etc.)
#   2. Merges each into master sequentially (--no-edit, stops on conflict)
#   3. After each merge: npx tsc --noEmit. Abort if it fails.
#   4. After ALL merges: npm run build. Abort if it fails.
#   5. Optional: restart SERVICE_NAME via sudo systemctl.
#   6. After everything succeeds: remove worktrees + delete merged branches.
#   7. Never auto-pushes. Prints a manual-push reminder.
#
# CLAUDE.md-only conflict handling:
#   If the ONLY conflicting file is CLAUDE.md, the script auto-resolves via
#   `git checkout --theirs CLAUDE.md`. NOTE: this REPLACES master's CLAUDE.md
#   with the incoming branch's version verbatim — if master has its own
#   newer changelog entries (e.g. from an earlier merge in this same run),
#   they will be LOST. To preserve all changelog entries from every worktree,
#   set `CLAUDE.md merge=union` in `.gitattributes` (separate one-time change).
#
# Any OTHER conflicting file → script stops; user resolves manually, re-runs.

set -euo pipefail

MAIN_DIR="/home/trevor/trevor-dashboard"
MAIN_BRANCH="master"
RESTART_SERVICE=""
DRY_RUN=false

usage() {
  echo "Usage: bash scripts/worktree_merge_all.sh [--restart SERVICE_NAME] [--dry-run]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --restart)
      [[ $# -ge 2 ]] || { echo "--restart requires a service name"; usage; }
      RESTART_SERVICE="$2"; shift 2 ;;
    --dry-run)
      DRY_RUN=true; shift ;;
    -h|--help)
      usage ;;
    *)
      echo "Unknown argument: $1"; usage ;;
  esac
done

cd "$MAIN_DIR"

# Auto-discover ALL worktrees not on master (excludes (bare) too)
ENTRIES=$(git worktree list | grep -v "^\S*\s.*\[$MAIN_BRANCH\]" | grep -v "(bare)" || true)

if [ -z "$ENTRIES" ]; then
  echo "No pending worktrees found. Nothing to merge."
  exit 0
fi

TOTAL=$(echo "$ENTRIES" | wc -l)
echo "=== Hub worktree merge: $TOTAL pending worktree(s) ==="
echo ""

# Print the list (this IS the confirmation step — user ^C to abort)
i=0
while IFS= read -r line; do
  i=$((i + 1))
  WT_PATH=$(echo "$line" | awk '{print $1}')
  BRANCH=$(echo "$line" | sed 's/.*\[//' | sed 's/\]//')
  echo "  $i. $BRANCH (at $WT_PATH)"
done <<< "$ENTRIES"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "=== DRY RUN — would do the following ==="
  echo "  · checkout $MAIN_BRANCH"
  echo "  · merge each branch listed above with --no-edit"
  echo "  · run 'npx tsc --noEmit' after each merge (abort on fail)"
  echo "  · auto-resolve CLAUDE.md-only conflicts via --theirs (see header)"
  echo "  · run 'npm run build' once after all merges (abort on fail)"
  [ -n "$RESTART_SERVICE" ] && echo "  · sudo systemctl restart $RESTART_SERVICE"
  echo "  · git worktree remove + git branch -d for each merged worktree"
  echo "  · print manual-push reminder (NO auto-push)"
  echo ""
  echo "No state changed. Drop --dry-run to execute."
  exit 0
fi

# Ensure we're on master
CURRENT=$(git branch --show-current)
if [ "$CURRENT" != "$MAIN_BRANCH" ]; then
  echo "Switching to $MAIN_BRANCH..."
  git checkout "$MAIN_BRANCH"
fi

# Merge each branch sequentially
MERGED=0
while IFS= read -r line; do
  BRANCH=$(echo "$line" | sed 's/.*\[//' | sed 's/\]//')
  MERGED=$((MERGED + 1))

  echo ""
  echo "--- [$MERGED/$TOTAL] Merging: $BRANCH ---"

  if ! git merge "$BRANCH" --no-edit; then
    # Identify conflicted files
    CONFLICTING=$(git diff --name-only --diff-filter=U)
    # Trim whitespace for exact-match comparison
    CONFLICTING_TRIMMED=$(echo "$CONFLICTING" | xargs)

    if [ "$CONFLICTING_TRIMMED" = "CLAUDE.md" ]; then
      echo ""
      echo "ℹ️  CLAUDE.md-only conflict — auto-resolving with --theirs."
      echo "    (incoming branch's CLAUDE.md wins; see script header re: merge=union)"
      git checkout --theirs CLAUDE.md
      git add CLAUDE.md
      git commit --no-edit
      echo "✅ Resolved CLAUDE.md and completed merge"
    else
      echo ""
      echo "❌ MERGE CONFLICT on $BRANCH — conflicting files:"
      echo "$CONFLICTING"
      echo ""
      echo "Resolve manually then re-run this script for the remaining $((TOTAL - MERGED + 1)) worktree(s)."
      exit 1
    fi
  fi
  echo "✅ Merged $BRANCH"

  # Per-merge typecheck — abort if it fails so we know which branch broke types
  echo "--- Running npx tsc --noEmit ---"
  if ! npx tsc --noEmit; then
    echo ""
    echo "❌ TypeScript errors after merging $BRANCH — aborting."
    echo "Inspect the diff on $MAIN_BRANCH, fix, commit, then re-run for the remaining branches."
    exit 1
  fi
  echo "✅ tsc clean"
done <<< "$ENTRIES"

# Single post-merge build
echo ""
echo "--- Running npm run build (final check) ---"
if ! npm run build; then
  echo ""
  echo "❌ Build failed after all $TOTAL merges — investigate."
  echo "Worktrees + branches NOT cleaned up (re-runnable after fix)."
  exit 1
fi
echo "✅ Build clean"

# Optional service restart
if [ -n "$RESTART_SERVICE" ]; then
  echo ""
  echo "--- Restarting $RESTART_SERVICE ---"
  sudo systemctl restart "$RESTART_SERVICE"
  sleep 3
  if systemctl is-active --quiet "$RESTART_SERVICE"; then
    echo "✅ $RESTART_SERVICE active"
  else
    echo "❌ $RESTART_SERVICE failed to come up"
    journalctl -u "$RESTART_SERVICE" --no-pager -n 20
    exit 1
  fi
fi

# Cleanup worktrees + branches (only after everything else succeeded)
echo ""
echo "--- Cleaning up worktrees + branches ---"
while IFS= read -r line; do
  WT_PATH=$(echo "$line" | awk '{print $1}')
  BRANCH=$(echo "$line" | sed 's/.*\[//' | sed 's/\]//')
  git worktree remove "$WT_PATH" --force 2>/dev/null || rm -rf "$WT_PATH"
  git branch -d "$BRANCH" 2>/dev/null || git branch -D "$BRANCH" 2>/dev/null || true
  echo "✅ Removed worktree $WT_PATH and branch $BRANCH"
done <<< "$ENTRIES"

echo ""
echo "=== ✅ COMPLETE: $TOTAL worktree(s) merged into $MAIN_BRANCH ==="
echo "Tip: review with 'git log --oneline -$((TOTAL + 1))'"
echo "$MAIN_BRANCH HEAD: $(git log --oneline -1)"
echo ""
echo "⚠️  NOT PUSHED. When ready: git push origin $MAIN_BRANCH"
echo ""
git worktree list
