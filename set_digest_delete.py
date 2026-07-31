#!/usr/bin/env python3
"""set_digest_delete.py — Hub write surface for the digest feed's delete control [D2].

Backs DELETE /api/health/digests/<date>, the per-card delete on the Health zone's
"Digest" sub-tab. Mirrors set_ai_command.py: reads ONE JSON object from stdin,
emits ONE JSON object to stdout, exits with a status code the route maps to HTTP.

🚨 THIS IS THE HUB'S FIRST DELETE PATH. Read the three bounds before editing.

AUTHORITY: BEHAVIOR_RULES Rule 15 exception #2 (Ghost-directed, 2026-07-31, D1) —
`digest` only, an observability artifact read by nothing on the trading path.
"Bounded DELETEs by named `digest_date` are permitted; an unbounded
`DELETE FROM digest` is not." This helper issues ONLY the bounded form and holds
no code path to an unbounded one. The exception explicitly NEVER GENERALIZES: do
not copy this file as the template for deleting from any other table.

⚠️ WRITES THE VM *LIVE* trevor.db, NOT the replica. The WSL litestream/tailsync
replica at /home/ghost/trevor-replica/trevor.db is 0444 and republished wholesale
every ~20 min, so a write there is refused outright ("attempt to write a readonly
database") and would silently revert even if it were not — the row would reappear
and the user would think delete is broken. Like set_ai_command.py, the write
reaches the VM over the read-only-login `ssh vm` pipe, running
`sudo -n -u trevor python3 -` so any journal/WAL files stay owned by `trevor`
(matching the bot). The remote program arrives on STDIN — no VM file is created
or edited by this helper.

🚨 WHY ssh AND NOT THE TWO-HOP GATEWAY (recorded so a future reader does not
"fix" this by rerouting it): the :3939 -> :3940 gateway is a FIXED ALLOWLIST of
named ops, each bound to a named helper script that must exist ON THE VM. There
is no generic DB-write op — a `digest.delete` op returns `unknown op` (400),
measured live at the D2 gate. Adding one means a new VM-side helper file, a new
entry in /home/trevor/trevor/gateway/vm_gateway.js, and a VM gateway restart:
all off the WSL box. The gateway IS the tidier long-term home and buys a flag
gate + a mandatory idempotency key, neither of which this path has. If the Hub
ever grows more write paths, move this one there rather than adding a second
ssh-shaped writer.

THE THREE BOUNDS — all enforced on the VM, inside one transaction:
  1. The ONLY table touched is `digest`. No other table, no other verb.
  2. The delete is BOUNDED TO ONE ROW BY digest_date. A pre-count of 0 or >1
     issues NO DELETE at all and returns a distinguishable outcome. After the
     DELETE, a rowcount != 1 ROLLS BACK — a best-effort delete is never
     acceptable here.
  3. digest_date is a BOUND PARAMETER, never interpolated into SQL. It is also
     shape-validated (^\\d{4}-\\d{2}-\\d{2}$) twice before it gets that far —
     once in the route, once here — so a malformed value never reaches the VM.

The payload crosses as base64-embedded JSON (never the remote shell), matching
set_ai_command.py. Rule 26 is satisfied by construction: no user value is
interpolated into the remote Python source, and the date is provably
`^\\d{4}-\\d{2}-\\d{2}$` before encoding.

Usage (called by DELETE /api/health/digests/<date> via runPython with stdin):
    echo '{"digest_date":"2026-07-31","author":"ghost"}' | set_digest_delete.py

Outcomes (always on stdout as one JSON object):
    {"ok":true,  "outcome":"deleted"}              row removed (exactly one)
    {"ok":false, "outcome":"not_found"}            no such digest_date
    {"ok":false, "outcome":"refused_multi"}        pre-count > 1 (no DELETE issued)
    {"ok":false, "outcome":"refused_rowcount"}     DELETE matched != 1 (rolled back)
    {"ok":false, "outcome":"invalid_date"}         shape rejected before SQL
    {"ok":false, "outcome":"vm_unreachable"}       ssh failed/timed out
    {"ok":false, "outcome":"db_error"}             remote sqlite error

Exit codes:
    0  the delete happened (outcome=deleted)
    1  usage / bad JSON / invalid date  (nothing was attempted)
    2  backend / VM-unreachable / DB error / refused  (nothing was deleted)
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from typing import NoReturn

SSH_BASE = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "vm"]

# Strict shape gate. Deliberately a WHOLE-STRING match on exactly ten characters:
# a date is not "mostly digits", and an unbounded string has no business reaching
# a DB parameter even though it would be bound safely.
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Pure-stdlib program run ON THE VM as `trevor`. Deletes AT MOST ONE row from the
# LIVE `digest` table. The date arrives via the base64-embedded PARAMS dict —
# never the remote shell — and is bound as a SQL parameter.
#
# The audit INSERT mirrors set_ai_command.py's C-7 shape: additive change_log row
# in the SAME transaction, wrapped so an audit failure can never abort or
# un-delete the row. Note the asymmetry from an enqueue: here the audit is
# written BEFORE the commit but AFTER the rowcount assertion, so a row that is
# rolled back is never audited as deleted.
_REMOTE_BODY = r'''
import sqlite3, json as _json
DB = "/home/trevor/trevor/trevor.db"
DATE = PARAMS["digest_date"]
con = None
try:
    con = sqlite3.connect(DB, timeout=10)
    con.execute("PRAGMA busy_timeout=10000")
    con.execute("BEGIN IMMEDIATE")

    # BOUND 2, first half: count before touching anything. A 0 or >1 pre-count
    # issues NO DELETE — the caller gets a distinguishable refusal, never a
    # best-effort removal.
    n = con.execute(
        "SELECT COUNT(*) FROM digest WHERE digest_date = ?", (DATE,)
    ).fetchone()[0]
    if n == 0:
        con.rollback(); con.close()
        print(_json.dumps({"_status": "not_found"}))
        raise SystemExit(0)
    if n > 1:
        con.rollback(); con.close()
        print(_json.dumps({"_status": "refused_multi", "matched": n}))
        raise SystemExit(0)

    # Capture identifying fields for the audit BEFORE the row is gone.
    row = con.execute(
        "SELECT id, generated_at FROM digest WHERE digest_date = ?", (DATE,)
    ).fetchone()
    rid = row[0] if row else None
    gen = row[1] if row else None

    cur = con.execute("DELETE FROM digest WHERE digest_date = ?", (DATE,))

    # BOUND 2, second half: the belt to the pre-count's braces. If the engine
    # somehow removed anything other than exactly one row, nothing is kept.
    if cur.rowcount != 1:
        con.rollback(); con.close()
        print(_json.dumps({"_status": "refused_rowcount", "rowcount": cur.rowcount}))
        raise SystemExit(0)

    try:
        con.execute(
            "INSERT INTO change_log "
            "(table_name, row_id, key, old_value, new_value, actor, source_type, session_id, notes) "
            "VALUES ('digest', ?, 'digest_date', ?, NULL, ?, 'UI', ?, ?)",
            (rid, DATE, PARAMS["actor"], PARAMS["actor"],
             "Digest hard-deleted via Hub delete control (ssh-to-live) [D2]"),
        )
    except Exception:
        pass

    con.commit()
    con.close()
    print(_json.dumps({"_status": "ok", "id": rid, "generated_at": gen}))
except SystemExit:
    raise
except Exception as e:
    try:
        if con is not None:
            con.rollback(); con.close()
    except Exception:
        pass
    print(_json.dumps({"_status": "error", "detail": f"{type(e).__name__}: {e}"}))
'''


def _emit(payload: dict, code: int = 0) -> NoReturn:
    print(json.dumps(payload, default=str))
    sys.exit(code)


def delete_digest(digest_date: str, author: str) -> None:
    payload = {
        "digest_date": digest_date,
        "actor": author,
        "requested_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
    }
    b64 = base64.b64encode(json.dumps(payload).encode()).decode()
    program = (
        "import base64, json\n"
        "PARAMS = json.loads(base64.b64decode('" + b64 + "').decode())\n"
        + _REMOTE_BODY
    )
    try:
        proc = subprocess.run(
            SSH_BASE + ["sudo", "-n", "-u", "trevor", "python3", "-"],
            input=program,
            capture_output=True,
            text=True,
            timeout=15,
            # Defensive only: ssh resolves ~/.ssh from the UID (getpwuid), not
            # $HOME [RF3T2-B8]. Kept to match the sibling helper exactly.
            env={**os.environ, "HOME": "/home/ghost"},
        )
    except subprocess.TimeoutExpired:
        _emit({"ok": False, "outcome": "vm_unreachable",
               "error": "VM unreachable: ssh timeout"}, code=2)
    except Exception as exc:  # pragma: no cover
        _emit({"ok": False, "outcome": "vm_unreachable",
               "error": f"VM unreachable: {type(exc).__name__}: {exc}"}, code=2)

    if proc.returncode != 0 or not proc.stdout.strip():
        _emit({"ok": False, "outcome": "vm_unreachable",
               "error": f"VM error: {(proc.stderr or 'ssh failed').strip()[:200]}"}, code=2)
    try:
        data = json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        _emit({"ok": False, "outcome": "db_error",
               "error": "VM error: unparseable remote output"}, code=2)

    status = data.get("_status")

    if status == "ok":
        _emit({
            "ok": True,
            "outcome": "deleted",
            "digest_date": digest_date,
            "id": data.get("id"),
            "generated_at": data.get("generated_at"),
            "target": "vm_live",
        }, code=0)

    if status == "not_found":
        _emit({"ok": False, "outcome": "not_found", "digest_date": digest_date,
               "error": f"No digest exists for {digest_date}."}, code=2)

    if status == "refused_multi":
        _emit({"ok": False, "outcome": "refused_multi", "digest_date": digest_date,
               "matched": data.get("matched"),
               "error": (f"Refused: {data.get('matched')} rows match {digest_date}. "
                         "This delete only ever removes exactly one.")}, code=2)

    if status == "refused_rowcount":
        _emit({"ok": False, "outcome": "refused_rowcount", "digest_date": digest_date,
               "rowcount": data.get("rowcount"),
               "error": ("Refused and rolled back: the delete matched "
                         f"{data.get('rowcount')} rows, not exactly one.")}, code=2)

    _emit({"ok": False, "outcome": "db_error", "digest_date": digest_date,
           "error": f"DB error: {data.get('detail', 'unknown')}"}, code=2)


def main() -> None:
    raw = sys.stdin.read() if not sys.stdin.isatty() else (sys.argv[1] if len(sys.argv) > 1 else "")
    if not raw:
        _emit({"ok": False, "outcome": "invalid_date",
               "error": "missing JSON body on stdin"}, code=1)
    try:
        body = json.loads(raw)
    except json.JSONDecodeError as exc:
        _emit({"ok": False, "outcome": "invalid_date", "error": f"bad JSON: {exc}"}, code=1)

    digest_date = body.get("digest_date")
    # BOUND 3: the shape gate. Reject before the value can reach SQL — a
    # non-string, an empty string, a LIKE wildcard, a quote, or anything that is
    # not exactly YYYY-MM-DD never leaves this function.
    if not isinstance(digest_date, str) or not DATE_RE.match(digest_date):
        _emit({"ok": False, "outcome": "invalid_date",
               "error": "digest_date must match YYYY-MM-DD"}, code=1)

    author = str(body.get("author", "ghost")).strip() or "ghost"
    delete_digest(digest_date, f"hub:{author}")


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (matches sibling helpers)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(2)
