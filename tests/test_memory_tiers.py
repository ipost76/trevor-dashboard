#!/usr/bin/env python3
"""Tests for R11-B2 (memory_tiers.py) — tier transitions + append-only compression +
the self-maintaining sweep + COLD→HOT rehydration.

Proves, per the Phase-1/2/3 verification gates:
  * the level cache reads from memory_state with NO ssh on the query/sweep path,
  * a shim failure → UNKNOWN → NO demotion (fail toward keeping HOT),
  * compute_tier is correct at every band boundary + the keep-hot override,
  * L0 / empty pre-cutover → everything HOT, no demotion,
  * demotion is APPEND-ONLY (the original HOT row byte-identical after; WARM/COLD are
    NEW rows; only memory_tier_state.current_tier flips),
  * the sweep is idempotent + bounded + crash-safe + both-agents-frozen safe,
  * rehydration re-promotes the EXISTING HOT_DETAIL row (never reconstructs), writes
    ONLY memory_tier_state, and is a two-query flip (COLD summary now → HOT detail next),
  * the thrash guard (keep-hot window) + already-HOT no-op,
  * B2 has ZERO knowledge-row UPDATE/DELETE and ZERO level-chain / rebuild_tracker /
    ssh-mint path,
  * the watcher independence suite still passes 5/5 with B2 present,
  * MEMORY_TIERS_ENABLED OFF → byte-identical inert.

Dependency-free: ``python3 tests/test_memory_tiers.py``. Uses a temp MEMORY_DB_PATH per
test (never touches the real data/memory.db).
"""
import ast
import atexit
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── MODULE-LEVEL store protection (B11) ───────────────────────────────────────
# 🚨 `_setup()` below already points MEMORY_DB_PATH at a temp db — but only once a test
# CALLS it. Until B11 this file had NO protection above that point, so a new test
# function added ahead of the first `_setup()` would reach the live data/memory.db and
# nothing would say so. Ordering is not a safety mechanism. This sets a scratch default
# at import — before the module imports below can reach a store — and `_setup()` still
# overrides it per-test.
_B11_SCRATCH = tempfile.mkdtemp(
    prefix="memtiers_module_", dir="/home/ghost/tmp" if os.path.isdir("/home/ghost/tmp") else None
)
os.environ["MEMORY_DB_PATH"] = os.path.join(_B11_SCRATCH, "memory.db")
atexit.register(shutil.rmtree, _B11_SCRATCH, True)

import lib.memory_db as memory_db          # noqa: E402
import memory_query                        # noqa: E402
import memory_tiers                         # noqa: E402
from lib.memory_db import ROLE_HOT, ROLE_WARM, ROLE_COLD  # noqa: E402


# ── harness ────────────────────────────────────────────────────────────────────
def _code_tokens(path):
    """The CODE surface of a module — every non-docstring string literal + every
    identifier (Name/Attribute) — with docstrings AND comments excluded (comments are
    AST-invisible). Mirrors the watcher independence scanner: a token DOCUMENTED in
    prose ("this module has no rebuild_tracker path") must NOT false-flag, while a real
    identifier or SQL-string reference IS caught."""
    tree = ast.parse(open(path, encoding="utf-8").read())
    doc_ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", None) or []
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                doc_ids.add(id(body[0].value))
    parts = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in doc_ids:
            parts.append(node.value)
        elif isinstance(node, ast.Name):
            parts.append(node.id)
        elif isinstance(node, ast.Attribute):
            parts.append(node.attr)
    return "\n".join(parts)


