#!/usr/bin/env python3
"""Tests for the R10-B1 watcher review-brain — budget line + the five mechanical checks.

Proves the Phase-1 verification gate:
  * can_afford returns False at the boundary AND fails CLOSED on an unreadable ledger.
  * record_spend upserts today's row atomically (increment, not duplicate).
  * each of the five mechanical checks FIRES on a synthetic violation AND returns
    not_applicable on an absent/empty source (both paths per check) — the empty-stream
    mandate proven.
  * no check raises on a missing table ("no such table" -> not_applicable, not a crash).

Mirrors the independence test's convention: a ``_TESTS`` list + a ``__main__`` runner
(pytest is not installed on this box). Uses THROWAWAY dbs via explicit ``db_path`` /
injected raw connections — the real trainer.db / watcher.db are NEVER touched.
"""
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 🚨 CONTAINMENT BELT (B7) — MODULE LEVEL, BEFORE the production imports below.
# This file drives ``watcher_review`` against throwaway dbs, but the review-brain
# reads BOTH stores and a zero-arg ``get_connection()`` on either would open a LIVE
# <repo>/data/*.db. B11's ``_under_test()`` guard covers that only while the entry
# point is named ``test_*``; this redirect holds regardless of argv[0].
# Module level on purpose: a test added ABOVE a harness would otherwise run first.
import _containment  # noqa: E402

_containment.activate()

import json  # noqa: E402
import watcher_budget  # noqa: E402
import watcher_review as wr  # noqa: E402
from lib import trainer_db  # noqa: E402

_REPLICA = "/home/ghost/trevor-replica/trevor.db"  # the 0444 refused path (guard trigger)


def _tmp_db(prefix: str) -> str:
    return os.path.join(tempfile.mkdtemp(prefix=prefix), "throwaway.db")


def _raw_empty_conn() -> sqlite3.Connection:
    """A raw sqlite3 connection to a fresh file with NO trainer schema — every trainer
    table is genuinely ABSENT (the pre-cutover 'no such table' state we must survive)."""
    return sqlite3.connect(_tmp_db("watcher_review_raw_"))


def _seed_trainer_db(db_path: str, *, rejections=(), budget=None) -> None:
    """Seed a throwaway trainer.db (schema auto-created by get_connection) with rejection_log
    rows and/or a trainer_api_budget row."""
    conn = trainer_db.get_connection(db_path)
    try:
        with conn:
            for r in rejections:
                conn.execute(
                    "INSERT INTO rejection_log "
                    "(arm_hash, level_id, config_json, failing_gates_json, rationale_text, "
                    " p_value, dsr, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (r["arm_hash"], r["level_id"], r.get("config_json", "{}"),
                     r.get("failing_gates_json"), r.get("rationale_text"),
                     r.get("p_value"), r.get("dsr"), r["ts"]),
                )
            if budget is not None:
                conn.execute(
                    "INSERT INTO trainer_api_budget (date, spend_usd, call_count, updated_at) "
                    "VALUES (?, ?, ?, ?)",
                    (budget["date"], budget["spend_usd"], budget.get("call_count", 1),
                     budget.get("updated_at", "2026-07-22T00:00:00Z")),
                )
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
#  Budget line (watcher_budget) — HARD gate + fails-closed + atomic upsert
# ═══════════════════════════════════════════════════════════════════════════════
def test_can_afford_boundary():
    db = _tmp_db("wb_boundary_")
    # daily_budget default $0.15. Exactly-at-budget is affordable (<= within).
    assert watcher_budget.can_afford(0.15, db_path=db) is True, "0.15 <= 0.15 should be affordable"
    assert watcher_budget.can_afford(0.1501, db_path=db) is False, "0.1501 > 0.15 must be refused"
    # spend up to the ceiling, then the gate must close.
    watcher_budget.record_spend(0.15, db_path=db)
    assert watcher_budget.budget_remaining(db_path=db) == 0.0
    assert watcher_budget.can_afford(0.001, db_path=db) is False, "gate must close at the boundary"
    print("  can_afford boundary (0.15 ok / 0.1501 refused / closes at ceiling): PASS")


