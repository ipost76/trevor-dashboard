#!/usr/bin/env python3
"""query_loop_heartbeat.py — [B6] / RM-WATCH. The Hub's LIVE background-loop health read.

🚨 THE POINT. `[B1]` (`ed23440`) made the trainer honest in the database — it now writes
`loop_heartbeat.degraded_reason` every iteration, symmetric (NULL clears as readily as a
reason sets). `[B1]` deliberately left cause 5 open: **nothing on the Hub rendered it.**
Ghost watches the Hub, not `journalctl`, and he is about to step back for two weeks. This
helper is the read behind that render.

READ-ONLY. Zero writes, no schema change, no ALTER. `[B1]`'s one-time, by-name `ALTER`
override does NOT extend here (Hub CLAUDE.md, Hub-Specific Rules).

🚨 WHY THIS READS THE LIVE VM AND NOT THE REPLICA — measured, not assumed.
   `/home/ghost/trevor-replica/trevor.db` (WSL, 0444) is a litestream restore running
   ~19–30 min behind. Measured B6, same instant:
       replica `scheduler_loop` last_iteration 18:00:09   live 18:23:09   (~24 min)
   Every loop with a cadence under ~12 min therefore reads STALE off the replica forever.
   That is not hypothetical: the Hub's ONLY pre-existing `loop_heartbeat` tile,
   `query_system_health.collect_scanner_lag`, reads the replica and returned
   `tone:"red" value:"1596s"` for `scalp_scan_loop` at the same moment the LIVE row was
   **2 s** old. A card that renders a healthy system red gets ignored, and an ignored card
   is worse than no card. So we read the live VM over the sanctioned read-only `ssh` pipe,
   the way `query_level_state.py` (`/api/watcher/level`) and
   `scripts/external_liveness_check.py` (`f881f8e`) already do.

🚨 A FAILED READ IS `unknown`, NEVER `ok`, AND NEVER THE REPLICA. Ghost's call at the B6
   gate: no replica fallback. A labelled-stale card is still a card people read as current,
   so the lag would come back in through the door marked "clearly labelled". ssh down, DB
   unreachable, no row, an unparseable timestamp, a negative age — each surfaces as UNKNOWN
   with its own reason.

🚨 THE CLOCK. `last_iteration_at` is offset-aware ISO **UTC**
   (`2026-08-05T18:23:42.083078+00:00`), NOT the naive-Eastern form `auto_trades.opened_at`
   uses. Ages are computed IN the VM's own SQLite via `strftime('%s', ...)`, which honours
   the offset, so there is no 4 h phantom-staleness trap. Proof recorded B6: the same query
   returns age=12 s for `auto_trader_monitor_loop` (30 s cadence) and 15 s for
   `scheduler_loop` (60 s cadence); a 4 h clock error would read ±14400.
   ⚠️ THE FORMAT IS MIXED: 22 of 24 rows are offset-aware ISO, 2 (`shadow_readiness_gate`,
   `daily_email_triage`) are naive space-separated `YYYY-MM-DD HH:MM:SS`. SQLite parses
   both (naive is read as UTC, which is how they are written). Anything it cannot parse
   yields a NULL age and renders UNKNOWN — never stale, never healthy.

🚨 THE STALENESS THRESHOLD IS BORROWED ON PURPOSE: `max(3600, cadence*2)`, byte-identical
   to `watcher_surface.check_loop_freshness` and to `external_liveness_check`'s trainer
   default. Three instruments, one definition of stale. Minting a fourth would guarantee
   they disagree in public.

── THE SIX STATES, and why `unpopulated` had to exist ────────────────────────────────────
   ok           fresh, and `degraded_reason` is NULL from code that is actually writing it
   degraded     `degraded_reason` is set — the loop is running and saying it is impaired
   stale        no iteration within max(3600, cadence*2)
   unpopulated  🚨 THE FOURTH STATE. The column exists but nothing is writing it.
   unknown      the read failed, or the row cannot be judged
   dormant      `is_dormant=1` — parked deliberately; NOT a fault and NOT green

   ⚠️ **THE CONDITION THAT MOTIVATED `unpopulated` HAS SINCE CLEARED — the state has NOT.**
   This block used to assert, in the present tense, that `[B1]`'s restart was still pending
   and that `trainer_search_loop` was therefore running the PRE-`[B1]` module with
   `degraded_reason` NULL. **That restart has happened.** Re-measured live on the VM
   2026-08-06 (RM-TRAINER-B1): the trainer row now reads `degraded_reason='no_simulator'`,
   `error_count=21` and climbing once per iteration — the column is POPULATED and the row
   classifies `degraded`, not `unpopulated`. Whole-table read the same instant: 13 `ok`,
   1 `degraded`, **0 `unpopulated`**.

   🚨 **DO NOT DELETE `unpopulated` ON THE STRENGTH OF THAT.** It is the guard for a
   condition that recurs the moment any loop is restarted onto a module that predates its
   own degraded-reason emit — which is exactly what had happened when it was written. The
   historical measurement is kept below as the worked example precisely because it is the
   shape the state exists to catch. Rendering a NULL as green would report a degraded loop
   as healthy, which is the defect `[B1]` fixed one layer down. **An absent signal is not
   a negative signal**, and a state that currently matches zero rows is a guard, not dead
   code.

   🚨 THE DISCRIMINATOR IS SINGLE-POLL, and it has to be. The obvious test — "error_count
   is not advancing between polls" — cannot decide the FIRST frame, and the first frame is
   what Ghost sees. So the structural test is `last_error_at` vs `last_iteration_at`:
   post-`[B1]` the degraded reason is folded into the per-iteration emit, so `error_count`
   increments every iteration and `last_error_at` tracks `last_iteration_at`. Pre-`[B1]` it
   was emitted ONCE above the loop and went silent, so `last_error_at` freezes while
   `last_iteration_at` advances. Measured on the live row **as it stood 2026-08-05, before
   the restart** (the worked example, not current state): `last_error_at`
   2026-08-04T14:00:16Z vs `last_iteration_at` 2026-08-05T18:02:37Z — **28 h and 35
   iterations apart**. One poll decides it. The cross-poll `error_count` check still runs,
   client-side, as corroboration on top (see loop-heartbeat-card.tsx).

Test seam (mirrors `LIVENESS_DRY_RUN` / `WATCHER_ARM_DRY_RUN`, the house idiom):
  LOOP_HB_SOURCE_JSON=<path>   read the VM payload from a file instead of the ssh pipe.
                               Used to drive every state end-to-end without touching a
                               live store. Absent (the default) = the real live read.

Env overrides (all optional; the defaults are the live values):
  LOOP_HB_VM_HOST   ssh alias for the VM        (default `vm`)
  LOOP_HB_VM_DB     VM live DB path             (default /home/trevor/trevor/trevor.db)
  LOOP_HB_TIMEOUT   ssh timeout, seconds        (default 20)

Python 3, stdlib only. Prints one JSON object to stdout and always exits 0 — the Hub route
parses stdout; a non-zero exit would surface as a 500 on a page Ghost is reading for health.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

VM_HOST = os.environ.get("LOOP_HB_VM_HOST", "vm")
VM_DB = os.environ.get("LOOP_HB_VM_DB", "/home/trevor/trevor/trevor.db")
SSH_TIMEOUT = int(os.environ.get("LOOP_HB_TIMEOUT", "20"))
SOURCE_JSON = os.environ.get("LOOP_HB_SOURCE_JSON", "")

STALE_FLOOR = 3600  # the shared floor — see the module docstring

OK = "ok"
DEGRADED = "degraded"
STALE = "stale"
UNPOPULATED = "unpopulated"
UNKNOWN = "unknown"
DORMANT = "dormant"

# Worst-first. `unknown` sits ABOVE `ok` deliberately: "I could not tell" must never be
# summarised as "everything is fine". `dormant` is not ranked — a parked loop is not a
# verdict about the system, so it never drives the roll-up.
_RANK = {STALE: 5, DEGRADED: 4, UNPOPULATED: 3, UNKNOWN: 2, OK: 1, DORMANT: 0}


# ── the VM-side program ──────────────────────────────────────────────────────────────────
# Sent over stdin to `python3 -` as the `trevor` user. Opens the live DB `mode=ro`, computes
# both ages in the VM's OWN SQLite clock, and prints one JSON line. It NEVER raises out: a
# failure prints {"error": ...} so the WSL side can render UNKNOWN with a real reason rather
# than an ssh traceback.
#
# `__DB__` is substituted by .replace() rather than %-formatting or .format(): the program
# is full of `%s` (strftime) and `{}` would collide with nothing here, but a single stray
# format specifier in a cross-box program is a class of bug worth designing out.
_VM_PROG = r"""
import json, sqlite3
out = {"rows": [], "degraded_column": None, "error": None}
try:
    c = sqlite3.connect("file:__DB__?mode=ro", uri=True)
    cols = [r[1] for r in c.execute("PRAGMA table_info(loop_heartbeat)").fetchall()]
    if not cols:
        raise RuntimeError("loop_heartbeat table is absent")
    has_dr = "degraded_reason" in cols
    out["degraded_column"] = has_dr
    dr_expr = "degraded_reason" if has_dr else "NULL"
    sql = (
        "SELECT loop_name, COALESCE(cadence_seconds, 0), last_iteration_at, "
        "COALESCE(iteration_count, -1), COALESCE(error_count, -1), last_error, "
        "last_error_at, COALESCE(is_dormant, 0), " + dr_expr + ", "
        "CAST(strftime('%s','now') - strftime('%s', last_iteration_at) AS INTEGER), "
        "CAST(strftime('%s','now') - strftime('%s', last_error_at) AS INTEGER) "
        "FROM loop_heartbeat"
    )
    for r in c.execute(sql).fetchall():
        out["rows"].append({
            "loop_name": r[0], "cadence_seconds": r[1], "last_iteration_at": r[2],
            "iteration_count": r[3], "error_count": r[4], "last_error": r[5],
            "last_error_at": r[6], "is_dormant": r[7], "degraded_reason": r[8],
            "age_sec": r[9], "error_age_sec": r[10],
        })
    c.close()