def _setup(*, tiers=True, query=True, keephot="0", hot="2", warm="6"):
    """Fresh temp db + flags. keephot='0' disables the keep-hot override so level alone
    decides (demotion tests); pass a real window for the thrash test."""
    d = tempfile.mkdtemp(prefix="memtiers_")
    os.environ["MEMORY_DB_PATH"] = os.path.join(d, "memory.db")
    os.environ["MEMORY_TIERS_ENABLED"] = "1" if tiers else ""
    os.environ["MEMORY_QUERY_ENABLED"] = "1" if query else ""
    os.environ["MEMORY_HOT_LEVELS"] = hot
    os.environ["MEMORY_WARM_LEVELS"] = warm
    os.environ["MEMORY_KEEPHOT_WINDOW_SEC"] = keephot
    for k in ("MEMORY_SWEEP_CAP", "MEMORY_TIERS_SSH_TIMEOUT", "MEMORY_TIERS_VM_HOST"):
        os.environ.pop(k, None)
    memory_tiers.uninstall()  # reset the late-bind between tests
    return os.environ["MEMORY_DB_PATH"]


def _conn():
    return memory_db.get_connection()


def _wm(subjects, level, prose, *, action="act", because="conclusion", outcome="tested",
        agent="trainer"):
    return memory_query.write_memory(agent, subjects, action, because, level, outcome,
                                     "high", prose)


def _set_cache(level):
    """Simulate a successful level-cache refresh WITHOUT ssh (injected reader)."""
    return memory_tiers.refresh_level_cache(reader=lambda: level)


def _tier_of(cid):
    c = _conn()
    try:
        r = c.execute("SELECT current_tier FROM memory_tier_state WHERE canonical_id=?",
                      (cid,)).fetchone()
        return r[0] if r else None
    finally:
        c.close()


def _dump(table):
    c = _conn()
    try:
        return sorted(c.execute("SELECT * FROM %s" % table).fetchall())
    finally:
        c.close()


def _count_tier(tier):
    c = _conn()
    try:
        return c.execute("SELECT COUNT(*) FROM memory_tier_state WHERE current_tier=?",
                         (tier,)).fetchone()[0]
    finally:
        c.close()


def _cid_of(entry_id, table="trainer_memory"):
    c = _conn()
    try:
        return c.execute("SELECT canonical_id FROM %s WHERE id=?" % table, (entry_id,)).fetchone()[0]
    finally:
        c.close()


def _assert(cond, msg):
    if not cond:
        raise AssertionError(msg)


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 1 — level cache + compute_tier
# ═══════════════════════════════════════════════════════════════════════════════
def test_compute_tier_bands_and_boundaries():
    _setup(keephot="0", hot="2", warm="6")
    ct = memory_tiers.compute_tier
    # current level → HOT; the HOT boundary (age == N) → HOT; age N+1 → WARM.
    _assert(ct(10, 10, None) == ROLE_HOT, "current level must be HOT")
    _assert(ct(8, 10, None) == ROLE_HOT, "age==2 (HOT_LEVELS) must be HOT boundary")
    _assert(ct(7, 10, None) == ROLE_WARM, "age==3 must cross into WARM")
    _assert(ct(4, 10, None) == ROLE_WARM, "age==6 (WARM_LEVELS) must be WARM boundary")
    _assert(ct(3, 10, None) == ROLE_COLD, "age==7 must cross into COLD")
    _assert(ct(0, 10, None) == ROLE_COLD, "very old must be COLD")
    # defensive: unknown geometry → HOT (never hide).
    _assert(ct(0, None, None) == ROLE_HOT, "unknown current level → HOT (safe)")
    _assert(ct(None, 10, None) == ROLE_HOT, "unknown entry level → HOT (safe)")
    print("  P1 compute_tier bands/boundaries + defensive: PASS")


def test_keephot_override():
    _setup(keephot="86400", hot="2", warm="6")
    ct = memory_tiers.compute_tier
    now = 1_000_000.0
    recent = memory_db.utc_now  # format helper
    # an OLD-level entry (age 100 → COLD by level) accessed inside the window → HOT.
    ts_recent = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - 100))
    ts_old = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - 200_000))
    _assert(ct(0, 100, ts_recent, now=now) == ROLE_HOT, "recent access must override level → HOT")
    _assert(ct(0, 100, ts_old, now=now) == ROLE_COLD, "stale access must fall back to level → COLD")
    _ = recent
    print("  P1 keep-hot override (recent access → HOT, stale → level): PASS")