def test_can_afford_fails_closed():
    # An unreadable ledger must return False (never authorize spend). The refused 0444
    # replica path makes get_connection raise -> today_spend raises -> can_afford -> False.
    assert watcher_budget.can_afford(0.001, db_path=_REPLICA) is False, \
        "unreadable ledger must FAIL CLOSED (return False), never authorize spend"
    print("  can_afford FAILS CLOSED on an unreadable ledger: PASS")


def test_record_spend_atomic_upsert():
    db = _tmp_db("wb_upsert_")
    assert watcher_budget.record_spend(0.05, db_path=db) == 0.05
    assert watcher_budget.record_spend(0.03, db_path=db) == 0.08, "same-day row must INCREMENT"
    st = watcher_budget.budget_status(db_path=db)
    assert st["call_count"] == 2, "call_count must tick per spend (one row, not two)"
    assert abs(st["spend_usd"] - 0.08) < 1e-9
    # negative cost floored to 0 (a spend is never a credit).
    assert watcher_budget.record_spend(-1.0, db_path=db) == 0.08
    print("  record_spend atomic upsert (increment, call_count, neg floored): PASS")


# ═══════════════════════════════════════════════════════════════════════════════
#  Mechanical checks — FIRES on a synthetic violation + not_applicable on absent/empty
# ═══════════════════════════════════════════════════════════════════════════════
def test_known_dead_end_fires_and_not_applicable():
    db = _tmp_db("wr_deadend_")
    _seed_trainer_db(db, rejections=[
        {"arm_hash": "ARM1", "level_id": 0, "ts": "2026-07-22T00:00:00Z"},  # id=1 (the prior)
    ])
    # FIRES: a VERDICT re-verdicting ARM1 at level 0 (its own row_id=2) finds prior id=1.
    fired = wr.check_known_dead_end_repropose(
        {"kind": wr.VERDICT, "arm_hash": "ARM1", "level_id": 0, "row_id": 2}, db_path=db)
    assert fired["fired"] is True and fired["severity"] == wr.SEV_PROBLEM, fired
    assert fired["evidence"]["prior_rejection_id"] == 1, fired
    # CLEAN: a fresh arm has no prior rejection -> applicable, not fired.
    clean = wr.check_known_dead_end_repropose(
        {"kind": wr.VERDICT, "arm_hash": "ARM_NEW", "level_id": 0, "row_id": 5}, db_path=db)
    assert clean["applicable"] is True and clean["fired"] is False, clean
    # not_applicable (absent source): raw conn with NO rejection_log table.
    raw = _raw_empty_conn()
    try:
        na = wr.check_known_dead_end_repropose(
            {"kind": wr.VERDICT, "arm_hash": "ARM1", "level_id": 0, "row_id": 2}, conn=raw)
    finally:
        raw.close()
    assert na["applicable"] is False and na["fired"] is False, na
    assert "absent" in na["evidence"]["reason"], na
    # not_applicable (empty decision shape): no arm_hash.
    na2 = wr.check_known_dead_end_repropose({"kind": wr.VERDICT, "level_id": 0}, db_path=db)
    assert na2["applicable"] is False and na2["fired"] is False, na2
    print("  known_dead_end: fires on re-propose / clean on fresh / n.a. on absent+empty: PASS")


def test_budget_overrun_fires_and_not_applicable():
    db = _tmp_db("wr_budget_")
    # FIRES: trainer spent $0.30 on 2026-07-22 > its $0.25 ceiling.
    _seed_trainer_db(db, budget={"date": "2026-07-22", "spend_usd": 0.30})
    fired = wr.check_budget_overrun({"kind": wr.VERDICT, "ts": "2026-07-22T12:00:00Z"}, db_path=db)
    assert fired["fired"] is True and fired["severity"] == wr.SEV_PROBLEM, fired
    assert fired["evidence"]["spend_usd"] == 0.30, fired
    # CLEAN: a different day with no row -> spend 0 -> not fired.
    clean = wr.check_budget_overrun({"kind": wr.VERDICT, "ts": "2026-07-21T12:00:00Z"}, db_path=db)
    assert clean["applicable"] is True and clean["fired"] is False, clean
    # not_applicable (absent source): raw conn with NO trainer_api_budget table.
    raw = _raw_empty_conn()
    try:
        na = wr.check_budget_overrun({"kind": wr.VERDICT, "ts": "2026-07-22T12:00:00Z"}, conn=raw)
    finally:
        raw.close()
    assert na["applicable"] is False and na["fired"] is False, na
    # not_applicable (empty decision shape): no ts.
    na2 = wr.check_budget_overrun({"kind": wr.VERDICT}, db_path=db)
    assert na2["applicable"] is False and na2["fired"] is False, na2
    print("  budget_overrun: fires over ceiling / clean under / n.a. on absent+empty: PASS")


