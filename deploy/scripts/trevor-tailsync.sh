#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TREVOR Hub — read-replica refresh via DIRECT TAILNET VM->WSL SYNC  (B1, 2026-06-22)
#
# WHY: replaces trevor-restore.sh (litestream restore from GCS, ~65×/day re-pulling
# the DB through the cloud). That GCS egress was ~75-80% of a $158/mo Cloud Storage
# bill (~0.9 TB/mo). Both boxes are on Tailscale, so the Hub pulls a consistent
# snapshot of trevor.db straight from the VM over the tailnet (DIRECT WireGuard P2P,
# verified `pong ... via <pub-ip>:41641`) instead of round-tripping through GCS.
#
# ⚠️ THE EGRESS WIN IS rsync DELTA-TRANSFER, NOT THE TAILNET ITSELF. The VM is GCP;
# bytes leaving it are billed as Compute-Engine egress at ~the same per-GB rate as GCS
# egress. A full pull every cycle would be NO cheaper (it would just move the bill from
# GCS to Compute Engine). The saving comes from three things, all load-bearing:
#   (1) rsync's delta algorithm (a remote-shell transfer => delta is ON by default)
#       sends only the CHANGED blocks between syncs (the DB's churn, ~tens of MB),
#       and -z compresses what little does cross the wire;
#   (2) the staging file ${STAGE} is PERSISTENT — it is the delta BASIS and is NEVER
#       wiped (wiping it would force a full transfer every run and forfeit the saving);
#   (3) the VM snapshot uses `VACUUM INTO` — it reads inside ONE transaction, so it gets a
#       consistent point-in-time snapshot and is IMMUNE to the live bot's concurrent writes.
#       (`.backup` was tried first and LIVELOCKS on this hot DB: its page-by-page copy
#       restarts every time the bot writes an already-copied page, so under continuous
#       trading it never finishes — observed spinning ~67% CPU with the output frozen for
#       11+ min. VACUUM INTO does repack the DB, but because this DB is append-mostly
#       (trade/shadow logs) its output is largely page-stable run-to-run, so rsync delta
#       still matches the bulk: measured 7.3 MB received per warm sync, 1.37 GB matched,
#       188x speedup — the egress win holds.)
#
# SAFETY (never publish a corrupt/partial replica, never write the live DB):
#   * NEVER copy the hot WAL DB directly — trevor.db is WAL-active (a plain cp/rsync of
#     the live file is corrupt: the -wal holds uncommitted pages). The VM makes a
#     consistent snapshot with `VACUUM INTO`, run as user `trevor` (the DB owner) so it
#     reads WAL-safely alongside the live bot writer.
#   * The pulled snapshot is integrity-checked (PRAGMA integrity_check) AND gated by
#     deploy/scripts/tailsync_gate.py BEFORE it is published.
#     🚨 RE-KEYED 2026-08-11 (RM-REPAIR [B2], finding B-01). The gate used to compare
#     `auto_trades MAX(id)` on the two files. That column is a PER-DATABASE
#     AUTOINCREMENT and is NOT a cross-box key: measured on the two live ledgers,
#     id 101826 is XRP|SHORT|10:57:52 on the VM and FARTCOIN|SHORT|12:22:31 on the
#     shadow, and both boxes once read MAX(id)=101824/rows=1839/open=2
#     SIMULTANEOUSLY while holding different trades there. So the old gate could
#     ABORT on a perfectly good cutover snapshot with a message about truncation
#     (A7 R-24: "the message reads as corruption"), and — far worse — could PUBLISH
#     SILENTLY across a source change whenever the other box's integer happened to
#     be larger, swapping the Hub onto a different instance's ledger with no
#     message at all. It now gates on the trade IDENTITY (ticker|direction|
#     opened_at) with C5's INHERITED/POST-START partition, and on the replica's
#     recorded PROVENANCE. See tailsync_gate.py for the full reasoning.
#   * Publish is an atomic rename(2) over ${DST} on the same filesystem. The Hub keeps
#     reading the OLD copy until the instant of swap; it opens the replica read-only
#     (?mode=ro) in a fresh subprocess per request, so it picks up the swap on the next
#     request with NO Hub restart.
#   * WSL NEVER writes the live DB. The only WSL "write" is the atomic swap of a
#     locally-verified file into the replica path. A corrupt replica is worse than a
#     stale one — every failure path leaves the existing ${DST} untouched and exits
#     non-zero so the timer surfaces it.
#
# NOTE: WSL has NO sqlite3 CLI — every WSL-side DB op uses python3's stdlib sqlite3
# module (the sqlite3 CLI lives only on the VM, for VACUUM INTO). The ssh target is the
# `vm` alias (-> ghost@trevor-prime-2, the live box @ 100.95.174.30; see ~/.ssh/config).
# Repointed off the dead pre-migration trevor-prime IP on 2026-06-25 (B1).
#
# Supersedes deploy/scripts/trevor-restore.sh (GCS restore) as of B1, 2026-06-22.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPLICA_DIR="/home/ghost/trevor-replica"
DST="${REPLICA_DIR}/trevor.db"                 # published read-replica (consumers read this, ?mode=ro)
STAGE_DIR="${REPLICA_DIR}/.staging"
STAGE="${STAGE_DIR}/trevor.db"                 # PERSISTENT rsync delta basis — NEVER wiped
PUB="${STAGE_DIR}/trevor.db.publish"           # throwaway DELETE-mode publish copy (derived from STAGE)
LOCK="${REPLICA_DIR}/.tailsync.lock"

