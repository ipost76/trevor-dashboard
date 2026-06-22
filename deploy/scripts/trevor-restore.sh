#!/usr/bin/env bash
# ⚠️ SUPERSEDED 2026-06-22 (B1) — DISABLED, kept on disk as a ROLLBACK PATH.
# Replaced by deploy/scripts/trevor-tailsync.sh (direct tailnet VM->WSL VACUUM-INTO
# snapshot + rsync-delta sync). This GCS litestream-restore loop was ~75-80% of the
# $158/mo Cloud Storage bill (~0.9 TB/mo egress); trevor-restore.timer/.service are now
# `systemctl disable`d. To roll back: `sudo systemctl disable --now trevor-tailsync.timer
# && sudo systemctl enable --now trevor-restore.timer`. NEVER run both loops at once.
# ─────────────────────────────────────────────────────────────────────────────
# TREVOR Hub — continuous read-replica refresh  (W-H-P2-HUB, 2026-06-09, Ghost-approved)
#
# WHY: The Hub (trevor-dashboard.service, :3000, this WSL box) reads a LOCAL litestream
# replica /home/ghost/trevor-replica/trevor.db. At the W-D migration (2026-06-06) that
# replica was restored ONCE and never refreshed — litestream.service was left dead+disabled
# and /home/ghost/litestream.yml is a *replicate* (PUSH) config, the wrong direction. The
# replica therefore froze at 06-06 02:06 (phantom "open" auto_trades, 0 trades today, account
# 52 trade-ids behind live). litestream 0.3.13 has NO live read-replica daemon (that feature
# was 0.4-beta-only and is still absent in 0.5.0), so the canonical pattern is a PERIODIC
# one-shot RESTORE that pulls GCS -> local. This script is that pull, driven by
# trevor-restore.timer (OnUnitInactiveSec=15min => ~20-30 min effective freshness).
#
# ONE-WAY, READ-SIDE ONLY. It RESTORES (downloads) from the GCS generation the VM owns
# (gs://trevor-prime-backups/litestream/trevor.db) INTO the local replica. It NEVER
# replicates/pushes anything outward, never writes the VM DB or GCS, never touches the bot
# or the money path. It deliberately uses a config-LESS `gcs://` REPLICA_URL so it can never
# be confused with the dangerous replicate (push) config in /home/ghost/litestream.yml.
#
# SAFE ATOMIC PUBLISH: restore to a staging file on the SAME filesystem -> checkpoint it to a
# single self-contained DELETE-mode db (no -wal/-shm) -> sanity-check it advances (auto_trades
# MAX(id) monotonic, never backwards/empty) -> rename(2) over the live path. The Hub opens a
# fresh read-only sqlite connection in a fresh subprocess PER REQUEST (no long-lived fd), so
# the swap is picked up on the very next request with NO Hub restart.
#
# Note: the real efficiency win (shrink each restore from ~14 min to seconds) is shortening
# the VM-side litestream snapshot-interval — that is a SEPARATE, VM-side change Ghost will
# authorize later. This script is intentionally WSL-read-side only.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPLICA_DIR="/home/ghost/trevor-replica"
DST="${REPLICA_DIR}/trevor.db"
STAGE_DIR="${REPLICA_DIR}/.staging"
TMP="${STAGE_DIR}/trevor.db"
GCS_URL="gcs://trevor-prime-backups/litestream/trevor.db"
LITESTREAM="/usr/bin/litestream"
PARALLELISM="${TREVOR_RESTORE_PARALLELISM:-16}"
LOCK="${REPLICA_DIR}/.restore.lock"

log() { printf '%s [trevor-restore] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Single-flight: never let two restores race the same staging/target (manual run vs timer).
exec 9>"$LOCK"
if ! flock -n 9; then
  log "another restore holds the lock; exiting (no overlap)."
  exit 0
fi

mkdir -p "$STAGE_DIR"
cleanup() { rm -f "${TMP}"* 2>/dev/null || true; }   # staging dir is dedicated to trevor.db*
trap cleanup EXIT
cleanup   # clear any leftovers from a previously killed run

log "restoring ${GCS_URL} -> ${TMP} (parallelism=${PARALLELISM}) ..."
t0=$(date +%s)
"$LITESTREAM" restore -parallelism "$PARALLELISM" -o "$TMP" "$GCS_URL"
t1=$(date +%s)
log "litestream restore completed in $((t1 - t0))s."

# Fold any WAL into the main file and publish a single self-contained DELETE-mode db, so the
# Hub's read-only (?mode=ro) opens never trip on a stale wal/shm pairing.
python3 - "$TMP" <<'PY'
import sqlite3, sys
db = sys.argv[1]
c = sqlite3.connect(db)
c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
c.execute("PRAGMA journal_mode=DELETE")
c.commit(); c.close()
PY

# Sanity gate: staged db must be valid sqlite AND must not regress (live ids only grow).
# Protects a working replica from being clobbered by a partial/corrupt/stale restore.
SANITY="$(python3 - "$TMP" "$DST" <<'PY'
import sqlite3, sys
def maxid(p):
    try:
        c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
        v = c.execute("SELECT COALESCE(MAX(id),0) FROM auto_trades").fetchone()[0]
        c.close(); return int(v or 0)
    except Exception:
        return -1
print(maxid(sys.argv[1]), maxid(sys.argv[2]))
PY
)"
STAGE_MAX="$(awk '{print $1}' <<<"$SANITY")"
CUR_MAX="$(awk '{print $2}' <<<"$SANITY")"
log "staged auto_trades MAX(id)=${STAGE_MAX}, current published=${CUR_MAX}."

if [ "${STAGE_MAX:-0}" -le 0 ]; then
  log "ABORT: staged db invalid/empty (MAX id=${STAGE_MAX}); keeping current replica."
  exit 1
fi
if [ "${CUR_MAX:-0}" -ge 0 ] && [ "$STAGE_MAX" -lt "$CUR_MAX" ]; then
  log "ABORT: staged id ${STAGE_MAX} < current ${CUR_MAX} (would regress); keeping current replica."
  exit 1
fi

chmod 0444 "$TMP"
mv -f "$TMP" "$DST"                 # atomic rename over the live path (same filesystem)
rm -f "${DST}-wal" "${DST}-shm"     # drop stale wal/shm left by the old WAL-mode replica
# Leave the EXIT trap armed: on success it now clears litestream's .tmp-* stragglers from
# the (already-mv'd) staging dir, so staging never accumulates between runs.
log "published fresh replica -> ${DST} (auto_trades MAX id=${STAGE_MAX}). done."