def test_skipped_gate_fires_and_not_applicable():
    # FIRES: a rejection citing NO failing gate.
    f1 = wr.check_skipped_gate({"kind": wr.VERDICT, "failing_gates_json": "[]"})
    assert f1["fired"] is True and f1["severity"] == wr.SEV_PROBLEM, f1
    # FIRES: a promotion surfaced without a passing gate.
    f2 = wr.check_skipped_gate({"kind": wr.PROMOTION, "gate_passed": False})
    assert f2["fired"] is True, f2
    # CLEAN: a rejection citing a real gate / a promotion that passed.
    assert wr.check_skipped_gate({"kind": wr.VERDICT, "failing_gates_json": '["net_of_cost"]'})["fired"] is False
    assert wr.check_skipped_gate({"kind": wr.PROMOTION, "gate_passed": True})["fired"] is False
    # not_applicable (empty source): no gate fields.
    na1 = wr.check_skipped_gate({"kind": wr.VERDICT})
    na2 = wr.check_skipped_gate({"kind": wr.PROMOTION})
    assert na1["applicable"] is False and na2["applicable"] is False, (na1, na2)
    print("  skipped_gate: fires (no-gate reject + gateless promo) / clean / n.a. on empty: PASS")


def test_inconsistent_log_fires_and_not_applicable():
    # FIRES: a verdict row missing arm_hash + a config that isn't valid JSON.
    bad = wr.check_inconsistent_log(
        {"kind": wr.VERDICT, "level_id": 0, "config_json": "{not json", "ts": "2026-07-22T00:00:00Z"})
    assert bad["fired"] is True and bad["severity"] == wr.SEV_PROBLEM, bad
    assert "missing arm_hash" in bad["evidence"]["problems"], bad
    assert "config_json is not valid JSON" in bad["evidence"]["problems"], bad
    # CLEAN: a well-formed verdict row.
    ok = wr.check_inconsistent_log({
        "kind": wr.VERDICT, "arm_hash": "A", "level_id": 0,
        "config_json": json.dumps({"exit": 1}), "ts": "2026-07-22T00:00:00Z"})
    assert ok["applicable"] is True and ok["fired"] is False, ok
    # not_applicable (empty source): an empty decision.
    na = wr.check_inconsistent_log({})
    assert na["applicable"] is False and na["fired"] is False, na
    print("  inconsistent_log: fires on malformed row / clean on well-formed / n.a. on empty: PASS")


def test_axes_off_surface_fires_and_not_applicable():
    # FIRES: a config carrying an axis not on the sampleable surface.
    fired = wr.check_axes_off_surface({"config_json": json.dumps({"exit": 0.5, "BOGUS_AXIS": 9})})
    assert fired["fired"] is True and fired["severity"] == wr.SEV_PROBLEM, fired
    assert fired["evidence"]["off_surface_axes"] == ["BOGUS_AXIS"], fired
    # CLEAN: a config whose axes are all on the surface.
    clean = wr.check_axes_off_surface({"config_json": json.dumps({"exit": 0.5, "leverage": 2})})
    assert clean["applicable"] is True and clean["fired"] is False, clean
    # not_applicable (empty source): no config_json.
    na = wr.check_axes_off_surface({"kind": wr.VERDICT})
    assert na["applicable"] is False and na["fired"] is False, na
    print("  axes_off_surface: fires on off-surface axis / clean on-surface / n.a. on empty: PASS")