SSH_HOST="vm"                                  # ssh alias -> ghost@trevor-prime-2 (live box; resolved via ~/.ssh/config)
VM_DB="/home/trevor/trevor/trevor.db"
VM_SNAP="/tmp/trevor-tailsync-snap.db"

log() { printf '%s [trevor-tailsync] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Single-flight: never let two syncs race the same staging/target (manual run vs timer).
exec 9>"$LOCK"
if ! flock -n 9; then
  log "another tailsync holds the lock; exiting (no overlap)."
  exit 0
fi

mkdir -p "$STAGE_DIR"

# Cleanup: drop the throwaway publish copy + (best-effort) the VM temp snapshot on every exit.
# NEVER touch ${STAGE} — it is the delta basis and must persist between runs.
# Snapshot is created by `sudo -u trevor`, so it is owned by trevor; /tmp's sticky bit means
# only trevor can remove it. All VM-snapshot removals therefore run as `sudo -u trevor`.
vm_cleanup() { ssh "$SSH_HOST" "sudo -n -u trevor rm -f '${VM_SNAP}' '${VM_SNAP}-wal' '${VM_SNAP}-shm'" 2>/dev/null || true; }
local_cleanup() { rm -f "$PUB" "${PUB}-wal" "${PUB}-shm" 2>/dev/null || true; }
trap 'vm_cleanup; local_cleanup' EXIT
local_cleanup   # clear a leftover publish copy from a previously killed run

# 1) Consistent snapshot ON THE VM via VACUUM INTO (single read txn -> immune to the live
#    bot's concurrent writes; .backup livelocks here). Run as the DB owner `trevor`, then
#    make it ghost-readable so the rsync (remote side runs as ghost) can pull it.
log "snapshot: sudo -u trevor sqlite3 VACUUM INTO ${VM_DB} -> ${VM_SNAP} (on VM) ..."
ssh "$SSH_HOST" "sudo -n -u trevor rm -f '${VM_SNAP}' '${VM_SNAP}-wal' '${VM_SNAP}-shm' && sudo -n -u trevor sqlite3 -cmd '.timeout 15000' '${VM_DB}' \"VACUUM INTO '${VM_SNAP}'\" && sudo -n -u trevor chmod 0644 '${VM_SNAP}'"

# 2) Delta-pull over the tailnet. rsync over a remote shell => delta algorithm ON by default;
#    -z compresses; the existing ${STAGE} is the delta basis so only changed blocks cross the wire.
log "rsync delta-pull ${SSH_HOST}:${VM_SNAP} -> ${STAGE} ..."
t0=$(date +%s)
RSYNC_OUT="$(rsync -z --partial --timeout=300 --stats -e ssh "${SSH_HOST}:${VM_SNAP}" "${STAGE}")"
log "rsync completed in $(($(date +%s) - t0))s."
echo "$RSYNC_OUT" | grep -E 'Literal data|Matched data|Total transferred|sent .* received|speedup' | sed 's/^/    rsync: /' || true

# 3) Derive a self-contained DELETE-mode publish copy from the (raw, WAL-mode) basis.
#    The Hub opens ?mode=ro; a WAL-flagged file with no -wal sidecar can fail a read-only open,
#    so we publish DELETE-mode (matches the proven trevor-restore.sh read contract). The
#    conversion runs on the throwaway PUB copy so ${STAGE} stays a clean, page-stable delta
#    basis for the next run (converting STAGE in place would hurt the next delta).
cp -f "$STAGE" "$PUB"
python3 - "$PUB" <<'PY'
import sqlite3, sys
db = sys.argv[1]
c = sqlite3.connect(db)
c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
c.execute("PRAGMA journal_mode=DELETE")
c.commit(); c.close()
PY

# 4) Integrity + monotonic sanity gate on PUB, BEFORE publishing. Protects a working replica
#    from being clobbered by a corrupt / partial / stale / regressing snapshot.
INTEG="$(python3 - "$PUB" <<'PY'
import sqlite3, sys
try:
    c = sqlite3.connect("file:%s?mode=ro" % sys.argv[1], uri=True)
    print(c.execute("PRAGMA integrity_check").fetchone()[0]); c.close()
except Exception as e:
    print("ERROR:%s" % e)
PY
)"
if [ "$INTEG" != "ok" ]; then
  log "ABORT: integrity_check='${INTEG}' (not ok); keeping current replica ${DST}."
  exit 1
