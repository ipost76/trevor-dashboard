#!/usr/bin/env python3
"""
Hub helper — READ-ONLY EMERGENCY_KILLSWITCH state reader.

Returns to stdout as JSON:
  killswitch_state : str  "engaged" | "disengaged" | "unknown"  (the discriminator)
  enabled       : bool|None  mirrors killswitch_state; **None is the unknown
                             value, never False**
  lastToggle    : str    (ISO-8601 ET timestamp of last flip, '' if never)
  lastAuthor    : str    (Discord author string of last flip, '' if never)
  lastReason    : str    (free-text reason of last flip, '' if never)

🚨 THREE STATES, NOT TWO (C3-FALSE-SUCCESS-SWEEP, 2026-08-03):
    "engaged"     a row was READ and says the killswitch is on
    "disengaged"  a row was READ and says it is off
    "unknown"     the row is absent, the table is absent, or the read failed

This file used to have exactly the bug it now refuses. It initialised nothing,
resolved the row with `.get("EMERGENCY_KILLSWITCH", "false")`, and caught every
exception into `{"enabled": False}`. So an ABSENT ROW and ANY DB ERROR were both
emitted as positive evidence that the emergency stop was DISENGAGED — which the
Hub rendered as a confident "Off · New trades allowed". Two independent
coercions, both pointing at "safe", neither backed by a reading.

The in-repo precedent this conforms to is `/api/system-health` (QUAL-01,
2026-06-03), which reports `{"active": null, "status": "unknown"}` for this SAME
fact rather than a false `active: false` all-clear; and `query_trainer_pause.py`,
whose rule is quoted below.

🚨 `enabled` KEEPS ITS NAME AND STAYS POPULATED. It is not renamed and not
removed — only its unknown value changes from False to None. A consumer doing
`if (!data.enabled)` behaves exactly as before; a consumer that wants the honest
three-state answer reads `killswitch_state`. (B3-HUB measured that renaming a
field out from under a live branch is itself a false-green generator.)

Used by:
  /api/killswitch (GET only — there is no POST; toggling happens via
  Discord !killswitch on/off).
  src/components/KillswitchPill.tsx polls every 5 s; this helper is
  cached 5 s on the Node side (matches client cadence).

Read-only via SQLite mode=ro URI — Hub cannot write to auto_config from
this path. Killswitch flips are bot-side only via the Discord command,
which writes through auto_trader.killswitch.set_killswitch().

Failure mode: FAIL-SOFT, exit 0, with killswitch_state="unknown" and the reason
in `error`. It no longer exits 1, because a non-zero exit made runPython throw,
which drove the route into a catch that minted its own {"enabled": false} — the
false green was reachable by two paths and closing only one would have left it
live. The route still returns HTTP 500 on a genuine helper failure (the machine
contract is unmoved); only the BODY stops claiming a state nobody read.
"""
import json
import sqlite3

DB_RO_URI = "file:/home/trevor/trevor/trevor.db?mode=ro"


def main() -> None:
    # 🚨 The unknown default. Nothing below may set these to a DISENGAGED reading
    # unless it has actually READ an EMERGENCY_KILLSWITCH row saying so.
    # (The rule is quoted verbatim from query_trainer_pause.py, which is the
    # acceptance pattern this file was measured against.)
    out = {
        "killswitch_state": "unknown",
        "enabled": None,
        "lastToggle": "",
        "lastAuthor": "",
        "lastReason": "",
        "error": None,
    }
    try:
        with sqlite3.connect(DB_RO_URI, uri=True, timeout=10) as conn:
            rows = conn.execute(
                "SELECT key, value FROM auto_config "
                "WHERE key LIKE 'EMERGENCY_KILLSWITCH%'"
            ).fetchall()
        d = dict(rows)
        # The audit metadata is display-only and may legitimately be empty.
        out["lastToggle"] = d.get("EMERGENCY_KILLSWITCH_LAST_TOGGLE", "")
        out["lastAuthor"] = d.get("EMERGENCY_KILLSWITCH_LAST_AUTHOR", "")
        out["lastReason"] = d.get("EMERGENCY_KILLSWITCH_LAST_REASON", "")
        # ONLY a row we actually read may move the state off "unknown". An absent
        # key is NOT evidence that the emergency stop is disengaged.
        raw = d.get("EMERGENCY_KILLSWITCH")
        if raw is not None:
            engaged = str(raw).strip().lower() == "true"
            out["killswitch_state"] = "engaged" if engaged else "disengaged"
            out["enabled"] = engaged
        else:
            out["error"] = "EMERGENCY_KILLSWITCH row absent from auto_config"
        print(json.dumps(out))
    except Exception as exc:
        # Fail-soft: the state fields keep their unknown default — the except
        # branch is allowed to write `error`, never a reading.
        out["error"] = f"{type(exc).__name__}: {exc}"
        print(json.dumps(out))


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