def test_run_mechanical_never_raises_on_unreadable_db():
    # An unreadable trainer.db (the refused 0444 replica) must NOT crash run_mechanical —
    # the two db checks degrade to not_applicable; the three pure checks still run.
    findings = wr.run_mechanical(
        {"kind": wr.VERDICT, "arm_hash": "A", "level_id": 0,
         "config_json": json.dumps({"exit": 1}), "failing_gates_json": '["net"]',
         "ts": "2026-07-22T00:00:00Z", "row_id": 1},
        db_path=_REPLICA)
    assert len(findings) == 5, findings
    by = {f["check"]: f for f in findings}
    assert by["known_dead_end_repropose"]["applicable"] is False, by["known_dead_end_repropose"]
    assert by["budget_overrun"]["applicable"] is False, by["budget_overrun"]
    # the pure checks are unaffected by the unreadable db.
    assert by["skipped_gate"]["applicable"] is True
    assert by["axes_off_surface"]["applicable"] is True
    assert wr.has_problem(findings) is False, "a clean-but-degraded decision must not surface"
    print("  run_mechanical never raises on an unreadable db (db checks -> n.a.): PASS")


def test_has_problem_and_max_severity():
    off = wr.run_mechanical(
        {"kind": wr.VERDICT, "arm_hash": "A", "level_id": 0,
         "config_json": json.dumps({"BOGUS_AXIS": 1}), "failing_gates_json": "[]",
         "ts": "2026-07-22T00:00:00Z", "row_id": 1})
    assert wr.has_problem(off) is True, "off-surface + no-gate must surface a problem"
    assert wr.max_severity(off) == wr.SEV_PROBLEM, off
    print("  has_problem / max_severity over a firing decision: PASS")


# ═══════════════════════════════════════════════════════════════════════════════
#  Phase 2 — LLM judgment layer (no-flip, budget-gated, template degradation) + store
# ═══════════════════════════════════════════════════════════════════════════════
class _CountingStub:
    """A stub LLM call (system, user, max_tokens) -> (text, cost) that counts invocations —
    proves the LLM never runs on a clean decision / when the budget is exhausted."""
    def __init__(self, text, cost=0.001):
        self.text = text
        self.cost = cost
        self.calls = 0

    def __call__(self, system, user, max_tokens):
        self.calls += 1
        return (self.text, self.cost)


class _judge_env:
    """Context manager: turn WATCHER_JUDGE_ENABLED + a dummy key ON, restore on exit."""
    _KEYS = ("WATCHER_JUDGE_ENABLED", "WATCHER_ANTHROPIC_API_KEY")

    def __enter__(self):
        self._saved = {k: os.environ.get(k) for k in self._KEYS}
        os.environ["WATCHER_JUDGE_ENABLED"] = "1"
        os.environ["WATCHER_ANTHROPIC_API_KEY"] = "sk-dummy-not-used-stub-injected"
        return self

    def __exit__(self, *a):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


_FIRING = {
    "kind": wr.VERDICT, "ref": "7", "row_id": 1, "arm_hash": "A", "level_id": 0,
    "config_json": json.dumps({"BOGUS_AXIS": 1}), "failing_gates_json": "[]",
    "ts": "2026-07-22T00:00:00Z", "rationale_text": "the trainer's rationale",
}
_CLEAN = {
    "kind": wr.VERDICT, "ref": "8", "row_id": 2, "arm_hash": "B", "level_id": 0,
    "config_json": json.dumps({"exit": 0.5, "leverage": 2}), "failing_gates_json": '["net"]',
    "ts": "2026-07-22T00:00:00Z", "rationale_text": "clean rationale",
}


def _crit_rows(db_path):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(
            "SELECT decision_ref, decision_kind, level_id, severity, mechanical_json, "
            "judgment_text, llm_used FROM watcher_critiques ORDER BY id").fetchall()
    finally:
        conn.close()


