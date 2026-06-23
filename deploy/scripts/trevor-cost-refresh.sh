#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# trevor-cost-refresh.sh — daily GCP cost-cache refresh driver (B4).
#
# Curls the internal cost-refresh WORKER (POST /api/cost/refresh) with the
# machine bearer GATEWAY_TOKEN, so the cost_snapshots cache (data/hub.db) stays
# current with zero manual action. Driven by trevor-cost-refresh.timer (daily
# ~06:00 local, after GCP's daily billing export lands). The route queries
# BigQuery and UPSERTs the cache; this script just triggers it.
#
# Read-only over cost data — no money path, no trevor.db write. Idempotent: the
# route UPSERTs on the UNIQUE key, and while the export is still backfilling it
# returns {status:'no_data_yet'} (HTTP 200) → a clean no-op, NOT a failure.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO=/home/ghost/projects/trevor-dashboard
ENV_FILE="$REPO/.env.local"
URL="http://127.0.0.1:3000/api/cost/refresh"

# Read GATEWAY_TOKEN from .env.local (never export the whole file, never print the value).
TOKEN=$(grep -E '^GATEWAY_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
if [ -z "${TOKEN:-}" ]; then
  echo "[cost-refresh] GATEWAY_TOKEN missing from $ENV_FILE — abort" >&2
  exit 1
fi

# -m 60: a cold BigQuery query can take a few seconds; give generous headroom.
RESP=$(curl -s -m 60 -w $'\n%{http_code}' -X POST -H "Authorization: Bearer $TOKEN" "$URL" || true)
CODE=$(printf '%s' "$RESP" | tail -1)
BODY=$(printf '%s' "$RESP" | sed '$d')

echo "[cost-refresh] HTTP ${CODE:-000} — ${BODY:-<no body>}"

# 2xx (ok / no_data_yet) → success; anything else (502 error, connection refused)
# → fail loud so `systemctl status` surfaces a persistent problem.
case "${CODE:-000}" in
  2*) exit 0 ;;
  *)  echo "[cost-refresh] non-2xx from refresh route" >&2; exit 1 ;;
esac
