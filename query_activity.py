#!/usr/bin/env python3
"""query_activity.py — D3 (Activity log) backend — federated UNION.

Reads from change_log + 5 historical audit tables and returns a single
unified timeline of all system changes — past and future. Each row is
normalized into the same shape (timestamp, table_name, key, old_value,
new_value, actor, source_type, notes, ...).

Sources (table_name in the returned row):
    - change_log              B1b cross-index; entries since ~2026-05-27
    - autotrader_state_audit  AT start/stop + config flips (pre-B1b history)
    - aggressive_mode_history aggressive-mode transitions
    - filter_rule_changelog   filter-rule changes
    - circuit_breaker_trips   circuit-breaker fires (shadow/active)
    - close_audit_log         trade close events; deduped against change_log

Recent close_audit_log rows are also indexed in change_log via a SQLite
trigger; we dedupe by skipping any close_audit_log row whose trade_id is
already represented in change_log (table_name='close_audit_log').

GET /api/auto/activity?limit=&offset=&actor=&source_type=&key=&table_name=

Argv (positional; all optional):
    query_activity.py [limit] [offset] [actor] [source_type] [key] [table_name]

Use "*" or empty string as a filter wildcard.
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
from typing import Any, Dict, List, Optional, Set

DB = "/home/trevor/trevor/trevor.db"

DEFAULT_LIMIT = 50
MAX_LIMIT = 500

# 12-hour format used by filter_rule_changelog: '2026-04-06 09:49 AM ET'
_AMPM_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*"
    r"(?:ET|EST|EDT|PT|PST|PDT|CT|CST|CDT|MT|MST|MDT|UTC|GMT)?\s*$",
    re.IGNORECASE,
)
# ISO 8601 with explicit T separator: '2026-05-27T23:53:22+0000' / '...Z'
_ISO_T_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})"
    r"(?:\.\d+)?(?:[+\-]\d{2}:?\d{2}|Z)?\s*$"
)


def _arg(idx: int) -> Optional[str]:
    if idx >= len(sys.argv):
        return None
    v = sys.argv[idx]
    if v is None:
        return None
    v = v.strip()
    if v == "" or v == "*":
        return None
    return v


def _normalize_ts(ts: Optional[str]) -> str:
    """Return a lexically-sortable 'YYYY-MM-DD HH:MM:SS' string (UTC-ish)."""
    if not ts:
        return "1970-01-01 00:00:00"
    ts = ts.strip()

    m = _ISO_T_RE.match(ts)
    if m:
        return f"{m.group(1)} {m.group(2)}"

    m = _AMPM_RE.match(ts)
    if m:
        y, mo, d = m.group(1), m.group(2), m.group(3)
        h = int(m.group(4))
        mi = m.group(5)
        ap = m.group(6).upper()
        if ap == "PM" and h < 12:
            h += 12
        elif ap == "AM" and h == 12:
            h = 0
        return f"{y}-{mo}-{d} {h:02d}:{mi}:00"

    return ts


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


def _composite_id(table: str, source_id: Any) -> str:
    return f"{table}:{source_id}"


def _infer_source_type(stored: Optional[str], hint: str) -> str:
    """Fall back to a chip-friendly source_type when the row was written
    before B1b populated the envelope columns (everything pre-B1b is
    persisted as 'unknown'). `hint` is the best inferred bucket per table.
    """
    if stored and stored.strip().lower() not in ("", "unknown"):
        return stored
    return hint


def _fetch_change_log(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    if not _table_exists(conn, "change_log"):
        return []
    out: List[Dict[str, Any]] = []
    for r in conn.execute(
        "SELECT id, timestamp, table_name, row_id, key, "
        "       old_value, new_value, actor, source_type, "
        "       session_id, prompt_id, notes "
        "FROM change_log"
    ):
        out.append({
            "id": _composite_id("change_log", r[0]),
            "source_id": r[0],
            "timestamp": r[1],
            "table_name": r[2],
            "row_id": r[3],
            "key": r[4],
            "old_value": r[5],
            "new_value": r[6],
            "actor": r[7],
            "source_type": r[8] or "unknown",
            "session_id": r[9],
            "prompt_id": r[10],
            "notes": r[11],
        })
    return out


def _fetch_autotrader_state_audit(
    conn: sqlite3.Connection,
) -> List[Dict[str, Any]]:
    if not _table_exists(conn, "autotrader_state_audit"):
        return []
    out: List[Dict[str, Any]] = []
    for r in conn.execute(
        "SELECT id, action, prev_value, new_value, source, timestamp, "
        "       actor, source_type, session_id "
        "FROM autotrader_state_audit"
    ):
        rid, action, prev, new, source, ts, actor, stored_st, sess = r
        st = _infer_source_type(stored_st, _atsa_hint(source))
        out.append({
            "id": _composite_id("autotrader_state_audit", rid),
            "source_id": rid,
            "timestamp": ts,
            "table_name": "autotrader_state_audit",
            "row_id": rid,
            "key": action,
            "old_value": prev,
            "new_value": new,
            "actor": actor or source,
            "source_type": st,
            "session_id": sess,
            "prompt_id": None,
            "notes": (f"source={source}" if source else None),
        })
    return out


def _atsa_hint(source: Optional[str]) -> str:
    s = (source or "").upper()
    if not s:
        return "unknown"
    if s.startswith(("RM-", "P0", "WAVE", "AT-", "DEGEN", "G2", "G3")):
        return "API"
    if "HUB" in s:
        return "UI"
    return "unknown"


def _fetch_aggressive_mode_history(
    conn: sqlite3.Connection,
) -> List[Dict[str, Any]]:
    if not _table_exists(conn, "aggressive_mode_history"):
        return []
    out: List[Dict[str, Any]] = []
    for r in conn.execute(
        "SELECT id, event_type, threshold_delta, duration_hours, actor, "
        "       reason, signals_fired, timestamp, source_type, session_id "
        "FROM aggressive_mode_history"
    ):
        (rid, evt, delta, dur, actor, reason, fired, ts,
         stored_st, sess) = r
        st = _infer_source_type(stored_st, _amh_hint(actor, reason))
        bits: List[str] = []
        if delta is not None:
            bits.append(f"delta={delta}")
        if dur is not None:
            bits.append(f"duration={dur}h")
        if fired is not None:
            bits.append(f"signals={fired}")
        if reason:
            bits.append(f"reason={reason}")
        out.append({
            "id": _composite_id("aggressive_mode_history", rid),
            "source_id": rid,
            "timestamp": ts,
            "table_name": "aggressive_mode_history",
            "row_id": rid,
            "key": "aggressive_mode",
            "old_value": None,
            "new_value": evt,
            "actor": actor,
            "source_type": st,
            "session_id": sess,
            "prompt_id": None,
            "notes": "; ".join(bits) if bits else None,
        })
    return out


def _amh_hint(actor: Optional[str], reason: Optional[str]) -> str:
    a = (actor or "").lower()
    if a in ("hub", "ghost_hub", "ghost"):
        return "UI"
    r = (reason or "").lower()
    if "g2_hub" in r or "hub_toggle" in r:
        return "UI"
    if "discord" in r:
        return "Discord"
    return "unknown"


def _fetch_filter_rule_changelog(
    conn: sqlite3.Connection,
) -> List[Dict[str, Any]]:
    if not _table_exists(conn, "filter_rule_changelog"):
        return []
    out: List[Dict[str, Any]] = []
    for r in conn.execute(
        "SELECT id, timestamp, rule_type, field_changed, old_value, "
        "       new_value, changed_by, actor, source_type, session_id "
        "FROM filter_rule_changelog"
    ):
        (rid, ts, rule, field, old, new, changed_by,
         actor, stored_st, sess) = r
        st = _infer_source_type(stored_st, _frcl_hint(changed_by, actor))
        # rule_type carries the primary semantic ('CONFIDENCE_FLOOR' etc.);
        # most rows only flip field_changed='value', so keep the key concise.
        key = rule if (not field or field == "value") else f"{rule}.{field}"
        eff_actor = actor or changed_by
        notes = None
        if changed_by and changed_by != actor:
            notes = f"changed_by={changed_by}"
        out.append({
            "id": _composite_id("filter_rule_changelog", rid),
            "source_id": rid,
            "timestamp": ts,
            "table_name": "filter_rule_changelog",
            "row_id": rid,
            "key": key,
            "old_value": old,
            "new_value": new,
            "actor": eff_actor,
            "source_type": st,
            "session_id": sess,
            "prompt_id": None,
            "notes": notes,
        })
    return out


def _frcl_hint(changed_by: Optional[str], actor: Optional[str]) -> str:
    name = (changed_by or actor or "").lower()
    if name in ("ghost", "trevor", "user"):
        return "UI"
    if name.startswith(("rm-", "p0", "wave")):
        return "API"
    if name == "discord":
        return "Discord"
    return "unknown"


def _fetch_circuit_breaker_trips(
    conn: sqlite3.Connection,
) -> List[Dict[str, Any]]:
    if not _table_exists(conn, "circuit_breaker_trips"):
        return []
    out: List[Dict[str, Any]] = []
    for r in conn.execute(
        "SELECT id, layer, mode, details, tripped_at, "
        "       actor, source_type, session_id "
        "FROM circuit_breaker_trips"
    ):
        rid, layer, mode, details, ts, actor, stored_st, sess = r
        st = _infer_source_type(stored_st, "Trigger")
        out.append({
            "id": _composite_id("circuit_breaker_trips", rid),
            "source_id": rid,
            "timestamp": ts,
            "table_name": "circuit_breaker_trips",
            "row_id": rid,
            "key": layer,
            "old_value": None,
            "new_value": mode,
            "actor": actor,
            "source_type": st,
            "session_id": sess,
            "prompt_id": None,
            "notes": details,
        })
    return out


def _fetch_close_audit_log(
    conn: sqlite3.Connection,
    already_indexed_trade_ids: Set[int],
) -> List[Dict[str, Any]]:
    if not _table_exists(conn, "close_audit_log"):
        return []
    out: List[Dict[str, Any]] = []
    for r in conn.execute(
        "SELECT id, trade_id, old_status, new_status, changed_at, "
        "       source, actor, source_type, session_id "
        "FROM close_audit_log"
    ):
        rid, tid, old_st, new_st, ts, src, actor, stored_st, sess = r
        if tid in already_indexed_trade_ids:
            continue
        st = _infer_source_type(stored_st, "Trigger")
        notes = f"trade_id={tid}"
        if src:
            notes += f" source={src}"
        out.append({
            "id": _composite_id("close_audit_log", rid),
            "source_id": rid,
            "timestamp": ts,
            "table_name": "close_audit_log",
            "row_id": tid,
            "key": "trade_close",
            "old_value": old_st,
            "new_value": new_st,
            "actor": actor,
            "source_type": st,
            "session_id": sess,
            "prompt_id": None,
            "notes": notes,
        })
    return out


def main() -> int:
    try:
        limit = int(_arg(1) or str(DEFAULT_LIMIT))
    except ValueError:
        limit = DEFAULT_LIMIT
    limit = max(1, min(MAX_LIMIT, limit))

    try:
        offset = int(_arg(2) or "0")
    except ValueError:
        offset = 0
    offset = max(0, offset)

    actor = _arg(3)
    source_type = _arg(4)
    key_filter = _arg(5)
    table_name = _arg(6)

    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5.0)

        change_log_rows = _fetch_change_log(conn)
        already_indexed: Set[int] = {
            r["row_id"] for r in change_log_rows
            if r["table_name"] == "close_audit_log" and r["row_id"] is not None
        }

        rows: List[Dict[str, Any]] = []
        rows.extend(change_log_rows)
        rows.extend(_fetch_autotrader_state_audit(conn))
        rows.extend(_fetch_aggressive_mode_history(conn))
        rows.extend(_fetch_filter_rule_changelog(conn))
        rows.extend(_fetch_circuit_breaker_trips(conn))
        rows.extend(_fetch_close_audit_log(conn, already_indexed))

        conn.close()
    except Exception as exc:
        print(json.dumps({
            "entries": [], "total": 0,
            "limit": limit, "offset": offset,
            "filters": {
                "actor": actor, "source_type": source_type,
                "key": key_filter, "table_name": table_name,
            },
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0

    def keep(row: Dict[str, Any]) -> bool:
        if actor and (row.get("actor") or "") != actor:
            return False
        if source_type and (row.get("source_type") or "") != source_type:
            return False
        if key_filter and (row.get("key") or "") != key_filter:
            return False
        if table_name and (row.get("table_name") or "") != table_name:
            return False
        return True

    filtered = [r for r in rows if keep(r)]
    filtered.sort(
        key=lambda r: (_normalize_ts(r.get("timestamp")), str(r.get("id"))),
        reverse=True,
    )

    total = len(filtered)
    page = filtered[offset:offset + limit]
    for r in page:
        r.pop("source_id", None)

    print(json.dumps({
        "entries": page,
        "total": total,
        "returned": len(page),
        "limit": limit,
        "offset": offset,
        "filters": {
            "actor": actor,
            "source_type": source_type,
            "key": key_filter,
            "table_name": table_name,
        },
        "sources": [
            "change_log",
            "autotrader_state_audit",
            "aggressive_mode_history",
            "filter_rule_changelog",
            "circuit_breaker_trips",
            "close_audit_log",
        ],
    }, default=str))
    return 0


if __name__ == "__main__":
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
