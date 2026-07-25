#!/usr/bin/env python3
"""memory_query.py — R11-B1 the structured WRITE + the "have we tested X" QUERY.

This is the capability that turns the trainer's endless SEARCH into endless LEARNING:
a fast, indexed, cross-tier structured-verdict lookup ("have we tested X?") plus the
structured write that feeds it (tags enforced AT WRITE, never bolted on later). It is a
LAYER over C1 (``lib/memory_db.py``) — it builds ON C1's scoped-accessor API, never around
it, and introduces NO update/delete path to the append-only ``*_memory`` tables.

    from memory_query import write_memory, have_we_tested

TWO SURFACES:
  * ``write_memory(agent, subjects, action, because, level, outcome, confidence, prose)``
    — INSERTs one ``HOT_DETAIL`` row into the agent's namespace (``trainer_memory`` /
    ``watcher_memory``) via ``trainer_scope()`` / ``watcher_scope()``, tags it from the
    reused vocabulary, and upserts ``memory_tier_state`` (tier=HOT + access telemetry).
    Tags are enforced at WRITE — an empty/untagged ``subjects`` RAISES ``ValueError`` and
    stores NOTHING (an untagged memory is unqueryable, which defeats the store). Idempotent
    on a content ``entry_hash`` (INSERT OR IGNORE) — the same memory written twice inserts
    once, with no duplicate tags and no access-telemetry bump on the re-write.
  * ``have_we_tested(subjects, *, level=None, agent=None)`` — a fast INDEXED lookup
    (``memory_tags`` idx_mtag → the namespace table's PK → per-canonical fetch on
    idx_tmem_canon / idx_wmem_canon; NEVER a full scan). Cross-tier: HOT → full detail
    (prose), WARM → conclusion + tags, COLD → summary stats. An entry's EFFECTIVE tier is
    ``memory_tier_state.current_tier`` when a pointer exists, else the row's own ``role``.

🚨 ``is_known_dead_end`` STAYS TRAINER-OWNED AND UNTOUCHED. ``have_we_tested`` is a strict
SUPERSET alongside it (by subject/tag, across tiers, across levels) — it does NOT replace or
repoint the trainer's exact fast ``(arm_hash, level_id)`` lookup. ``trainer_reasoning.py`` is
byte-identical after B1.

🚨 THE CRITIQUE-LEAK BOUNDARY (denial 4) HOLDS. The cross-agent span (``agent=None``) reads
BOTH ``trainer_memory`` and ``watcher_memory`` — the ``watcher_scope`` / ``watcher_memory``
references it needs live ONLY here. ``memory_query.py`` is NOT a ``trainer_*.py`` glob member
(exactly like ``memory_projection.py``), so ``tests/test_watcher_independence.py`` denial 4
never scans it, and B1 modifies NO trainer module — so denial 4 stays 4/4. The trainer's only
structural path into ``memory.db`` is ``trainer_scope()`` (binds ONE table, no code path to
the other). CAVEAT for a future prompt: denial 4 is a SYMBOL scan — it CANNOT catch a trainer
module passing ``agent=None`` / ``agent="watcher"`` as a runtime string to ``have_we_tested``.
The boundary holds because B1 wires no such call and the direct vectors (a ``watcher_scope``
import, a ``watcher_memory`` symbol, a raw ``watcher_memory`` SQL string) stay denial-4-blocked
in every trainer module. DO NOT wire a trainer to call ``have_we_tested(agent=None|"watcher")``.

🚨 THE APPEND-ONLY LAW. This module INSERTs ``HOT_DETAIL`` rows and reads; it exposes NO
UPDATE/DELETE against ``*_memory``. The ONLY mutations it makes are to the status tables
(``memory_tier_state`` tier pointer + access telemetry, ``memory_state`` unknown-tag record) —
exactly the rows C1 marks mutable. B1 builds NO tier movement; ``have_we_tested`` leaves a
documented no-op ``_on_cold_hit`` seam where R11-B2 attaches COLD-hit auto-rehydration.

PRE-CUTOVER EMPTY IS EXPECTED. A query over an empty store returns ``[]`` — never an alarm,
never an error (v4 PAUSED, MAX(level)=0). Feature flag ``MEMORY_QUERY_ENABLED`` (default OFF)
makes the module fully inert: ``write_memory`` returns 0 without opening the db, ``have_we_tested``
returns ``[]`` without opening the db, and NOTHING runs on import.

Python 3, stdlib sqlite3 only (via ``lib.memory_db``). No ORM, no numpy, no LLM.
"""
import hashlib
import json
import os
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

