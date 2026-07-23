#!/usr/bin/env python3
"""Tests for R11-B1: the structured write + the "have we tested X" cross-tier query.

Dependency-free (``python3 tests/test_memory_query.py``), pytest-compatible. Each test runs
against an ISOLATED temp ``memory.db`` (via the ``MEMORY_DB_PATH`` env override C1 resolves at
call time) with ``MEMORY_QUERY_ENABLED=1`` — the real ``data/memory.db`` is never touched.

Covers both phase gates:
  Phase 1 (write): HOT row per namespace · untagged→raise+store-nothing · idempotency (one row,
    no dup tags, no access bump on re-write) · memory_tags populated+queryable · memory_tier_state
    upserted HOT with access telemetry · NO update/delete path to *_memory (AST-assert) · flag-off
    inert.
  Phase 2 (query): per-tier shapes (HOT/WARM/COLD synthetic) · indexed not a scan
    (EXPLAIN QUERY PLAN) · level+agent filters · cross-agent span · empty-store→[] · rehydration
    seam reached on a COLD hit (spy) · is_known_dead_end byte-identical+callable · memory_query.py
    absent from the trainer/watcher globs · full independence suite 5/5.
"""
import ast
import hashlib
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# is_known_dead_end must be byte-identical to the recorded baseline sha256.
# RF1-B2 (2026-07-23): re-baselined — the authorized _level_of conversion (silent 0 default →
# loud raise on a level-less candidate; sibling #5 of BLOCK-2) changed trainer_reasoning.py's
# bytes. is_known_dead_end's BEHAVIOR is unchanged (functional half (b) below + the full
# test_trainer_reasoning suite 8/8 both green); only _level_of's missing-level fallback changed.
_TRAINER_REASONING_SHA256 = "e3465a8e2af3b256b19f1bcfa33148a88063497811f409fb0163e9c6e4002d99"


# ── isolated-db harness ──
class _Env:
    """Snapshot + point MEMORY_DB_PATH/MEMORY_QUERY_ENABLED at a fresh temp db; restore on exit."""

    def __init__(self, enabled=True):
        self._prev = {k: os.environ.get(k) for k in ("MEMORY_DB_PATH", "MEMORY_QUERY_ENABLED")}
        self.dir = tempfile.mkdtemp(prefix="memq_test_")
        self.path = os.path.join(self.dir, "memory.db")
        os.environ["MEMORY_DB_PATH"] = self.path
        if enabled:
            os.environ["MEMORY_QUERY_ENABLED"] = "1"
        else:
            os.environ.pop("MEMORY_QUERY_ENABLED", None)

    def close(self):
        for k, v in self._prev.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.dir, ignore_errors=True)


def _raw(env):
    """A raw connection to the temp db for direct assertions (independent of the module)."""
    return sqlite3.connect(env.path)


# ═══════════════════════════ Phase 1 — the write ═══════════════════════════
def test_write_hot_row_per_namespace():
    import memory_query as mq
    from lib.memory_db import trainer_scope, watcher_scope, ROLE_HOT
    env = _Env()
    try:
        tid = mq.write_memory("trainer", ["tickers", "leverage"], "reject",
                              "failing_gates=dd_wall", 3, outcome="rejected",
                              confidence="high", prose="BTC/ETH 3x rejected on drawdown wall")
        wid = mq.write_memory("watcher", ["exit", "signal"], "lesson",
                              "exits fire too late in VOLATILE", 3, outcome="concern",
                              confidence="medium", prose="generalized watcher lesson")
        assert tid > 0 and wid > 0, (tid, wid)
        # each landed in the CORRECT namespace via its own scope
        ts = trainer_scope(); ws = watcher_scope()
        try:
            assert ts.count() == 1 and ws.count() == 1, (ts.count(), ws.count())
            trow = ts.get_entry(tid); wrow = ws.get_entry(wid)
            assert trow["role"] == ROLE_HOT and wrow["role"] == ROLE_HOT
            assert trow["action"] == "reject" and wrow["action"] == "lesson"
        finally:
            ts.close(); ws.close()
        # cross-namespace isolation: the trainer row is NOT in watcher_memory and vice-versa
        c = _raw(env)
        try:
            assert c.execute("SELECT COUNT(*) FROM trainer_memory").fetchone()[0] == 1
            assert c.execute("SELECT COUNT(*) FROM watcher_memory").fetchone()[0] == 1
        finally:
            c.close()
        print("  write: HOT row lands in the correct namespace per agent: PASS")
    finally:
        env.close()


