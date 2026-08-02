#!/usr/bin/env python3
"""memory_db.py — TREVOR v5 Memory Store (R11) foundation (schema + connection + scopes).

R11 is the shared reasoning brain: a structured, append-only, 3-tier store that BOTH
agents (the R9 trainer, the R10 watcher) read/index/rehydrate through. It is a LAYER,
not a rebuild — R9/R10 already shipped R11-shaped structured reasoning logs; R11 reads
+ indexes them and adds tiers + query + rehydration on top. **R9/R10's writes do not
change.** This module is the foundation every R11-C1/B1..B3 sibling imports:

    from lib.memory_db import get_connection            # schema init
    from lib.memory_db import trainer_scope, watcher_scope   # the agent-facing surface

It builds ``memory.db`` — a NEW, WSL-local SQLite db — lazily on first ``get_connection()``
and owns 6 additive tables:

  * trainer_memory / watcher_memory  — the append-only knowledge rows (one per agent
    NAMESPACE, identical shape, separate tables)
  * memory_tags                      — subject → tag index over the reused vocabulary
  * memory_tier_state                — the ONE mutable tier pointer (HOT/WARM/COLD)
  * memory_state                     — small key/value slot (cursor + B2's level-cache)
  * memory_health                    — integrity/health flags

THE LAW THIS STORE HONORS: **NOTHING IS EVER DELETED.** The ``*_memory`` tables are
INSERT-only — this module exposes NO update/delete path for them. WARM compresses to
conclusion+tags, COLD to summary stats, but the knowledge PERSISTS: a WARM row coexists
with its original HOT row (a NEW row, same ``canonical_id``, ``role='WARM_SUMMARY'``);
only ``memory_tier_state.current_tier`` flips. The system forgets DETAIL, never
CONCLUSIONS. The ONLY mutable rows are the three small status tables (ON-CONFLICT upsert,
exactly like ``watcher_health``).

WHY ITS OWN DB (A1 / RECON-MEMORY-001):
  * The WSL replica /home/ghost/trevor-replica/trevor.db is 0444 read-only and is
    atomically OVERWRITTEN every tailsync cycle — the store cannot live there. This
    module hard-REFUSES to ever resolve to that replica path (see get_connection).
  * memory.db is WSL-local and is NEVER replicated to the VM.

🚨 THE CRITIQUE-LEAK BOUNDARY (A1's biggest risk) IS STRUCTURAL:
  * Per-agent NAMESPACES: the trainer's entries land in ``trainer_memory``, the watcher's
    generalized lessons in ``watcher_memory`` — SEPARATE tables reached only through the
    per-agent scoped accessors (``trainer_scope()`` / ``watcher_scope()``). No raw shared
    connection is the agent-facing surface (a raw ``get_connection`` exists for schema
    init only).
  * ``watcher_critiques`` (the raw per-decision critiques of the trainer's own arms) is
    NEVER projected into this store — teaching stays Hub-only, Ghost-gated. Only the
    watcher's GENERALIZED lessons land in ``watcher_memory`` (written natively by B1).
  * ``tests/test_watcher_independence.py`` denial 4 forbids any ``trainer_*.py`` from
    referencing the ``watcher_memory`` symbol/table — the boundary is proven, not a
    convention.

DISCIPLINE (mirrors lib/trainer_db.py verbatim):
  * DB-path trap: the db path is resolved AT CALL TIME inside the resolver — never a
    module-level constant, never a default-arg bound at import. There is NO module-level
    absolute-path constant at all EXCEPT the replica-refusal literal below.
  * Own connection: get_connection() opens a fresh connection per call (WAL +
    busy_timeout); no global handle is shared across threads.
  * Additive-DB law: CREATE TABLE IF NOT EXISTS only — no DROP/DELETE/TRUNCATE, never a
    non-NULL overwrite. init_schema is idempotent, safe on every connect.
  * STDLIB ONLY: zero import path to auto_trader.* or any bot/trainer/watcher logic.
    Nothing runs on import; the db is inert until a consumer calls.

Python 3, stdlib sqlite3 only. No ORM, no numpy, no LLM, no memory logic (B1..B3).
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

# The 0444 read-only WSL replica of the VM's trevor.db. It is atomically overwritten
# every tailsync cycle, so the memory store must NEVER target it. get_connection refuses
# it. This is the ONLY module-level absolute-path literal permitted (the replica guard).
_REPLICA_PATH = "/home/ghost/trevor-replica/trevor.db"

# ── Reused vocabulary (A1 §R2) — REUSE, never invent a competing taxonomy ──────────────
# The 12 config axes (trainer_bandit.default_axis_schema) + the 5 mechanical-check names
# (watcher_review). The projection layer tags subjects with these; B1 tags natively with
# the same constants so there is ONE taxonomy across the store.
CONFIG_AXES = (
    "tickers", "size", "leverage", "timeframe", "direction", "hedge",
    "exit", "portfolio", "timing_context", "cost", "signal", "entry",
)
MECHANICAL_CHECKS = (
    "known_dead_end_repropose", "budget_overrun", "skipped_gate",
    "inconsistent_log", "axes_off_surface",
)

# ── Role taxonomy (the 3 tiers) ────────────────────────────────────────────────────────
ROLE_HOT = "HOT_DETAIL"
ROLE_WARM = "WARM_SUMMARY"
ROLE_COLD = "COLD_STAT"
_ROLES = frozenset((ROLE_HOT, ROLE_WARM, ROLE_COLD))

# ── Per-agent namespaces (agent -> its OWN memory table) ───────────────────────────────
# The scoped accessors bind to exactly one of these; a trainer handle has no code path to
# the watcher table and vice versa. Table names come ONLY from this trusted map — never
# from caller input — so a scope can never be pointed at the other namespace.
TRAINER_NS = "trainer"
WATCHER_NS = "watcher"
_NAMESPACES = {TRAINER_NS: "trainer_memory", WATCHER_NS: "watcher_memory"}


def utc_now() -> str:
    """UTC timestamp string for the created_ts / *_at columns.

    Public glue: consumers (C1 projection, B1..B3) import this so every writer stamps the
    same format, keeping the columns uniform.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def resolve_db_path() -> str:
    """Resolve the memory.db absolute path AT CALL TIME.

    Order: MEMORY_DB_PATH env override wins; else the repo-local default
    <repo>/data/memory.db, recomputed from this file's location on every call.

    Deliberately NOT a module-level constant and NOT a default-arg default —
    binding the path at import is the DB-path trap (A1 standing warning, R8-B1).
    """
    override = os.environ.get("MEMORY_DB_PATH")
    if override:
        return os.path.abspath(override)
    return _live_default_path()


