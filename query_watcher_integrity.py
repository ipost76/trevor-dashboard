#!/usr/bin/env python3
"""query_watcher_integrity.py — WATCHER page backend (integrity + reconciliation).

Backs GET /api/watcher/integrity — the R12 WATCHER cockpit's `integrity` sub-tab.
Reads the watcher's SEPARATE, must-never-drift integrity store
`data/watcher_integrity.db` READ-ONLY (`mode=ro`) and returns:

  * integrity_findings — the recorded results of the watcher's own L10-style
    level/ID integrity checks (increment_when_should / no_silent_drift /
    chain_consistency / apply_oversight). Each row carries an `ok` flag + a
    findings blob (parsed here to a bounded count/list).
  * reconciliation_log — declared-vs-detected trading-change reconciliation.
    Ranked DANGEROUS-FIRST: `undeclared_trading_change` (a change detected but
    NEVER declared — the dangerous case) ranks above `declared_not_detected`
    (a tripwire gap), then newest.
  * watcher_state — the integrity module's key/value state.

This store is physically separate from watcher.db by design (a trainer/review
bug must never take down its own oversight). READ-ONLY, opens the sqlite file
directly, imports no watcher writer. Named `query_*` so the AST independence
guard never sweeps it in.

PRE-CUTOVER EMPTY IS THE DISPLAY: `no such table` / 0 rows -> empty shape + exit
0, NEVER a traceback. The route wraps this in safeJsonParse + a fallback so a
Python error can never become an HTTP 500.

🚨 THREE STATES, NOT ONE (B2-HUB-READER-HONESTY, 2026-08-04) — `status` is the
discriminator:
    "ok"        every table was READ (or was legitimately ABSENT pre-cutover)
    "degraded"  the store opened but at least one table could not be READ
    "unknown"   the store could not be opened at all, or the reader crashed

This file used to emit `"status": "ok"` on EVERY path, including the two that
took no reading at all. `_EMPTY` hardcoded it, so a DB-connect failure and a
reader crash both reported a clean bill of health for the module that watches
for undeclared trading changes. `status` KEEPS ITS NAME AND STAYS POPULATED —
only its unknown value moves from "ok" to "unknown"/"degraded". (B3-HUB measured
that renaming a field out from under a live branch is itself a false-green
generator; C3 held `enabled` populated at `184bb6a` for the same reason.)

🚨 AND THE THIRD SHAPE IS THE ONE THAT REACHED THE SCREEN. The three table reads
below used to be guarded by a bare `except sqlite3.OperationalError: pass`, which
cannot tell "this table does not exist yet" (the EXPECTED pre-cutover state) from
"this table exists and I could not read it" (schema drift, a locked DB, disk I/O).
MEASURED 2026-08-04 by dropping one column from `integrity_findings`: a REAL
unresolved `ok=0` finding vanished into `findings: []`, `status` said `ok`, and
**no `error` key was set at all** — so the renderer's `data.error` branch never
fired and the screen painted the healthy empty state. The other two shapes are
caught today ONLY because they populate `error`; this one populated nothing.
An absent table is still silently fine. Anything else is now NAMED.

The rule this file is measured against, quoted verbatim from
`query_trainer_pause.py` (WSL, repo root):
    "The unknown default. Nothing below may set these to a not-paused reading."
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any, Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(_HERE, "data", "watcher_integrity.db")

# R10-B2's reconciliation severity ranking. Dangerous-first.
_KIND_RANK = {"undeclared_trading_change": 0, "declared_not_detected": 1}

# 🚨 The unknown default. Nothing below may set `status` to "ok" unless every
# table was actually READ (or was legitimately absent). This constant is used on
# the two paths that take NO reading at all — a DB-connect failure and a reader
# crash — so "ok" here was a clean bill of health nobody measured.
_EMPTY: dict[str, Any] = {
    "status": "unknown",
    "findings": [],
    "reconciliation": [],
    "state": [],
    "unreadable_tables": [],
    "updated_seconds": None,
    "updated_at": None,
}


def _table_read_outcome(exc: sqlite3.OperationalError) -> Optional[str]:
    """Absent-vs-unreadable. Returns None when the table simply does not exist
    (the EXPECTED pre-cutover state), else a short stable reason code.

    🚨 STRUCTURE, NOT ENGLISH — the renderer decides what to show. The raw
    sqlite message is deliberately NOT returned: it is a raw exception string,
    and this reader must not mint display text out of one.
    """
    msg = str(exc).lower()
    if msg.startswith("no such table"):
        return None  # pre-cutover empty is the display, not a fault
    if msg.startswith("no such column"):
        return "schema_drift"
    if "locked" in msg or "busy" in msg:
        return "locked"
    return "unreadable"


def _parse_ts(raw: Optional[str]) -> Optional[datetime]:
    if not raw or not isinstance(raw, str):
        return None
    try:
        dt = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _load_json(raw: Optional[str]) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _freshness(ts_pool: list[Optional[str]]) -> tuple[Optional[int], Optional[str]]:
    """Newest timestamp across all rows -> (age_seconds, iso). WSL-local store,
    no replica lag, so this is a real "updated Xs ago" value."""
    dts = [d for d in (_parse_ts(t) for t in ts_pool) if d is not None]
    if not dts:
        return None, None
    newest = max(dts)
    age = max(0, int((datetime.now(tz=timezone.utc) - newest).total_seconds()))
    return age, newest.isoformat().replace("+00:00", "Z")


def _findings_view(raw: Any) -> tuple[int, list[str], list[dict[str, str]], int]:
    """Bounded view of a findings blob — (count, authored lines, key/value pairs,
    dropped).

    🚨 F1 — THIS FUNCTION USED TO SERIALIZE A DICT BLOB TO ``k=v`` STRINGS, HERE,
    ON THE SERVER. The Hub's plain-English layer already maps these exact keys
    (``level_matches`` / ``prompt_id_present`` / ``config_snapshot_cross_check``
    are in ``src/lib/plain-labels.ts``), but it never got the chance: the
    identifiers were welded into a display string before any renderer saw them,
    so no amount of sweeping the TSX could have found or fixed it.

    The rule this encodes: a Python reader emits STRUCTURE; the renderer decides
    what English to show. Never build display text out of column or check names
    down here.
    """
    if raw is None:
        return 0, [], [], 0
    if isinstance(raw, list):
        # Authored finding text passes through; anything else is counted, not
        # str()'d (str(dict) is the same leak wearing braces).
        lines = [x[:200] for x in raw[:5] if isinstance(x, str)]
        return len(raw), lines, [], len(raw[:5]) - len(lines)
    if isinstance(raw, dict):
        pairs = [{"key": str(k), "value": str(v)[:120]}
                 for k, v in list(raw.items())[:5]]
        return len(raw), [], pairs, 0
    if isinstance(raw, str):
        return 1, [raw[:200]], [], 0
    return 1, [], [], 1


def main() -> int:
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
        conn.row_factory = sqlite3.Row
    except Exception as exc:
        out = dict(_EMPTY)
        out["error"] = f"{type(exc).__name__}: {exc}"
        print(json.dumps(out))
        return 0

    ts_pool: list[Optional[str]] = []
    # Tables that EXIST but could not be read. An absent table never lands here.
    unreadable: list[dict[str, str]] = []

    # ── integrity_findings ──────────────────────────────────────────────────
    findings: list[dict[str, Any]] = []
    try:
        rows = conn.execute(
            "SELECT id, check_name, ok, findings_json, level_id, ts "
            "FROM integrity_findings ORDER BY ts DESC"
        ).fetchall()
        for r in rows:
            count, lines, pairs, dropped = _findings_view(
                _load_json(r["findings_json"]))
            ok = bool(r["ok"])
            level_id = r["level_id"]
            # VACUOUS: an ok check at L0 with no findings ran but had nothing to
            # check (no money-path changes above baseline) — NOT a verified pass.
            vacuous = bool(ok and count == 0 and level_id == 0)
            findings.append({
                "id": r["id"],
                "check_name": r["check_name"],
                "ok": ok,
                "vacuous": vacuous,
                "findings_count": count,
                "findings": lines,
                "finding_pairs": pairs,
                "findings_dropped": dropped,
                "level_id": level_id,
                "ts": r["ts"],
            })
            ts_pool.append(r["ts"])
    except sqlite3.OperationalError as exc:
        reason = _table_read_outcome(exc)
        if reason is not None:
            unreadable.append({"table": "integrity_findings", "reason": reason})

    # ── reconciliation_log (dangerous-first, then newest) ───────────────────
    reconciliation: list[dict[str, Any]] = []
    try:
        rows = conn.execute(
            "SELECT id, prompt_id, outcome, kind, triggers_json, resolved, ts "
            "FROM reconciliation_log"
        ).fetchall()
        parsed = []
        for r in rows:
            triggers = _load_json(r["triggers_json"])
            if isinstance(triggers, list):
                trig_view = [str(x)[:120] for x in triggers[:5]]
            elif triggers is None:
                trig_view = []
            else:
                trig_view = [str(triggers)[:120]]
            kind = r["kind"]
            parsed.append({
                "id": r["id"],
                "prompt_id": r["prompt_id"],
                "outcome": r["outcome"],
                "kind": kind,
                "kind_rank": _KIND_RANK.get(kind, 2),
                "triggers": trig_view,
                "resolved": bool(r["resolved"]),
                "ts": r["ts"],
                "_ts": _parse_ts(r["ts"]),
            })
            ts_pool.append(r["ts"])
        # dangerous-first, then unresolved-first, then newest.
        parsed.sort(key=lambda x: (
            x["kind_rank"],
            0 if not x["resolved"] else 1,
            -(x["_ts"].timestamp() if x["_ts"] else 0.0),
        ))
        for p in parsed:
            p.pop("_ts", None)
        reconciliation = parsed
    except sqlite3.OperationalError as exc:
        reason = _table_read_outcome(exc)
        if reason is not None:
            unreadable.append({"table": "reconciliation_log", "reason": reason})

    # ── watcher_state ───────────────────────────────────────────────────────
    state: list[dict[str, Any]] = []
    try:
        rows = conn.execute(
            "SELECT key, value, updated_at FROM watcher_state ORDER BY key"
        ).fetchall()
        for r in rows:
            state.append({
                "key": r["key"],
                "value": r["value"],
                "updated_at": r["updated_at"],
            })
            ts_pool.append(r["updated_at"])
    except sqlite3.OperationalError as exc:
        reason = _table_read_outcome(exc)
        if reason is not None:
            unreadable.append({"table": "watcher_state", "reason": reason})

    conn.close()

    updated_seconds, updated_at = _freshness(ts_pool)

    # 🚨 "ok" is EARNED, not assumed: it means every table was read, or was
    # legitimately absent. If any table exists and could not be read, the arrays
    # below are INCOMPLETE and saying "ok" about them is the false green this
    # prompt exists to close.
    out: dict[str, Any] = {
        "status": "degraded" if unreadable else "ok",
        "findings": findings,
        "reconciliation": reconciliation,
        "state": state,
        "unreadable_tables": unreadable,
        "updated_seconds": updated_seconds,
        "updated_at": updated_at,
    }
    if unreadable:
        # `error` STAYS POPULATED and carries a STABLE CODE, never a raw
        # exception. Its consumer branches on it, and B3-HUB measured that
        # leaving it empty here is what turns an incomplete read into an
        # empty-but-healthy false green.
        out["error"] = "integrity_store_degraded"
    print(json.dumps(out, default=str))
    return 0


if __name__ == "__main__":
    import traceback as _tb_wrap
    import sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        print(json.dumps(dict(_EMPTY, error="reader crashed")))
        _sys_wrap.exit(0)
