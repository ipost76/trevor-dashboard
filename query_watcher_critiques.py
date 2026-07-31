#!/usr/bin/env python3
"""query_watcher_critiques.py — WATCHER page backend (critique + errors + health).

Backs GET /api/watcher/critiques — the R12 WATCHER cockpit's `critique` and
`errors` sub-tabs. Reads the R10 watcher's OWN store `data/watcher.db` READ-ONLY
(`mode=ro`) and returns three surfaces:

  * watcher_critiques — the trainer decisions the watcher flagged as PROBLEMS.
    The watcher critiques ONLY problems, so a clean decision produces NO row —
    an empty list means "nothing wrong found", NOT "nothing checked". Each row's
    `mechanical_json` (a {checks, all, memory} object from R10-B1's log_critique)
    is parsed HERE; only the FIRED mechanical checks + an applicable count are
    emitted. The R11-compatible `memory` hook inside it is NEVER projected to the
    client (that boundary is R11's; the WATCHER page builds no memory-store UI).
  * watcher_errors — real live detections (loop stalls, dead crons, failed units,
    swallowed canaries). Rendered honestly: a ~79h stale loop or a dead daemon is
    correct reporting of genuinely bad live state, not a Hub bug.
  * watcher_health — the per-check freshness/liveness roll-up (ok / degraded).

READ-ONLY. Never writes the DB, never imports a watcher writer (opens the sqlite
file directly, `mode=ro`). Named `query_*` so the AST independence guard
(tests/test_watcher_independence.py globs `watcher_*.py` / `trainer_*.py`) never
sweeps it in. Mirrors query_loop_health.py (open pattern + main() shape) and the
sibling watcher-store readers.

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

# __file__-relative so the DB resolves regardless of the spawn cwd (runPython
# runs with cwd=TREVOR_PROJECT_DIR; on WSL that IS this repo, but resolving off
# __file__ is robust either way). data/watcher.db is WSL-local, gitignored.
_HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(_HERE, "data", "watcher.db")

_EMPTY: dict[str, Any] = {
    "status": "ok",
    "critiques": [],
    "errors": [],
    "health": [],
    "updated_seconds": None,
    "updated_at": None,
}


def _parse_ts(raw: Optional[str]) -> Optional[datetime]:
    """Tolerant ISO parse (accepts a trailing Z). None on anything unparseable."""
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
    """Newest timestamp across all rows -> (age_seconds, iso). These stores are
    WSL-local (no replica lag), so this is a real "updated Xs ago" value."""
    dts = [d for d in (_parse_ts(t) for t in ts_pool) if d is not None]
    if not dts:
        return None, None
    newest = max(dts)
    age = max(0, int((datetime.now(tz=timezone.utc) - newest).total_seconds()))
    return age, newest.isoformat().replace("+00:00", "Z")


# Unit -> plain name, mirroring watcher_surface.UNIT_PLAIN. Duplicated on purpose:
# this reader must never import a watcher writer (see the module docstring).
_UNIT_PLAIN = {
    "trevor.service": "the trading bot",
    "trevor-monitor-center.service": "the monitor service",
    "trevor-observatory.service": "the observatory service",
    "trevor-regime-transitions.service": "market-regime transitions",
}
_LOCATION_PLAIN = {"vm": "on the trading server", "wsl": "on this machine"}


def _plain_age(seconds: Any) -> Optional[str]:
    """Machine seconds -> the largest sensible human unit, or None if unusable."""
    if not isinstance(seconds, (int, float)) or isinstance(seconds, bool):
        return None
    s = abs(float(seconds))
    if s < 5400:
        n, unit = round(s / 60), "minute"
    elif s < 172800:
        n, unit = round(s / 3600), "hour"
    else:
        n, unit = round(s / 86400), "day"
    return f"{n} {unit}" if n == 1 else f"{n} {unit}s"


def _plain_unit(key: Any) -> Optional[str]:
    """Plain name for a unit key (optionally '<box>:<unit>'), or None if unmapped."""
    if not isinstance(key, str):
        return None
    return _UNIT_PLAIN.get(key.split(":", 1)[-1])


def _err_summary(source: str, detail: Any) -> str:
    """One honest plain-English line per detection — never the raw blob.

    🚨 These strings are USER-FACING COPY on the Hub's WATCHER tab. They must
    carry no unit name, snake_case key, machine unit or serialized dict. They
    also describe a MEASUREMENT taken when the detection was recorded, which may
    be days old — so they are written in the past tense and must never read as a
    statement about the present moment.
    """
    d = detail if isinstance(detail, dict) else {}
    if source == "loop_stall":
        age = _plain_age(d.get("age_seconds"))
        if age:
            return f"A background loop hadn't updated for {age} when this was found."
        return "A background loop had stopped updating when this was found."
    if source == "swallowed_canary":
        age = _plain_age(d.get("hmm_age_seconds"))
        if age:
            return (f"Market-regime data was {age} out of date when this was found, "
                    "and no alert was raised about it.")
        return ("Market-regime data was out of date when this was found, and no alert "
                "was raised about it.")
    if source == "cron_dead":
        name = _plain_unit(d.get("key"))
        loc = d.get("location")
        where = _LOCATION_PLAIN.get(loc) if isinstance(loc, str) else None
        if name:
            return f"A scheduled job stopped running: {name}{' ' + where if where else ''}."
        return "A scheduled job stopped running."
    if source == "systemctl_failed":
        name = _plain_unit(d.get("key")) or _plain_unit(d.get("unit"))
        if name:
            return f"{name.capitalize()} was stopped when this was found."
        return "A background service was stopped when this was found."
    # 🚨 Generic fallback for an UNRECOGNISED source — a FIXED sentence. Never
    # interpolate an unknown key or value here: this branch applies to every
    # detection type that does not exist yet, so anything dynamic puts raw
    # machine text back on screen the moment a new check is added.
    return "Something the watcher flagged — details not recognised."


def _summarize_critique(mechanical: Any) -> tuple[list[dict[str, Any]], int]:
    """From the parsed mechanical_json {checks, all, memory}, return the FIRED
    checks (name + a short evidence line) + the count of APPLICABLE checks. The
    `memory` hook is intentionally NOT surfaced (R11's boundary)."""
    if not isinstance(mechanical, dict):
        return [], 0
    fired_raw = mechanical.get("checks") or []
    all_raw = mechanical.get("all") or []
    fired: list[dict[str, Any]] = []
    for f in fired_raw:
        if not isinstance(f, dict):
            continue
        # 🚨 `evidence` is deliberately NOT projected. It was rendered verbatim on
        # the WATCHER tab and was built by joining raw key=value pairs — the same
        # serialize-a-dict-into-the-UI defect as the _err_summary fallback. The
        # check NAME is the user-facing fact; the raw evidence is not.
        fired.append({"check": f.get("check", "?")})
    applicable = sum(1 for f in all_raw if isinstance(f, dict) and f.get("applicable"))
    return fired, applicable


def main() -> int:
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=8.0)
        conn.row_factory = sqlite3.Row
    except Exception as exc:
        # DB absent entirely (pre-cutover) — the empty display, never an error card.
        out = dict(_EMPTY)
        out["error"] = f"{type(exc).__name__}: {exc}"
        print(json.dumps(out))
        return 0

    ts_pool: list[Optional[str]] = []

    # ── critiques (problems only) ───────────────────────────────────────────
    critiques: list[dict[str, Any]] = []
    try:
        rows = conn.execute(
            "SELECT id, decision_ref, decision_kind, level_id, severity, "
            "mechanical_json, judgment_text, llm_used, ts "
            "FROM watcher_critiques ORDER BY ts DESC"
        ).fetchall()
        for r in rows:
            fired, applicable = _summarize_critique(_load_json(r["mechanical_json"]))
            critiques.append({
                "id": r["id"],
                "decision_ref": r["decision_ref"],
                "decision_kind": r["decision_kind"],
                "level_id": r["level_id"],
                "severity": r["severity"],           # note | concern | problem
                "fired_checks": fired,
                "checks_applicable": applicable,
                "judgment_text": r["judgment_text"],
                "llm_used": bool(r["llm_used"]),
                "ts": r["ts"],
            })
            ts_pool.append(r["ts"])
    except sqlite3.OperationalError:
        pass  # no such table -> empty (pre-cutover)

    # ── errors (real live detections) ───────────────────────────────────────
    errors: list[dict[str, Any]] = []
    try:
        rows = conn.execute(
            "SELECT id, source, detail_json, first_seen_ts, last_seen_ts, resolved "
            "FROM watcher_errors ORDER BY resolved ASC, last_seen_ts DESC"
        ).fetchall()
        for r in rows:
            detail = _load_json(r["detail_json"])
            errors.append({
                "id": r["id"],
                "source": r["source"],
                "summary": _err_summary(r["source"], detail),
                "first_seen_ts": r["first_seen_ts"],
                "last_seen_ts": r["last_seen_ts"],
                "resolved": bool(r["resolved"]),
            })
            ts_pool.append(r["last_seen_ts"])
    except sqlite3.OperationalError:
        pass

    # ── health ──────────────────────────────────────────────────────────────
    health: list[dict[str, Any]] = []
    try:
        rows = conn.execute(
            "SELECT check_name, status, detail, updated_at FROM watcher_health "
            "ORDER BY CASE status WHEN 'degraded' THEN 0 WHEN 'ok' THEN 2 ELSE 1 END, "
            "check_name"
        ).fetchall()
        for r in rows:
            health.append({
                "check_name": r["check_name"],
                "status": r["status"],
                "detail": r["detail"],
                "updated_at": r["updated_at"],
            })
            ts_pool.append(r["updated_at"])
    except sqlite3.OperationalError:
        pass

    conn.close()

    updated_seconds, updated_at = _freshness(ts_pool)

    print(json.dumps({
        "status": "ok",
        "critiques": critiques,
        "errors": errors,
        "health": health,
        "updated_seconds": updated_seconds,
        "updated_at": updated_at,
    }, default=str))
    return 0


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (mirrors query_loop_health.py).
    import traceback as _tb_wrap
    import sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        # Even on an unexpected crash, hand the client a parseable empty shape.
        print(json.dumps(dict(_EMPTY, error="reader crashed")))
        _sys_wrap.exit(0)
