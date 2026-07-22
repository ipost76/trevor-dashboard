#!/usr/bin/env python3
"""memory_tiers.py — TREVOR v5 Memory Store (R11-B2) tier transitions + rehydration.

The subtlest layer of the shared reasoning store: the machinery that keeps an
ever-growing history QUERYABLE (append-only tier DEMOTION) and brings old context
back when the config space circles round (COLD→HOT REHYDRATION). It builds ON C1
(``lib/memory_db.py``) and B1 (``memory_query.py``) — it edits NEITHER, and it
introduces NO update/delete path to the append-only ``*_memory`` tables.

    import memory_tiers
    memory_tiers.install()          # gated late-bind of the COLD-hit rehydration
    memory_tiers.run_maintenance()  # daemon: opportunistic level refresh + a bounded sweep

═══════════════════════════════════════════════════════════════════════════════
 THE LAWS THIS MODULE HONORS
═══════════════════════════════════════════════════════════════════════════════
  * NOTHING IS EVER DELETED. Compression is INSERT-only — a WARM_SUMMARY row (a NEW
    row, same ``canonical_id``, conclusion-only) coexists with its retained
    HOT_DETAIL row; a COLD_STAT row (summary stats) coexists with both. The ONLY
    mutation is flipping ``memory_tier_state.current_tier`` (C1's one mutable tier
    pointer). The system forgets DETAIL, never CONCLUSIONS. There is ZERO
    UPDATE/DELETE against ``trainer_memory``/``watcher_memory`` in this file.

  * REHYDRATION ≠ LEVEL CHANGE. Remembering something is not a promotion. A COLD hit
    re-promotes the EXISTING HOT_DETAIL row by writing ONLY ``memory_tier_state`` —
    it does NO ssh, reads NO level, writes NO level chain. This module introduces the
    FIRST-and-ONLY WSL level READ (a read-only CLI shim, below) and NEVER a level
    WRITE — there is no ``rebuild_tracker`` invocation, no money-path mint, no
    ``INSERT INTO`` the level chain anywhere in B2.

  * NEVER A PER-QUERY ssh. The current minted level comes from a CACHED value in
    ``memory_state`` (``memory_tiers:current_level``). The ssh shim refreshes that
    cache OPPORTUNISTICALLY (daemon cadence) — NEVER on the query/sweep read path (a
    10-20s round trip would make every query unusable).

  * FAIL TOWARD KEEPING THINGS HOT, NEVER TOWARD HIDING THEM. A shim failure → hard
    UNKNOWN (never a guessed level). UNKNOWN / a missing cache → NO demotion runs;
    entries stay where they are. And a STALE-but-known cache is SAFE to demote on:
    the minted level is MONOTONIC, so a stale reading is always ≤ the true level ⇒
    ``current - entry`` age is UNDERSTATED ⇒ MORE entries stay HOT ⇒ under-demotion.
    Wrongly demoting on a bad level would hide knowledge; that failure mode is
    structurally excluded.

  * SELF-MAINTAINING, NO DAEMON OF ITS OWN. The sweep runs lazily, piggybacked on
    store calls (B1's COLD-hit seam) + the R13 daemon's cadence — no thread, no
    auto-start on import. Neither the trainer's nor the watcher's freeze can stop the
    store working: no call ⇒ no sweep ⇒ nothing breaks; the next call resumes. Tier
    is always recomputable from (level, last_accessed), so a crash mid-sweep leaves
    no orphaned state.

═══════════════════════════════════════════════════════════════════════════════
 HOW IT ATTACHES (late-bind, NOT a source edit to B1)
═══════════════════════════════════════════════════════════════════════════════
B1 carved ``memory_query._on_cold_hit`` as a rebindable module-level no-op seam
"where R11-B2 attaches COLD-hit auto-rehydration". ``install()`` LATE-BINDS
``memory_query._on_cold_hit = _rehydrate_hook`` — Python resolves that module global
at call time, so the hook fires INSIDE ``have_we_tested``'s query path WITHOUT editing
memory_query.py (the hard-constraint literal: new module + tests + CLAUDE.md only).
It is explicit, gated, idempotent, and NEVER runs on import.

B1 already bumps access telemetry (``last_accessed_ts`` / ``access_count``) on EVERY
tier hit (``memory_query.py:381``, same effective tier ⇒ telemetry, not movement) —
BEFORE the seam fires. So the hook re-promotes with ``touch_access=False`` (no
double-count). The seam is COLD-only; a WARM hit rehydrates via the access-window
keep-hot override + the next sweep (adding a WARM hook would restructure B1's query).

Feature flag ``MEMORY_TIERS_ENABLED`` (default OFF) makes the module byte-identically
inert: ``install()`` no-ops (the seam stays B1's), ``maybe_sweep`` returns without
opening the db, no ssh, no auto-start. Pre-cutover (MAX(level)=0) EVERYTHING is HOT,
no demotion, no alarm — the EXPECTED state.

Python 3, stdlib only (via ``lib.memory_db`` + ``memory_query``). No ORM, no numpy,
no LLM. Nothing runs on import.
"""
import hashlib
import json
import os
import shlex
import subprocess
import time
from datetime import datetime, timezone
from typing import Optional, Tuple

