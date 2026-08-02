#!/usr/bin/env python3
"""watcher_integrity_db.py — TREVOR v5 Watcher (R10) INTEGRITY persistence layer.

The integrity sub-module (R10-B2) is the watcher's reliable, must-NEVER-drift half:
it verifies the stack incremented when it should have, that there was no silent drift,
that the chain is consistent, and that oversight applied. It keeps its OWN store,
``watcher_integrity.db``, via THIS module — SEPARATE from the fragile review-brain's
``watcher.db``:

    from lib.watcher_integrity_db import get_connection

    * integrity checks (R10-B2) — write ``integrity_findings``
    * reconciliation (R10-B2)   — write ``reconciliation_log``
    * jsonl tailing (R10-B2)    — track ``jsonl_cursor``

It builds ``watcher_integrity.db`` — a NEW, WSL-local SQLite db — lazily on first
``get_connection()`` and owns 3 additive tables:

  * integrity_findings   — per-check ok/finding results
  * reconciliation_log   — change_detector reconciliation outcomes
  * jsonl_cursor         — last-line cursor per jsonl source (resumable tailing)

═══════════════════════════════════════════════════════════════════════════════
 WHY A SEPARATE DB (Ghost's locked decision — the guarantee, not a convention)
═══════════════════════════════════════════════════════════════════════════════
So the fragile LLM review-brain module (R10-B1) physically CANNOT write the reliable
integrity store. The two connection modules are truly distinct:

  * ZERO cross-import (BOTH directions): this module NEVER imports/references
    ``watcher_db`` or ``watcher.db`` (the fragile main store); ``lib/watcher_db.py``
    never imports ``watcher_integrity_db`` or ``watcher_integrity.db``. The small
    amount of plumbing (resolver / init_schema / get_connection / replica-guard /
    utc_now) is DUPLICATED here on purpose — a shared ``_common_db.py`` would give
    both a common import and re-couple them, destroying the guarantee.
  * NAMING CONVENTION (load-bearing): the CI AST-assert treats the module whose
    basename CONTAINS ``integrity`` as the integrity side — the ONE side allowed to
    reference the integrity store. This module (and B2's ``watcher_integrity.py``)
    qualify; every OTHER watcher module (the B1 review-brain, the B3 error/surfacing
    layer) is DENIED any integrity reference. A B2 module must keep ``integrity`` in
    its name to land under the rule.
  * The CI/test AST-assert (``tests/test_watcher_independence.py``) proves the three
    structural denials; this module carries the reciprocal half of denial (1)
    (integrity ↛ main store) and shares denial (3) (integrity ↛ any auto-halt lever;
    it touches ``auto_config`` NOT AT ALL).

DISCIPLINE (mirrors lib/watcher_db.py — intentionally duplicated, never shared):
  * DB-path trap: resolved AT CALL TIME; the only module-level absolute-path literal
    is the replica-refusal guard constant below.
  * Own connection per call (WAL + busy_timeout); no shared global handle.
  * Additive-DB law: CREATE TABLE IF NOT EXISTS only; init_schema idempotent.
  * Replica-refusal: hard-REFUSES the 0444 WSL replica path.
  * WSL-local, NEVER replicated to the VM. Nothing runs on import.

Python 3, stdlib sqlite3 only. No ORM, no numpy, no LLM, no watcher logic (B2).
"""
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Optional

# The 0444 read-only WSL replica of the VM's trevor.db. It is atomically overwritten
# every tailsync cycle, so the watcher must NEVER target it. get_connection refuses it.
_REPLICA_PATH = "/home/ghost/trevor-replica/trevor.db"


