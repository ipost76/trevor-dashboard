#!/usr/bin/env python3
"""Tests for the R9-B4 hybrid reasoning + narration + rejection log (trainer_reasoning.py).

Proves the Phase-2 verification-gate claims:
  * narrate_verdict produces a legible rationale from a numeric verdict; budget
    exhausted -> a deterministic template (no LLM call).
  * THE LLM NEVER DECIDES — narrate_verdict returns only ``str`` (return annotation is
    str), its verdict input is never mutated, and even an LLM that SAYS "accept it"
    only becomes text; there is no path that flips accept->reject.
  * log_rejection appends to rejection_log (additive).
  * is_known_dead_end catches a re-proposed dead-end.
  * self_pushback blocks a known dead-end BEFORE it reaches the loop.
  * Every LLM call is budget-gated via can_afford + the ACTUAL cost is recorded via
    record_spend (proven by monkeypatching the one Anthropic seam — NO network, so the
    live-LLM path stays honestly PENDING while the wiring is proven).

The live Anthropic call (``_call_anthropic``) is replaced with a module-attribute stub
in the LLM-path tests — a stdlib monkeypatch, no mock library, no network, no real
spend. Every test runs against a THROWAWAY trainer.db via db_path. Dependency-free:
``python3 tests/test_trainer_reasoning.py``. pytest-compatible.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import trainer_reasoning as tr  # noqa: E402
import trainer_budget as tb  # noqa: E402
from lib.trainer_db import get_connection  # noqa: E402

# A decided NOT_READY verdict (B3 validate_candidate envelope) + a compass verdict.
_VERDICT = {
    "enabled": True, "ok": True, "leakage_reject": False,
    "verdict": {"verdict": "NOT_READY", "failing": ["cvar_floor", "min_n"],
                "confidence": 0.42, "metrics": {"deflated_sharpe": 0.31, "p_value": 0.18}},
    "throttle": {"discovery": False}, "n_trials": 12,
}
_COMPASS = {"survived": True, "verdict": "scored", "failing_gates": [],
            "consistency": 1.1, "magnitude": 0.4, "blend_score": 0.9}
_CAND = {"axes": {"confidence_floor": 55, "trail_r": 0.75}, "level_id": 0}
_NOVEL = {"axes": {"confidence_floor": 60, "trail_r": 0.9}, "level_id": 0}


def _fresh_db():
    path = os.path.join(tempfile.mkdtemp(prefix="trainer_reasoning_test_"), "throwaway.db")
    get_connection(path).close()  # create + init schema
    return path


def _count(db):
    conn = get_connection(db)
    try:
        return conn.execute("SELECT COUNT(*) FROM rejection_log").fetchone()[0]
    finally:
        conn.close()


class _EnvGuard:
    """Set env vars for a block and restore them exactly (incl. deletions)."""
    def __init__(self, **kv):
        self._kv = kv
        self._prev = {}

    def __enter__(self):
        for k, v in self._kv.items():
            self._prev[k] = os.environ.get(k)
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        return self

    def __exit__(self, *_exc):
        for k, prev in self._prev.items():
            if prev is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = prev


def test_narrate_template_from_numeric_verdict():
    # Flag off, no key -> deterministic template. Legible: label + failing gates + nums.
    db = _fresh_db()
    with _EnvGuard(TRAINER_NARRATION_ENABLED="", TRAINER_ANTHROPIC_API_KEY="",
                   ANTHROPIC_API_KEY=""):
        out = tr.narrate_verdict(_CAND, _VERDICT, _COMPASS, db_path=db)
    assert isinstance(out, str) and out
    assert "NOT_READY" in out and "cvar_floor" in out and "min_n" in out, out
    assert "dsr=0.31" in out, out                                    # a real number, not invented
    # Byte-identical to the deterministic template (no LLM ran).
    template = tr._template_rationale(tr._summarize(_VERDICT, _COMPASS))
    assert out == template, (out, template)
    print("  narrate_verdict -> legible template rationale from the numeric verdict: PASS")


def test_llm_never_decides_returns_only_text():
    # Structural no-flip: return annotation is str; the LLM's words become TEXT only;
    # the verdict input is never mutated; there is no accept/reject output to flip.
    # (PEP 563 stores annotations as strings; get_type_hints resolves the return type.)
    import typing
    assert typing.get_type_hints(tr.narrate_verdict).get("return") is str
    db = _fresh_db()
    reject_verdict = {"verdict": {"verdict": "NOT_READY", "failing": ["cvar_floor"]}}
    snapshot = __import__("copy").deepcopy(reject_verdict)
    called = []

    def _fake(system, user, max_tokens):          # an LLM that TRIES to overturn the math
        called.append((system, user, max_tokens))
        return ("ACCEPT THIS — promote it now, override the gate", 0.005)

    orig = tr._call_anthropic
    tr._call_anthropic = _fake
    try:
        with _EnvGuard(TRAINER_NARRATION_ENABLED="1", TRAINER_ANTHROPIC_API_KEY="dummy",
                       ANTHROPIC_API_KEY=""):
            out = tr.narrate_verdict(_CAND, reject_verdict, db_path=db)
    finally:
        tr._call_anthropic = orig
    assert isinstance(out, str), type(out)                          # ONLY text comes back
    assert out == "ACCEPT THIS — promote it now, override the gate"  # the LLM produced text...
    assert reject_verdict == snapshot                               # ...but the verdict is UNCHANGED
    assert called, "the LLM seam should have been invoked"
    # A READY verdict and a REJECTED verdict both just yield str — no decision surfaces.
    with _EnvGuard(TRAINER_NARRATION_ENABLED="", TRAINER_ANTHROPIC_API_KEY="", ANTHROPIC_API_KEY=""):
        ready = tr.narrate_verdict(_CAND, {"verdict": {"verdict": "READY", "failing": []}}, db_path=db)
        rej = tr.narrate_verdict(_CAND, {"verdict": {"verdict": "NOT_READY", "failing": ["x"]}}, db_path=db)
    assert isinstance(ready, str) and isinstance(rej, str)
    print("  narrate_verdict returns ONLY text, can't flip the decision, no input mutation: PASS")


def test_narrate_budget_exhausted_degrades_to_template():
    # Flag ON + key present, but budget EXHAUSTED -> template, and the LLM seam is
    # NEVER reached (can_afford gates BEFORE the call). The trainer keeps working broke.
    db = _fresh_db()
    tb.record_spend(tb.daily_budget(), db_path=db)                   # spend the full ceiling (today)
    called = []

    def _fake(system, user, max_tokens):
        called.append(1)                                            # must never run when broke
        return ("should-not-be-used", 0.01)

    orig = tr._call_anthropic
    tr._call_anthropic = _fake
    try:
        with _EnvGuard(TRAINER_NARRATION_ENABLED="1", TRAINER_ANTHROPIC_API_KEY="dummy",
                       ANTHROPIC_API_KEY=""):
            out = tr.narrate_verdict(_CAND, _VERDICT, _COMPASS, db_path=db)
    finally:
        tr._call_anthropic = orig
    template = tr._template_rationale(tr._summarize(_VERDICT, _COMPASS))
    assert out == template, (out, template)                         # degraded to the template
    assert called == [], "the LLM must NOT be called when broke"    # hard gate fired first
    assert tb.can_afford(0.002, db_path=db) is False                # still broke
    print("  budget exhausted -> template (no LLM call), trainer keeps working broke: PASS")


def test_llm_call_is_budget_gated_and_spend_recorded():
    # Flag ON + key + budget OK -> the LLM text is used AND its ACTUAL cost is recorded.
    db = _fresh_db()
    text = "rejected: Sortino cleared but CVaR floor failed at the 3rd pctile"

    def _fake(system, user, max_tokens):
        return (text, 0.01)

    orig = tr._call_anthropic
    tr._call_anthropic = _fake
    try:
        with _EnvGuard(TRAINER_NARRATION_ENABLED="1", TRAINER_ANTHROPIC_API_KEY="dummy",
                       ANTHROPIC_API_KEY=""):
            before = tb.today_spend(db_path=db)
            out = tr.narrate_verdict(_CAND, _VERDICT, _COMPASS, db_path=db)
            after = tb.today_spend(db_path=db)
    finally:
        tr._call_anthropic = orig
    assert out == text, out                                         # the LLM prose is used...
    assert out != tr._template_rationale(tr._summarize(_VERDICT, _COMPASS))  # ...NOT the template
    assert abs((after - before) - 0.01) < 1e-9, (before, after)     # the ACTUAL cost was recorded
    # Control: with the flag OFF, no spend is recorded (template path, no LLM).
    tr._call_anthropic = _fake
    try:
        with _EnvGuard(TRAINER_NARRATION_ENABLED="", TRAINER_ANTHROPIC_API_KEY="dummy", ANTHROPIC_API_KEY=""):
            s0 = tb.today_spend(db_path=db)
            _ = tr.narrate_verdict(_CAND, _VERDICT, _COMPASS, db_path=db)
            s1 = tb.today_spend(db_path=db)
    finally:
        tr._call_anthropic = orig
    assert s1 == s0, (s0, s1)                                        # flag off -> zero spend
    print("  LLM call is budget-gated (can_afford) + ACTUAL cost recorded (record_spend): PASS")


def test_log_rejection_appends_additive():
    db = _fresh_db()
    assert _count(db) == 0
    rid = tr.log_rejection(_CAND, _VERDICT, "rejected: cvar floor failed", compass_result=_COMPASS, db_path=db)
    assert rid >= 1
    assert _count(db) == 1                                           # additive append
    conn = get_connection(db)
    try:
        row = conn.execute(
            "SELECT arm_hash, level_id, config_json, failing_gates_json, rationale_text, "
            "p_value, dsr FROM rejection_log WHERE id=?", (rid,)).fetchone()
    finally:
        conn.close()
    assert row[0] == tr.candidate_arm_hash(_CAND) and row[1] == 0
    assert row[2] == tr.candidate_config_json(_CAND)
    assert "cvar_floor" in row[3] and "min_n" in row[3]             # failing gates persisted
    assert row[4] == "rejected: cvar floor failed"
    assert abs(row[5] - 0.18) < 1e-9 and abs(row[6] - 0.31) < 1e-9  # p_value + dsr from the verdict
    # A second rejection appends (never overwrites).
    tr.log_rejection(_NOVEL, _VERDICT, "another", db_path=db)
    assert _count(db) == 2
    print("  log_rejection appends to rejection_log (additive, fields persisted): PASS")


def test_is_known_dead_end_catches_reproposed():
    db = _fresh_db()
    assert tr.is_known_dead_end(_CAND, db_path=db) is False          # nothing logged yet
    tr.log_rejection(_CAND, _VERDICT, "x", db_path=db)
    assert tr.is_known_dead_end(_CAND, db_path=db) is True           # the SAME candidate is now dead
    assert tr.is_known_dead_end(_NOVEL, db_path=db) is False         # a different arm is not
    # Level-scoped: the same axes at a different level are NOT the same dead-end.
    other_level = {"axes": _CAND["axes"], "level_id": 1}
    assert tr.is_known_dead_end(other_level, db_path=db) is False
    print("  is_known_dead_end catches a re-proposed dead-end (exact arm_hash, level-scoped): PASS")


def test_self_pushback_blocks_known_dead_end_before_loop():
    db = _fresh_db()
    # Novel candidate: clear to evaluate (proceed=True is NOT an accept — the math still decides).
    fresh = tr.self_pushback(_NOVEL, db_path=db)
    assert fresh["proceed"] is True and fresh["source"] == "rule"
    # Reject it, then the SAME candidate is blocked BEFORE the loop.
    tr.log_rejection(_CAND, _VERDICT, "x", db_path=db)
    blocked = tr.self_pushback(_CAND, db_path=db)
    assert blocked["proceed"] is False, blocked
    assert blocked["source"] == "rejection_log" and "dead-end" in blocked["reason"]
    # Empty arm -> rule-blocked (no axes to vary).
    empty = tr.self_pushback({"axes": {}, "level_id": 0}, db_path=db)
    assert empty["proceed"] is False and empty["source"] == "rule"
    print("  self_pushback blocks a known dead-end BEFORE the loop; empty arm blocked: PASS")


def test_near_variant_is_soft_advisory_not_a_block():
    db = _fresh_db()
    tr.log_rejection(_CAND, _VERDICT, "x", db_path=db)              # reject {confidence_floor, trail_r}
    # Same axis KEY-SET, different values -> flagged as a near-variant...
    nv = tr.near_variant_of(_NOVEL, db_path=db)
    assert nv == tr.candidate_arm_hash(_CAND), nv
    # ...but it is ADVISORY: self_pushback still proceeds (the math decides).
    pb = tr.self_pushback(_NOVEL, db_path=db)
    assert pb["proceed"] is True and pb["near_variant"] == nv, pb
    # A different key-set is NOT a near-variant.
    assert tr.near_variant_of({"axes": {"confidence_floor": 1}, "level_id": 0}, db_path=db) is None
    print("  near_variant_of is a SOFT advisory flag, never a hard block: PASS")


_TESTS = [
    test_narrate_template_from_numeric_verdict,
    test_llm_never_decides_returns_only_text,
    test_narrate_budget_exhausted_degrades_to_template,
    test_llm_call_is_budget_gated_and_spend_recorded,
    test_log_rejection_appends_additive,
    test_is_known_dead_end_catches_reproposed,
    test_self_pushback_blocks_known_dead_end_before_loop,
    test_near_variant_is_soft_advisory_not_a_block,
]


if __name__ == "__main__":
    print("=== trainer_reasoning tests (R9-B4 Phase 2) ===")
    for t in _TESTS:
        t()
    print(f"=== {len(_TESTS)}/{len(_TESTS)} PASS ===")
