#!/usr/bin/env python3
"""
query_shadow_week.py — read the shadow-week panel row for GET /api/shadow-week.
RM-CUTOVER Wave C · C4 Phase 2.

Reads data/hub.db READ-ONLY (the Hub's own DB — never the trevor.db replica, so the
card is lag-free and independent of which box the Hub points at, A7 §8.6). The
writer is scripts/db/shadow_week_pull.py on a 15-minute timer.

🚨 DERIVES NO VERDICT. The only thing computed here is `panel_state`, which is about
   the PANEL's own freshness and reachability, never about the two instances. Every
   class, count and state from B1/B4 passes through VERBATIM.

🚨 THE FOUR PANEL STATES, and why none of them may render as a clean day:
     NO_DATA      nothing has ever been pulled. The shadow does not exist until C5,
                  so this is the honest dominant state today. It is NOT a clean day.
     UNREACHABLE  the last pull could not read ghostbox. A one-sided view must say
                  so on its face -- never green, never silently omitted.
     STALE        a row exists but B4 stopped writing (>28h, B4's threshold). 🚨 This
                  must render as a FAULT. If the panel silently shows its last known
                  values when the monitor has stopped, it reproduces the exact
                  failure the monitoring exists to prevent: a stopped monitor and a
                  clean week look identical.
     OK           fresh, reachable. Says nothing about whether the week is passing --
                  `harness_state` answers that, and it outranks everything.

USAGE  python3 scripts/db/query_shadow_week.py
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HUB_DB = os.path.join(REPO_ROOT, "data", "hub.db")

# B4's own threshold, from C4_HUB_PANEL_SPEC.md §3: stale = (now - generated_at_et) > 28h.
STALE_AFTER_S = 28 * 3600


def _base(panel_state: str, reason: str) -> dict:
    return {
        "panel_state": panel_state,
        "reason": reason,
        "stale": panel_state == "STALE",
        "row": None,
        "fetch": None,
        "schema": "b4mon/hub-panel/1",
    }


def main() -> int:
    if not os.path.exists(HUB_DB):
        print(json.dumps(_base("NO_DATA", "hub_db_missing")))
        return 0
    try:
        conn = sqlite3.connect(f"file:{HUB_DB}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
    except Exception as exc:  # noqa: BLE001
        print(json.dumps(_base("NO_DATA", f"db_open_error: {exc}")))
        return 0

    try:
        names = {
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        if "shadow_week_status" not in names:
            print(json.dumps(_base("NO_DATA", "table_absent — puller has never run")))
            return 0

        srow = conn.execute("SELECT * FROM shadow_week_status WHERE id=1").fetchone()
        frow = (
            conn.execute("SELECT * FROM shadow_week_fetch WHERE id=1").fetchone()
            if "shadow_week_fetch" in names else None
        )
        fetch = dict(frow) if frow else None

        if srow is None:
            out = _base("NO_DATA", "no row yet — the shadow does not start until C5")
            out["fetch"] = fetch
            print(json.dumps(out))
            return 0

        row = dict(srow)
        # Classes and pass conditions pass through as PARSED JSON, unmodified.
        try:
            row["not_drift"] = json.loads(row.pop("not_drift_json") or "{}")
        except Exception:  # noqa: BLE001
            row["not_drift"] = {}
        try:
            row["pass_conditions"] = json.loads(row.pop("pass_conditions_json") or "[]")
        except Exception:  # noqa: BLE001
            row["pass_conditions"] = []

        age_s = None
        try:
            gen = datetime.fromisoformat(row["generated_at_et"])
            if gen.tzinfo is None:
                gen = gen.replace(tzinfo=timezone.utc)
            age_s = (datetime.now(timezone.utc) - gen).total_seconds()
        except Exception:  # noqa: BLE001
            age_s = None
        row["age_s"] = age_s

        # 🚨 UNREACHABLE outranks STALE: it names the CAUSE. Staleness is still
        #    reported alongside so a reader never has to infer it.
        if fetch is not None and not fetch.get("ok"):
            out = _base("UNREACHABLE", fetch.get("error") or "last pull failed")
        elif age_s is None:
            out = _base("STALE", "generated_at_et unparseable — freshness unknown")
        elif age_s > STALE_AFTER_S:
            hours = age_s / 3600.0
            out = _base("STALE", f"B4 last wrote {hours:.1f}h ago (threshold 28h)")
        else:
            out = _base("OK", "fresh")

        out["stale"] = bool(age_s is not None and age_s > STALE_AFTER_S) or (
            out["panel_state"] == "STALE"
        )
        out["row"] = row
        out["fetch"] = fetch
        print(json.dumps(out))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps(_base("NO_DATA", f"query_error: {exc}")))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
