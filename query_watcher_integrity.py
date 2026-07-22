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

_EMPTY: dict[str, Any] = {
    "status": "ok",
    "findings": [],
    "reconciliation": [],
    "state": [],
    "updated_seconds": None,
    "updated_at": None,
}


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


def _findings_view(raw: Any) -> tuple[int, list[str]]:
    """Bounded rendering of a findings blob — a count + up to 5 short lines."""
    if raw is None:
        return 0, []
    if isinstance(raw, list):
        lines = [str(x)[:200] for x in raw[:5]]
        return len(raw), lines
    if isinstance(raw, dict):
        lines = [f"{k}={v}" for k, v in list(raw.items())[:5]]
        return len(raw), [x[:200] for x in lines]
    return 1, [str(raw)[:200]]


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

    # ── integrity_findings ──────────────────────────────────────────────────
    findings: list[dict[str, Any]] = []
    try:
        rows = conn.execute(
            "SELECT id, check_name, ok, findings_json, level_id, ts "
            "FROM integrity_findings ORDER BY ts DESC"
        ).fetchall()
        for r in rows:
            count, lines = _findings_view(_load_json(r["findings_json"]))
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
                "level_id": level_id,
                "ts": r["ts"],
            })
            ts_pool.append(r["ts"])
    except sqlite3.OperationalError:
        pass

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
    except sqlite3.OperationalError:
        pass

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
    except sqlite3.OperationalError:
        pass

    conn.close()

    updated_seconds, updated_at = _freshness(ts_pool)

    print(json.dumps({
        "status": "ok",
        "findings": findings,
        "reconciliation": reconciliation,
        "state": state,
        "updated_seconds": updated_seconds,
        "updated_at": updated_at,
    }, default=str))
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
