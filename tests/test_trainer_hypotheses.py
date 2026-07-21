#!/usr/bin/env python3
"""Tests for the R9-B3 standing-hypothesis mechanism (trainer_hypotheses.py).

Proves the T6 requirements:
  * ACCUMULATE, NOT ONE-SHOT — re-evaluating at two levels leaves TWO rows, not
    one overwritten; a within-level re-eval UPDATES that level's row only.
  * hypothesis_status reads ACROSS all levels (never just the latest).
  * ADDITIVE — a prior level's row is never DELETEd/overwritten when a new level
    is added (byte-stable across the second evaluation); the module's code carries
    no DELETE/DROP/TRUNCATE.
  * The seed hypotheses (autocorrelation, aggression-sizing) EXIST and are testable.
  * Edge: no prior evidence -> fresh 'open'/0 levels; a hypothesis open at level 0.
  * compass_blend_delta gives the seed evaluator a real signed delta.

Dependency-free: ``python3 tests/test_trainer_hypotheses.py``. pytest-compatible.
Every test runs against a THROWAWAY trainer.db (the real ledger is never touched).
"""
import io
import os
import sys
import tempfile
import tokenize

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

import trainer_hypotheses as th  # noqa: E402
from lib.trainer_db import get_connection  # noqa: E402

_MODULE = os.path.join(_REPO, "trainer_hypotheses.py")


def _fresh_db():
    d = tempfile.mkdtemp()
    return os.path.join(d, "trainer.db")


def _count_rows(db, hyp_id):
    conn = get_connection(db)
    try:
        return conn.execute(
            "SELECT COUNT(*) FROM standing_hypotheses WHERE hypothesis_id=?",
            (hyp_id,)).fetchone()[0]
    finally:
        conn.close()


# ── 1. seeds exist + are testable ──
def test_seed_hypotheses_exist_and_testable():
    ids = set(th.SEED_HYPOTHESES)
    assert {"autocorr_helps", "aggression_sizing_helps"} <= ids, ids
    assert th.SEED_HYPOTHESES["autocorr_helps"].domain == "signal"
    assert th.SEED_HYPOTHESES["aggression_sizing_helps"].domain == "sizing"
    assert len(th.open_hypotheses()) >= 2
    db = _fresh_db()
    # testable: evaluate a seed with only its id (domain/claim from the registry)
    row = th.evaluate_at_level("aggression_sizing_helps", 0, delta=0.2, n_obs=30, db_path=db)
    assert row["domain"] == "sizing" and row["level_id"] == 0
    print("  seeds exist (autocorr + aggression-sizing) and are testable: PASS")


# ── 2. re-evaluate at two levels -> TWO rows (accumulate, not one-shot) ──
def test_two_levels_two_rows_not_overwritten():
    db = _fresh_db()
    th.evaluate_at_level("autocorr_helps", 0, delta=0.12, n_obs=40, db_path=db)
    assert _count_rows(db, "autocorr_helps") == 1
    th.evaluate_at_level("autocorr_helps", 1, delta=-0.03, n_obs=55, db_path=db)
    assert _count_rows(db, "autocorr_helps") == 2, "level N+1 must APPEND, not overwrite"
    st = th.hypothesis_status("autocorr_helps", db_path=db)
    assert st["levels_tested"] == 2
    assert {p["level_id"] for p in st["per_level"]} == {0, 1}
    print("  two levels -> TWO rows (accumulate, not one-shot): PASS")


# ── 3. hypothesis_status reads ACROSS levels, not just the latest ──
def test_status_reads_across_levels():
    db = _fresh_db()
    th.evaluate_at_level("autocorr_helps", 0, delta=0.10, n_obs=20, db_path=db)
    th.evaluate_at_level("autocorr_helps", 1, delta=0.05, n_obs=30, db_path=db)
    th.evaluate_at_level("autocorr_helps", 2, delta=0.08, n_obs=25, db_path=db)
    st = th.hypothesis_status("autocorr_helps", db_path=db)
    # net + n_obs accumulate across ALL three levels (not just level 2)
    assert st["levels_tested"] == 3
    assert st["total_n_obs"] == 75, st
    assert abs(st["net_evidence"] - 0.23) < 1e-9, st
    assert st["tally"]["for"] == 3
    assert st["status"] == "supported"  # 3 for, net>0, >= MIN_LEVELS
    print("  hypothesis_status accumulates across levels (supported: 3 for, net 0.23): PASS")