def test_untagged_write_raises_and_stores_nothing():
    import memory_query as mq
    from lib.memory_db import get_connection
    env = _Env()
    try:
        # seed ONE valid memory so the db exists with schema + a row, then prove untagged
        # writes raise AND add nothing (validation raises before any transaction begins).
        mq.write_memory("trainer", ["tickers"], "reject", "x", 0, prose="seed")
        for bad in ({}, [], "", None, {"config": {}}, ["", "  "]):
            try:
                mq.write_memory("trainer", bad, "reject", "x", 0)
            except ValueError:
                pass
            else:
                raise AssertionError(f"untagged subjects {bad!r} did NOT raise")
        c = get_connection()
        try:
            assert c.execute("SELECT COUNT(*) FROM trainer_memory").fetchone()[0] == 1  # seed only
            assert c.execute("SELECT COUNT(*) FROM memory_tags").fetchone()[0] == 1     # 'tickers'
        finally:
            c.close()
        print("  write: untagged subjects RAISE ValueError + store NOTHING (seed untouched): PASS")
    finally:
        env.close()


def test_idempotent_one_row_no_dup_tags_no_access_bump():
    import memory_query as mq
    from lib.memory_db import trainer_scope
    env = _Env()
    try:
        args = ("trainer", ["tickers", "leverage"], "reject", "dd_wall", 3)
        kw = dict(outcome="rejected", confidence="high", prose="same content")
        id1 = mq.write_memory(*args, **kw)
        c = _raw(env)
        try:
            access_after_write = c.execute(
                "SELECT access_count FROM memory_tier_state").fetchone()[0]
        finally:
            c.close()
        # a query hit bumps access telemetry to 2
        mq.have_we_tested(["tickers"], agent="trainer")
        # now write the IDENTICAL memory again — must dedup to one row, no dup tags, no bump
        id2 = mq.write_memory(*args, **kw)
        assert id1 == id2, (id1, id2)
        c = _raw(env)
        try:
            assert c.execute("SELECT COUNT(*) FROM trainer_memory").fetchone()[0] == 1
            # exactly the 2 tags, once each (no duplicates from the re-write)
            tagrows = c.execute("SELECT tag, COUNT(*) FROM memory_tags GROUP BY tag").fetchall()
            assert sorted(tagrows) == [("leverage", 1), ("tickers", 1)], tagrows
            access_final = c.execute("SELECT access_count FROM memory_tier_state").fetchone()[0]
        finally:
            c.close()
        # write=1 → query hit=2 → re-write does NOT bump (stays 2)
        assert access_after_write == 1, access_after_write
        assert access_final == 2, access_final
        print("  write: idempotent (1 row, no dup tags, no access bump on re-write): PASS")
    finally:
        env.close()


def test_tags_populated_and_queryable():
    import memory_query as mq
    env = _Env()
    try:
        mq.write_memory("trainer", {"tickers": ["BTC"], "leverage": 2}, "reject", "x", 1,
                        prose="detail")
        c = _raw(env)
        try:
            tags = sorted(r[0] for r in c.execute(
                "SELECT tag FROM memory_tags WHERE entry_agent='trainer'").fetchall())
            assert tags == ["leverage", "tickers"], tags
        finally:
            c.close()
        hits = mq.have_we_tested(["leverage"], agent="trainer")
        assert len(hits) == 1 and hits[0]["summary_or_prose"] == "detail", hits
        print("  write: memory_tags populated + queryable after a write: PASS")
    finally:
        env.close()


