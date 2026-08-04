#!/usr/bin/env python3
"""
set_autotrader_enabled.py — Flag-gated AutoTrader on/off toggle for
/api/memory/autotrader-toggle POST. Per Rule 32 carve-out (2026-05-02).

Usage:
    set_autotrader_enabled.py <true|false> <author>

Behavior:
    1. Refuse if HUB_AUTOTRADER_TOGGLE_ENABLED != 'true' (exit 3, gate locked).
    2. Read current auto_config.AUTO_TRADER_ENABLED. If matches requested →
       no-op (still exit 0, no audit row, no DB write).
    3. Otherwise, in a single transaction:
         a) UPSERT auto_config.AUTO_TRADER_ENABLED to 'true' or 'false'.
            The bot's auto_trader/config.cfg_bool('AUTO_TRADER_ENABLED')
            picks up the change at the next signal (no restart).
         b) INSERT autotrader_state_audit row (action / prev_value /
            new_value / source='hub' / timestamp). Table created lazily
            on first call (additive — Rule 15).

Exit codes:
    0  success (toggled or idempotent no-op)
    1  usage error / bad value
    2  DB / unexpected error
    3  toggle disabled (HUB_AUTOTRADER_TOGGLE_ENABLED is false)

NOTE: Rule 1 + Rule 31 still binding — flipping OFF does NOT close any open
position, cancel any HL order, or restart any service. Only blocks NEW AT
entries. Manual signal cards in #scalp-signals continue to fire.

🚨 B1-MONEY-PATH-HONESTY (2026-08-04) — THREE STATES, NOT TWO.
`prev_state` is the discriminator and `unknown` is expressible:

    "true"     an AUTO_TRADER_ENABLED row was READ and says on
    "false"    an AUTO_TRADER_ENABLED row was READ and says off
    "unknown"  the row is absent, or its value is NULL — NOTHING WAS READ

`verified` mirrors it as True / False / **None**, and None is the unknown
value — never False.

🚨 WHY. Step 2's `prev == requested` short-circuit returned exit 0 with
`{"ok": true, "no_change": true}` whenever the read happened to agree with the
request — and that reading comes from whatever store DB_PATH resolves to. On
the WSL Hub that is a litestream replica whose lag is a measured sawtooth
(1m18s → 20m38s), so agreement with the copy is not agreement with the bot.
DRIVEN 2026-08-04: a copy saying `false` while the live value was `true`
produced output BYTE-IDENTICAL to a correct no-op. Worse, an ABSENT row was
emitted as `prev_value: "false"` — total absence rendered as positive evidence
that the AutoTrader is off, which is the same defect `query_trainer_pause.py`
was built to end.

🚨 `prev_value` / `prev` / the `prev == requested` comparison are DELIBERATELY
UNCHANGED — byte-identical, including the documented `else "false"` mirror of
auto_trader/config.py's default. The money path does not move; only the
honesty of the REPORT does. The new keys are additive and nothing was renamed.
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
    of this helper also returned `read_is_authoritative_store` from
    `os.access(W_OK)` and fed it to `verified`, which is a PROXY for the thing
    (writability standing in for "is this the store the bot reads?"). Driving
    it exposed the proxy immediately — a writable scratch copy reported
    `verified: true` for the exact stale-match case this fix exists to close.
    Recorded rather than quietly deleted: substituting a proxy for the thing is
    one of the eight causes this prompt catalogued, and it was reintroduced
    here while fixing the others."""
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

    This is the ONLY thing in this file entitled to set `verified: True`, and
    it earns it by re-reading after the commit. None means the re-read itself
    failed, which is unknown, not failure."""
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
    """CREATE TABLE IF NOT EXISTS — additive only (Rule 15)."""
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
        _emit({"ok": False, "error": "Usage: set_autotrader_enabled.py <true|false> <author>"}, code=1)

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
            # 1. Flag gate
            row = conn.execute(
                "SELECT value FROM auto_config WHERE key='HUB_AUTOTRADER_TOGGLE_ENABLED'"
            ).fetchone()
            gate_on = bool(row) and (row["value"] or "false").strip().lower() == "true"
            if not gate_on:
                _emit(
                    {
                        "ok": False,
                        "gate_locked": True,
                        "error": "HUB_AUTOTRADER_TOGGLE_ENABLED is false",
                        # B1: the gate refused before AUTO_TRADER_ENABLED was
                        # ever read, so its state is genuinely unknown here.
                        "prev_state": "unknown",
                        "state_source": "none",
                        "verified": None,
                        **prov,
                    },
                    code=3,
                )

            # 2. Read current state for idempotent check. Bot defaults to
            # 'false' at config.py:38 if the row is missing — mirror that.
            cur = conn.execute(
                "SELECT value FROM auto_config WHERE key='AUTO_TRADER_ENABLED'"
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
                        # resolved to. `prev_state` says whether a row was read
                        # at all; `read_age_seconds` says how old that read is.
                        "prev_state": prev_state,
                        "state_source": "read",
                        "verified": False,
                        **prov,
                    },
                    code=0,
                )

            # 3. Atomic write: flip the bot-read flag + audit row.
            _ensure_audit_table(conn)

            conn.execute(
                "INSERT OR REPLACE INTO auto_config(key, value) VALUES (?, ?)",
                ("AUTO_TRADER_ENABLED", requested_str),
            )

            action = "start" if requested else "pause"
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
            # B1: the one place entitled to claim verification — re-read the
            # committed value. Purely additive: a read after the commit cannot
            # change what was written.
            write_verified = _confirm_written(conn, "AUTO_TRADER_ENABLED", requested_str)

        # B1b: change_log cross-index row. Fail-open. Outside the txn so
        # the audit-side write can't roll back the config flip.
        # 🚨 B1 (N-12): db_path=DB_PATH is LOAD-BEARING, not tidy-up.
        # audit_logger.DB_PATH is a HARDCODED absolute path, so without this
        # keyword the audit row lands in the live trevor.db no matter which
        # database the flip above actually went to — a silently WRONG audit
        # trail, which is worse than a missing one. `audit_log` has accepted
        # `db_path` since 2026-08-01; this call site simply never adopted it.
        try:
            from audit_logger import audit_log
            audit_log(
                key="AUTO_TRADER_ENABLED",
                old_value=prev_str,
                new_value=requested_str,
                actor="ghost_hub",
                source_type="UI",
                table_name="autotrader_state_audit",
                row_id=audit_id,
                session_id=f"hub:{author}",
                notes=action,
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
                "note": "Bot picks up via cfg_bool('AUTO_TRADER_ENABLED') at next signal",
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