from lib.memory_db import (
    ROLE_COLD,
    ROLE_HOT,
    ROLE_WARM,
    TRAINER_NS,
    WATCHER_NS,
    MemoryScope,
    get_connection,
    get_state,
    upsert_state,
    upsert_tier,
    utc_now,
)

# ── feature flag (default OFF → byte-identical inert) ──────────────────────────
_TRUTHY = frozenset(("1", "true", "yes", "on"))


def _enabled() -> bool:
    """MEMORY_TIERS_ENABLED gate (default OFF). Off ⇒ no sweep, no rehydration, no
    ssh, no install, no auto-start. Read at CALL TIME so a flip needs no re-import."""
    return os.environ.get("MEMORY_TIERS_ENABLED", "").strip().lower() in _TRUTHY


# ── env-tunable knobs (B2's OWN tier bands / cap — NOT the VM level chain) ──────
def _knob_int(env_name: str, default: int) -> int:
    """A non-negative int knob from env, or the default (malformed/negative → default)."""
    raw = os.environ.get(env_name, "").strip()
    try:
        v = int(raw)
        return v if v >= 0 else default
    except (ValueError, TypeError):
        return default


def _hot_levels() -> int:
    """HOT band width: HOT = current + last N minted levels (default 2 — the active
    working set the trainer reads in full; env MEMORY_HOT_LEVELS)."""
    return _knob_int("MEMORY_HOT_LEVELS", 2)


def _warm_levels() -> int:
    """WARM band outer edge (default 6; env MEMORY_WARM_LEVELS). Beyond this → COLD."""
    return _knob_int("MEMORY_WARM_LEVELS", 6)


def _keephot_window_sec() -> int:
    """Keep-hot access window (default 86400s = 24h; env MEMORY_KEEPHOT_WINDOW_SEC).
    An entry accessed within this window stays HOT regardless of level age — and this
    is the thrash guard (a just-rehydrated entry has last_accessed=now)."""
    return _knob_int("MEMORY_KEEPHOT_WINDOW_SEC", 86400)


def _sweep_cap() -> int:
    """Max entries examined per bounded sweep pass (default 200; env MEMORY_SWEEP_CAP).
    A single call never stalls on a backlog; the next call continues via the cursor."""
    return _knob_int("MEMORY_SWEEP_CAP", 200)


# ── memory_state slots (B2's own keys; no collision with C1's projection_cursor:*) ─
_LEVEL_CACHE_KEY = "memory_tiers:current_level"    # {"level": N, "ts": "..."} — the cached minted level
_LAST_SWEEP_KEY = "memory_tiers:last_sweep_level"  # the level for which the store was last fully drained
_SWEEP_CURSOR_KEY = "memory_tiers:sweep_cursor"    # resume point ("ns:canonical_id") within the current drain


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 1a — the read-only level shim (the ONLY ssh in B2; NEVER on the query path)
#  Duplicated from watcher_integrity's discipline ON PURPOSE — a shared module would
#  re-couple them, and the store must keep working through a watcher failure.
# ═══════════════════════════════════════════════════════════════════════════════
_VM_HOST = os.environ.get("MEMORY_TIERS_VM_HOST", "vm")
_VM_CWD = "/home/trevor/trevor"
# The read-only level READER CLI (NOT the minter). Reads the VM level chain mode=ro;
# no money-path write path is reachable through it.
_LEVEL_QUERY = "scripts/level/level_query.py"