def test_level_cache_no_ssh_on_read_path():
    _setup()
    # Prime the cache via the injected reader (no ssh), then GUARD subprocess.run.
    _set_cache(5)
    _wm(["tickers"], 0, "detail")
    real_run = memory_tiers.subprocess.run

    def _boom(*a, **k):
        raise AssertionError("ssh subprocess.run was called on the query/sweep path!")

    memory_tiers.subprocess.run = _boom
    try:
        memory_tiers.install()
        memory_tiers.maybe_sweep()                 # sweep read path
        memory_query.have_we_tested(["tickers"])   # query read path (may fire the hook)
        cur = memory_tiers.cached_level()          # cache read
    finally:
        memory_tiers.subprocess.run = real_run
    _assert(cur == 5, "cached_level must read memory_state (=5), got %r" % cur)
    print("  P1 level cache read path makes ZERO ssh (subprocess.run guarded): PASS")


def test_shim_failure_unknown_no_demotion():
    _setup(keephot="0")
    e = _wm(["tickers"], 0, "detail")
    cid = _cid_of(e)
    # A hard-fail read (reader → None) must report unknown AND NOT write the cache.
    res = memory_tiers.refresh_level_cache(reader=lambda: None)
    _assert(res["status"] == "unknown", "failed read must be UNKNOWN, got %r" % res)
    _assert(memory_tiers.cached_level() is None, "failed read must NOT write a guessed cache")
    sweep = memory_tiers.maybe_sweep()
    _assert(sweep["status"] == "unknown_level" and sweep["demoted"] == 0,
            "UNKNOWN level must run NO demotion, got %r" % sweep)
    _assert(_tier_of(cid) == ROLE_HOT, "entry must stay HOT under UNKNOWN level")
    # A later failed read must NOT clobber a previously-known cache (monotonic safe).
    _set_cache(7)
    memory_tiers.refresh_level_cache(reader=lambda: None)
    _assert(memory_tiers.cached_level() == 7, "failed read must preserve the last-known level")
    print("  P1 shim failure → UNKNOWN → no demotion + known cache preserved: PASS")


def test_real_shim_failure_modes_return_none():
    _setup()
    real_run = memory_tiers.subprocess.run

    class _P:
        def __init__(self, rc, out): self.returncode, self.stdout, self.stderr = rc, out, ""

    cases = {
        "nonzero": _P(1, '{"current_level": 3}'),
        "empty": _P(0, "   "),
        "malformed": _P(0, "not json"),
        "non_object": _P(0, "[1,2,3]"),
        "no_field": _P(0, '{"x": 1}'),
        "negative": _P(0, '{"current_level": -1}'),
        "bool": _P(0, '{"current_level": true}'),
    }
    try:
        for name, p in cases.items():
            memory_tiers.subprocess.run = lambda *a, _p=p, **k: _p
            _assert(memory_tiers._read_current_level_via_ssh() is None,
                    "%s must map to UNKNOWN (None)" % name)
        # a good read maps to the int
        memory_tiers.subprocess.run = lambda *a, **k: _P(0, '{"current_level": 4}')
        _assert(memory_tiers._read_current_level_via_ssh() == 4, "good read must return the int")
        # timeout → None
        def _timeout(*a, **k):
            raise subprocess.TimeoutExpired(cmd="ssh", timeout=1)
        memory_tiers.subprocess.run = _timeout
        _assert(memory_tiers._read_current_level_via_ssh() is None, "timeout must be UNKNOWN")
        # spawn error → None
        def _oserr(*a, **k):
            raise OSError("ssh missing")
        memory_tiers.subprocess.run = _oserr
        _assert(memory_tiers._read_current_level_via_ssh() is None, "spawn error must be UNKNOWN")
    finally:
        memory_tiers.subprocess.run = real_run
    print("  P1 shim hard-UNKNOWN on every failure mode, good read → int: PASS")