from lib.memory_db import (
    CONFIG_AXES,
    MECHANICAL_CHECKS,
    ROLE_COLD,
    ROLE_HOT,
    ROLE_WARM,
    TRAINER_NS,
    WATCHER_NS,
    MemoryScope,
    get_state,
    get_tier,
    trainer_scope,
    upsert_state,
    upsert_tier,
    watcher_scope,
)

# ── The reused vocabulary (12 config axes + 5 mechanical-check names) — ONE taxonomy across
# the store. A "known" subject tag is one of these; an "unknown" tag is accepted-and-recorded
# (a legitimately new subject must never be blocked), never invented, never a hard block. ──
_VOCAB = frozenset(CONFIG_AXES) | frozenset(MECHANICAL_CHECKS)

# Structural container keys in a subjects dict whose INNER keys are the tags (mirrors the
# projection layer's look-inside-``config`` behaviour). The container key itself is NOT a tag.
_RESERVED_CONTAINERS = ("config", "axes", "subjects")

# memory_state slot recording distinct out-of-vocab subject tags actually written (visibility
# for an operator — accept-and-record, never a block). Union-merged; the mutable status table.
_UNKNOWN_TAGS_KEY = "memory_query:unknown_subject_tags"

_TRUTHY = frozenset(("1", "true", "yes", "on"))


def _enabled() -> bool:
    """MEMORY_QUERY_ENABLED gate (default OFF). Off ⇒ the module is fully inert: no db is
    opened, no write happens, ``have_we_tested`` returns ``[]``. Read at CALL TIME so a flag
    flip needs no re-import."""
    return os.environ.get("MEMORY_QUERY_ENABLED", "").strip().lower() in _TRUTHY


def _scope_for(agent: str, db_path: Optional[str] = None) -> MemoryScope:
    """Route to the per-agent scoped accessor. A bad agent RAISES before any db is touched.

    The trainer reaches ``memory.db`` ONLY through ``trainer_scope()`` (its own namespace);
    the ``watcher_scope`` reference here is what the cross-agent span needs — legitimate in
    this non-``trainer_*.py`` module (see the module docstring / denial-4 note)."""
    if agent == TRAINER_NS:
        return trainer_scope(db_path)
    if agent == WATCHER_NS:
        return watcher_scope(db_path)
    raise ValueError(f"unknown agent {agent!r}; expected one of {(TRAINER_NS, WATCHER_NS)}")


# ── subject → tag extraction (predictable, documented) ─────────────────────────────────────
def _extract_tags(subjects: Any) -> Tuple[List[str], List[str]]:
    """Derive (known, unknown) tag lists from ``subjects``, ordered + de-duplicated.

    * dict  → the top-level KEYS are tags, EXCEPT a reserved container key
      (``config``/``axes``/``subjects``) whose value is a dict contributes its INNER keys
      instead (so ``{"arm_hash": ..., "config": {"tickers": ..., "leverage": ...}}`` yields
      ``arm_hash`` [unknown] + ``tickers``, ``leverage`` [known]).
    * list/tuple/set → each item is a tag token.
    * non-empty str  → a single tag token.

    "known" = in the reused vocab (12 axes + 5 checks); "unknown" = accepted-and-recorded.
    An empty/None/blank ``subjects`` yields ([], []) → the caller (write) raises ValueError."""
    tokens: List[str] = []
    if isinstance(subjects, dict):
        for key, val in subjects.items():
            if key in _RESERVED_CONTAINERS and isinstance(val, dict):
                tokens.extend(str(inner) for inner in val.keys())
            else:
                tokens.append(str(key))
    elif isinstance(subjects, (list, tuple, set)):
        tokens.extend(str(x) for x in subjects)
    elif isinstance(subjects, str) and subjects.strip():
        tokens.append(subjects.strip())

    seen: set = set()
    known: List[str] = []
    unknown: List[str] = []
    for tok in tokens:
        tok = tok.strip() if isinstance(tok, str) else str(tok)
        if not tok or tok in seen:
            continue
        seen.add(tok)
        (known if tok in _VOCAB else unknown).append(tok)
    return known, unknown


def _subjects_json(subjects: Any) -> str:
    """Deterministic serialization used BOTH for storage and the entry_hash (so a re-write of
    identical content hashes identically). A str is stored verbatim; a dict/list is sorted."""
    if isinstance(subjects, str):
        return subjects
    try:
        return json.dumps(subjects, sort_keys=True, default=str)
    except (TypeError, ValueError):
        return json.dumps(str(subjects))