def _shim_timeout() -> float:
    """Hard subprocess timeout (s) — turns a hung ssh into UNKNOWN. Env-overridable
    for the timeout failure-mode test."""
    raw = os.environ.get("MEMORY_TIERS_SSH_TIMEOUT", "").strip()
    try:
        val = float(raw)
        return val if val > 0 else 20.0
    except (ValueError, TypeError):
        return 20.0


def _read_current_level_via_ssh() -> Optional[int]:
    """Read the current minted level over the read-only ssh shim → int, or None
    (hard UNKNOWN). Mirrors ``watcher_integrity._level_query`` discipline: allowlist
    is exactly the ``current`` reader subcommand, ``sudo -u trevor`` opens the chain
    mode=ro, and ANY failure (spawn / timeout / nonzero / empty / malformed / non-int)
    returns None — NEVER a guessed level, NEVER a VM mutation, NEVER raises."""
    remote = "cd %s && sudo -u trevor python3 %s current" % (
        shlex.quote(_VM_CWD),
        shlex.quote(_LEVEL_QUERY),
    )
    argv = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", _VM_HOST, remote]
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=_shim_timeout())
    except (subprocess.TimeoutExpired, OSError, ValueError):
        return None  # timeout / ssh missing / bad argv → UNKNOWN
    if p.returncode != 0:
        return None
    out = (p.stdout or "").strip()
    if not out:
        return None
    try:
        data = json.loads(out)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    lvl = data.get("current_level")
    # bool is an int subclass — reject it explicitly; reject negatives.
    if isinstance(lvl, bool) or not isinstance(lvl, int) or lvl < 0:
        return None
    return lvl


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 1b — the level cache (read on the sweep path; refreshed only opportunistically)
# ═══════════════════════════════════════════════════════════════════════════════
def cached_level(*, conn=None) -> Optional[int]:
    """The last cached minted level from ``memory_state`` (no ssh). Returns the int,
    or None (UNKNOWN) on a missing / malformed / negative slot. None ⇒ the sweep runs
    NO demotion (safe). Never raises."""
    own = conn is None
    c = conn or get_connection()
    try:
        raw = get_state(_LEVEL_CACHE_KEY, conn=c)
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            return None
        lvl = data.get("level") if isinstance(data, dict) else None
        if isinstance(lvl, bool) or not isinstance(lvl, int) or lvl < 0:
            return None
        return lvl
    finally:
        if own:
            c.close()


