#!/usr/bin/env python3
"""
Hub helper — Aggressive Mode status reader + hub_commands writer.

Read modes (mode=ro, safe for cached GET):
  status   — full snapshot of aggressive_mode_config + last event + cb passthrough
  history  — last 20 entries from aggressive_mode_history

Write modes (writable, used by /api/aggressive POST):
  enable   <delta> <hours> [reason]   — write AGGRESSIVE_ON command to hub_commands
  disable  [reason]                   — write AGGRESSIVE_OFF command to hub_commands
  extend   <hours>      [reason]      — write AGGRESSIVE_EXTEND command to hub_commands

The bot's hub_close_poll_loop picks up the queued command and executes it via the
aggressive_mode singleton on the trevor.service side. Latency: ~10s (poll cadence).

Aggressive mode commands use a sentinel trade_id ``__GLOBAL_AGGRESSIVE__``
because hub_commands.trade_id is NOT NULL but aggressive mode is not trade-bound.
"""
import json
import sqlite3
import sys

DB_PATH = "/home/trevor/trevor/trevor.db"
DB_RO_URI = f"file:{DB_PATH}?mode=ro"
SENTINEL_TRADE_ID = "__GLOBAL_AGGRESSIVE__"


def _conn_ro() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_RO_URI, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _conn_rw() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def status() -> None:
    """Print full status JSON for /api/aggressive GET."""
    try:
        with _conn_ro() as conn:
            cfg = conn.execute(
                "SELECT * FROM aggressive_mode_config WHERE id=1"
            ).fetchone()
            last_event = conn.execute(
                "SELECT * FROM aggressive_mode_history ORDER BY id DESC LIMIT 1"
            ).fetchone()
            tagged_total = conn.execute(
                "SELECT COUNT(*) AS n FROM trade_insights WHERE aggressive_mode=1"
            ).fetchone()
    except Exception as e:
        print(json.dumps({"enabled": False, "threshold_delta": 0, "error": str(e)}))
        return

    if not cfg:
        print(json.dumps({"enabled": False, "threshold_delta": 0}))
        return

    out = dict(cfg)
    out["enabled"] = bool(out.get("enabled"))
    out["last_event"] = dict(last_event) if last_event else None
    out["total_tagged_alltime"] = (tagged_total["n"] if tagged_total else 0) or 0

    # CB passthrough
    sys.path.insert(0, "/home/trevor/trevor")
    try:
        from circuit_breaker import CircuitBreakerSystem
        out["cb_overall_status"] = CircuitBreakerSystem().get_status().get(
            "overall_status", "UNKNOWN"
        )
    except Exception:
        out["cb_overall_status"] = "UNKNOWN"

    # minutes_until_revert
    out["minutes_until_revert"] = None
    if out.get("enabled") and out.get("revert_at"):
        try:
            from datetime import datetime, timezone
            revert_at = datetime.fromisoformat(out["revert_at"])
            if revert_at.tzinfo is None:
                revert_at = revert_at.replace(tzinfo=timezone.utc)
            delta_sec = (revert_at - datetime.now(timezone.utc)).total_seconds()
            out["minutes_until_revert"] = max(0, round(delta_sec / 60.0))
        except Exception:
            pass

    print(json.dumps(out, default=str))


def history(limit: int = 20) -> None:
    try:
        with _conn_ro() as conn:
            rows = conn.execute(
                "SELECT * FROM aggressive_mode_history ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
    except Exception as e:
        print(json.dumps({"error": str(e), "rows": []}))
        return
    print(json.dumps({"rows": [dict(r) for r in rows]}, default=str))


def _submit(command: str, params: dict) -> None:
    """Insert a command into hub_commands queue. Bot picks it up via poll loop."""
    try:
        with _conn_rw() as conn:
            cur = conn.execute(
                "INSERT INTO hub_commands (trade_id, command, params, status) "
                "VALUES (?, ?, ?, 'pending')",
                (SENTINEL_TRADE_ID, command, json.dumps(params)),
            )
            cmd_id = cur.lastrowid
            conn.commit()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return
    print(json.dumps({
        "ok": True,
        "command": command,
        "command_id": cmd_id,
        "queued": True,
        "note": "Bot poll loop will pick up within ~10s",
    }))


def enable(delta: int, hours: float, reason: str = "hub_toggle") -> None:
    _submit("AGGRESSIVE_ON", {"delta": delta, "hours": hours, "reason": reason})


def disable(reason: str = "hub_toggle") -> None:
    _submit("AGGRESSIVE_OFF", {"reason": reason})


def extend(hours: float, reason: str = "hub_extend") -> None:
    _submit("AGGRESSIVE_EXTEND", {"hours": hours, "reason": reason})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: query_aggressive_mode.py status|history|enable|disable|extend ..."}))
        sys.exit(1)
    action = sys.argv[1].lower()
    if action == "status":
        status()
    elif action == "history":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        history(limit)
    elif action == "enable":
        if len(sys.argv) < 4:
            print(json.dumps({"ok": False, "error": "Usage: enable <delta> <hours> [reason]"}))
            sys.exit(1)
        d = int(sys.argv[2])
        h = float(sys.argv[3])
        r = sys.argv[4] if len(sys.argv) > 4 else "hub_toggle"
        enable(d, h, r)
    elif action == "disable":
        r = sys.argv[2] if len(sys.argv) > 2 else "hub_toggle"
        disable(r)
    elif action == "extend":
        if len(sys.argv) < 3:
            print(json.dumps({"ok": False, "error": "Usage: extend <hours> [reason]"}))
            sys.exit(1)
        h = float(sys.argv[2])
        r = sys.argv[3] if len(sys.argv) > 3 else "hub_extend"
        extend(h, r)
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)