def test_L0_everything_hot_no_demotion():
    _setup(keephot="0")
    ids = [_cid_of(_wm(["tickers"], 0, "d%d" % i, action="a%d" % i)) for i in range(4)]
    _set_cache(0)  # L0 — the pre-cutover state
    sweep = memory_tiers.maybe_sweep()
    _assert(sweep["demoted"] == 0, "L0 must demote nothing, got %r" % sweep)
    for cid in ids:
        _assert(_tier_of(cid) == ROLE_HOT, "at L0 everything must stay HOT")
    print("  P1 L0/pre-cutover → everything HOT, no demotion, no alarm: PASS")


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 2 — append-only compression + the sweep
# ═══════════════════════════════════════════════════════════════════════════════
def _hot_row(cid):
    c = _conn()
    try:
        return c.execute("SELECT * FROM trainer_memory WHERE canonical_id=? AND role=?",
                         (cid, ROLE_HOT)).fetchone()
    finally:
        c.close()


def _rows_for(cid):
    c = _conn()
    try:
        return c.execute("SELECT role FROM trainer_memory WHERE canonical_id=? ORDER BY id",
                         (cid,)).fetchall()
    finally:
        c.close()


def test_append_only_warm_then_cold_byte_identical():
    _setup(keephot="0")
    cid = _cid_of(_wm(["tickers", "leverage"], 5, "FULL DETAIL", because="conclusion Y"))
    hot_before = _hot_row(cid)
    # level 8: age 3 → WARM band (2 < 3 <= 6).
    _set_cache(8)
    memory_tiers.maybe_sweep()
    _assert(_tier_of(cid) == ROLE_WARM, "age 3 must demote HOT→WARM")
    roles = [r[0] for r in _rows_for(cid)]
    _assert(roles == [ROLE_HOT, ROLE_WARM], "WARM must be a NEW row beside HOT, got %r" % roles)
    _assert(_hot_row(cid) == hot_before, "HOT_DETAIL row must be BYTE-IDENTICAL after WARM demotion")
    warm_c = _conn()
    try:
        warm = warm_c.execute("SELECT because, prose FROM trainer_memory WHERE canonical_id=? AND role=?",
                              (cid, ROLE_WARM)).fetchone()
    finally:
        warm_c.close()
    _assert(warm[0] == "conclusion Y", "WARM must carry the conclusion (because)")
    _assert(warm[1] is None, "WARM must DROP prose (the compression)")
    # advance further: level 20 → age 15 → COLD.
    _set_cache(20)
    memory_tiers.maybe_sweep()
    _assert(_tier_of(cid) == ROLE_COLD, "age 15 must demote to COLD")
    roles = [r[0] for r in _rows_for(cid)]
    _assert(roles == [ROLE_HOT, ROLE_WARM, ROLE_COLD], "COLD must ADD a row; both priors retained: %r" % roles)
    _assert(_hot_row(cid) == hot_before, "HOT_DETAIL row STILL byte-identical after COLD demotion")
    cold_c = _conn()
    try:
        cold = cold_c.execute("SELECT prose FROM trainer_memory WHERE canonical_id=? AND role=?",
                              (cid, ROLE_COLD)).fetchone()
    finally:
        cold_c.close()
    stats = json.loads(cold[0])
    _assert(stats.get("cold_stat") is True and "level_span" in stats and "outcomes" in stats,
            "COLD must carry summary stats, got %r" % cold[0])
    print("  P2 append-only HOT→WARM→COLD; original byte-identical; WARM=conclusion, COLD=stats: PASS")


