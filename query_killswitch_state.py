#!/usr/bin/env python3
"""
Hub helper — READ-ONLY EMERGENCY_KILLSWITCH state reader.

Returns 4 keys from auto_config to stdout as JSON:
  enabled       : bool   (EMERGENCY_KILLSWITCH == 'true')
  lastToggle    : str    (ISO-8601 ET timestamp of last flip, '' if never)
  lastAuthor    : str    (Discord author string of last flip, '' if never)
  lastReason    : str    (free-text reason of last flip, '' if never)

Used by:
  /api/killswitch (GET only — there is no POST; toggling happens via
  Discord !killswitch on/off).
  src/components/KillswitchPill.tsx polls every 5 s; this helper is
  cached 5 s on the Node side (matches client cadence).

Read-only via SQLite mode=ro URI — Hub cannot write to auto_config from
this path. Killswitch flips are bot-side only via the Discord command,
which writes through auto_trader.killswitch.set_killswitch().

Failure mode: on any DB error, prints {"enabled": false, "error": "..."}
and exits 1. Hub route returns 500 with same shape — KillswitchPill stays
hidden (fail-safe-OFF visual), surfaces error to console only.
"""
import json
import sqlite3
import sys

DB_RO_URI = "file:/home/trevor/trevor/trevor.db?mode=ro"


def main() -> None:
    try:
        with sqlite3.connect(DB_RO_URI, uri=True, timeout=10) as conn:
            rows = conn.execute(
                "SELECT key, value FROM auto_config "
                "WHERE key LIKE 'EMERGENCY_KILLSWITCH%'"
            ).fetchall()
        d = dict(rows)
        out = {
            "enabled": str(d.get("EMERGENCY_KILLSWITCH", "false")).lower() == "true",
            "lastToggle": d.get("EMERGENCY_KILLSWITCH_LAST_TOGGLE", ""),
            "lastAuthor": d.get("EMERGENCY_KILLSWITCH_LAST_AUTHOR", ""),
            "lastReason": d.get("EMERGENCY_KILLSWITCH_LAST_REASON", ""),
        }
        print(json.dumps(out))
    except Exception as exc:
        print(json.dumps({"enabled": False, "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        main()

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