def utc_now() -> str:
    """UTC timestamp string for the *_ts / *_at columns.

    Public glue: the B2 integrity consumers import this so every writer stamps the
    same format (e.g. ``updated_at=utc_now()``), keeping the columns uniform.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def resolve_db_path() -> str:
    """Resolve the watcher_integrity.db absolute path AT CALL TIME.

    Order: WATCHER_INTEGRITY_DB_PATH env override wins; else the repo-local default
    <repo>/data/watcher_integrity.db, recomputed from this file's location on every
    call. Deliberately NOT a module-level constant and NOT a default-arg default.
    """
    override = os.environ.get("WATCHER_INTEGRITY_DB_PATH")
    if override:
        return os.path.abspath(override)
    return _live_default_path()


def _live_default_path() -> str:
    """The repo-local LIVE watcher_integrity.db, recomputed from this file per call.

    Split out of resolve_db_path so the test guard below can ask "is this the live
    store?" without re-deriving the path or caring what the env override says.
    Still call-time, still no module-level constant — the DB-path trap is unchanged.
    """
    # lib/watcher_integrity_db.py  ->  repo root is one directory up from lib/
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(repo_root, "data", "watcher_integrity.db")


# ═══════════════════════════════════════════════════════════════════════════════
#  THE LIVE-STORE TEST GUARD (B11) — DUPLICATED IN ALL FOUR STORE MODULES
# ═══════════════════════════════════════════════════════════════════════════════
# 🚨 DO NOT factor this into a shared ``_common_db.py``. THE "WHY A SEPARATE DB"
# BLOCK AT THE TOP OF THIS FILE IS EXACTLY WHY: this module and ``lib/watcher_db.py``
# must have ZERO cross-import in BOTH directions so the fragile LLM review-brain
# physically cannot write the integrity store, and that is AST-proven by
# ``tests/test_watcher_independence.py``. A shared helper would give both a common
# import and destroy the guarantee — the same reasoning that already duplicates
# resolve_db_path / init_schema / utc_now / the replica guard between them. The guard
# below is DUPLICATED ON PURPOSE in all four store modules. Four copies is the design,
# not debt; DRYing it out would silently delete a structural safety property.
#
# WHAT IT DOES: refuses to resolve THIS module's live repo-local store when the
# process entry point is a test. The canonical invocation on this box is
# ``python3 tests/test_X.py``, so ``sys.argv[0]`` IS the test file — the guard needs
# no runner, no conftest and no pytest (pytest is genuinely absent here, and a
# conftest would be inert because nothing loads one).
#
# 🚨 IT FAILS TOWARD REFUSING. When it cannot tell whether it is under test —
# argv[0] is ``-`` (a stdin script), ``-c``, or empty — it treats that as UNDER TEST
# and refuses. A false refusal costs an error message naming the escape hatch; a
# false permit costs the live store. Measured at B11: no production entry point on
# this box reaches these four modules with an indeterminate argv[0]; the Hub's
# inline-python routes (argv[0] == "-") touch trevor.db through raw sqlite3.connect
# and import none of lib/*_db.py. A future inline caller fails LOUDLY with the hatch
# named, never silently against the live store.
#
# ⚠️ SCOPE LIMIT, stated here so it is not discovered later: the guard lives INSIDE
# get_connection(), so it only sees callers that come through get_connection().
# Sites that open ``sqlite3.connect(...)`` directly are structurally invisible to it
# (16 such sites on this box at B11) and must be given an explicit path by hand.
_INDETERMINATE_ARGV0 = ("", "-", "-c")


def _under_test() -> bool:
    """True when this process looks like a test — or when that cannot be determined.

    Indeterminate reads as True on purpose: see the FAILS TOWARD REFUSING note above.
    """
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return True
    if "pytest" in sys.modules:
        return True
    base = os.path.basename(sys.argv[0]) if sys.argv else ""
    if base.startswith("test_") or base.startswith("pytest"):
        return True
    return base in _INDETERMINATE_ARGV0


# All schema is additive: CREATE TABLE IF NOT EXISTS only. Column definitions are
# verbatim from A1 (RECON-WATCHER-001) §4 — no invented columns.
_SCHEMA_STATEMENTS = (
    # Per-check integrity findings (B2).
    """
    CREATE TABLE IF NOT EXISTS integrity_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      check_name TEXT NOT NULL,          -- 'increment_when_should'|'no_silent_drift'|'chain_consistency'|'apply_oversight'
      ok INTEGER NOT NULL, findings_json TEXT, level_id INTEGER, ts TEXT NOT NULL
    )
    """,
    # Reconciliation outcomes from the change_detector (B2).
    """
    CREATE TABLE IF NOT EXISTS reconciliation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_id TEXT, outcome TEXT NOT NULL, kind TEXT,   -- from change_detector's dict
      triggers_json TEXT, resolved INTEGER NOT NULL DEFAULT 0, ts TEXT NOT NULL
    )
    """,
    # Resumable per-source jsonl tailing cursor (B2).
    """
    CREATE TABLE IF NOT EXISTS jsonl_cursor (
      source TEXT PRIMARY KEY, last_line INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    )
    """,
)


def init_schema(conn: sqlite3.Connection) -> None:
    """Idempotently create all 3 additive integrity tables.

    CREATE ... IF NOT EXISTS only (additive-DB law) — safe to call on every connect.
    No DROP/DELETE/TRUNCATE; never overwrites existing data. Wrapped in a single
    transaction so the schema lands atomically.
    """
    with conn:  # commits on success, rolls back on error
        for stmt in _SCHEMA_STATEMENTS:
            conn.execute(stmt)


def get_connection(
    db_path: Optional[str] = None, *, allow_live_under_test: bool = False
) -> sqlite3.Connection:
    """Open (lazily creating) watcher_integrity.db and ensure its schema; return it.

    Path resolution is at CALL TIME: explicit db_path arg wins, else resolve_db_path()
    (WATCHER_INTEGRITY_DB_PATH env -> <repo>/data/watcher_integrity.db). Opens the
    integrity store's OWN connection (never a shared global handle), sets WAL +
    busy_timeout, mkdir -p's the parent dir if missing, and runs the idempotent schema.

    Hard-refuses to ever target the 0444 read-only replica (overwritten each tailsync).
    Surfaces connect errors (locked db / bad path) rather than swallowing them.
    """
    path = os.path.abspath(db_path) if db_path else resolve_db_path()
    path = os.path.abspath(path)

    # Hard guard: never touch the 0444 replica — it is overwritten every tailsync cycle.
    if path == os.path.abspath(_REPLICA_PATH):
        raise ValueError(
            f"REFUSED: watcher_integrity.db path resolves to the read-only replica "
            f"{_REPLICA_PATH}; the integrity store must use its own WSL-local db, "
            "never the replica."
        )

    # Live-store test guard (B11). Fires ONLY on this module's own live default, so an
    # explicit db_path or WATCHER_INTEGRITY_DB_PATH pointing at a scratch file is
    # untouched.
    if path == os.path.abspath(_live_default_path()) and _under_test():
        if not (
            allow_live_under_test
            or os.environ.get("ALLOW_LIVE_STORE_UNDER_TEST") == "1"
        ):
            raise ValueError(
                f"REFUSED: watcher_integrity.db resolved to the LIVE store {path} from "
                f"a test entry point (argv[0]={sys.argv[0]!r}). A test must not read or "
                "write the live store. Point WATCHER_INTEGRITY_DB_PATH at a scratch "
                "file, or pass an explicit db_path. To touch the live store on purpose, "
                "call get_connection(allow_live_under_test=True) or set "
                "ALLOW_LIVE_STORE_UNDER_TEST=1 — both have to be typed deliberately."
            )

    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)  # db dir may not exist yet

    try:
        conn = sqlite3.connect(path, timeout=15)
    except sqlite3.Error as e:  # locked db / bad path — surface, do not swallow
        raise sqlite3.Error(f"watcher_integrity.db connect failed at {path}: {e}") from e

    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    init_schema(conn)
    return conn


# Naming latitude: consumers import get_connection; connect is a thin alias.
connect = get_connection


if __name__ == "__main__":
    # Smoke only — guarded, NEVER runs on import. Prints the resolved path, WAL mode,
    # and the created table list. B0 has no runtime behavior beyond this manual check.
    _c = get_connection()
    _tables = [
        r[0]
        for r in _c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
    ]
    print(f"watcher_integrity.db @ {resolve_db_path()}")
    print(f"journal_mode = {_c.execute('PRAGMA journal_mode').fetchone()[0]}")
    print(f"tables = {_tables}")
    _c.close()
