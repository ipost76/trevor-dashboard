#!/usr/bin/env python3
"""Query/update trading capital in trevor_config table.

🚨 THREE STATES ON THE READ, NOT ONE (B2-HUB-READER-HONESTY, 2026-08-04) —
`capital_state` is the discriminator:
    "read"     a trading_capital row was READ and parsed
    "unknown"  the row is absent, the table is absent, or the read failed

`capital` mirrors it as a float or **None**, and None is the unknown value —
never a number. It KEEPS ITS NAME AND STAYS POPULATED; only the unknown value
moves from 50.0 to None. (B3-HUB measured that renaming a field out from under a
live branch is itself a false-green generator.)

🚨 WHY THIS ONE WAS INVISIBLE, AND WHY THAT IS THE DANGER. This file resolved an
absent row with `else 50.0` and caught every exception into `capital = 50.0`, and
`sqlite3.connect` sat OUTSIDE the try so a missing DB file crashed to exit 1 and
the route minted its own 50.0. FOUR coercions, all to the same number — and
`trevor_config` holds exactly one row, `trading_capital = 50.0`, unchanged since
2026-04-07. MEASURED 2026-08-04: an absent row, a corrupt DB, a missing file and
the LIVE replica all printed byte-identical `{"capital": 50.0}`.

**The fallback is indistinguishable from a true read today.** That coincidence is
not a mitigation — it is the reason nobody has noticed, and it stops being true
the moment capital changes, at which point the reader will confidently report the
old number and nobody will be watching for it.

The rule this file is measured against, quoted verbatim from
`query_trainer_pause.py` (WSL, repo root):
    "The unknown default. Nothing below may set these to a not-paused reading."

⚠️ The `set` branch below is UNCHANGED — this is a read-honesty fix, not a write
change.
"""
import json
import os
import sqlite3
import sys

trevor_dir = os.environ.get("TREVOR_PROJECT_DIR", "/home/trevor/trevor")
db_path = os.environ.get("TREVOR_DB_PATH", os.path.join(trevor_dir, "trevor.db"))


def main():
    scope = sys.argv[1] if len(sys.argv) > 1 else "get"

    if scope == "get":
        # 🚨 The unknown default. Nothing below may set `capital` to a number
        # unless it has actually READ a trading_capital row saying so.
        out = {"capital": None, "capital_state": "unknown", "error": None}
        conn = None
        try:
            # connect() is INSIDE the try on purpose: it used to sit outside, so
            # a missing DB file raised, exit-1'd, made runPython throw, and the
            # route's own catch minted the same 50.0. The false green was
            # reachable by two paths; closing one would have left it live.
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT value FROM trevor_config WHERE key='trading_capital'"
            ).fetchone()
            if row is not None and row["value"] is not None:
                out["capital"] = float(row["value"])
                out["capital_state"] = "read"
            else:
                out["error"] = "trading_capital row absent from trevor_config"
        except Exception as exc:  # noqa: BLE001 — fail-soft; exit 0, never a reading
            # The except branch may write `error`, never a reading.
            out["error"] = f"{type(exc).__name__}: {exc}"
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
        print(json.dumps(out))

    elif scope == "set":
        value = float(sys.argv[2]) if len(sys.argv) > 2 else 50.0
        conn = sqlite3.connect(db_path, timeout=10)
        conn.execute(
            "INSERT OR REPLACE INTO trevor_config (key, value, updated_at) VALUES ('trading_capital', ?, datetime('now'))",
            (str(value),),
        )
        conn.commit()
        conn.close()
        print(json.dumps({"capital": value, "updated": True}))

    else:
        print(json.dumps({"error": f"Unknown scope: {scope}"}))


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