def _default_canonical_id(agent: str, subjects_json: str, action: Optional[str], level: int) -> str:
    """Deterministic canonical_id so identical (agent, subjects, action, level) groups its
    tier variants — B2 links a WARM/COLD row to its HOT original by passing this same id."""
    digest = hashlib.sha256(f"{subjects_json}|{action}".encode("utf-8")).hexdigest()[:16]
    return f"{agent}:{action or 'memory'}:{digest}:{int(level)}"


def _entry_hash(canonical_id: str, role: str, subjects_json: str, action: Optional[str],
                because: Optional[str], outcome: Optional[str], confidence: Optional[str],
                prose: Optional[str]) -> str:
    """Content hash → INSERT OR IGNORE idempotency. Same full content ⇒ same hash ⇒ one row."""
    raw = "|".join(
        "" if x is None else str(x)
        for x in (canonical_id, role, subjects_json, action, because, outcome, confidence, prose)
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _record_unknown_tags(unknown: List[str], conn: sqlite3.Connection) -> None:
    """Accept-and-record: union the out-of-vocab tags into a memory_state slot (visibility,
    not a block). Same connection/transaction as the write, so it commits atomically."""
    raw = get_state(_UNKNOWN_TAGS_KEY, conn=conn)
    try:
        current = set(json.loads(raw)) if raw else set()
    except (TypeError, ValueError, json.JSONDecodeError):
        current = set()
    merged = sorted(current | set(unknown))
    upsert_state(_UNKNOWN_TAGS_KEY, json.dumps(merged), conn=conn)


# ═══════════════════════════════════════════════════════════════════════════════════════
#  M7 — THE STRUCTURED WRITE (tags enforced AT WRITE, never bolted on later)
# ═══════════════════════════════════════════════════════════════════════════════════════
def write_memory(
    agent: str,
    subjects: Any,
    action: Optional[str],
    because: Optional[str],
    level: int,
    outcome: Optional[str] = None,
    confidence: Optional[str] = None,
    prose: Optional[str] = None,
    *,
    canonical_id: Optional[str] = None,
) -> int:
    """Append ONE ``HOT_DETAIL`` knowledge row into ``agent``'s namespace + tag it + upsert its
    tier pointer (HOT, with access telemetry). Returns the row id (0 when the flag is OFF).

    Tags are enforced AT WRITE: if ``subjects`` produces no tags, this RAISES ``ValueError``
    and stores NOTHING — an untagged memory is unqueryable, which defeats the store. Unknown
    (out-of-vocab) subjects are accepted-and-recorded, never blocked. Idempotent on a content
    ``entry_hash`` — a second identical write inserts nothing, adds no duplicate tags, and does
    NOT bump access telemetry (a re-write is not an access). Append-only: NO update/delete path
    to ``*_memory``; only the mutable status tables (``memory_tier_state`` / ``memory_state``)
    change.
    """
    if not _enabled():
        return 0
    if agent not in (TRAINER_NS, WATCHER_NS):
        raise ValueError(f"unknown agent {agent!r}; expected one of {(TRAINER_NS, WATCHER_NS)}")

    known, unknown = _extract_tags(subjects)
    tags = known + unknown  # already ordered + de-duplicated by _extract_tags
    if not tags:
        raise ValueError(
            "write_memory: subjects produced no tags — an untagged memory is unqueryable and "
            "must never be stored; provide at least one subject (axis/check name or dict/list)."
        )

    subjects_json = _subjects_json(subjects)
    lvl = int(level)
    cid = canonical_id or _default_canonical_id(agent, subjects_json, action, lvl)
    role = ROLE_HOT
    ehash = _entry_hash(cid, role, subjects_json, action, because, outcome, confidence, prose)

    scope = _scope_for(agent)
    try:
        entry_id = scope.insert_entry(
            canonical_id=cid, role=role, subjects=subjects_json, level=lvl,
            action=action, because=because, outcome=outcome, confidence=confidence,
            prose=prose, entry_hash=ehash, commit=False,
        )
        # Fresh insert ⇔ no tags yet on this row. On an idempotent re-write (INSERT OR IGNORE
        # hit the UNIQUE(entry_hash) conflict → existing id returned) the row is already
        # tagged → skip tagging (no duplicates) AND skip the tier/access bump (not an access).
        if not scope.tags_for(entry_id):
            for tag in tags:
                scope.tag(entry_id, tag, commit=False)
            upsert_tier(cid, role, touch_access=True, conn=scope.conn)
            if unknown:
                _record_unknown_tags(unknown, conn=scope.conn)
        scope.conn.commit()
        return int(entry_id)
    finally:
        scope.close()


# ═══════════════════════════════════════════════════════════════════════════════════════
#  M3 — THE "HAVE WE TESTED X" QUERY (fast, indexed, cross-tier structured verdict)
# ═══════════════════════════════════════════════════════════════════════════════════════
_ROW_COLS = (
    "id", "canonical_id", "role", "subjects_json", "action", "because",
    "level", "outcome", "confidence", "prose", "created_ts",
)


def _rowdict(row: Optional[tuple]) -> Optional[Dict[str, Any]]:
    return None if row is None else dict(zip(_ROW_COLS, row))


def _fetch_effective_row(conn: sqlite3.Connection, table: str, canonical_id: str,
                         tier_from_state: Optional[str]) -> Optional[Dict[str, Any]]:
    """Fetch the row representing ``canonical_id``'s EFFECTIVE tier.

    If ``memory_tier_state`` carries a pointer (``tier_from_state``), fetch the newest row at
    that role. Else (no pointer — e.g. a projection row) fall back to the newest row and use
    ITS role. Both fetches ride idx_tmem_canon / idx_wmem_canon (indexed, not a scan)."""
    cols = ", ".join(_ROW_COLS)
    if tier_from_state is not None:
        row = conn.execute(
            f"SELECT {cols} FROM {table} WHERE canonical_id = ? AND role = ? ORDER BY id DESC LIMIT 1",
            (canonical_id, tier_from_state),
        ).fetchone()
        if row is not None:
            return _rowdict(row)
        # pointer names a tier with no row yet (edge) → fall through to newest-of-any-role
    row = conn.execute(
        f"SELECT {cols} FROM {table} WHERE canonical_id = ? ORDER BY id DESC LIMIT 1",
        (canonical_id,),
    ).fetchone()
    return _rowdict(row)


def _tags_for_canonical(conn: sqlite3.Connection, table: str, canonical_id: str, agent: str) -> List[str]:
    """Distinct tags across every entry sharing ``canonical_id`` (tags live on the HOT row;
    a WARM/COLD row need not be re-tagged). Used for the WARM 'conclusion + tags' shape."""
    rows = conn.execute(
        f"SELECT DISTINCT t.tag FROM memory_tags t JOIN {table} m ON m.id = t.entry_id "
        f"WHERE m.canonical_id = ? AND t.entry_agent = ? ORDER BY t.tag",
        (canonical_id, agent),
    ).fetchall()
    return [r[0] for r in rows]


def _on_cold_hit(canonical_id: str, agent: str, conn: sqlite3.Connection) -> None:
    """REHYDRATION SEAM — R11-B2 attaches here; B1 implements ZERO tier movement.

    ``have_we_tested`` calls this on a COLD-tier hit. B2 will plug COLD → WARM/HOT auto-
    rehydration (promotion) in here, WITHOUT restructuring the query. B1 leaves it a
    deliberate no-op. (Access telemetry — last_accessed_ts / access_count — is bumped by the
    caller for EVERY tier hit; that is telemetry the rehydration policy consumes, NOT movement.)
    """
    return None


def _shape(agent: str, canonical_id: str, row: Dict[str, Any], eff_tier: str,
           conn: sqlite3.Connection, table: str) -> Dict[str, Any]:
    """Build the structured verdict for one canonical entry at its effective tier.

    HOT  → full detail (prose). WARM → conclusion (because) + tags. COLD → summary stats."""
    result: Dict[str, Any] = {
        "what": row["subjects_json"],
        "canonical_id": canonical_id,
        "agent": agent,
        "level": row["level"],
        "outcome": row["outcome"],
        "tier": eff_tier,
        "confidence": row["confidence"],
    }
    if eff_tier == ROLE_HOT:
        result["summary_or_prose"] = row["prose"]                       # full detail
    elif eff_tier == ROLE_WARM:
        result["summary_or_prose"] = row["because"]                     # conclusion
        result["tags"] = _tags_for_canonical(conn, table, canonical_id, agent)
    elif eff_tier == ROLE_COLD:
        result["summary_or_prose"] = row["prose"] or row["outcome"]     # summary stats
    else:
        result["summary_or_prose"] = row["prose"]
    return result


def _query_namespace(scope: MemoryScope, tags: List[str], level: Optional[int]) -> List[Dict[str, Any]]:
    """Indexed tag lookup in ONE namespace → per-canonical effective-tier verdicts.

    Path: memory_tags (idx_mtag on ``tag``) → JOIN the namespace table on its PK → resolve the
    effective tier per canonical_id (idx_tmem_canon / idx_wmem_canon). NEVER a full scan. On a
    COLD hit fires the B2 rehydration seam; on EVERY hit bumps access telemetry (same tier →
    telemetry, not movement). A missing table (never post-C1) degrades to [] — never a crash."""
    conn = scope.conn
    table = scope._table  # trusted per-scope literal from C1's _NAMESPACES map
    placeholders = ", ".join("?" for _ in tags)
    sql = (
        f"SELECT DISTINCT m.canonical_id FROM memory_tags t "
        f"JOIN {table} m ON m.id = t.entry_id "
        f"WHERE t.entry_agent = ? AND t.tag IN ({placeholders})"
    )
    params: List[Any] = [scope.agent, *tags]
    if level is not None:
        sql += " AND m.level <= ?"
        params.append(int(level))

    try:
        canonical_ids = [r[0] for r in conn.execute(sql, params).fetchall()]
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc).lower():
            return []  # pre-cutover / fresh db — expected empty, never an alarm
        raise

    out: List[Dict[str, Any]] = []
    touched = False
    for cid in canonical_ids:
        tier_ptr = get_tier(cid, conn=conn)
        row = _fetch_effective_row(conn, table, cid, tier_ptr)
        if row is None:
            continue
        eff_tier = tier_ptr or row["role"]
        # access telemetry — pass the SAME effective tier so current_tier does NOT move.
        upsert_tier(cid, eff_tier, touch_access=True, conn=conn)
        touched = True
        if eff_tier == ROLE_COLD:
            _on_cold_hit(cid, scope.agent, conn)
        out.append(_shape(scope.agent, cid, row, eff_tier, conn, table))
    if touched:
        conn.commit()  # persist access telemetry (the ONLY write this query makes)
    return out