def test_tier_state_hot_with_access_telemetry():
    import memory_query as mq
    env = _Env()
    try:
        mq.write_memory("trainer", ["signal"], "lesson", "x", 0, prose="d")
        c = _raw(env)
        try:
            tier, acc, last = c.execute(
                "SELECT current_tier, access_count, last_accessed_ts FROM memory_tier_state"
            ).fetchone()
        finally:
            c.close()
        assert tier == "HOT_DETAIL", tier
        assert acc == 1, acc                      # touch_access=True on the new entry
        assert last is not None                   # telemetry stamped
        print("  write: memory_tier_state upserted HOT + access telemetry on a new entry: PASS")
    finally:
        env.close()


def test_no_update_delete_path_to_memory_tables():
    """AST-assert memory_query.py introduces NO UPDATE/DELETE/DROP/TRUNCATE in any non-docstring
    string — the append-only invariant for *_memory (writes go through C1's INSERT-only scope)."""
    src = open(os.path.join(_REPO, "memory_query.py"), encoding="utf-8").read()
    tree = ast.parse(src, "memory_query.py")
    doc_ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", None) or []
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                doc_ids.add(id(body[0].value))
    banned = re.compile(r"\b(UPDATE|DELETE|DROP|TRUNCATE|REPLACE)\b", re.IGNORECASE)
    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in doc_ids:
            if banned.search(node.value):
                offenders.append((node.lineno, node.value[:60]))
    assert offenders == [], f"memory_query.py introduces a mutating SQL verb: {offenders}"
    print("  write: NO UPDATE/DELETE path to *_memory (append-only preserved): PASS")


def test_flag_off_is_fully_inert():
    import memory_query as mq
    env = _Env(enabled=False)   # MEMORY_QUERY_ENABLED unset
    try:
        assert mq.write_memory("trainer", ["tickers"], "reject", "x", 0) == 0
        assert mq.have_we_tested(["tickers"]) == []
        # the db was NEVER opened → no file created
        assert not os.path.exists(env.path), "flag OFF must not open/create the db"
        print("  flag OFF → fully inert (write returns 0, query returns [], no db opened): PASS")
    finally:
        env.close()


# ═══════════════════════════ Phase 2 — the query ═══════════════════════════
def _add_tier_variant(cid, role, *, because=None, prose=None, outcome=None, subjects='["exit"]'):
    """Insert a synthetic WARM/COLD row for an existing canonical_id + flip the tier pointer."""
    from lib.memory_db import trainer_scope, upsert_tier
    sc = trainer_scope()
    try:
        sc.insert_entry(canonical_id=cid, role=role, subjects=subjects, level=0,
                        because=because, outcome=outcome, prose=prose,
                        entry_hash=f"{role}:{cid}", commit=True)
    finally:
        sc.close()
    upsert_tier(cid, role)   # effective tier now = role


def test_query_per_tier_return_shapes():
    import memory_query as mq
    from lib.memory_db import ROLE_HOT, ROLE_WARM, ROLE_COLD
    env = _Env()
    try:
        # HOT (natural write) → full detail (prose)
        mq.write_memory("trainer", ["exit"], "lesson", "hot conclusion", 0,
                        prose="FULL hot detail prose", canonical_id="cid-hot")
        hot = mq.have_we_tested(["exit"], agent="trainer")
        hot = [r for r in hot if r["canonical_id"] == "cid-hot"]
        assert len(hot) == 1 and hot[0]["tier"] == ROLE_HOT
        assert hot[0]["summary_or_prose"] == "FULL hot detail prose"

        # WARM → conclusion (because) + tags
        mq.write_memory("trainer", ["exit"], "lesson", "warm base", 0,
                        prose="hot prose", canonical_id="cid-warm")
        _add_tier_variant("cid-warm", ROLE_WARM, because="WARM conclusion only", prose="ignored")
        warm = [r for r in mq.have_we_tested(["exit"], agent="trainer")
                if r["canonical_id"] == "cid-warm"]
        assert len(warm) == 1 and warm[0]["tier"] == ROLE_WARM, warm
        assert warm[0]["summary_or_prose"] == "WARM conclusion only"
        assert warm[0]["tags"] == ["exit"], warm[0]["tags"]     # tags carried from the HOT row

        # COLD → summary stats
        mq.write_memory("trainer", ["exit"], "lesson", "cold base", 0,
                        prose="hot prose", canonical_id="cid-cold")
        _add_tier_variant("cid-cold", ROLE_COLD, prose="n=42 mean=-1.3R", outcome="rejected")
        cold = [r for r in mq.have_we_tested(["exit"], agent="trainer")
                if r["canonical_id"] == "cid-cold"]
        assert len(cold) == 1 and cold[0]["tier"] == ROLE_COLD, cold
        assert cold[0]["summary_or_prose"] == "n=42 mean=-1.3R"
        print("  query: per-tier shapes HOT(full)/WARM(conclusion+tags)/COLD(stats): PASS")
    finally:
        env.close()


