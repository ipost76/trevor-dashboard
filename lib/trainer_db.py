#!/usr/bin/env python3
"""trainer_db.py — TREVOR v5 Trainer (R9) persistence layer (schema + connection).

The trainer (R9) is the optimizer that searches the 12-axis config space toward a
survival-first compass. It runs continuously on the WSL box (ghost@Ghost) and needs
its OWN persistence, none of which exists upstream. This module is the foundation
every R9-B1..B6 sibling imports:

    from lib.trainer_db import get_connection

It builds ``trainer.db`` — a NEW, WSL-local SQLite db — lazily on first ``get_connection()``
and owns 5 additive tables:

  * bandit_posteriors    — Thompson per-arm Beta posteriors (arm-selection distribution)
  * rejection_log        — dead-end memory (matters more under stochastic Thompson)
  * standing_hypotheses  — level-dependent hypotheses, evidence accumulates across levels
  * compass_weights      — per-level learned compass blend + gate thresholds
  * trainer_api_budget   — the trainer's daily API-spend accounting

WHY ITS OWN DB (A1 / RECON-TRAINER-001):
  * The WSL replica /home/ghost/trevor-replica/trevor.db is 0444 read-only and is
    atomically OVERWRITTEN every tailsync cycle — the trainer cannot write it. This
    module hard-REFUSES to ever resolve to that replica path (see get_connection).
  * The Hub's data/hub.db is Hub-only (3 tables) — NOT colonized here.
  * trainer.db is trainer-owned, WSL-local, and is NEVER replicated to the VM.

DISCIPLINE (A1 standing warnings):
  * DB-path trap (R8-B1): the db path is resolved AT CALL TIME inside the resolver
    — never a module-level constant, never a default-arg bound at import. An
    import-time binding leaks the wrong db. We go stricter than R8: there is NO
    module-level absolute-path constant at all.
  * Own connection: get_connection() opens a fresh connection per call (WAL +
    busy_timeout); no global handle is shared across the trainer's threads.
  * Additive-DB law: CREATE TABLE IF NOT EXISTS only — no DROP/DELETE/TRUNCATE,
    never a non-NULL overwrite. init_schema is idempotent, safe on every connect.
  * reset() hole (A1 rec #2): this module imports STDLIB ONLY — zero import path to
    auto_trader.validation or anything in the bot's validation package. Pure
    WSL-local sqlite. Nothing runs on import; the db is inert until a consumer calls.

Python 3, stdlib sqlite3 only. No ORM, no numpy, no LLM, no trainer logic (B1..B6).
"""
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Optional

# The 0444 read-only WSL replica of the VM's trevor.db. It is atomically overwritten
# every tailsync cycle, so the trainer must NEVER target it. get_connection refuses it.
_REPLICA_PATH = "/home/ghost/trevor-replica/trevor.db"