def _live_default_path() -> str:
    """The repo-local LIVE memory.db, recomputed from this file's location per call.

    Split out of resolve_db_path so the test guard below can ask "is this the live
    store?" without re-deriving the path or caring what the env override says.
    Still call-time, still no module-level constant — the DB-path trap is unchanged.
    """
    # lib/memory_db.py  ->  repo root is one directory up from lib/
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(repo_root, "data", "memory.db")


# ═══════════════════════════════════════════════════════════════════════════════
#  THE LIVE-STORE TEST GUARD (B11) — DUPLICATED IN ALL FOUR STORE MODULES
# ═══════════════════════════════════════════════════════════════════════════════
# 🚨 DO NOT factor this into a shared ``_common_db.py``. The note at the top of
# ``lib/watcher_db.py`` is the reason and it binds this copy too: the watcher's main
# and integrity stores are guaranteed to have ZERO cross-import in BOTH directions,
# and that guarantee is AST-proven by ``tests/test_watcher_independence.py``. A shared
# helper would hand every store module one common import and destroy it. This plumbing
# is DUPLICATED ON PURPOSE, exactly like resolve_db_path / init_schema / utc_now.
# Four copies is the design, not debt.
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


# All schema is additive: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS only.
# Column definitions are verbatim from A1 (RECON-MEMORY-001) §5 — no invented columns.
# The two *_memory tables are byte-identical in shape (separate tables, one per namespace).
def _memory_table_ddl(name: str) -> str:
    return f"""
    CREATE TABLE IF NOT EXISTS {name} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_id TEXT NOT NULL, role TEXT NOT NULL,        -- HOT_DETAIL | WARM_SUMMARY | COLD_STAT
      subjects_json TEXT NOT NULL, action TEXT, because TEXT,
      level INTEGER NOT NULL, outcome TEXT, confidence TEXT, prose TEXT,
      source_db TEXT, source_table TEXT, source_id INTEGER,
      entry_hash TEXT, created_ts TEXT NOT NULL
    )
    """