def test_query_is_indexed_not_a_scan():
    import memory_query as mq
    from lib.memory_db import get_connection
    env = _Env()
    try:
        mq.write_memory("trainer", ["tickers", "leverage"], "reject", "x", 0, prose="d")
        c = get_connection()
        try:
            plan = c.execute(
                "EXPLAIN QUERY PLAN "
                "SELECT DISTINCT m.canonical_id FROM memory_tags t "
                "JOIN trainer_memory m ON m.id = t.entry_id "
                "WHERE t.entry_agent = ? AND t.tag IN (?, ?)",
                ("trainer", "tickers", "leverage"),
            ).fetchall()
            text = " | ".join(str(r) for r in plan)
            assert "idx_mtag" in text, text                 # tag filter rides idx_mtag
            assert "SCAN" not in text, text                 # NOT a full table scan
            # per-canonical effective-tier fetch rides idx_tmem_canon
            fetch = c.execute(
                "EXPLAIN QUERY PLAN SELECT * FROM trainer_memory "
                "WHERE canonical_id = ? ORDER BY id DESC LIMIT 1", ("x",)
            ).fetchall()
            assert any("idx_tmem_canon" in str(r) for r in fetch), fetch
        finally:
            c.close()
        print(f"  query: INDEXED (idx_mtag + idx_tmem_canon), not a scan — plan: {text}: PASS")
    finally:
        env.close()


def test_query_filters_level_and_agent():
    import memory_query as mq
    env = _Env()
    try:
        mq.write_memory("trainer", ["tickers"], "reject", "x", 2, prose="lvl2",
                        canonical_id="t-lvl2")
        mq.write_memory("trainer", ["tickers"], "reject", "x", 9, prose="lvl9",
                        canonical_id="t-lvl9")
        mq.write_memory("watcher", ["tickers"], "lesson", "y", 2, prose="w-lvl2",
                        canonical_id="w-lvl2")
        # level filter: at/below 2 keeps the level-2 rows, drops level-9
        lvl = {r["canonical_id"] for r in mq.have_we_tested(["tickers"], level=2)}
        assert lvl == {"t-lvl2", "w-lvl2"}, lvl
        # agent filter: trainer only
        tr = {r["canonical_id"] for r in mq.have_we_tested(["tickers"], agent="trainer")}
        assert tr == {"t-lvl2", "t-lvl9"}, tr
        # agent=None → cross-agent span (both namespaces)
        span = {(r["agent"], r["canonical_id"]) for r in mq.have_we_tested(["tickers"])}
        assert ("trainer", "t-lvl2") in span and ("watcher", "w-lvl2") in span, span
        print("  query: filters (level at/below, agent scope, agent=None span): PASS")
    finally:
        env.close()


def test_empty_store_returns_empty_no_error():
    import memory_query as mq
    env = _Env()
    try:
        # fresh (schema-only) store — query returns [], never raises
        assert mq.have_we_tested(["tickers", "leverage"]) == []
        assert mq.have_we_tested(["tickers"], agent="trainer", level=5) == []
        print("  query: empty pre-cutover store → [] (no alarm, no error): PASS")
    finally:
        env.close()


