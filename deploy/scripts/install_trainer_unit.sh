#!/usr/bin/env bash
# install_trainer_unit.sh — install trevor-trainer.service DISABLED (RP-C2)
#
# 🚨 INSTALLS ONLY. NEVER enables, never starts, never arms.
#
# WHY THIS SCRIPT EXISTS: /etc/systemd/system is not version-controlled, so an
# install done by hand vanishes on a rebuild and the wiring silently regresses to
# "authored in-repo, never installed" — the exact defect RP-C2 closed. The tracked
# file `deploy/systemd/wsl/trevor-trainer.service` is THE SOURCE OF TRUTH; this
# script is the reproducible way to put it where systemd can see it.
#
# WHY DISABLED: `trainer_loop.main()` refuses below L1 (rc=1 → `failed` → a
# pre-cutover alert via OnFailure=). VM MAX(level) is 0. Enabling now would page
# on a daemon behaving CORRECTLY. Arming is a separate decision that belongs to
# Ghost and cannot happen before L1 exists (RP-D3).
#
# Idempotent: safe to re-run. Re-running only re-syncs the unit file from the repo
# and reloads systemd; it never changes enablement state.
#
#   Usage:  bash deploy/scripts/install_trainer_unit.sh
#   Verify: systemctl is-enabled trevor-trainer   # -> disabled
#           systemctl is-active  trevor-trainer   # -> inactive
#   Remove: sudo rm /etc/systemd/system/trevor-trainer.service && sudo systemctl daemon-reload
set -euo pipefail

UNIT_NAME="trevor-trainer.service"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO_ROOT/deploy/systemd/wsl/$UNIT_NAME"
DST="/etc/systemd/system/$UNIT_NAME"

[ -f "$SRC" ] || { echo "FATAL: tracked unit missing: $SRC" >&2; exit 1; }

# 🚨 Refuse to proceed if the tracked source were ever edited to auto-start. A unit
# that starts itself would arm the trainer at level 0 and page on the refusal.
if grep -qiE '^\s*(ExecStartPre|ExecStartPost)=.*systemctl\s+(enable|start)' "$SRC"; then
  echo "FATAL: source unit contains a self-enable/self-start directive — refusing." >&2
  exit 1
fi

echo "[install] source : $SRC"
echo "[install] target : $DST"

if [ -f "$DST" ] && cmp -s "$SRC" "$DST"; then
  echo "[install] already byte-identical — no copy needed"
else
  sudo cp "$SRC" "$DST"
  sudo chmod 0644 "$DST"
  echo "[install] copied (byte-identical to the tracked source)"
fi

sudo systemctl daemon-reload
echo "[install] daemon-reload done"

# `is-enabled`/`is-active` exit non-zero for a disabled/inactive unit — that is the
# state we WANT, so capture rather than let `set -e` abort.
enabled="$(systemctl is-enabled "$UNIT_NAME" 2>&1 || true)"
active="$(systemctl is-active "$UNIT_NAME" 2>&1 || true)"
echo "[verify] is-enabled = $enabled"
echo "[verify] is-active  = $active"

if [ "$enabled" = "enabled" ] || [ "$active" = "active" ]; then
  echo "🚨 FATAL: unit is armed ($enabled/$active). It must be disabled+inactive until L1 exists." >&2
  exit 1
fi

echo "[ok] $UNIT_NAME installed, DISABLED and INACTIVE (correct pre-L1 state)."