def test_only_tier_state_mutated_no_knowledge_update():
    _setup(keephot="0")
    cid = _cid_of(_wm(["tickers"], 0, "detail"))
    tags_before = _dump("memory_tags")
    _set_cache(20)
    # snapshot the HOT row set (the original knowledge) — demotion must not alter it.
    hot_before = _hot_row(cid)
    memory_tiers.maybe_sweep()
    _assert(_hot_row(cid) == hot_before, "demotion must not UPDATE the HOT knowledge row")
    _assert(_dump("memory_tags") == tags_before, "demotion must not touch memory_tags")
    # tier pointer flipped (the only knowledge-side mutation).
    _assert(_tier_of(cid) == ROLE_COLD, "tier pointer must have flipped to COLD")
    print("  P2 demotion mutates ONLY memory_tier_state (+ new rows); no knowledge UPDATE/tag change: PASS")


def test_sweep_idempotent():
    _setup(keephot="0")
    cid = _cid_of(_wm(["tickers"], 0, "detail"))
    _set_cache(20)
    memory_tiers.maybe_sweep()
    rows_after_first = _rows_for(cid)
    # re-run at the SAME level → no_advance (drained), and even a forced re-run inserts nothing.
    r2 = memory_tiers.maybe_sweep()
    _assert(r2["status"] == "no_advance", "a drained level must not re-sweep, got %r" % r2)
    _assert(_rows_for(cid) == rows_after_first, "idempotent: no duplicate WARM/COLD rows on re-sweep")
    print("  P2 sweep idempotency — no duplicate compressed rows: PASS")


def test_sweep_bounded_and_resumable():
    _setup(keephot="0")
    os.environ["MEMORY_SWEEP_CAP"] = "10"
    for i in range(25):
        _wm(["tickers"], 0, "d%d" % i, action="a%d" % i)
    _set_cache(20)  # all age out → COLD
    s1 = memory_tiers.maybe_sweep()
    _assert(s1["demoted"] == 10 and s1["drained"] is False, "pass 1 must be capped at 10, not drained: %r" % s1)
    _assert(_count_tier(ROLE_COLD) == 10, "10 demoted after pass 1")
    s2 = memory_tiers.maybe_sweep()
    _assert(s2["demoted"] == 10 and s2["drained"] is False, "pass 2 must be capped at 10: %r" % s2)
    _assert(_count_tier(ROLE_COLD) == 20, "20 demoted after pass 2")
    s3 = memory_tiers.maybe_sweep()
    _assert(s3["demoted"] == 5 and s3["drained"] is True, "pass 3 must drain the last 5: %r" % s3)
    _assert(_count_tier(ROLE_COLD) == 25, "all 25 demoted after pass 3")
    s4 = memory_tiers.maybe_sweep()
    _assert(s4["status"] == "no_advance", "a drained level must stop sweeping: %r" % s4)
    os.environ.pop("MEMORY_SWEEP_CAP", None)
    print("  P2 sweep bounded (cap=10 across 3 passes over 25) + resumes + stops when drained: PASS")


def test_sweep_crash_safe():
    _setup(keephot="0")
    os.environ["MEMORY_SWEEP_CAP"] = "50"
    for i in range(20):
        _wm(["tickers"], 0, "d%d" % i, action="a%d" % i)
    _set_cache(20)
    real = memory_tiers._demote_entry
    calls = {"n": 0}

    def _crash(*a, **k):
        calls["n"] += 1
        if calls["n"] == 5:
            raise RuntimeError("simulated mid-sweep crash")
        return real(*a, **k)

    memory_tiers._demote_entry = _crash
    crashed = False
    try:
        memory_tiers.maybe_sweep()
    except RuntimeError:
        crashed = True
    finally:
        memory_tiers._demote_entry = real
    _assert(crashed, "the simulated crash must propagate")
    # atomic rollback: NO demotions persisted, cursor NOT advanced (recomputable state).
    _assert(_count_tier(ROLE_COLD) == 0, "a crashed pass must roll back — 0 demoted")
    c = _conn()
    try:
        cursor = c.execute("SELECT value FROM memory_state WHERE key=?",
                           ("memory_tiers:sweep_cursor",)).fetchone()
    finally:
        c.close()
    _assert(cursor is None, "the cursor must not have advanced (no orphaned state)")
    # the next clean pass completes correctly.
    s = memory_tiers.maybe_sweep()
    _assert(s["demoted"] == 20 and s["drained"] is True, "the next pass must complete all 20: %r" % s)
    _assert(_count_tier(ROLE_COLD) == 20, "all 20 demoted after recovery")
    os.environ.pop("MEMORY_SWEEP_CAP", None)
    print("  P2 crash-safe — mid-sweep crash rolls back atomically; next pass completes: PASS")


