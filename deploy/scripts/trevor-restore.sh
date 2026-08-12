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
# single self-contained DELETE-mode db (no -wal/-shm) -> gate it on trade IDENTITY (it must
# not LOSE a trade; re-keyed 2026-08-11, see the gate below) -> rename(2) over the live path.
# The Hub opens a fresh read-only sqlite connection in a fresh subprocess PER REQUEST (no long-lived fd), so
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

# Sanity gate: staged db must be valid sqlite AND must not lose trades.
# Protects a working replica from being clobbered by a partial/corrupt/stale restore.
#
# ð¨ RE-KEYED 2026-08-11 (RM-REPAIR [B2], finding B-01) EVEN THOUGH THIS SCRIPT IS
# DISABLED. It was gating on `auto_trades MAX(id)`, a PER-DATABASE AUTOINCREMENT
# that is NOT a cross-box key â measured on the two live ledgers, id 101826 is
# XRP|SHORT|10:57:52 on the VM and FARTCOIN|SHORT|12:22:31 on the shadow. This file
# is kept on disk as the documented ROLLBACK PATH (see the header), so leaving the
# old key here would have left a dormant copy of the defect that a rollback â
# exactly the moment nobody is looking closely â would arm. It now calls the same
# tailsync_gate.py the live path uses; there is ONE gate, not two.
SOURCE_ID="litestream-gcs:${GCS_URL}"
GATE="$(dirname "$(readlink -f "$0")")/tailsync_gate.py"
if [ ! -x "$GATE" ]; then
  log "ABORT: publish gate ${GATE} is missing or not executable; keeping current replica."
  exit 1
fi
GATE_OUT="$(python3 "$GATE" check --staged "$TMP" --published "$DST" --source "$SOURCE_ID" 2>&1)" && GATE_RC=0 || GATE_RC=$?
printf '%s
' "$GATE_OUT" | sed 's/^/    gate: /'
if [ "$GATE_RC" -ne 0 ]; then
  log "ABORT: publish gate refused (rc=${GATE_RC}); keeping current replica ${DST}."
  exit 1
fi

chmod 0444 "$TMP"
mv -f "$TMP" "$DST"                 # atomic rename over the live path (same filesystem)
rm -f "${DST}-wal" "${DST}-shm"     # drop stale wal/shm left by the old WAL-mode replica
# Record WHERE this replica came from, so the next run (by EITHER script) can tell
# a source change from a truncation instead of guessing from an integer.
python3 "$GATE" record --published "$DST" --source "$SOURCE_ID" >/dev/null
# Leave the EXIT trap armed: on success it now clears litestream's .tmp-* stragglers from
# the (already-mv'd) staging dir, so staging never accumulates between runs.
log "published fresh replica -> ${DST} (auto_trades MAX id=${STAGE_MAX}). done."
