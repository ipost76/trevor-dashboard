#!/bin/bash
# build_atomic.sh — build the Hub into a STAGING dir, then swap it into place.
# B4-HUB-RESILIENCE (2026-08-02).
#
# WHY THIS EXISTS. `next build` rewrites `.next` IN PLACE. For the tens of seconds a
# build runs, the live `.next` is a half-written directory that the service can be
# started from. On 2026-08-02 that is exactly what happened: `.next` was left without
# prerender-manifest.json, Next read it once at setupFsCheck() during initialize(),
# and the Hub died with an opaque ENOENT five times in ten seconds. systemd hit its
# start limit and gave up at 00:12:23. The Hub — Ghost's ONLY cockpit — stayed down
# 21m53s. This is the only change in the B4 set that removes that failure class
# rather than reporting it faster.
#
# 🚨 HONEST SCOPE — THIS IS NOT A PERFECTLY ATOMIC SWAP, AND SAYING SO MATTERS.
#   Swapping a DIRECTORY takes two rename(2) calls (there is no portable
#   RENAME_EXCHANGE from shell), so a window still exists between them. What changes
#   is its SIZE and its SHAPE:
#     before — `.next` is HALF-WRITTEN for the whole build (tens of seconds), and a
#              service started in that window dies on an opaque Node stack trace;
#     after  — `.next` is ABSENT for the duration of one rename (sub-millisecond),
#              and a service started in THAT window is caught by the ExecStartPre
#              manifest assertions and fails with a named precondition error.
#   Absent-and-named beats half-present-and-opaque. It is a large reduction, not an
#   elimination, and it must not be described as elimination.
#
# Requirements, both verified before the swap:
#   * `.next` and the staging dir share a filesystem (rename(2) is same-fs only).
#   * the build actually produced the three manifests the runtime reads.
#
# Usage:  bash scripts/build_atomic.sh
# Exit:   0 built + swapped | 1 precondition failed | 2 build failed | 3 swap failed
set -uo pipefail

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

LIVE=".next"
STAGE=".next.build"
PREV=".next.prev"

# The three files Next reads during initialize(); an incomplete build is defined as
# any one of them missing or empty. prerender-manifest.json is the one that actually
# took the Hub down, and it is read ONCE at startup — which is why a broken build is
# invisible until the next restart.
MANIFESTS=(prerender-manifest.json routes-manifest.json build-manifest.json)

say() { printf '[build_atomic] %s\n' "$1"; }

# ── 1. same-filesystem precondition ─────────────────────────────────────────
# rename(2) across filesystems fails with EXDEV. Check the PARENT (the repo root),
# because that is what both the live and staging dirs are created in.
repo_dev="$(stat -c '%d' "$REPO")" || exit 1
if [ -e "$LIVE" ]; then
  live_dev="$(stat -c '%d' "$LIVE")" || exit 1
  if [ "$repo_dev" != "$live_dev" ]; then
    say "🚨 REFUSING: $LIVE (dev $live_dev) is not on the same filesystem as $REPO (dev $repo_dev)."
    say "   A rename-into-place would fail EXDEV. Fix the mount, or build in place knowingly."
    exit 1
  fi
fi
say "same-filesystem check OK (dev $repo_dev)"

# ── 2. build into staging ───────────────────────────────────────────────────
# 🚨 `next build` REWRITES next-env.d.ts and tsconfig.json to point their type
#    references at whatever distDir it was given. With NEXT_DIST_DIR set that means
#    they end up naming ".next.build" — a directory that does not exist between
#    builds — so a later `npx tsc --noEmit` or a plain `npm run build` would be
#    referencing a path that is gone, and the diff would look like a source change
#    nobody made. MEASURED on the first run of this script (B4, 2026-08-02); these
#    two files are Next-managed, so the fix is to snapshot and restore them rather
#    than to edit them. Restore happens on EVERY exit path, including build failure.
TS_SNAPSHOT="$(mktemp -d)"
cleanup_ts() {
  for f in next-env.d.ts tsconfig.json; do
    [ -f "$TS_SNAPSHOT/$f" ] && cp -p "$TS_SNAPSHOT/$f" "$REPO/$f"
  done
  rm -rf "$TS_SNAPSHOT"
}
trap cleanup_ts EXIT
for f in next-env.d.ts tsconfig.json; do
  [ -f "$REPO/$f" ] && cp -p "$REPO/$f" "$TS_SNAPSHOT/$f"
done

rm -rf "$STAGE"
say "building into $STAGE (live $LIVE untouched, Hub keeps serving) ..."
if ! NEXT_DIST_DIR="$STAGE" npm run build; then
  say "🚨 BUILD FAILED — $LIVE was NOT touched. The Hub is still serving the previous build."
  rm -rf "$STAGE"
  exit 2
fi

# ── 3. verify the staged build before it is allowed near the live path ──────
# This is the gate the old in-place build never had: a build that exits 0 but did not
# emit a manifest is caught HERE, while the live directory is still the good one.
for m in "${MANIFESTS[@]}"; do
  if [ ! -s "$STAGE/$m" ]; then
    say "🚨 STAGED BUILD INCOMPLETE — $STAGE/$m missing or empty. NOT swapping."
    say "   $LIVE is untouched and still good. This is the outage-preventing branch."
    exit 2
  fi
done
say "staged build verified — all ${#MANIFESTS[@]} manifests present and non-empty"

# ── 4. swap ─────────────────────────────────────────────────────────────────
# `mv -T` so a rename can never nest one dir inside the other.
rm -rf "$PREV"
if [ -e "$LIVE" ]; then
  mv -T "$LIVE" "$PREV" || { say "🚨 SWAP FAILED moving $LIVE aside — $LIVE intact."; exit 3; }
fi
if ! mv -T "$STAGE" "$LIVE"; then
  say "🚨 SWAP FAILED — restoring the previous build from $PREV."
  mv -T "$PREV" "$LIVE" || say "🚨🚨 COULD NOT RESTORE — $LIVE is ABSENT. Restore $PREV by hand NOW."
  exit 3
fi
say "swapped: $STAGE -> $LIVE (previous build kept at $PREV for rollback)"

# ── 5. post-swap assertion ──────────────────────────────────────────────────
for m in "${MANIFESTS[@]}"; do
  [ -s "$LIVE/$m" ] || { say "🚨 POST-SWAP: $LIVE/$m missing/empty."; exit 3; }
done
say "post-swap verified — $LIVE complete"
say "🚨 the running Hub still holds the OLD build in memory — restart it to serve this one:"
say "   sudo systemctl restart trevor-dashboard.service"
exit 0