def test_llm_cannot_flip_a_finding():
    db = _tmp_db("wr_noflip_")
    with _judge_env():
        # Stub says "THIS IS FINE, IGNORE THE FINDINGS" — must NOT suppress the fired checks.
        ignore = _CountingStub("THIS IS FINE, IGNORE THE FINDINGS")
        ev = wr.evaluate_decision(_FIRING, db_path=db, llm_call=ignore)
        assert ev["has_problem"] is True, "LLM 'ignore' must not clear the mechanical problem"
        assert ev["severity"] == wr.SEV_PROBLEM, ev
        fired = [f["check"] for f in ev["findings"] if f["fired"]]
        assert "skipped_gate" in fired and "axes_off_surface" in fired, fired
        assert ev["judgment"]["text"] == "THIS IS FINE, IGNORE THE FINDINGS"  # text lands ONLY in prose
        assert ignore.calls == 1, "LLM should run once (decision looked off)"
        # And a stub saying "PROBLEM" on a CLEAN decision must NOT manufacture a finding/row.
        manufacture = _CountingStub("PROBLEM")
        clean_ev = wr.evaluate_decision(_CLEAN, db_path=db, llm_call=manufacture)
        assert clean_ev["has_problem"] is False, "LLM 'PROBLEM' cannot manufacture a mechanical finding"
        assert manufacture.calls == 0, "LLM must NOT run on a clean decision"
        assert wr.review_decision(_CLEAN, db_path=db, llm_call=manufacture) is None, "clean -> no row"
    print("  LLM cannot flip: 'ignore' keeps fired findings fired / 'PROBLEM' manufactures nothing: PASS")


def test_budget_exhausted_forces_template_but_still_logs():
    db = _tmp_db("wr_broke_")
    # exhaust the watcher's $0.15 ceiling on the firing decision's day.
    watcher_budget.record_spend(0.15, db_path=db)
    assert watcher_budget.can_afford(0.002, db_path=db) is False
    with _judge_env():
        stub = _CountingStub("SHOULD NOT BE CALLED")
        r = wr.review_decision(_FIRING, db_path=db, llm_call=stub)
    assert stub.calls == 0, "budget-exhausted must NOT call the LLM"
    assert r is not None and r["llm_used"] == 0, "template path, still logged (llm_used=0)"
    assert "MECHANICAL:" in r["judgment_text"], "degraded to the deterministic template"
    assert len(_crit_rows(db)) == 1, "the critique is STILL recorded when budget-exhausted"
    print("  budget exhausted -> template judgment, LLM not called, critique STILL logged: PASS")


def test_clean_decision_spends_nothing_and_writes_no_row():
    db = _tmp_db("wr_clean_")
    with _judge_env():
        stub = _CountingStub("PROBLEM")
        r = wr.review_decision(_CLEAN, db_path=db, llm_call=stub)
    assert r is None, "a clean decision produces NO critique row"
    assert stub.calls == 0, "a clean decision must spend NOTHING (LLM never called)"
    assert watcher_budget.today_spend(db_path=db) == 0.0, "no spend recorded on a clean decision"
    assert _crit_rows(db) == [], "no watcher_critiques row for a clean decision"
    print("  clean decision: spends nothing, writes no row (critique-only-problems): PASS")


def test_llm_path_records_spend_and_uses_prose():
    db = _tmp_db("wr_llm_")
    with _judge_env():
        stub = _CountingStub("That verdict looks rash — thin margin, re-proposed a dead-end.", cost=0.0012)
        r = wr.review_decision(_FIRING, db_path=db, llm_call=stub)
    assert stub.calls == 1, "the LLM runs once on a firing decision"
    assert r["llm_used"] == 1, r
    assert r["judgment_text"].startswith("That verdict looks rash"), r
    assert abs(watcher_budget.today_spend(db_path=db) - 0.0012) < 1e-9, "ACTUAL cost recorded"
    rows = _crit_rows(db)
    assert len(rows) == 1 and rows[0][6] == 1, "llm_used=1 persisted"
    print("  LLM path: runs once, records ACTUAL spend, prose persisted (llm_used=1): PASS")