def have_we_tested(
    subjects: Any,
    *,
    level: Optional[int] = None,
    agent: Optional[str] = None,
    db_path: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """"Have we tested X?" — a fast INDEXED, cross-tier structured-verdict lookup.

    🚨 RF3T2-B8 (NIT-5, DOCUMENT — watch-item): `agent` defaults to None, and None is
    the CROSS-AGENT SPAN (reads watcher_memory too). The AST independence guard
    (tests/test_watcher_independence.py denial 4) scans symbols + string literals, so it
    is STRUCTURALLY BLIND to a runtime `agent=None` reaching here from a trainer module —
    a future trainer prompt could leak and the suite would still read 5/5. No live code
    exercises it today: the sole production caller, trainer_loop.py:694, passes
    agent="trainer" as a LITERAL (verified this run). Keep it literal; never pass a
    variable, and never call this from a trainer with agent=None or agent="watcher".

    Returns a list of ``{what, canonical_id, agent, level, outcome, tier, confidence,
    summary_or_prose}`` (WARM also carries ``tags``). Per effective tier: HOT → full detail,
    WARM → conclusion + tags, COLD → summary stats. Empty store / no match → ``[]`` (never an
    error). Flag OFF → ``[]`` without opening the db.

    Filters: ``level`` (entries at/below that level), ``agent`` (namespace scope).
    ``agent="trainer"`` / ``"watcher"`` reads that ONE namespace; ``agent=None`` is the
    CROSS-AGENT SPAN (both ``trainer_memory`` + ``watcher_memory``) — the Hub/watcher surface
    (see the module docstring's denial-4 caveat; do NOT wire a trainer to call the span).

    This is a strict SUPERSET alongside the trainer's ``is_known_dead_end`` (which stays the
    exact, fast, trainer-owned ``(arm_hash, level_id)`` lookup) — it does not replace it."""
    if not _enabled():
        return []

    known, unknown = _extract_tags(subjects)
    tags = known + unknown
    if not tags:
        return []  # nothing to search on — not an error

    if agent is None:
        agents: Tuple[str, ...] = (TRAINER_NS, WATCHER_NS)
    elif agent in (TRAINER_NS, WATCHER_NS):
        agents = (agent,)
    else:
        raise ValueError(f"unknown agent {agent!r}; expected trainer, watcher, or None (span)")

    results: List[Dict[str, Any]] = []
    for ag in agents:
        scope = _scope_for(ag, db_path)
        try:
            results.extend(_query_namespace(scope, tags, level))
        finally:
            scope.close()
    return results


if __name__ == "__main__":
    # Smoke only — guarded, NEVER runs on import. Over the empty pre-cutover store with the
    # flag ON this prints [] (the EXPECTED empty result). With the flag OFF it prints [] too,
    # without opening the db.
    print(have_we_tested(["tickers", "leverage"]))