_SCHEMA_STATEMENTS = (
    # ── trainer_memory (the trainer's append-only knowledge rows) ──
    _memory_table_ddl("trainer_memory"),
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tmem_hash  ON trainer_memory(entry_hash)",
    "CREATE INDEX IF NOT EXISTS idx_tmem_level ON trainer_memory(level)",
    "CREATE INDEX IF NOT EXISTS idx_tmem_canon ON trainer_memory(canonical_id)",
    # ── watcher_memory (the watcher's GENERALIZED lessons — NOT raw critiques) ──
    _memory_table_ddl("watcher_memory"),
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_wmem_hash  ON watcher_memory(entry_hash)",
    "CREATE INDEX IF NOT EXISTS idx_wmem_level ON watcher_memory(level)",
    "CREATE INDEX IF NOT EXISTS idx_wmem_canon ON watcher_memory(canonical_id)",
    # ── subject → tag index (reused vocabulary) ──
    "CREATE TABLE IF NOT EXISTS memory_tags (entry_agent TEXT, entry_id INTEGER, tag TEXT)",
    "CREATE INDEX IF NOT EXISTS idx_mtag ON memory_tags(tag)",
    # ── the ONE mutable tier pointer (HOT/WARM/COLD per canonical_id) ──
    """
    CREATE TABLE IF NOT EXISTS memory_tier_state (
      canonical_id TEXT PRIMARY KEY, current_tier TEXT NOT NULL,
      last_accessed_ts TEXT, access_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    )
    """,
    # ── small key/value slot (projection cursor + B2's current-level cache) ──
    "CREATE TABLE IF NOT EXISTS memory_state  (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL)",
    # ── integrity/health flags ──
    "CREATE TABLE IF NOT EXISTS memory_health (check_name TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT, updated_at TEXT NOT NULL)",
)