# ── 4. ADDITIVE: prior level's row never deleted/overwritten when a new level lands ──
def test_prior_level_row_inviolable():
    db = _fresh_db()
    r0 = th.evaluate_at_level("autocorr_helps", 0, delta=0.12, n_obs=40, db_path=db)
    snap0 = (r0["evidence"], r0["n_obs"], r0["status"])
    # add a NEW level -> level 0 row must be byte-stable (except nothing about it changes)
    th.evaluate_at_level("autocorr_helps", 1, delta=0.99, n_obs=99, db_path=db)
    conn = get_connection(db)
    try:
        row0 = conn.execute(
            "SELECT evidence_json, n_obs, status FROM standing_hypotheses "
            "WHERE hypothesis_id=? AND level_id=0", ("autocorr_helps",)).fetchone()
    finally:
        conn.close()
    import json
    assert (json.loads(row0[0]), row0[1], row0[2]) == snap0, "prior level 0 row mutated!"
    # module code carries no destructive SQL
    toks = " ".join(t.string.upper() for t in tokenize.generate_tokens(
        io.StringIO(open(_MODULE).read()).readline)
        if t.type not in (tokenize.STRING, tokenize.COMMENT) and t.string.strip())
    for bad in ("DELETE", "DROP", "TRUNCATE"):
        assert bad not in toks, f"destructive SQL keyword '{bad}' in code"
    print("  prior level row inviolable + no DELETE/DROP/TRUNCATE in code: PASS")


# ── 5. within-level re-eval UPDATES that row only (n_obs grows, no new row) ──
def test_within_level_update_not_append():
    db = _fresh_db()
    th.evaluate_at_level("autocorr_helps", 0, delta=0.05, n_obs=10, db_path=db)
    assert _count_rows(db, "autocorr_helps") == 1
    r = th.evaluate_at_level("autocorr_helps", 0, delta=0.09, n_obs=25, db_path=db)
    assert _count_rows(db, "autocorr_helps") == 1, "same level must UPDATE, not append"
    assert r["n_obs"] == 25 and abs(r["evidence"]["delta"] - 0.09) < 1e-9
    print("  within-level re-eval UPDATEs the level's row (no new row): PASS")


# ── 6. edge: no prior evidence -> fresh; open at level 0 ──
def test_no_prior_and_level_zero_edges():
    db = _fresh_db()
    st = th.hypothesis_status("never_seen", db_path=db)
    assert st["levels_tested"] == 0 and st["status"] == "open" and st["per_level"] == []
    # a hypothesis open at level 0 with level-0 data -> single level -> still 'open'
    th.evaluate_at_level("autocorr_helps", 0, delta=0.5, n_obs=99, db_path=db)
    st0 = th.hypothesis_status("autocorr_helps", db_path=db)
    assert st0["levels_tested"] == 1 and st0["status"] == "open", st0  # < MIN_LEVELS
    print("  no-prior -> fresh 'open'; single level 0 stays 'open' (< MIN_LEVELS): PASS")


# ── 7. compass_blend_delta gives the seed evaluator a real signed delta ──
def test_compass_blend_delta():
    # with-feature survives with a higher blend; without dies at the wall (score 0)
    d = th.compass_blend_delta({"survived": True, "blend_score": 0.8},
                               {"survived": False})
    assert abs(d - 0.8) < 1e-9, d
    # both survive; delta is the blend difference
    d2 = th.compass_blend_delta({"survived": True, "blend_score": 0.5},
                                {"survived": True, "blend_score": 0.7})
    assert abs(d2 - (-0.2)) < 1e-9, d2
    print("  compass_blend_delta signed with-vs-without (wall->0.0): PASS")


if __name__ == "__main__":
    fails = 0
    for name in sorted(n for n in dir() if n.startswith("test_")):
        try:
            globals()[name]()
        except AssertionError as e:
            fails += 1
            print(f"  {name}: FAIL — {e}")
        except Exception as e:  # noqa: BLE001
            fails += 1
            print(f"  {name}: ERROR — {type(e).__name__}: {e}")
    print(f"\n{'ALL PASS' if not fails else f'{fails} FAILED'}")
    sys.exit(1 if fails else 0)
