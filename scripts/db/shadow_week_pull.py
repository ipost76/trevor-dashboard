#!/usr/bin/env python3
"""
shadow_week_pull.py — pull B4's shadow-week panel from ghostbox into data/hub.db.
RM-CUTOVER Wave C · C4 Phase 2.

WHAT THIS IS
    B4 (`ghost@ghostbox`) writes /home/ghost/b4mon/var/handoff/panel.json on every
    b4-digest run, schema `b4mon/hub-panel/1`. This pulls that file and upserts it
    into the Hub's OWN database (data/hub.db), which is why the card is lag-free and
    independent of which box the Hub is pointed at (A7 §8.6).

🚨 THIS IS ADDITIVE AND CHANGES NO EXISTING DATA SOURCE.
    It writes two NEW tables and reads NOTHING the Hub already reads. The Hub's VM
    view is untouched. This is a SECOND read, never a replacement.

🚨 TRANSPORT — WHY `ghostbox` AND NOT `vm`.
    B4's C4_HUB_PANEL_SPEC §5 recommends "WSL pulls ... over the existing ssh pipe
    once it is repointed". That premise was WRONG in a useful direction: the pull
    needs NO repoint at all. `Host ghostbox` already exists in ~/.ssh/config and
    already works keyless. The `vm` alias is the REPOINT TARGET and must keep
    pointing at the VM through the whole shadow week — so this script must never
    use it. It names `ghostbox` explicitly, and it stays correct AFTER the Wave D
    repoint too, because ghostbox is the host that holds B4's tooling either way.

🚨 THIS SCRIPT DERIVES NO VERDICT.
    Every class string, count and state is copied VERBATIM from B4's payload. B4
    owns the vocabulary; B1 owns the classification. Two systems that each derive a
    class will eventually disagree, and then neither can be trusted. If B1 adds a
    class tomorrow it appears here tomorrow with no code change.

🚨 A FAILED PULL IS A STATE, NOT A SILENCE.
    Transport outcome is recorded in its own row. The panel renders UNREACHABLE
    from it. A one-sided view must never render green or be silently omitted --
    that is the exact failure this whole monitoring layer exists to defeat.

USAGE
    python3 scripts/db/shadow_week_pull.py            # pull + upsert
    python3 scripts/db/shadow_week_pull.py --dry-run  # fetch + validate, write nothing
EXIT
    0 pulled and stored · 0 unreachable-but-recorded · 1 local DB failure
"""
import argparse
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HUB_DB = os.path.join(REPO_ROOT, "data", "hub.db")

# The far side. `ghostbox` is a ~/.ssh/config alias, NOT the `vm` repoint target.
SSH_HOST = os.environ.get("SHADOW_PANEL_SSH_HOST", "ghostbox")
PANEL_PATH = os.environ.get(
    "SHADOW_PANEL_PATH", "/home/ghost/b4mon/var/handoff/panel.json"
)
SSH_TIMEOUT = int(os.environ.get("SHADOW_PANEL_SSH_TIMEOUT", "20"))
EXPECT_SCHEMA = "b4mon/hub-panel/1"

# B4's schema, VERBATIM from var/handoff/C4_HUB_PANEL_SPEC.md §2. Do not "improve" it.
DDL_STATUS = """
CREATE TABLE IF NOT EXISTS shadow_week_status (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),  -- exactly one row
  generated_at_et       TEXT    NOT NULL,
  tz_asserted           TEXT    NOT NULL,
  day                   TEXT    NOT NULL,
  clean_days            INTEGER NOT NULL,
  target_days           INTEGER NOT NULL,
  day_state             TEXT    NOT NULL,   -- CLEAN | HOLD | RESET
  day_cause             TEXT,
  harness_state         TEXT    NOT NULL,   -- RUNNING | NOT-STARTED | STOPPED
  last_heartbeat_age_s  REAL,
  drift_count           INTEGER NOT NULL,
  not_drift_json        TEXT    NOT NULL,   -- the non-drift classes, as JSON
  pass_conditions_json  TEXT    NOT NULL
)
"""

# 🚨 A SIBLING table, deliberately NOT extra columns on B4's table. B4's schema is a
#    handed-over contract and is reproduced byte-for-byte above; transport state is
#    OURS, so it lives in our own table. Adding columns to B4's would make the two
#    diverge the first time B4 ships a v2.
DDL_FETCH = """
CREATE TABLE IF NOT EXISTS shadow_week_fetch (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_at_utc  TEXT    NOT NULL,
  ok              INTEGER NOT NULL,   -- 1 reached and parsed · 0 could not
  source          TEXT    NOT NULL,   -- host:path actually attempted
  error           TEXT                -- the reason, verbatim, when ok=0
)
"""