def test_both_agents_frozen_no_call_no_sweep():
    _setup(keephot="0")
    cid = _cid_of(_wm(["tickers"], 0, "detail"))
    _set_cache(20)
    # NO store call fires (both agents frozen) → nothing runs → entry stays HOT.
    _assert(_tier_of(cid) == ROLE_HOT, "with no sweep call, the entry stays HOT (nothing ran)")
    # a later call resumes and demotes.
    memory_tiers.maybe_sweep()
    _assert(_tier_of(cid) == ROLE_COLD, "the next call resumes the sweep")
    print("  P2 both-agents-frozen — no call → no sweep → nothing breaks; next call resumes: PASS")


def test_no_knowledge_update_delete_in_source():
    # AST (docstring/comment-excluded): memory_tiers.py must contain ZERO UPDATE/DELETE/
    # REPLACE against the *_memory knowledge tables in CODE — every write goes through
    # C1's INSERT-only MemoryScope.insert_entry; the only code SQL naming *_memory is the
    # SELECT candidate join.
    code = _code_tokens(os.path.join(_REPO, "memory_tiers.py")).upper()
    for banned in ("DELETE FROM TRAINER_MEMORY", "DELETE FROM WATCHER_MEMORY",
                   "UPDATE TRAINER_MEMORY", "UPDATE WATCHER_MEMORY",
                   "REPLACE INTO TRAINER_MEMORY", "REPLACE INTO WATCHER_MEMORY",
                   "INSERT INTO TRAINER_MEMORY", "INSERT INTO WATCHER_MEMORY"):
        _assert(banned not in code, "found a raw knowledge-row statement in code: %r" % banned)
    print("  P2 zero knowledge-row UPDATE/DELETE/REPLACE/raw-INSERT in code: PASS")


# ═══════════════════════════════════════════════════════════════════════════════
#  PHASE 3 — rehydration + thrash guard + level-chain isolation + flag-off inertness
# ═══════════════════════════════════════════════════════════════════════════════
def _shape_for(cid, agent="trainer"):
    for r in memory_query.have_we_tested(["tickers"], agent=agent):
        if r["canonical_id"] == cid:
            return r
    return None


def test_rehydration_two_query_returns_original_detail():
    _setup(keephot="0")
    cid = _cid_of(_wm(["tickers"], 0, "THE ORIGINAL FULL DETAIL", because="conc"))
    _set_cache(20)
    memory_tiers.maybe_sweep()  # demote to COLD, drains → last_sweep=20
    _assert(_tier_of(cid) == ROLE_COLD, "precondition: entry is COLD")
    memory_tiers.install()
    # QUERY 1: eff_tier was captured as COLD before the seam → returns the COLD summary,
    # and the seam re-promotes the pointer to HOT.
    q1 = _shape_for(cid)
    _assert(q1 is not None and q1["tier"] == ROLE_COLD, "query 1 must serve the COLD summary: %r" % q1)
    _assert(_tier_of(cid) == ROLE_HOT, "the seam must have re-promoted the pointer to HOT")
    # QUERY 2: pointer is HOT → serves the ORIGINAL HOT_DETAIL row (not a reconstruction).
    q2 = _shape_for(cid)
    _assert(q2 is not None and q2["tier"] == ROLE_HOT, "query 2 must serve HOT: %r" % q2)
    _assert(q2["summary_or_prose"] == "THE ORIGINAL FULL DETAIL",
            "rehydration must return the ORIGINAL detail, never a reconstruction: %r" % q2)
    print("  P3 two-query rehydration: COLD summary now → ORIGINAL HOT detail next: PASS")


