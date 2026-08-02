#!/usr/bin/env python3
"""watcher_db.py — TREVOR v5 Watcher (R10) MAIN persistence layer (schema + connection).

The watcher (R10) observes and reports on the v5 self-improvement stack — it never
trades and never auto-halts. It has three modules: a review-brain (an LLM, can drift),
an integrity sub-module (must NEVER drift), and an error/health/budget layer. This
module is the ``watcher.db`` foundation the two FRAGILE modules import:

    from lib.watcher_db import get_connection

    * review-brain (R10-B1) — writes ``watcher_critiques``
    * error/health/budget (R10-B3) — writes ``watcher_errors`` / ``watcher_health`` /
      ``watcher_api_budget``

It builds ``watcher.db`` — a NEW, WSL-local SQLite db — lazily on first ``get_connection()``
and owns 4 additive tables (+1 index):

  * watcher_critiques   — review-brain critiques (mechanical checks + LLM prose)
  * watcher_errors      — surfaced errors (loop stall / failed unit / swallowed canary / dead cron)
  * watcher_health      — per-check health status
  * watcher_api_budget  — the watcher's daily API-spend accounting

═══════════════════════════════════════════════════════════════════════════════
 THE INDEPENDENCE GUARANTEE (Ghost's locked decision — structural, not convention)
═══════════════════════════════════════════════════════════════════════════════
The integrity sub-module (R10-B2) keeps its OWN store, ``watcher_integrity.db``, via
the SEPARATE ``lib/watcher_integrity_db.py`` connection module. The two modules are
truly distinct:

  * ZERO cross-import (BOTH directions): this module NEVER imports/references
    ``watcher_integrity_db`` or ``watcher_integrity.db``; that module never imports
    ``watcher_db`` or ``watcher.db``. A little plumbing is DUPLICATED here on purpose
    — a shared ``_common_db.py`` would re-couple them and destroy the guarantee.
  * The fragile LLM review-brain (B1) physically CANNOT write the integrity store —
    the only handle to it is ``lib.watcher_integrity_db.get_connection``, and B1/B3
    import only ``lib.watcher_db``.
  * A CI/test AST-assert (``tests/test_watcher_independence.py``) proves the three
    structural denials: (1) review-brain/error ↛ integrity DB (the integrity side is
    the module whose basename CONTAINS ``integrity`` — B2 is ``watcher_integrity.py``,
    so it lands under the rule cleanly; every OTHER watcher module is denied any
    integrity reference), (2) the trainer is structurally unable to read the watcher's
    critiques (teaching stays Hub-only, Ghost-gated), and (3) no watcher module reaches
    any auto-halt lever (no ``auto_trader.*`` / gateway-client import, no
    ``set_enabled`` / ``killswitch`` / ``force_close``, and it touches ``auto_config``
    NOT AT ALL — never reads it, never writes it).

DISCIPLINE (mirrors lib/trainer_db.py):
  * DB-path trap: the db path is resolved AT CALL TIME inside the resolver — never a
    module-level constant, never a default-arg bound at import. The ONLY module-level
    absolute-path literal is the replica-refusal guard constant below.
  * Own connection: get_connection() opens a fresh connection per call (WAL +
    busy_timeout); no global handle is shared across the watcher's threads.
  * Additive-DB law: CREATE TABLE IF NOT EXISTS only — no DROP/DELETE/TRUNCATE,
    never a non-NULL overwrite. init_schema is idempotent, safe on every connect.
  * Replica-refusal: the 0444 WSL replica ``/home/ghost/trevor-replica/trevor.db`` is
    overwritten every tailsync cycle — get_connection hard-REFUSES to resolve to it.
  * WSL-local, NEVER replicated to the VM. Nothing runs on import; the db is inert
    until a consumer calls.

Python 3, stdlib sqlite3 only. No ORM, no numpy, no LLM, no watcher logic (B1..B3).
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

    Public glue: consumers (B1..B3) import this so every watcher writer stamps the
    same format (e.g. ``updated_at=utc_now()``), keeping the columns uniform.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def resolve_db_path() -> str:
    """Resolve the watcher.db absolute path AT CALL TIME.

    Order: WATCHER_DB_PATH env override wins; else the repo-local default
    <repo>/data/watcher.db, recomputed from this file's location on every call.

    Deliberately NOT a module-level constant and NOT a default-arg default —
    binding the path at import is the DB-path trap.
    """
    override = os.environ.get("WATCHER_DB_PATH")
    if override:
        return os.path.abspath(override)
    return _live_default_path()


def _live_default_path() -> str:
    """The repo-local LIVE watcher.db, recomputed from this file's location per call.

    Split out of resolve_db_path so the test guard below can ask "is this the live
    store?" without re-deriving the path or caring what the env override says.
    Still call-time, still no module-level constant — the DB-path trap is unchanged.
    """
    # lib/watcher_db.py  ->  repo root is one directory up from lib/
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(repo_root, "data", "watcher.db")


# ═══════════════════════════════════════════════════════════════════════════════
#  THE LIVE-STORE TEST GUARD (B11) — DUPLICATED IN ALL FOUR STORE MODULES
# ═══════════════════════════════════════════════════════════════════════════════
# 🚨 DO NOT factor this into a shared ``_common_db.py``. THE INDEPENDENCE GUARANTEE
# AT THE TOP OF THIS FILE IS EXACTLY WHY: this module and ``lib/watcher_integrity_db.py``
# must have ZERO cross-import in BOTH directions, and that is AST-proven by
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
#
# ⚠️ This module's OWN replica guard six lines below was the right SHAPE and the wrong
# SCOPE — a denylist of exactly one hardcoded path with no notion of "under test",
# which is why the live-store escapes sailed straight past it.
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


# All schema is additive: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
# only. Column definitions are verbatim from A1 (RECON-WATCHER-001) §4 — no invented
# columns. Ordered so the index statement follows its table.
_SCHEMA_STATEMENTS = (
    # Review-brain critiques (B1): deterministic-check results + LLM prose (template
    # when the API budget is exhausted).
    """
    CREATE TABLE IF NOT EXISTS watcher_critiques (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_ref TEXT NOT NULL,        -- rejection_log.id / shadow_id / level N
      decision_kind TEXT NOT NULL,       -- 'verdict' | 'promotion' | 'level_change'
      level_id INTEGER NOT NULL,
      severity TEXT NOT NULL,            -- 'note' | 'concern' | 'problem'
      mechanical_json TEXT,              -- deterministic-check results
      judgment_text TEXT,                -- LLM prose (template when budget-exhausted)
      llm_used INTEGER NOT NULL DEFAULT 0,
      ts TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_crit_level ON watcher_critiques(level_id)",
    # Surfaced errors (B3): loop stalls, failed units, swallowed canaries, dead crons.
    """
    CREATE TABLE IF NOT EXISTS watcher_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,              -- 'loop_stall'|'systemctl_failed'|'swallowed_canary'|'cron_dead'
      detail_json TEXT NOT NULL,
      first_seen_ts TEXT NOT NULL, last_seen_ts TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0
    )
    """,
    # Per-check health status (B3).
    """
    CREATE TABLE IF NOT EXISTS watcher_health (
      check_name TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT, updated_at TEXT NOT NULL
    )
    """,
    # The watcher's daily API-spend accounting (B3).
    """
    CREATE TABLE IF NOT EXISTS watcher_api_budget (
      date TEXT PRIMARY KEY, spend_usd REAL NOT NULL DEFAULT 0.0,
      call_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    )
    """,
)