def init_schema(conn: sqlite3.Connection) -> None:
    """Idempotently create all 6 additive tables + their 7 indexes.

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
    """Open (lazily creating) memory.db and ensure its schema; return the connection.

    Path resolution is at CALL TIME: explicit db_path arg wins, else resolve_db_path()
    (MEMORY_DB_PATH env -> <repo>/data/memory.db). Opens its OWN connection (never a
    shared global handle), sets WAL + busy_timeout, mkdir -p's the parent dir if missing,
    and runs the idempotent schema.

    Hard-refuses to ever target the 0444 read-only replica (overwritten each tailsync).
    Surfaces connect errors (locked db / bad path) rather than swallowing them.

    NOTE: this raw connection is for SCHEMA INIT (and the projection/status helpers). The
    AGENT-FACING surface is the per-namespace scopes (trainer_scope / watcher_scope) — do
    NOT hand a raw connection to agent code, or the critique-leak boundary is only a
    convention instead of a structure.
    """
    path = os.path.abspath(db_path) if db_path else resolve_db_path()
    path = os.path.abspath(path)

    # Hard guard: never touch the 0444 replica — it is overwritten every tailsync cycle.
    if path == os.path.abspath(_REPLICA_PATH):
        raise ValueError(
            f"REFUSED: memory.db path resolves to the read-only replica {_REPLICA_PATH}; "
            "the memory store must use its own WSL-local db, never the replica."
        )

    # Live-store test guard (B11). Fires ONLY on this module's own live default, so an
    # explicit db_path or a MEMORY_DB_PATH pointing at a scratch file is untouched.
    if path == os.path.abspath(_live_default_path()) and _under_test():
        if not (
            allow_live_under_test
            or os.environ.get("ALLOW_LIVE_STORE_UNDER_TEST") == "1"
        ):
            raise ValueError(
                f"REFUSED: memory.db resolved to the LIVE store {path} from a test "
                f"entry point (argv[0]={sys.argv[0]!r}). A test must not read or write "
                "the live store. Point MEMORY_DB_PATH at a scratch file, or pass an "
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
        raise sqlite3.Error(f"memory.db connect failed at {path}: {e}") from e

    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    init_schema(conn)
    return conn


# Naming latitude (A1 §6): consumers import get_connection; connect is a thin alias.
connect = get_connection


# ═══════════════════════════════════════════════════════════════════════════════════════
#  APPEND-ONLY WRITE + READ — the *_memory tables have NO update/delete path (by design).
#  The entry_hash makes projection idempotent: same source row -> same hash -> INSERT OR
#  IGNORE dedupes on re-sweep. A WARM/COLD row is a NEW INSERT with the same canonical_id.
# ═══════════════════════════════════════════════════════════════════════════════════════
_ENTRY_COLS = (
    "canonical_id", "role", "subjects_json", "action", "because", "level",
    "outcome", "confidence", "prose", "source_db", "source_table", "source_id",
    "entry_hash", "created_ts",
)


class MemoryScope:
    """A per-agent handle bound to EXACTLY ONE namespace table (trainer_memory OR
    watcher_memory). The bound table name comes only from the trusted ``_NAMESPACES`` map,
    never from caller input — so a trainer scope has no code path to the watcher namespace
    and vice versa (the structural half of the critique-leak boundary; the AST denial 4 is
    the other half). Exposes INSERT-only writes (no update/delete) + scoped reads.
    """

    def __init__(self, agent: str, conn: sqlite3.Connection):
        if agent not in _NAMESPACES:
            raise ValueError(f"unknown memory namespace {agent!r}; expected one of {sorted(_NAMESPACES)}")
        self.agent = agent
        self._table = _NAMESPACES[agent]  # trusted literal — never caller input
        self.conn = conn

    # ── context-manager sugar so callers can `with trainer_scope() as s:` ──
    def __enter__(self) -> "MemoryScope":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        _ = (exc_type, exc_value, traceback)  # unused; scope closes regardless of outcome
        self.close()

    def close(self) -> None:
        try:
            self.conn.close()
        except sqlite3.Error:
            pass

    # ── INSERT-only append (idempotent on entry_hash) ──
    def insert_entry(
        self, *, canonical_id: str, role: str, subjects: Union[str, Dict[str, Any]],
        level: int, action: Optional[str] = None, because: Optional[Union[str, List[str]]] = None,
        outcome: Optional[str] = None, confidence: Optional[str] = None, prose: Optional[str] = None,
        source_db: Optional[str] = None, source_table: Optional[str] = None,
        source_id: Optional[int] = None, entry_hash: Optional[str] = None,
        created_ts: Optional[str] = None, commit: bool = True,
    ) -> int:
        """Append ONE knowledge row into THIS scope's namespace table and return its id.

        Additive, INSERT OR IGNORE on the UNIQUE entry_hash — a re-append of the same
        source row is a no-op (returns the existing id). No update/delete path exists.
        """
        if role not in _ROLES:
            raise ValueError(f"invalid role {role!r}; expected one of {sorted(_ROLES)}")
        subjects_json = subjects if isinstance(subjects, str) else json.dumps(subjects, sort_keys=True)
        because_txt = because if (because is None or isinstance(because, str)) else json.dumps(because)
        row = (
            canonical_id, role, subjects_json, action, because_txt, int(level),
            outcome, confidence, prose, source_db, source_table,
            (None if source_id is None else int(source_id)),
            entry_hash, (created_ts or utc_now()),
        )
        placeholders = ", ".join("?" for _ in _ENTRY_COLS)
        collist = ", ".join(_ENTRY_COLS)
        # {self._table} is a trusted literal from _NAMESPACES; every value is bound.
        cur = self.conn.execute(
            f"INSERT OR IGNORE INTO {self._table} ({collist}) VALUES ({placeholders})", row
        )
        new_id = cur.lastrowid
        if commit:
            self.conn.commit()
        if entry_hash is not None:
            # Authoritative for dedup: works whether the row was freshly inserted OR the
            # INSERT OR IGNORE hit the UNIQUE(entry_hash) conflict and inserted nothing.
            got = self.conn.execute(
                f"SELECT id FROM {self._table} WHERE entry_hash = ?", (entry_hash,)
            ).fetchone()
            if got is not None:
                return int(got[0])
        # No dedup key (NULL entry_hash always inserts — SQLite treats NULLs as distinct):
        # the freshly-inserted rowid is correct.
        return int(new_id) if new_id else 0

    # ── tag index (scoped to this agent's namespace) ──
    def tag(self, entry_id: int, tag: str, commit: bool = True) -> None:
        """Index one subject tag for a row in THIS namespace (entry_agent = self.agent)."""
        self.conn.execute(
            "INSERT INTO memory_tags (entry_agent, entry_id, tag) VALUES (?, ?, ?)",
            (self.agent, int(entry_id), str(tag)),
        )
        if commit:
            self.conn.commit()

    def tags_for(self, entry_id: int) -> List[str]:
        rows = self.conn.execute(
            "SELECT tag FROM memory_tags WHERE entry_agent = ? AND entry_id = ? ORDER BY tag",
            (self.agent, int(entry_id)),
        ).fetchall()
        return [r[0] for r in rows]

    # ── scoped reads (bound table only) ──
    def get_entry(self, entry_id: int) -> Optional[Dict[str, Any]]:
        cur = self.conn.execute(
            f"SELECT id, {', '.join(_ENTRY_COLS)} FROM {self._table} WHERE id = ?", (int(entry_id),)
        )
        r = cur.fetchone()
        if r is None:
            return None
        keys = ("id",) + _ENTRY_COLS
        return dict(zip(keys, r))

    def entries_by_canonical(self, canonical_id: str) -> List[Dict[str, Any]]:
        cur = self.conn.execute(
            f"SELECT id, {', '.join(_ENTRY_COLS)} FROM {self._table} "
            f"WHERE canonical_id = ? ORDER BY id", (canonical_id,)
        )
        keys = ("id",) + _ENTRY_COLS
        return [dict(zip(keys, r)) for r in cur.fetchall()]

    def count(self) -> int:
        r = self.conn.execute(f"SELECT COUNT(*) FROM {self._table}").fetchone()
        return int(r[0]) if r else 0


def trainer_scope(db_path: Optional[str] = None) -> MemoryScope:
    """Open a memory.db connection scoped to the TRAINER namespace (trainer_memory).

    The agent-facing write/read surface — the trainer never gets a raw connection, so it
    has no code path into watcher_memory (leak boundary, structural half).
    """
    return MemoryScope(TRAINER_NS, get_connection(db_path))


def watcher_scope(db_path: Optional[str] = None) -> MemoryScope:
    """Open a memory.db connection scoped to the WATCHER namespace (watcher_memory).

    Used by B1 to write the watcher's GENERALIZED lessons (never raw critiques).
    """
    return MemoryScope(WATCHER_NS, get_connection(db_path))


# ═══════════════════════════════════════════════════════════════════════════════════════
#  STATUS TABLES — the ONLY mutable rows (ON-CONFLICT upsert, like watcher_health).
#  memory_state carries the projection cursor + B2's current-level cache SLOT (C1 provides
#  the slot only; B2 owns the refresh — no level source is hardcoded here, no path to a
#  levels table). memory_tier_state is the append-only store's ONE mutable tier pointer.
# ═══════════════════════════════════════════════════════════════════════════════════════
def upsert_state(key: str, value: str, conn: Optional[sqlite3.Connection] = None) -> None:
    """Set a small key/value slot (e.g. a projection cursor, or B2's cached current level)."""
    own = conn is None
    c = conn or get_connection()
    try:
        c.execute(
            "INSERT INTO memory_state (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (str(key), (None if value is None else str(value)), utc_now()),
        )
        if own:
            c.commit()
    finally:
        if own:
            c.close()


def get_state(key: str, conn: Optional[sqlite3.Connection] = None) -> Optional[str]:
    own = conn is None
    c = conn or get_connection()
    try:
        r = c.execute("SELECT value FROM memory_state WHERE key = ?", (str(key),)).fetchone()
        return None if r is None else r[0]
    finally:
        if own:
            c.close()


def upsert_tier(
    canonical_id: str, current_tier: str, *, touch_access: bool = False,
    conn: Optional[sqlite3.Connection] = None,
) -> None:
    """Flip the tier pointer for a canonical_id (the ONE mutable knowledge-side state).

    The *_memory rows for that canonical_id are never touched — WARM/COLD is a new INSERT
    with the same canonical_id; only this pointer moves.
    """
    if current_tier not in _ROLES:
        raise ValueError(f"invalid tier {current_tier!r}; expected one of {sorted(_ROLES)}")
    own = conn is None
    c = conn or get_connection()
    now = utc_now()
    try:
        access_inc = 1 if touch_access else 0
        last_ts = now if touch_access else None
        c.execute(
            "INSERT INTO memory_tier_state (canonical_id, current_tier, last_accessed_ts, "
            "access_count, updated_at) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(canonical_id) DO UPDATE SET current_tier=excluded.current_tier, "
            "last_accessed_ts=COALESCE(excluded.last_accessed_ts, memory_tier_state.last_accessed_ts), "
            "access_count=memory_tier_state.access_count + ?, updated_at=excluded.updated_at",
            (str(canonical_id), current_tier, last_ts, access_inc, now, access_inc),
        )
        if own:
            c.commit()
    finally:
        if own:
            c.close()


def get_tier(canonical_id: str, conn: Optional[sqlite3.Connection] = None) -> Optional[str]:
    own = conn is None
    c = conn or get_connection()
    try:
        r = c.execute(
            "SELECT current_tier FROM memory_tier_state WHERE canonical_id = ?", (str(canonical_id),)
        ).fetchone()
        return None if r is None else r[0]
    finally:
        if own:
            c.close()


def upsert_health(
    check_name: str, status: str, detail: Optional[str] = None,
    conn: Optional[sqlite3.Connection] = None,
) -> None:
    """Set an integrity/health flag (mirrors watcher_health's upsert shape)."""
    own = conn is None
    c = conn or get_connection()
    try:
        c.execute(
            "INSERT INTO memory_health (check_name, status, detail, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(check_name) DO UPDATE SET status=excluded.status, "
            "detail=excluded.detail, updated_at=excluded.updated_at",
            (str(check_name), str(status), detail, utc_now()),
        )
        if own:
            c.commit()
    finally:
        if own:
            c.close()


if __name__ == "__main__":
    # Smoke only — guarded, NEVER runs on import. Prints the resolved path, WAL mode,
    # and the created table list. C1 has no runtime behavior beyond this manual check.
    _c = get_connection()
    _tables = [
        r[0]
        for r in _c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
    ]
    print(f"memory.db @ {resolve_db_path()}")
    print(f"journal_mode = {_c.execute('PRAGMA journal_mode').fetchone()[0]}")
    print(f"tables = {_tables}")
    _c.close()