except Exception as e:
    out["error"] = str(e)
print(json.dumps(out))
"""


def _fetch() -> dict:
    """Return the VM payload, or {'error': reason}. NEVER raises."""
    if SOURCE_JSON:
        # Test seam. A malformed/absent fixture is an UNKNOWN like any other failed read —
        # it must not be able to fabricate a healthy payload.
        try:
            with open(SOURCE_JSON) as fh:
                data = json.load(fh)
            return data if isinstance(data, dict) else {
                "error": f"fixture {SOURCE_JSON} is not a JSON object"}
        except Exception as exc:  # noqa: BLE001
            return {"error": f"fixture unreadable: {exc}"}

    prog = _VM_PROG.replace("__DB__", VM_DB)
    try:
        p = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", VM_HOST,
             "sudo", "-n", "-u", "trevor", "python3", "-"],
            input=prog, capture_output=True, text=True, timeout=SSH_TIMEOUT,
            env={**os.environ, "HOME": os.environ.get("HOME", "/home/ghost")})
    except subprocess.TimeoutExpired:
        return {"error": f"ssh to {VM_HOST} timed out after {SSH_TIMEOUT}s"}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"ssh to {VM_HOST} could not be run: {exc}"}

    if p.returncode != 0:
        return {"error": f"ssh rc={p.returncode}: {(p.stderr or '').strip()[:160]}"}
    raw = (p.stdout or "").strip()
    if not raw:
        return {"error": "the VM read produced no output"}
    try:
        return json.loads(raw.splitlines()[-1])
    except Exception as exc:  # noqa: BLE001
        return {"error": f"unparsable VM payload: {exc}"}


def stale_threshold(cadence_seconds) -> int:
    """max(3600, cadence*2) — the SAME definition watcher_surface and the external liveness
    check use. Shared on purpose: three instruments, one meaning of 'stale'."""
    try:
        cadence = int(cadence_seconds or 0)
    except (TypeError, ValueError):
        cadence = 0
    return max(STALE_FLOOR, cadence * 2)


def classify(row: dict, degraded_column: bool | None) -> dict:
    """One loop's row -> {state, tone, reason, ...}. Pure: no clock, no I/O, no globals.

    Ages arrive already computed in the VM's clock, so this function cannot introduce a
    cross-box skew of its own — which is the whole reason it does not take a `now`.
    """
    name = row.get("loop_name") or "(unnamed)"
    cadence = row.get("cadence_seconds") or 0
    threshold = stale_threshold(cadence)
    age = row.get("age_sec")
    err_age = row.get("error_age_sec")
    reason = (row.get("degraded_reason") or "").strip() or None
    last_error = (row.get("last_error") or "").strip() or None
    dormant = bool(row.get("is_dormant"))

    out = {
        "loop_name": name,
        "cadence_seconds": cadence,
        "stale_threshold_sec": threshold,
        "age_sec": age,
        "iteration_count": row.get("iteration_count"),
        "error_count": row.get("error_count"),
        "last_error": last_error,
        "last_error_at": row.get("last_error_at"),
        "last_iteration_at": row.get("last_iteration_at"),
        # 🚨 Carried on EVERY row regardless of the state that wins below. A stale loop that
        # is also degraded must not lose its reason to the more urgent verdict.
        "degraded_reason": reason,
        "detail": "",
        "state": UNKNOWN,
    }

    # 1. Un-judgeable BEFORE anything else. A NULL age means SQLite could not parse
    #    last_iteration_at; a negative age means the row is in the future (cross-box clock
    #    skew). Neither is fresh and neither is stale — both are unresolved.
    if age is None:
        out["detail"] = (f"last run time {row.get('last_iteration_at')!r} could not be read"
                         if row.get("last_iteration_at") else "no last run time recorded")
        return out
    try:
        age = int(age)
    except (TypeError, ValueError):
        out["detail"] = f"age {age!r} is not a number"
        return out
    out["age_sec"] = age
    if age < 0:
        out["detail"] = f"last run is {abs(age)}s in the FUTURE — cross-box clock skew"
        return out

    # 2. Parked on purpose. Honoured the way watcher_surface honours it — a dormant loop is
    #    not a fault, and it is not a clean bill of health either.
    if dormant:
        out["state"] = DORMANT
        out["detail"] = "parked on purpose (is_dormant=1) — not running, not a fault"
        return out

    # 3. Stopped outranks impaired: if it is not running, that is the more urgent fact. The
    #    reason still rides along on the row above, so nothing is lost.
    if age > threshold:
        out["state"] = STALE
        out["detail"] = (f"no update for {age}s — past its {threshold}s limit "
                         f"(cadence {cadence}s)")
        if reason:
            out["detail"] += f"; last said: {reason}"
        return out

    # 4. Running and saying so.
    if reason:
        out["state"] = DEGRADED
        out["detail"] = reason
        return out

    # 5. 🚨 THE FOURTH STATE. A NULL degraded_reason means one of two very different things
    #    and they must not share a colour: either the writer cleared it (healthy), or
    #    nothing is writing it at all. If the column does not exist on this DB, or the loop
    #    still carries a last_error whose timestamp has frozen while iterations advance,
    #    then nothing is writing it — say UNKNOWN-shaped, never green.
    if degraded_column is False:
        out["state"] = UNPOPULATED
        out["detail"] = ("this database has no degraded_reason column, so an impaired loop "
                         "would look identical to a healthy one")
        return out
    if last_error:
        if err_age is None:
            # An error with no readable timestamp cannot be shown to be current, so it is
            # not evidence of a live writer. Unresolved leans to UNPOPULATED, never to OK.
            frozen = True
        else:
            try:
                # The error timestamp lagging the iteration timestamp by more than one full
                # cadence means the error surface stopped moving while the loop kept going.
                frozen = (int(err_age) - age) > max(int(cadence or 0), 60)
            except (TypeError, ValueError):
                frozen = True
        if frozen:
            out["state"] = UNPOPULATED
            out["detail"] = (
                f"reports \"{last_error}\" but has not refreshed that report in "
                f"{'an unknown time' if err_age is None else str(int(err_age)) + 's'} "
                f"while still running — the code writing degraded_reason is not loaded "
                f"(a restart is pending)")
            return out

    # 6. Fresh, no reason, and the reason field is demonstrably being maintained.
    out["state"] = OK
    out["detail"] = f"updating normally every {cadence}s (last {age}s ago)"
    return out


def rollup(loops: list) -> dict:
    """Worst-of across the loops that are supposed to be running. Dormant rows never vote."""
    counts = {OK: 0, DEGRADED: 0, STALE: 0, UNPOPULATED: 0, UNKNOWN: 0, DORMANT: 0}
    for lp in loops:
        counts[lp["state"]] = counts.get(lp["state"], 0) + 1
    voting = [lp["state"] for lp in loops if lp["state"] != DORMANT]
    worst = max(voting, key=lambda s: _RANK.get(s, 0)) if voting else UNKNOWN
    return {"worst": worst, "counts": counts, "active": len(voting), "total": len(loops)}


def main() -> int:
    payload = _fetch()

    if payload.get("error"):
        # 🚨 One shape for every failed read, and it is never the replica and never a zero.
        print(json.dumps({
            "status": UNKNOWN,
            "source": "vm-live",
            "degraded_column": None,
            "loops": [],
            "rollup": {"worst": UNKNOWN, "counts": {}, "active": 0, "total": 0},
            "error": str(payload["error"])[:300],
        }))
        return 0

    degraded_column = payload.get("degraded_column")
    rows = payload.get("rows") or []
    if not rows:
        print(json.dumps({
            "status": UNKNOWN,
            "source": "vm-live",
            "degraded_column": degraded_column,
            "loops": [],
            "rollup": {"worst": UNKNOWN, "counts": {}, "active": 0, "total": 0},
            "error": "the heartbeat table was read but held no rows",
        }))
        return 0

    loops = [classify(r, degraded_column) for r in rows]
    # Worst first, then oldest first — the thing that needs looking at is at the top.
    loops.sort(key=lambda lp: (-_RANK.get(lp["state"], 0), -(lp["age_sec"] or 0)))

    print(json.dumps({
        "status": OK,                      # the READ succeeded; the VERDICT is in rollup
        "source": "vm-live",
        "degraded_column": degraded_column,
        "loops": loops,
        "rollup": rollup(loops),
        "error": None,
    }))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        # OUTER-WRAP: silent-crash visibility (mirrors query_loop_health.py). Even a bug in
        # THIS file must reach the screen as UNKNOWN rather than as an empty 500.
        print(json.dumps({
            "status": UNKNOWN, "source": "vm-live", "degraded_column": None,
            "loops": [], "rollup": {"worst": UNKNOWN, "counts": {}, "active": 0, "total": 0},
            "error": f"query_loop_heartbeat.py crashed: {exc}",
        }))
        sys.exit(0)