def utc_now() -> str:
    """UTC timestamp string for the *_at / ts / last_updated columns.

    Public glue: consumers (B1..B6) import this so every trainer writer stamps
    the same format (e.g. ``updated_at=utc_now()``), keeping the columns uniform.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _live_default_path() -> str:
    """The repo-local LIVE trainer.db, recomputed from this file's location per call.

    Split out of resolve_db_path so the test guard below can ask "is this the live
    store?" without re-deriving the path or caring what the env override says.
    Still call-time, still no module-level constant — the DB-path trap is unchanged.
    """
    # lib/trainer_db.py  ->  repo root is one directory up from lib/
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(repo_root, "data", "trainer.db")


def resolve_db_path() -> str:
    """Resolve the trainer.db absolute path AT CALL TIME.

    Order: TRAINER_DB_PATH env override wins; else the repo-local default
    <repo>/data/trainer.db, recomputed from this file's location on every call.

    Deliberately NOT a module-level constant and NOT a default-arg default —
    binding the path at import is the DB-path trap (A1 standing warning, R8-B1).
    """
    override = os.environ.get("TRAINER_DB_PATH")
    if override:
        return os.path.abspath(override)
    return _live_default_path()


# ═══════════════════════════════════════════════════════════════════════════════
#  THE LIVE-STORE TEST GUARD (B11) — DUPLICATED IN ALL FOUR STORE MODULES
# ═══════════════════════════════════════════════════════════════════════════════
# 🚨 DO NOT factor this into a shared ``_common_db.py``. The note at the top of
# ``lib/watcher_db.py`` is the reason and it applies to this copy too: the watcher's
# main and integrity stores are guaranteed to have ZERO cross-import in BOTH
# directions, and that guarantee is AST-proven by ``tests/test_watcher_independence.py``.
# A shared helper would hand every store module one common import and destroy it.
# This plumbing is DUPLICATED ON PURPOSE, exactly like resolve_db_path / init_schema
# / utc_now above it. Four copies is the design, not debt.
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


# All schema is additive: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
# only. Column definitions are verbatim from A1 (RECON-TRAINER-001) §6 — no invented
# columns. Ordered so index statements follow their tables.
_SCHEMA_STATEMENTS = (
    # Thompson per-arm posteriors (the arm-selection distribution alpha_budget does NOT provide)
    """
    CREATE TABLE IF NOT EXISTS bandit_posteriors (
      arm_hash TEXT NOT NULL, level_id INTEGER NOT NULL,
      axes_json TEXT NOT NULL,           -- the arbitrary-depth axis subset + values
      alpha REAL NOT NULL DEFAULT 1.0,   -- Beta wins+1
      beta  REAL NOT NULL DEFAULT 1.0,   -- Beta losses+1
      n_obs INTEGER NOT NULL DEFAULT 0,
      last_sampled_at TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY (arm_hash, level_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_bandit_level ON bandit_posteriors(level_id)",
    # Rejection log (dead-end memory; matters more under stochastic Thompson)
    """
    CREATE TABLE IF NOT EXISTS rejection_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arm_hash TEXT NOT NULL, level_id INTEGER NOT NULL, config_json TEXT NOT NULL,
      failing_gates_json TEXT, rationale_text TEXT,
      p_value REAL, dsr REAL, ts TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_rejection_arm ON rejection_log(arm_hash, level_id)",
    # Standing hypotheses (level-dependent, evidence accumulates across levels)
    """
    CREATE TABLE IF NOT EXISTS standing_hypotheses (
      hypothesis_id TEXT NOT NULL, level_id INTEGER NOT NULL,
      domain TEXT NOT NULL, claim TEXT NOT NULL,
      evidence_json TEXT, n_obs INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open', last_updated TEXT NOT NULL,
      PRIMARY KEY (hypothesis_id, level_id)
    )
    """,
    # Per-level learned compass blend (consistency<->magnitude weight + gate thresholds)
    """
    CREATE TABLE IF NOT EXISTS compass_weights (
      level_id INTEGER PRIMARY KEY,
      w_consistency REAL NOT NULL, w_magnitude REAL NOT NULL,
      dd_ceiling REAL NOT NULL, cvar_floor REAL NOT NULL,
      learned INTEGER NOT NULL DEFAULT 0,   -- 0=set/seed, 1=learned
      updated_at TEXT NOT NULL
    )
    """,
    # Trainer API budget accounting (the daily spend line that does not exist upstream)
    """
    CREATE TABLE IF NOT EXISTS trainer_api_budget (
      date TEXT PRIMARY KEY, spend_usd REAL NOT NULL DEFAULT 0.0,
      call_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    )
    """,
)


def init_schema(conn: sqlite3.Connection) -> None:
    """Idempotently create all 5 additive trainer tables + their 2 indexes.

    CREATE ... IF NOT EXISTS only (additive-DB law) — safe to call on every
    connect. No DROP/DELETE/TRUNCATE; never overwrites existing data. Wrapped in
    a single transaction so the schema lands atomically.
    """
    with conn:  # commits on success, rolls back on error
        for stmt in _SCHEMA_STATEMENTS:
            conn.execute(stmt)


def get_connection(
    db_path: Optional[str] = None, *, allow_live_under_test: bool = False
) -> sqlite3.Connection:
    """Open (lazily creating) trainer.db and ensure its schema; return the connection.

    Path resolution is at CALL TIME: explicit db_path arg wins, else resolve_db_path()
    (TRAINER_DB_PATH env -> <repo>/data/trainer.db). Opens the trainer's OWN connection
    (never a shared global handle), sets WAL + busy_timeout, mkdir -p's the parent dir
    if missing, and runs the idempotent schema.

    Hard-refuses to ever target the 0444 read-only replica (overwritten each tailsync),
    and hard-refuses the LIVE store when the entry point is a test (see the guard note
    above). ``allow_live_under_test=True`` is the deliberate escape hatch for a genuine
    live read from a test. Surfaces connect errors rather than swallowing them.
    """
    path = os.path.abspath(db_path) if db_path else resolve_db_path()
    path = os.path.abspath(path)

    # Hard guard: never touch the 0444 replica — it is overwritten every tailsync cycle.
    if path == os.path.abspath(_REPLICA_PATH):
        raise ValueError(
            f"REFUSED: trainer.db path resolves to the read-only replica {_REPLICA_PATH}; "
            "the trainer must use its own WSL-local db, never the replica."
        )

    # Live-store test guard (B11). Fires ONLY on this module's own live default, so an
    # explicit db_path or a TRAINER_DB_PATH pointing at a scratch file is untouched.
    if path == os.path.abspath(_live_default_path()) and _under_test():
        if not (
            allow_live_under_test
            or os.environ.get("ALLOW_LIVE_STORE_UNDER_TEST") == "1"
        ):
            raise ValueError(
                f"REFUSED: trainer.db resolved to the LIVE store {path} from a test "
                f"entry point (argv[0]={sys.argv[0]!r}). A test must not read or write "
                "the live store. Point TRAINER_DB_PATH at a scratch file, or pass an "
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
        raise sqlite3.Error(f"trainer.db connect failed at {path}: {e}") from e

    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    init_schema(conn)
    return conn


# Naming latitude per A1 §6 ("get_connection() or connect()"): consumers import
# get_connection; connect is a thin alias for callers that prefer that spelling.
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
    print(f"trainer.db @ {resolve_db_path()}")
    print(f"journal_mode = {_c.execute('PRAGMA journal_mode').fetchone()[0]}")
    print(f"tables = {_tables}")
    _c.close()
