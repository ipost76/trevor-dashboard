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
import os
import sqlite3
import sys
from datetime import datetime, timezone

DB_PATH = "/home/trevor/trevor/trevor.db"

# B1b: bot dir on sys.path so we can import audit_logger (lives at
# /home/trevor/trevor/audit_logger.py). Mirrors set_killswitch.py:38.
sys.path.insert(0, "/home/trevor/trevor")


def _emit(payload: dict, code: int = 0) -> None:
    print(json.dumps(payload))
    sys.exit(code)


def _read_provenance() -> dict:
    """Honest provenance of the store this decision rests on. NEVER asserts a
    freshness it did not measure — every field is None when it could not be
    established, and None is the unknown value, not a default.

    ⚠️ These fields DESCRIBE the read. They do not judge it: an earlier draft
    also returned `read_is_authoritative_store` from `os.access(W_OK)` and fed
    it to `verified`, which is a PROXY for the thing (writability standing in
    for "is this the store the bot reads?"). Driving it exposed the proxy at
    once — a writable scratch copy reported `verified: true` for the exact
    stale-match case this fix exists to close. Recorded, not quietly deleted."""
    try:
        target = os.path.realpath(DB_PATH)
        st = os.stat(target)
        return {
            "read_path": target,
            "read_age_seconds": max(0, int(datetime.now(timezone.utc).timestamp() - st.st_mtime)),
        }
    except Exception:
        return {"read_path": None, "read_age_seconds": None}


def _confirm_written(conn: sqlite3.Connection, key: str, expected: str):
    """True / False / **None** — did the value we just committed read back?

    The ONLY thing entitled to set `verified: True`, and it earns it by
    re-reading after the commit. None means the re-read failed: unknown, not
    failure."""
    try:
        row = conn.execute(
            "SELECT value FROM auto_config WHERE key=?", (key,)
        ).fetchone()
        if row is None or row["value"] is None:
            return False
        return str(row["value"]).strip().lower() == expected
    except Exception:
        return None


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

    # B1: measured once, up front, so every exit path below can say where its
    # reading came from instead of implying it came from the live store.
    prov = _read_provenance()

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
                        # B1: the gate refused before CONFIRM_CYCLES_PROMOTED was ever
                        # read, so its state is genuinely unknown here.
                        "prev_state": "unknown",
                        "state_source": "none",
                        "verified": None,
                        **prov,
                    },
                    code=3,
                )

            cur = conn.execute(
                "SELECT value FROM auto_config WHERE key='CONFIRM_CYCLES_PROMOTED'"
            ).fetchone()
            # B1: `prev_known` records whether a row was ACTUALLY read. It is
            # additive and feeds only the report — `prev_str`, `prev` and the
            # `prev == requested` comparison below are byte-identical to HEAD,
            # so the money path is untouched.
            prev_known = cur is not None and cur["value"] is not None
            prev_str = (cur["value"] or "false").strip().lower() if cur else "false"
            prev = prev_str == "true"
            prev_state = prev_str if prev_known else "unknown"

            if prev == requested:
                _emit(
                    {
                        "ok": True,
                        "no_change": True,
                        "prev_value": prev_str,
                        "new_value": requested_str,
                        # 🚨 B1: agreeing with a copy is not verifying the bot.
                        # `verified` is FALSE here unconditionally — this path
                        # performed NO write and confirmed NOTHING; it inferred
                        # the state from one read of whatever store DB_PATH
                        # resolved to.
                        "prev_state": prev_state,
                        "state_source": "read",
                        "verified": False,
                        **prov,
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
            # B1: the one place entitled to claim verification. Purely
            # additive — a read after the commit cannot change what was written.
            write_verified = _confirm_written(conn, "CONFIRM_CYCLES_PROMOTED", requested_str)

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
                # 🚨 B1 (N-12): load-bearing. audit_logger.DB_PATH is hardcoded,
                # so without this the audit row lands in the live trevor.db no
                # matter which database the flip above went to — a silently
                # WRONG audit trail. Accepted since 2026-08-01; never adopted.
                db_path=DB_PATH,
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
                "prev_state": prev_state,
                "state_source": "write",
                "verified": write_verified,
                **prov,
            },
            code=0,
        )
    except SystemExit:
        raise
    except Exception as e:
        _emit({"ok": False, "error": str(e)}, code=2)


if __name__ == "__main__":
    main()