fi

# 🚨 THE RE-KEYED GATE (RM-REPAIR [B2] 2026-08-11). See the header note and
# tailsync_gate.py. SOURCE_ID is the identity this replica's provenance is recorded
# under; it MUST change when SSH_HOST/VM_DB change, which is exactly how the gate
# detects the Wave D repoint instead of silently publishing across it.
SOURCE_ID="${SSH_HOST}:${VM_DB}"
GATE="$(dirname "$(readlink -f "$0")")/tailsync_gate.py"
if [ ! -x "$GATE" ]; then
  log "ABORT: publish gate ${GATE} is missing or not executable; keeping current replica."
  exit 1
fi
GATE_OUT="$(python3 "$GATE" check --staged "$PUB" --published "$DST" --source "$SOURCE_ID" 2>&1)" && GATE_RC=0 || GATE_RC=$?
printf '%s\n' "$GATE_OUT" | sed 's/^/    gate: /'
if [ "$GATE_RC" -ne 0 ]; then
  log "ABORT: publish gate refused (rc=${GATE_RC}); keeping current replica ${DST}."
  exit 1
fi

# 5) Atomic publish: rename(2) PUB over the live path (same filesystem). Drop any stale wal/shm.
chmod 0444 "$PUB"
mv -f "$PUB" "$DST"                 # atomic rename over the live path (same filesystem)
rm -f "${DST}-wal" "${DST}-shm"     # drop stale wal/shm left by an older WAL-mode replica
# Record WHERE this replica came from. The next run compares against it; without a
# provenance record the gate can only make the INHERITED assertion and says so.
python3 "$GATE" record --published "$DST" --source "$SOURCE_ID" >/dev/null
log "published fresh replica -> ${DST} (source ${SOURCE_ID}). done."