def init_schema(conn: sqlite3.Connection) -> None:
    """Idempotently create all 4 additive watcher tables + the index.

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
    """Open (lazily creating) watcher.db and ensure its schema; return the connection.

    Path resolution is at CALL TIME: explicit db_path arg wins, else resolve_db_path()
    (WATCHER_DB_PATH env -> <repo>/data/watcher.db). Opens the watcher's OWN connection
    (never a shared global handle), sets WAL + busy_timeout, mkdir -p's the parent dir
    if missing, and runs the idempotent schema.

    Hard-refuses to ever target the 0444 read-only replica (overwritten each tailsync).
    Surfaces connect errors (locked db / bad path) rather than swallowing them.
    """
    path = os.path.abspath(db_path) if db_path else resolve_db_path()
    path = os.path.abspath(path)

    # Hard guard: never touch the 0444 replica — it is overwritten every tailsync cycle.
    if path == os.path.abspath(_REPLICA_PATH):
        raise ValueError(
            f"REFUSED: watcher.db path resolves to the read-only replica {_REPLICA_PATH}; "
            "the watcher must use its own WSL-local db, never the replica."
        )

    # Live-store test guard (B11). Fires ONLY on this module's own live default, so an
    # explicit db_path or a WATCHER_DB_PATH pointing at a scratch file is untouched.
    if path == os.path.abspath(_live_default_path()) and _under_test():
        if not (
            allow_live_under_test
            or os.environ.get("ALLOW_LIVE_STORE_UNDER_TEST") == "1"
        ):
            raise ValueError(
                f"REFUSED: watcher.db resolved to the LIVE store {path} from a test "
                f"entry point (argv[0]={sys.argv[0]!r}). A test must not read or write "
                "the live store. Point WATCHER_DB_PATH at a scratch file, or pass an "
                "explicit db_path. To touch the live store on purpose, call "
                "get_connection(allow_live_under_test=True) or set "
                "ALLOW_LIVE_STORE_UNDER_TEST=1 — both have to be typed deliberately."
            )

    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)  # db dir may not exist yet

    try:
        conn = sqlite3.connect(path, timeout=15)
    except sqlite3.Error as e:  # locked db / bad path — surface, do not swallow
        raise sqlite3.Error(f"watcher.db connect failed at {path}: {e}") from e

    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    init_schema(conn)
    return conn


# Naming latitude: consumers import get_connection; connect is a thin alias for
# callers that prefer that spelling.
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
    print(f"watcher.db @ {resolve_db_path()}")
    print(f"journal_mode = {_c.execute('PRAGMA journal_mode').fetchone()[0]}")
    print(f"tables = {_tables}")
    _c.close()