def test_critique_lands_r11_compatible_shape():
    db = _tmp_db("wr_r11_")
    # flag OFF -> template path (llm_used=0), still a full critique row.
    wr.review_decision(_FIRING, db_path=db)
    rows = _crit_rows(db)
    assert len(rows) == 1, rows
    ref, kind, level, sev, mech_json, _jtext, llm_used = rows[0]
    assert ref == "7" and kind == wr.VERDICT and level == 0 and sev == wr.SEV_PROBLEM
    assert llm_used == 0
    mech = json.loads(mech_json)
    assert set(mech.keys()) == {"checks", "all", "memory"}, mech.keys()
    assert len(mech["checks"]) == 2 and len(mech["all"]) == 5
    mem = mech["memory"]
    for k in ("subjects", "action", "because", "level", "outcome", "confidence", "prose"):
        assert k in mem, f"R11 hook missing {k}"
    assert mem["action"] == wr.VERDICT and mem["outcome"] == wr.SEV_PROBLEM
    assert set(mem["because"]) == {"skipped_gate", "axes_off_surface"}, mem["because"]
    assert mem["confidence"] == "mechanical", mem
    print("  critique row carries the R11-compatible memory hook (no new column/migration): PASS")


def test_no_nudge_write_surface_grep_asserts():
    """No-nudge grep guard: the watcher writes ONLY watcher.db (never a trainer table) and
    imports no trainer WRITER. The auto-halt guarantee (denial 3) + the deeper no-write
    structure are proven STRUCTURALLY by the AST scanner in tests/test_watcher_independence.py
    (which correctly ignores docstring/comment prose — a naive substring grep would false-fire
    on this module's own docstrings that NAME the forbidden levers to say it avoids them)."""
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "watcher_review.py")).read()
    # (a) zero WRITES to any trainer table (SELECT-only on trainer.db). These strings never
    #     appear in prose, so a substring grep is safe here.
    for tbl in ("rejection_log", "bandit_posteriors", "trainer_api_budget",
                "standing_hypotheses", "compass_weights"):
        for verb in ("INSERT INTO " + tbl, "UPDATE " + tbl, "DELETE FROM " + tbl):
            assert verb not in src, f"watcher must never write trainer table: {verb}"
    # (b) the ONLY INSERT target is watcher_critiques (watcher.db); Phase 3 adds watcher_cursor.
    import re as _re
    inserts = _re.findall(r"INSERT INTO (\w+)", src)
    assert set(inserts) <= {"watcher_critiques", "watcher_cursor"}, inserts
    # (c) no trainer WRITER import (trainer_reasoning owns log_rejection) — read-surface only.
    #     Both import forms; a docstring *mention* of the mirrored call shape is allowed.
    assert "import trainer_reasoning" not in src, "must not import the trainer's writer (module form)"
    assert "from trainer_reasoning" not in src, "must not import the trainer's writer (from form)"
    print("  no-nudge grep: writes only watcher_critiques, no trainer-table write, no writer import: PASS")


# ═══════════════════════════════════════════════════════════════════════════════
#  Phase 3 — poll triggers (exactly-once + crash-re-review) + empty stream + flag-off
# ═══════════════════════════════════════════════════════════════════════════════
def _count_crit(db_path):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute("SELECT COUNT(*) FROM watcher_critiques").fetchone()[0]
    finally:
        conn.close()


def _seed_replica_promotions(path, rows):
    conn = sqlite3.connect(path)
    try:
        with conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS promotion_candidates "
                "(id INTEGER PRIMARY KEY AUTOINCREMENT, shadow_id TEXT, level_id INTEGER, "
                " surfaced_at TEXT, gate_passed INTEGER)")
            for r in rows:
                conn.execute(
                    "INSERT INTO promotion_candidates (shadow_id, level_id, surfaced_at, gate_passed) "
                    "VALUES (?, ?, ?, ?)",
                    (r["shadow_id"], r["level_id"], r["surfaced_at"], r["gate_passed"]))
    finally:
        conn.close()