def _now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _fetch() -> tuple[dict | None, str | None]:
    """Return (payload, error). Never raises. Never guesses on a partial read."""
    argv = [
        "ssh", "-o", "BatchMode=yes", "-o", f"ConnectTimeout={SSH_TIMEOUT}",
        SSH_HOST, f"cat {PANEL_PATH}",
    ]
    try:
        proc = subprocess.run(
            argv, capture_output=True, text=True, timeout=SSH_TIMEOUT + 10
        )
    except subprocess.TimeoutExpired:
        return None, f"ssh timeout after {SSH_TIMEOUT + 10}s"
    except Exception as exc:  # noqa: BLE001 - the reason is the payload
        return None, f"ssh failed: {exc}"

    if proc.returncode != 0:
        err = (proc.stderr or "").strip()[:300] or f"rc={proc.returncode}"
        return None, f"ssh rc={proc.returncode}: {err}"

    try:
        payload = json.loads(proc.stdout)
    except Exception as exc:  # noqa: BLE001
        return None, f"panel.json unparseable: {exc}"

    if not isinstance(payload, dict):
        return None, "panel.json is not an object"

    got = payload.get("schema")
    if got != EXPECT_SCHEMA:
        # 🚨 Refuse rather than guess. A schema we do not recognise is UNREACHABLE
        #    data, not "probably fine" data, and rendering it green would be exactly
        #    the green-and-wrong failure A7 §13 P-1 names as this project's signature.
        return None, f"schema mismatch: expected {EXPECT_SCHEMA!r}, got {got!r}"

    return payload, None


def _store(payload: dict | None, error: str | None, dry_run: bool) -> int:
    if dry_run:
        print(json.dumps({
            "dry_run": True, "would_store": payload is not None,
            "error": error, "source": f"{SSH_HOST}:{PANEL_PATH}",
        }, indent=2))
        return 0

    try:
        conn = sqlite3.connect(HUB_DB, timeout=10)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"hub.db open failed: {exc}"}))
        return 1

    try:
        with conn:
            conn.execute(DDL_STATUS)
            conn.execute(DDL_FETCH)
            conn.execute(
                "INSERT INTO shadow_week_fetch (id, fetched_at_utc, ok, source, error) "
                "VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                "fetched_at_utc=excluded.fetched_at_utc, ok=excluded.ok, "
                "source=excluded.source, error=excluded.error",
                (_now_utc(), 1 if payload else 0, f"{SSH_HOST}:{PANEL_PATH}", error),
            )
            if payload is not None:
                # 🚨 Every value copied VERBATIM. Nothing derived, nothing summed,
                #    nothing reclassified. `not_drift_counts` in particular is stored
                #    whole so a class B4 adds later survives without a code change.
                conn.execute(
                    "INSERT INTO shadow_week_status (id, generated_at_et, tz_asserted,"
                    " day, clean_days, target_days, day_state, day_cause, harness_state,"
                    " last_heartbeat_age_s, drift_count, not_drift_json,"
                    " pass_conditions_json) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(id) DO UPDATE SET "
                    "generated_at_et=excluded.generated_at_et,"
                    "tz_asserted=excluded.tz_asserted, day=excluded.day,"
                    "clean_days=excluded.clean_days, target_days=excluded.target_days,"
                    "day_state=excluded.day_state, day_cause=excluded.day_cause,"
                    "harness_state=excluded.harness_state,"
                    "last_heartbeat_age_s=excluded.last_heartbeat_age_s,"
                    "drift_count=excluded.drift_count,"
                    "not_drift_json=excluded.not_drift_json,"
                    "pass_conditions_json=excluded.pass_conditions_json",
                    (
                        payload.get("generated_at_et", ""),
                        payload.get("tz_asserted", ""),
                        payload.get("day", ""),
                        int(payload.get("clean_days", 0)),
                        int(payload.get("target_days", 0)),
                        payload.get("day_state", ""),
                        payload.get("day_cause"),
                        payload.get("harness_state", ""),
                        payload.get("last_heartbeat_age_s"),
                        int(payload.get("drift_count", 0)),
                        json.dumps(payload.get("not_drift_counts", {})),
                        json.dumps(payload.get("pass_conditions", [])),
                    ),
                )
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"hub.db write failed: {exc}"}))
        return 1
    finally:
        conn.close()

    print(json.dumps({
        "ok": payload is not None,
        "stored": payload is not None,
        "error": error,
        "source": f"{SSH_HOST}:{PANEL_PATH}",
        "fetched_at_utc": _now_utc(),
    }))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="pull B4's shadow-week panel into hub.db")
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch and validate; write nothing")
    args = ap.parse_args()
    payload, error = _fetch()
    return _store(payload, error, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