def test_rehydration_writes_only_tier_state():
    _setup(keephot="0")
    cid = _cid_of(_wm(["tickers"], 0, "detail"))
    _set_cache(20)
    memory_tiers.maybe_sweep()  # → COLD, drained
    mem_before = _dump("trainer_memory")
    tags_before = _dump("memory_tags")
    memory_tiers.install()
    memory_query.have_we_tested(["tickers"])  # COLD hit → rehydration
    _assert(_dump("trainer_memory") == mem_before, "rehydration must not touch trainer_memory")
    _assert(_dump("memory_tags") == tags_before, "rehydration must not touch memory_tags")
    _assert(_tier_of(cid) == ROLE_HOT, "rehydration flipped ONLY memory_tier_state → HOT")
    print("  P3 rehydration writes ONLY memory_tier_state (no knowledge/tag change): PASS")


def test_rehydration_no_level_chain_and_max_level_zero():
    # AST code surface (docstrings/comments excluded — B2 may DOCUMENT "no rebuild_tracker
    # path" in prose): ZERO level-chain mint path in actual code.
    code = _code_tokens(os.path.join(_REPO, "memory_tiers.py"))
    for banned in ("rebuild_tracker", "INSERT INTO levels", "FROM levels",
                   "UPDATE levels", "--money-path", "money-path yes"):
        _assert(banned not in code, "B2 must have ZERO level-chain mint path in code: %r" % banned)
    # no ssh call fires during a rehydration query (subprocess guard).
    _setup(keephot="0")
    cid = _cid_of(_wm(["tickers"], 0, "detail"))
    _set_cache(20)
    memory_tiers.maybe_sweep()
    memory_tiers.install()
    real = memory_tiers.subprocess.run
    memory_tiers.subprocess.run = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("rehydration made an ssh call!"))
    try:
        memory_query.have_we_tested(["tickers"])
    finally:
        memory_tiers.subprocess.run = real
    # MAX(level) in the memory tables is unchanged by rehydration (it is derived from the
    # written rows, never from a level mint).
    c = _conn()
    try:
        mx = c.execute("SELECT MAX(level) FROM trainer_memory").fetchone()[0]
    finally:
        c.close()
    _assert(mx == 0, "the written entry's level is 0; rehydration must not change it, got %r" % mx)
    _ = cid
    print("  P3 rehydration ≠ level change: no mint path in source, no ssh, MAX(level) unchanged: PASS")


def test_thrash_guard_and_already_hot_noop():
    win = "86400"
    _setup(keephot=win)
    cid = _cid_of(_wm(["tickers"], 0, "detail"))
    W = _parse_write_time(cid)
    # demote it OUTSIDE the keep-hot window (inject now = write_time + 2 days).
    _set_cache(20)
    memory_tiers.maybe_sweep(now=W + 2 * 86400)
    _assert(_tier_of(cid) == ROLE_COLD, "precondition: demoted to COLD (outside keep-hot)")
    # rehydrate: the query's line-381 access bump sets last_accessed ≈ real now → keep-hot.
    memory_tiers.install()
    memory_query.have_we_tested(["tickers"])
    _assert(_tier_of(cid) == ROLE_HOT, "rehydrated to HOT")
    # advance the level so the sweep RUNS (not no_advance) and prove the thrash guard.
    _set_cache(21)
    now = time.time()
    s = memory_tiers.maybe_sweep(now=now)
    _assert(_tier_of(cid) == ROLE_HOT, "keep-hot window must protect the just-rehydrated entry: %r" % s)
    # already-HOT entry: querying it again is a no-op (seam is COLD-only; only access bumps).
    mem_before = _dump("trainer_memory")
    memory_query.have_we_tested(["tickers"])
    _assert(_tier_of(cid) == ROLE_HOT, "re-querying a HOT entry stays HOT")
    _assert(_dump("trainer_memory") == mem_before, "rehydrating an already-HOT entry inserts nothing")
    print("  P3 thrash guard (keep-hot survives next sweep) + already-HOT no-op: PASS")