def test_verdict_trigger_exactly_once_and_crash_rereview():
    db = _tmp_db("wr_v3_verdict_")
    _seed_trainer_db(db, rejections=[
        {"arm_hash": "AX", "level_id": 0, "config_json": json.dumps({"BOGUS_AXIS": 1}),
         "failing_gates_json": "[]", "ts": "2026-07-22T00:00:00Z"},  # a violation -> fires
    ])
    # normal: reviewed once, cursor advances to id=1, one critique.
    r = wr.poll_verdicts(db_path=db)
    assert len(r) == 1 and r[0]["decision_ref"] == "1", r
    assert wr.get_cursor(wr.CURSOR_VERDICT, db_path=db) == 1
    assert _count_crit(db) == 1
    # exactly-once: a second poll sees nothing (cursor past id=1).
    assert wr.poll_verdicts(db_path=db) == []

    # crash-re-review: reset the cursor to 0, make advance_cursor raise INSIDE the atomic
    # block -> the transaction rolls back (NO new critique, cursor stays 0) -> re-review.
    conn = sqlite3.connect(db)
    with conn:
        conn.execute("UPDATE watcher_cursor SET position=0 WHERE name=?", (wr.CURSOR_VERDICT,))
    conn.close()
    orig = wr.advance_cursor
    wr.advance_cursor = lambda c, n, p: (_ for _ in ()).throw(RuntimeError("simulated crash"))
    try:
        try:
            wr.poll_verdicts(db_path=db)  # raises inside the atomic transaction
        except RuntimeError:
            pass
    finally:
        wr.advance_cursor = orig
    # ATOMICITY: the failed transaction wrote NO new critique and left the cursor at 0.
    assert _count_crit(db) == 1, "the crash's critique INSERT must roll back with the cursor"
    assert wr.get_cursor(wr.CURSOR_VERDICT, db_path=db) == 0, "cursor must NOT advance on a crash"
    # recovery: re-review succeeds -> critique #2 + cursor advances (re-review, not skip).
    r2 = wr.poll_verdicts(db_path=db)
    assert len(r2) == 1 and _count_crit(db) == 2, "a crashed row is RE-reviewed, never skipped"
    assert wr.get_cursor(wr.CURSOR_VERDICT, db_path=db) == 1
    print("  verdict trigger: exactly-once + crash rolls back critique+cursor together -> re-review: PASS")


def test_promotion_trigger_empty_stream_and_review():
    db = _tmp_db("wr_v3_promo_")
    # empty: a replica with NO promotion_candidates -> [] (no such table, expected pre-cutover).
    empty_replica = _tmp_db("wr_v3_replica_empty_")
    sqlite3.connect(empty_replica).close()  # a real db file, but no promotion_candidates
    assert wr.poll_promotions(db_path=db, replica_path=empty_replica) == []
    assert _count_crit_or_zero(db) == 0
    # review: seed a promotion surfaced WITHOUT a passing gate (gate_passed=0) -> skipped_gate.
    replica = _tmp_db("wr_v3_replica_")
    _seed_replica_promotions(replica, [
        {"shadow_id": "shadow.abc", "level_id": 0, "surfaced_at": "2026-07-22T00:00:00Z", "gate_passed": 0},
    ])
    r = wr.poll_promotions(db_path=db, replica_path=replica)
    assert len(r) == 1 and r[0]["kind"] == wr.PROMOTION, r
    assert "skipped_gate" in r[0]["fired"], r
    # exactly-once: watermark advanced -> second poll empty.
    assert wr.poll_promotions(db_path=db, replica_path=replica) == []
    print("  promotion trigger: empty replica -> [] / gateless surface fires skipped_gate / once: PASS")


def _count_crit_or_zero(db_path):
    try:
        return _count_crit(db_path)
    except sqlite3.OperationalError:
        return 0  # watcher_critiques not created yet (nothing was ever reviewed)


def test_level_trigger_dormant_detect_and_unreachable():
    db = _tmp_db("wr_v3_level_")
    # dormant: MAX(level)=0, cursor 0 -> no new level -> [].
    assert wr.poll_level_change(db_path=db, level_reader=lambda: 0) == []
    # VM unreachable: reader returns None -> [] (no change, no alarm).
    assert wr.poll_level_change(db_path=db, level_reader=lambda: None) == []
    # detect: level advances 0 -> 1. B1's checks are verdict/promotion-shaped, so a bare level
    # change yields NO critique, but the cursor still advances (level recorded, not re-reviewed).
    assert wr.poll_level_change(db_path=db, level_reader=lambda: 1) == []
    assert wr.get_cursor(wr.CURSOR_LEVEL, db_path=db) == 1, "level cursor must advance on detect"
    assert wr.poll_level_change(db_path=db, level_reader=lambda: 1) == [], "1 <= 1 -> no re-detect"
    # a further advance is detected once.
    assert wr.poll_level_change(db_path=db, level_reader=lambda: 2) == []
    assert wr.get_cursor(wr.CURSOR_LEVEL, db_path=db) == 2
    print("  level trigger: dormant@0 / None unreachable / detects new level + advances cursor: PASS")