def test_rehydration_seam_reached_on_cold_hit():
    """The B2 attach point: _on_cold_hit is a no-op in B1 but MUST be reached on a COLD hit."""
    import memory_query as mq
    from lib.memory_db import ROLE_COLD
    env = _Env()
    try:
        assert mq._on_cold_hit("x", "trainer", None) is None   # B1 no-op
        mq.write_memory("trainer", ["exit"], "lesson", "base", 0, prose="hot",
                        canonical_id="cid-seam")
        _add_tier_variant("cid-seam", ROLE_COLD, prose="stats")
        spy = []
        original = mq._on_cold_hit
        mq._on_cold_hit = lambda cid, agent, conn: spy.append((cid, agent))
        try:
            mq.have_we_tested(["exit"], agent="trainer")
        finally:
            mq._on_cold_hit = original
        assert spy == [("cid-seam", "trainer")], spy
        print("  query: rehydration seam (_on_cold_hit) reached on a COLD hit, B1 no-op: PASS")
    finally:
        env.close()


# ═══════════════════════════ Invariants preserved ═══════════════════════════
def test_is_known_dead_end_untouched_and_callable():
    # (a) trainer_reasoning.py byte-identical to the Phase-0 baseline
    digest = hashlib.sha256(
        open(os.path.join(_REPO, "trainer_reasoning.py"), "rb").read()).hexdigest()
    assert digest == _TRAINER_REASONING_SHA256, (
        f"trainer_reasoning.py CHANGED — is_known_dead_end must stay untouched\n"
        f"  expected {_TRAINER_REASONING_SHA256}\n  got      {digest}")
    # (b) the exact (arm_hash, level_id) lookup still runs unchanged, returns a bool
    from trainer_reasoning import is_known_dead_end
    candidate = {"tickers": ["BTC", "ETH"], "leverage": 2, "level_id": 0}
    assert isinstance(is_known_dead_end(candidate), bool)
    print("  invariant: is_known_dead_end byte-identical (sha256) + callable/bool: PASS")


def test_memory_query_absent_from_trainer_and_watcher_globs():
    """memory_query.py must NOT be swept by the trainer/watcher globs — else denial 4 would
    falsely scan it (it legitimately references watcher_scope for the cross-agent span)."""
    import glob
    trainer = glob.glob(os.path.join(_REPO, "trainer_*.py"))
    watcher = glob.glob(os.path.join(_REPO, "watcher_*.py")) + \
        glob.glob(os.path.join(_REPO, "lib", "watcher*.py"))
    bases = {os.path.basename(p) for p in trainer + watcher} | {"trainer_db.py"}
    assert "memory_query.py" not in bases, bases
    print("  invariant: memory_query.py absent from trainer/watcher globs (like "
          "memory_projection.py): PASS")


def test_full_independence_suite_still_5_of_5():
    """Re-run the whole watcher-independence suite (denials 1-4 + self-validation) → 5/5."""
    out = subprocess.run(
        [sys.executable, os.path.join(_REPO, "tests", "test_watcher_independence.py")],
        capture_output=True, text=True, cwd=_REPO)
    assert out.returncode == 0, out.stdout + out.stderr
    assert "5/5 PASS" in out.stdout, out.stdout
    assert "(4) trainer ↛ watcher_memory namespace: 0 refs" in out.stdout, out.stdout
    print("  invariant: watcher independence suite still 5/5 (denial 4 = 4/4) after B1: PASS")


_TESTS = [
    test_write_hot_row_per_namespace,
    test_untagged_write_raises_and_stores_nothing,
    test_idempotent_one_row_no_dup_tags_no_access_bump,
    test_tags_populated_and_queryable,
    test_tier_state_hot_with_access_telemetry,
    test_no_update_delete_path_to_memory_tables,
    test_flag_off_is_fully_inert,
    test_query_per_tier_return_shapes,
    test_query_is_indexed_not_a_scan,
    test_query_filters_level_and_agent,
    test_empty_store_returns_empty_no_error,
    test_rehydration_seam_reached_on_cold_hit,
    test_is_known_dead_end_untouched_and_callable,
    test_memory_query_absent_from_trainer_and_watcher_globs,
    test_full_independence_suite_still_5_of_5,
]


if __name__ == "__main__":
    print("=== R11-B1 memory_query tests ===")
    for t in _TESTS:
        t()
    print(f"=== {len(_TESTS)}/{len(_TESTS)} PASS ===")