def _parse_write_time(cid):
    c = _conn()
    try:
        ts = c.execute("SELECT last_accessed_ts FROM memory_tier_state WHERE canonical_id=?",
                       (cid,)).fetchone()[0]
    finally:
        c.close()
    return memory_tiers._parse_utc(ts)


def test_flag_off_byte_identical_inert():
    d = tempfile.mkdtemp(prefix="memtiers_off_")
    dbp = os.path.join(d, "memory.db")
    os.environ["MEMORY_DB_PATH"] = dbp
    os.environ["MEMORY_TIERS_ENABLED"] = ""      # OFF
    os.environ["MEMORY_QUERY_ENABLED"] = "1"
    memory_tiers.uninstall()
    # OFF ⇒ install() no-ops (seam stays B1's), maybe_sweep/refresh/run_maintenance inert,
    # and NO db file is created by any of them.
    _assert(memory_tiers.install() is False, "install() must no-op when OFF")
    _assert(memory_tiers.is_installed() is False, "the seam must not be rebound when OFF")
    _assert(memory_query._on_cold_hit is not memory_tiers._rehydrate_hook, "seam must stay B1's no-op")
    _assert(memory_tiers.maybe_sweep()["status"] == "disabled", "maybe_sweep must be inert OFF")
    _assert(memory_tiers.refresh_level_cache(reader=lambda: 5)["status"] == "disabled",
            "refresh must be inert OFF")
    _assert(memory_tiers.run_maintenance()["status"] == "disabled", "run_maintenance must be inert OFF")
    _assert(not os.path.exists(dbp), "an inert (OFF) module must open NO db (no file created)")
    print("  P3 flag OFF → byte-identical inert (no install, no sweep, no db opened): PASS")


def test_independence_suite_still_5_of_5():
    r = subprocess.run([sys.executable, os.path.join(_REPO, "tests", "test_watcher_independence.py")],
                       capture_output=True, text=True, cwd=_REPO)
    _assert(r.returncode == 0, "independence suite must exit 0:\n%s\n%s" % (r.stdout, r.stderr))
    _assert("5/5 PASS" in r.stdout, "independence suite must report 5/5:\n%s" % r.stdout)
    print("  P3 watcher independence suite still 5/5 with B2 present: PASS")


_TESTS = [
    test_compute_tier_bands_and_boundaries,
    test_keephot_override,
    test_level_cache_no_ssh_on_read_path,
    test_shim_failure_unknown_no_demotion,
    test_real_shim_failure_modes_return_none,
    test_L0_everything_hot_no_demotion,
    test_append_only_warm_then_cold_byte_identical,
    test_only_tier_state_mutated_no_knowledge_update,
    test_sweep_idempotent,
    test_sweep_bounded_and_resumable,
    test_sweep_crash_safe,
    test_both_agents_frozen_no_call_no_sweep,
    test_no_knowledge_update_delete_in_source,
    test_rehydration_two_query_returns_original_detail,
    test_rehydration_writes_only_tier_state,
    test_rehydration_no_level_chain_and_max_level_zero,
    test_thrash_guard_and_already_hot_noop,
    test_flag_off_byte_identical_inert,
    test_independence_suite_still_5_of_5,
]


if __name__ == "__main__":
    print("=== R11-B2 memory_tiers tests ===")
    for t in _TESTS:
        t()
    print("=== %d/%d PASS ===" % (len(_TESTS), len(_TESTS)))