def test_empty_stream_no_alarm_all_triggers():
    db = _tmp_db("wr_v3_empty_")
    empty_replica = _tmp_db("wr_v3_empty_replica_")
    sqlite3.connect(empty_replica).close()
    os.environ["WATCHER_REVIEW_ENABLED"] = "1"
    try:
        cyc = wr.run_review_cycle(db_path=db, replica_path=empty_replica, level_reader=lambda: 0)
    finally:
        os.environ.pop("WATCHER_REVIEW_ENABLED", None)
    assert cyc["enabled"] is True
    for k in ("verdict", "promotion", "level_change"):
        assert cyc[k] == [], f"{k} must be [] on the empty stream (no alarm): {cyc[k]}"
    assert _count_crit_or_zero(db) == 0, "empty stream produces NO critique row"
    print("  empty stream (0 rows / no promotion_candidates / level 0) -> no error, no critique: PASS")


def test_flag_off_fully_inert_no_writes():
    # flag OFF -> the cycle returns enabled:False and NEVER opens a db (the throwaway path is
    # not even created — proof of zero reads/writes / full inertness).
    d = tempfile.mkdtemp(prefix="wr_v3_inert_")
    ghost_db = os.path.join(d, "never_created.db")
    os.environ.pop("WATCHER_REVIEW_ENABLED", None)
    cyc = wr.run_review_cycle(db_path=ghost_db, replica_path=ghost_db, level_reader=lambda: 9)
    assert cyc == {"enabled": False, "verdict": [], "promotion": [], "level_change": []}, cyc
    assert not os.path.exists(ghost_db), "flag OFF must not open/create any db (fully inert)"
    print("  flag OFF: cycle inert, no db opened/created, no LLM, no writes: PASS")


def test_import_is_inert_no_autostart():
    # Importing the module must start NOTHING (no daemon, no poll). run_forever is an EXPLICIT
    # entrypoint that must NOT be invoked at module scope. A source grep proves no module-level
    # call to run_forever / run_review_cycle (only their def + the __main__ smoke).
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "watcher_review.py")).read()
    import ast
    tree = ast.parse(src)
    top_calls = [n for n in tree.body if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)]
    assert top_calls == [], "no module-level call may run on import (no auto-start)"
    # the __main__ guard exists and run_forever is defined but not called at top level.
    assert '__name__ == "__main__"' in src or "__name__ == '__main__'" in src
    print("  import inert: zero module-level calls, run_forever never auto-starts: PASS")


_TESTS = [
    test_can_afford_boundary,
    test_can_afford_fails_closed,
    test_record_spend_atomic_upsert,
    test_known_dead_end_fires_and_not_applicable,
    test_budget_overrun_fires_and_not_applicable,
    test_skipped_gate_fires_and_not_applicable,
    test_inconsistent_log_fires_and_not_applicable,
    test_axes_off_surface_fires_and_not_applicable,
    test_run_mechanical_never_raises_on_unreadable_db,
    test_has_problem_and_max_severity,
    test_llm_cannot_flip_a_finding,
    test_budget_exhausted_forces_template_but_still_logs,
    test_clean_decision_spends_nothing_and_writes_no_row,
    test_llm_path_records_spend_and_uses_prose,
    test_critique_lands_r11_compatible_shape,
    test_no_nudge_write_surface_grep_asserts,
    test_verdict_trigger_exactly_once_and_crash_rereview,
    test_promotion_trigger_empty_stream_and_review,
    test_level_trigger_dormant_detect_and_unreachable,
    test_empty_stream_no_alarm_all_triggers,
    test_flag_off_fully_inert_no_writes,
    test_import_is_inert_no_autostart,
]


if __name__ == "__main__":
    print("=== watcher review-brain tests (R10-B1 Phase 1) ===")
    for t in _TESTS:
        t()
    print(f"=== {len(_TESTS)}/{len(_TESTS)} PASS ===")