def refresh_level_cache(*, reader=None, conn=None) -> dict:
    """Opportunistically refresh the cached minted level — the ONLY ssh path in B2.

    On a SUCCESSFUL read, records ``{level, ts}`` in ``memory_state``. On UNKNOWN
    (hard-fail), does NOT overwrite a previously-known value with a guess — it leaves
    the last-known level in place (monotonic ⇒ still safe) and reports unknown. MUST
    NOT be called on the query/sweep read path (10-20s ssh). Gated: OFF ⇒ inert
    no-op. ``reader`` is injectable for tests (defaults to the read-only ssh shim)."""
    if not _enabled():
        return {"status": "disabled"}
    read = reader or _read_current_level_via_ssh
    lvl = read()
    own = conn is None
    c = conn or get_connection()
    try:
        if lvl is None:
            return {"status": "unknown", "level": cached_level(conn=c)}
        upsert_state(_LEVEL_CACHE_KEY, json.dumps({"level": int(lvl), "ts": utc_now()}), conn=c)
        if own:
            c.commit()
        return {"status": "ok", "level": int(lvl)}
    finally:
        if own:
            c.close()


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 1c — tier computation (pure, unit-testable)
# ═══════════════════════════════════════════════════════════════════════════════
def _parse_utc(ts_str) -> Optional[float]:
    """Parse a C1 ``utc_now()`` stamp ('%Y-%m-%dT%H:%M:%SZ') to epoch seconds, or None."""
    if not isinstance(ts_str, str):
        return None
    try:
        return datetime.strptime(ts_str, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except (ValueError, TypeError):
        return None


def _within_keephot(last_accessed_ts, *, now=None) -> bool:
    """True iff ``last_accessed_ts`` is within the keep-hot window. Missing/malformed
    → False (not recently accessed → eligible for level-based demotion). ``now`` is
    injectable (epoch seconds) for deterministic tests."""
    ts = _parse_utc(last_accessed_ts)
    if ts is None:
        return False
    now_epoch = now if now is not None else time.time()
    return (now_epoch - ts) < _keephot_window_sec()


def compute_tier(entry_level, current_level, last_accessed_ts, *, now=None) -> str:
    """An entry's target tier from level age + the keep-hot access window. PURE.

    HOT iff the entry is inside the keep-hot window OR (current - entry) <=
    MEMORY_HOT_LEVELS. WARM iff (current - entry) <= MEMORY_WARM_LEVELS. COLD
    otherwise. Level is the spine; access is the override (decision 2). Defensive:
    an unknown/None/malformed level → HOT (fail toward keeping HOT, never hiding)."""
    # keep-hot override first — queried recently ⇒ HOT regardless of level age.
    if _within_keephot(last_accessed_ts, now=now):
        return ROLE_HOT
    if isinstance(current_level, bool) or isinstance(entry_level, bool):
        return ROLE_HOT  # defensive
    if not isinstance(current_level, int) or not isinstance(entry_level, int):
        return ROLE_HOT  # unknown geometry → safe default
    age = current_level - entry_level
    if age <= _hot_levels():
        return ROLE_HOT
    if age <= _warm_levels():
        return ROLE_WARM
    return ROLE_COLD


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 2 — append-only compression + the self-maintaining sweep
# ═══════════════════════════════════════════════════════════════════════════════
# Compression order (HOT < WARM < COLD): a higher rank = more compressed. Demotion
# only ever moves rank UP; rehydration (the ONLY promotion) is B1-seam-driven.
_TIER_RANK = {ROLE_HOT: 0, ROLE_WARM: 1, ROLE_COLD: 2}


def _rank(tier) -> int:
    return _TIER_RANK.get(tier, 0)  # unknown → HOT (safe)


def _compress_hash(canonical_id: str, role: str) -> str:
    """Deterministic, ROLE-keyed content hash → a re-sweep INSERT OR IGNOREs (the
    sweep is idempotent). One WARM row + one COLD row per canonical_id, ever."""
    return hashlib.sha256(("tier|%s|%s" % (canonical_id, role)).encode("utf-8")).hexdigest()[:32]


def _hot_source_row(scope: MemoryScope, canonical_id: str) -> Optional[dict]:
    """The retained HOT_DETAIL row for ``canonical_id`` (the compression SOURCE) — the
    original is READ, never touched. Falls back to the newest-of-any-role defensively."""
    rows = scope.entries_by_canonical(canonical_id)
    if not rows:
        return None
    for r in rows:
        if r.get("role") == ROLE_HOT:
            return r
    return rows[-1]


def _cold_stats(scope: MemoryScope, canonical_id: str, src: dict) -> str:
    """Compact COLD_STAT summary — variant count, outcome distribution, level span,
    conclusion — built by READING the retained rows (never destroying them). This is
    what B1's ``_shape`` serves for a COLD hit (``row["prose"] or row["outcome"]``)."""
    rows = scope.entries_by_canonical(canonical_id)
    levels = [int(r["level"]) for r in rows if isinstance(r.get("level"), int)]
    outcomes: dict = {}
    for r in rows:
        o = r.get("outcome")
        if o is not None:
            outcomes[str(o)] = outcomes.get(str(o), 0) + 1
    stats = {
        "cold_stat": True,
        "n_variants": len(rows),
        "outcomes": outcomes,
        "level_span": [min(levels), max(levels)] if levels else None,
        "conclusion": src.get("because"),
    }
    return json.dumps(stats, sort_keys=True)


def _ensure_warm(scope: MemoryScope, canonical_id: str, src: dict) -> None:
    """INSERT OR IGNORE the WARM_SUMMARY row (conclusion + tags via the retained HOT
    row) — same canonical_id, ``prose`` DROPPED (the compression). Idempotent
    (role-keyed hash). The original HOT_DETAIL row is untouched (INSERT-only)."""
    scope.insert_entry(
        canonical_id=canonical_id, role=ROLE_WARM,
        subjects=src["subjects_json"], level=int(src["level"]),
        action=src.get("action"), because=src.get("because"),     # the conclusion B1 serves for WARM
        outcome=src.get("outcome"), confidence=src.get("confidence"),
        prose=None,                                                # DROPPED — the long detail
        entry_hash=_compress_hash(canonical_id, ROLE_WARM), commit=False,
    )


def _ensure_cold(scope: MemoryScope, canonical_id: str, src: dict) -> None:
    """INSERT OR IGNORE the COLD_STAT summary-stats row — same canonical_id, stats in
    ``prose``. Idempotent (role-keyed hash). Both prior rows retained (INSERT-only)."""
    scope.insert_entry(
        canonical_id=canonical_id, role=ROLE_COLD,
        subjects=src["subjects_json"], level=int(src["level"]),
        action=src.get("action"), because=src.get("because"),
        outcome=src.get("outcome"), confidence=src.get("confidence"),
        prose=_cold_stats(scope, canonical_id, src),               # summary stats — what B1 serves for COLD
        entry_hash=_compress_hash(canonical_id, ROLE_COLD), commit=False,
    )


def _demote_entry(scope: MemoryScope, canonical_id: str, entry_level, last_accessed_ts,
                  current_level, current_tier, *, now=None) -> Optional[str]:
    """Demote ONE entry toward its computed target (append-only). Returns the new tier
    iff it moved DOWN (more compressed), else None. Creates the WARM row if the target
    is WARM/COLD, the COLD row if the target is COLD, then flips the pointer with
    ``touch_access=False`` (a sweep is not an access). NEVER promotes; NEVER touches an
    original row."""
    target = compute_tier(entry_level, current_level, last_accessed_ts, now=now)
    if _rank(target) <= _rank(current_tier):
        return None  # already at/below the target compression — demotion never promotes
    src = _hot_source_row(scope, canonical_id)
    if src is None:
        return None  # nothing to compress (defensive; a pointer with no memory row)
    if _rank(target) >= _rank(ROLE_WARM):
        _ensure_warm(scope, canonical_id, src)
    if _rank(target) >= _rank(ROLE_COLD):
        _ensure_cold(scope, canonical_id, src)
    upsert_tier(canonical_id, target, touch_access=False, conn=scope.conn)
    return target


# Candidate enumeration: entries with a tier pointer that are NOT already COLD, joined
# to each namespace for their (monotonic) entry level. Globally ordered by a composite
# ``ns:canonical_id`` key so bounded passes RESUME deterministically via the cursor.
# 'trainer'/'watcher' + *_memory are the trusted namespace/table names (C1 _NAMESPACES).
_CANDIDATE_SQL = """
SELECT ns, canonical_id, current_tier, last_accessed_ts, entry_level FROM (
  SELECT 'trainer' AS ns, s.canonical_id AS canonical_id, s.current_tier AS current_tier,
         s.last_accessed_ts AS last_accessed_ts, MIN(m.level) AS entry_level
    FROM memory_tier_state s JOIN trainer_memory m ON m.canonical_id = s.canonical_id
    WHERE s.current_tier != ?
    GROUP BY s.canonical_id, s.current_tier, s.last_accessed_ts
  UNION ALL
  SELECT 'watcher' AS ns, s.canonical_id AS canonical_id, s.current_tier AS current_tier,
         s.last_accessed_ts AS last_accessed_ts, MIN(m.level) AS entry_level
    FROM memory_tier_state s JOIN watcher_memory m ON m.canonical_id = s.canonical_id
    WHERE s.current_tier != ?
    GROUP BY s.canonical_id, s.current_tier, s.last_accessed_ts
)
WHERE (ns || ':' || canonical_id) > ?
ORDER BY (ns || ':' || canonical_id)
LIMIT ?
"""


def _get_state_str(conn, key: str, default: str) -> str:
    raw = get_state(key, conn=conn)
    return raw if isinstance(raw, str) else default


def _last_sweep_level(*, conn) -> int:
    """The level for which the store was last fully drained (-1 = never)."""
    raw = get_state(_LAST_SWEEP_KEY, conn=conn)
    try:
        return int(raw) if raw is not None else -1
    except (ValueError, TypeError):
        return -1


def _run_demotion_pass(c, current_level: int, cap: int, *, now=None) -> Tuple[int, bool]:
    """One bounded demotion pass over the candidate set, resuming from the cursor.
    Returns (demoted, drained). ``drained`` is True iff this pass reached the end of
    the candidate set (fewer than ``cap`` rows) — then the caller marks the level
    fully swept. Reads raw (like B1); writes via the scoped accessor on the SHARED
    connection (no new connection ⇒ no write-lock conflict with a caller's txn)."""
    cursor = _get_state_str(c, _SWEEP_CURSOR_KEY, "")
    rows = c.execute(_CANDIDATE_SQL, (ROLE_COLD, ROLE_COLD, cursor, int(cap))).fetchall()
    scopes = {TRAINER_NS: MemoryScope(TRAINER_NS, c), WATCHER_NS: MemoryScope(WATCHER_NS, c)}
    demoted = 0
    last_key = cursor
    for ns, canonical_id, cur_tier, last_acc, entry_level in rows:
        scope = scopes.get(ns)
        if scope is None:  # defensive — ns is always a trusted literal from the SQL
            continue
        moved = _demote_entry(scope, canonical_id, entry_level, last_acc,
                              current_level, cur_tier, now=now)
        if moved is not None:
            demoted += 1
        last_key = "%s:%s" % (ns, canonical_id)
    drained = len(rows) < cap
    # Advance the cursor; on a full drain reset it so the NEXT level-advance restarts.
    _set_state_str(c, _SWEEP_CURSOR_KEY, "" if drained else last_key)
    return demoted, drained


def _set_state_str(conn, key: str, value: str) -> None:
    upsert_state(key, value, conn=conn)


def maybe_sweep(*, conn=None, cap=None, now=None) -> dict:
    """The self-maintaining, bounded, idempotent demotion sweep — piggybacked on B1's
    COLD-hit seam AND callable by the R13 daemon. No daemon/thread of its own, no
    auto-start; OFF ⇒ returns without opening the db.

    Reads the CACHED level (never ssh). UNKNOWN/missing cache ⇒ NO demotion (safe —
    stays HOT). Runs only when the cached level advanced past ``last_sweep_level``.
    Bounded by MEMORY_SWEEP_CAP entries/pass; drains across calls via the cursor.
    Crash-safe: the whole pass is one transaction (rolls back atomically), and tier is
    recomputable from (level, last_accessed) with role-keyed idempotent INSERTs — a
    resume never duplicates. Both agents frozen ⇒ no call ⇒ no sweep ⇒ nothing breaks."""
    if not _enabled():
        return {"status": "disabled"}
    own = conn is None
    c = conn or get_connection()
    try:
        cur = cached_level(conn=c)
        if cur is None:
            return {"status": "unknown_level", "demoted": 0}  # safe: no demotion
        last_swept = _last_sweep_level(conn=c)
        if cur <= last_swept:
            return {"status": "no_advance", "current_level": cur, "demoted": 0}
        the_cap = cap if isinstance(cap, int) and cap > 0 else _sweep_cap()
        demoted, drained = _run_demotion_pass(c, cur, the_cap, now=now)
        if drained:
            _set_state_str(c, _LAST_SWEEP_KEY, str(int(cur)))  # fully drained this level
        if own:
            c.commit()
        return {"status": "ok", "current_level": cur, "demoted": demoted, "drained": drained}
    finally:
        if own:
            c.close()


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 3 — auto-rehydration (COLD→HOT) + the thrash guard + the late-bind install
# ═══════════════════════════════════════════════════════════════════════════════
def _rehydrate_hook(canonical_id, agent, conn) -> None:
    """The COLD-hit rehydration — late-bound into ``memory_query._on_cold_hit`` by
    ``install()``. Re-promotes the EXISTING HOT_DETAIL row (append-only ⇒ it still
    exists) by flipping ONLY ``memory_tier_state.current_tier`` → HOT with
    ``touch_access=False`` (B1 already bumped the access telemetry on the hit; a second
    bump would double-count). NEVER reconstructs detail from a summary, NEVER reads or
    writes the level chain, NEVER an ssh. Then piggybacks a bounded demotion sweep on
    this query activity (decision B).

    THRASH GUARD: the re-promoted entry's ``last_accessed_ts`` is now (B1's bump) ⇒ it
    is inside the keep-hot window ⇒ the sweep excludes it ⇒ no rehydrate↔demote loop.
    An already-HOT entry never enters here (B1 fires the seam on COLD ONLY) ⇒ a
    rehydrate-of-HOT is a structural no-op. Gated + defensive: OFF or ANY error ⇒
    inert (the caller's query must never break; the write is on B1's conn, which B1
    commits — SQLite does not poison the conn on a statement error, so B1's commit
    still lands the successful writes)."""
    if not _enabled():
        return
    try:
        upsert_tier(canonical_id, ROLE_HOT, touch_access=False, conn=conn)  # re-promote, never reconstruct
    except Exception:
        return  # rehydration must never break the caller's query
    try:
        maybe_sweep(conn=conn)  # piggyback demotion on query activity (idempotent; resumes next call)
    except Exception:
        return  # a sweep hiccup must never break the query


_INSTALLED = False
_ORIGINAL_ON_COLD_HIT = None


def install() -> bool:
    """LATE-BIND the COLD-hit rehydration into B1's documented seam
    (``memory_query._on_cold_hit``) WITHOUT editing memory_query.py — Python resolves
    the module global at call time, so the hook fires INSIDE ``have_we_tested``'s query
    path. Explicit, gated, idempotent; NEVER auto-runs on import. Returns True iff the
    hook is now installed. OFF ⇒ no-op (the seam stays B1's no-op — byte-identical
    inert). Safe to call repeatedly (the daemon calls it once at start)."""
    global _INSTALLED, _ORIGINAL_ON_COLD_HIT
    if not _enabled():
        return False
    if _INSTALLED:
        return True
    import memory_query  # lazy — keeps `import memory_tiers` fully inert
    _ORIGINAL_ON_COLD_HIT = memory_query._on_cold_hit
    memory_query._on_cold_hit = _rehydrate_hook
    _INSTALLED = True
    return True


def uninstall() -> None:
    """Restore B1's original no-op seam (rollback / test hygiene). Idempotent."""
    global _INSTALLED, _ORIGINAL_ON_COLD_HIT
    if not _INSTALLED:
        return
    import memory_query
    if _ORIGINAL_ON_COLD_HIT is not None:
        memory_query._on_cold_hit = _ORIGINAL_ON_COLD_HIT
    _INSTALLED = False
    _ORIGINAL_ON_COLD_HIT = None


def is_installed() -> bool:
    """True iff the rehydration hook is currently late-bound into B1's seam."""
    return _INSTALLED


# ═══════════════════════════════════════════════════════════════════════════════
#  Daemon convenience — the single gated maintenance entrypoint (no thread of its own)
# ═══════════════════════════════════════════════════════════════════════════════
def run_maintenance(*, reader=None) -> dict:
    """The R13 daemon's cadence hook: an opportunistic level-cache refresh (the ONLY
    ssh — off the query path) followed by a bounded demotion sweep. Gated; OFF ⇒ inert.
    Freeze-safe: it only runs when a caller invokes it — B2 owns no daemon/thread."""
    if not _enabled():
        return {"status": "disabled"}
    return {
        "status": "ran",
        "refresh": refresh_level_cache(reader=reader),
        "sweep": maybe_sweep(),
    }


if __name__ == "__main__":
    # Manual smoke ONLY — guarded, NEVER runs on import. At the pre-cutover state
    # (MAX(level)=0, empty store) with the flag ON everything is HOT and the sweep
    # demotes nothing; with the flag OFF this is fully inert.
    print("MEMORY_TIERS_ENABLED:", _enabled())
    print("compute_tier(entry=0, current=0, ts=None):", compute_tier(0, 0, None))
    print("cached_level():", cached_level())
    print("maybe_sweep():", maybe_sweep())
