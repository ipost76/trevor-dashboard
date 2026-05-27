#!/usr/bin/env python3
"""
set_confirm_cycles_promoted.py — Flag-gated toggle for CONFIRM_CYCLES_PROMOTED
backing POST /api/auto/exit-controls (B3, 2026-05-27). Modeled exactly on
set_autotrader_enabled.py.

Usage:
    set_confirm_cycles_promoted.py <true|false> <author>

Behavior:
    1. Refuse if HUB_CONFIRM_CYCLES_TOGGLE_ENABLED != 'true' (exit 3).
    2. Read current auto_config.CONFIRM_CYCLES_PROMOTED. If matches requested →
       no-op (still exit 0, no audit row, no DB write).
    3. Otherwise, in a single transaction:
         a) UPSERT auto_config.CONFIRM_CYCLES_PROMOTED to 'true' or 'false'.
            auto_trader/config.cfg_bool() reads with no cache, so the new
            value is picked up at the next monitor cycle (~30s) with no
            service restart needed.
         b) INSERT autotrader_state_audit row reusing the existing table per
            Ghost ruling (B3 Phase 0) — fewer moving parts and the toggle
            surfaces in AutoTrader Control's "Recent Toggles" list for free.
            action = 'confirm_cycles_on' or 'confirm_cycles_off';
            source = f"hub:{author}".

Exit codes:
    0  success (toggled or idempotent no-op)
    1  usage error / bad value
    2  DB / unexpected error
    3  toggle disabled (HUB_CONFIRM_CYCLES_TOGGLE_ENABLED is false)

NOTE: Rule 1 + Rule 31 still binding — flipping this ON only changes the
Layer 6 exit gate (require N consecutive sub-55 cycles instead of 1). It
does NOT close, cancel, or restart anything. Open positions stay monitored
by every other layer (stop / hard_stop / trail / stale / timeout).
"""
import json
import sqlite3
import sys

DB_PATH = "/home/trevor/trevor/trevor.db"

# B1b: bot dir on sys.path so we can import audit_logger (lives at
# /home/trevor/trevor/audit_logger.py). Mirrors set_killswitch.py:38.
sys.path.insert(0, "/home/trevor/trevor")


def _emit(payload: dict, code: int = 0) -> None:
    print(json.dumps(payload))
    sys.exit(code)


def _conn_rw() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_audit_table(conn: sqlite3.Connection) -> None:
    """CREATE TABLE IF NOT EXISTS — additive only (Rule 15). Same schema
    set_autotrader_enabled.py creates. No-op when the table already exists
    (which is the steady state today)."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS autotrader_state_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            prev_value TEXT,
            new_value TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'hub',
            timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)


def main() -> None:
    if len(sys.argv) < 3:
        _emit({"ok": False, "error": "Usage: set_confirm_cycles_promoted.py <true|false> <author>"}, code=1)

    raw = sys.argv[1].strip().lower()
    if raw not in ("true", "false"):
        _emit({"ok": False, "error": "value must be 'true' or 'false'"}, code=1)

    requested = raw == "true"
    requested_str = "true" if requested else "false"
    author = (sys.argv[2] or "").strip() or "unknown"

    try:
        with _conn_rw() as conn:
            row = conn.execute(
                "SELECT value FROM auto_config WHERE key='HUB_CONFIRM_CYCLES_TOGGLE_ENABLED'"
            ).fetchone()
            gate_on = bool(row) and (row["value"] or "false").strip().lower() == "true"
            if not gate_on:
                _emit(
                    {
                        "ok": False,
                        "gate_locked": True,
                        "error": "HUB_CONFIRM_CYCLES_TOGGLE_ENABLED is false",
                    },
                    code=3,
                )

            cur = conn.execute(
                "SELECT value FROM auto_config WHERE key='CONFIRM_CYCLES_PROMOTED'"
            ).fetchone()
            prev_str = (cur["value"] or "false").strip().lower() if cur else "false"
            prev = prev_str == "true"

            if prev == requested:
                _emit(
                    {
                        "ok": True,
                        "no_change": True,
                        "prev_value": prev_str,
                        "new_value": requested_str,
                    },
                    code=0,
                )

            _ensure_audit_table(conn)

            conn.execute(
                "INSERT OR REPLACE INTO auto_config(key, value) VALUES (?, ?)",
                ("CONFIRM_CYCLES_PROMOTED", requested_str),
            )

            action = "confirm_cycles_on" if requested else "confirm_cycles_off"
            # B1b: per-table INSERT extended with actor/source_type/session_id
            # envelope columns added by scripts/migration_b1b.py.
            audit_cur = conn.execute(
                "INSERT INTO autotrader_state_audit "
                "(action, prev_value, new_value, source, timestamp, "
                " actor, source_type, session_id) "
                "VALUES (?, ?, ?, ?, datetime('now'), 'ghost_hub', 'UI', ?)",
                (action, prev_str, requested_str, f"hub:{author}", f"hub:{author}"),
            )
            audit_id = audit_cur.lastrowid
            conn.commit()

        # B1b: change_log cross-index row. Fail-open.
        try:
            from audit_logger import audit_log
            audit_log(
                key="CONFIRM_CYCLES_PROMOTED",
                old_value=prev_str,
                new_value=requested_str,
                actor="ghost_hub",
                source_type="UI",
                table_name="autotrader_state_audit",
                row_id=audit_id,
                session_id=f"hub:{author}",
                notes=action,
            )
        except Exception:
            pass

        _emit(
            {
                "ok": True,
                "no_change": False,
                "action": action,
                "prev_value": prev_str,
                "new_value": requested_str,
                "audit_id": audit_id,
                "note": "Bot picks up via cfg_bool('CONFIRM_CYCLES_PROMOTED') at next monitor cycle (~30s)",
            },
            code=0,
        )
    except SystemExit:
        raise
    except Exception as e:
        _emit({"ok": False, "error": str(e)}, code=2)


if __name__ == "__main__":
    main()
