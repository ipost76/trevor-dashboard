#!/usr/bin/env python3
"""Tests for the R9-B4 daily API-spend self-gate (trainer_budget.py).

Proves the four Phase-1 verification-gate claims:
  * record_spend increments today's trainer_api_budget row (spend + call_count).
  * can_afford is the HARD gate — False when spend + estimate would breach the
    ceiling (tested AT the boundary, with binary-exact float amounts).
  * budget exhaustion closes the gate (remaining 0, can_afford False, exhausted).
  * the daily reset works — a new date row starts fresh at the full budget.
Plus: the env override is resolved at call time, and can_afford fails CLOSED when
the ledger can't be read (an unverifiable budget never authorizes spend).

Every test runs against a THROWAWAY trainer.db (tempfile) via the db_path override,
and simulates dates via the day override — so the real trainer.db is never touched
and no wall-clock/timezone dependence leaks in. Dependency-free:
``python3 tests/test_trainer_budget.py``. pytest-compatible.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import trainer_budget as tb  # noqa: E402
from lib.trainer_db import get_connection  # noqa: E402  (materialize the throwaway schema)

_D1 = "2026-03-01"  # a fixed "today" for deterministic single-day tests
_D2 = "2026-03-02"  # the next day, for the reset test


def _fresh_db():
    """A throwaway trainer.db path with the schema materialized (get_connection
    runs init_schema on connect). Returned path is safe to spend against freely."""
    path = os.path.join(tempfile.mkdtemp(prefix="trainer_budget_test_"), "throwaway.db")
    get_connection(path).close()  # create + init schema
    return path


def test_record_spend_increments_todays_row():
    db = _fresh_db()
    assert tb.today_spend(day=_D1, db_path=db) == 0.0            # no row yet
    total = tb.record_spend(0.05, day=_D1, db_path=db)
    assert abs(total - 0.05) < 1e-9, total
    st = tb.budget_status(day=_D1, db_path=db)
    assert abs(st["spend_usd"] - 0.05) < 1e-9 and st["call_count"] == 1, st
    tb.record_spend(0.03, day=_D1, db_path=db)                   # second add same day
    st2 = tb.budget_status(day=_D1, db_path=db)
    assert abs(st2["spend_usd"] - 0.08) < 1e-9, st2              # accumulates
    assert st2["call_count"] == 2, st2                           # ticks per call
    # A negative "spend" is floored to 0 (a spend is never a credit).
    tb.record_spend(-1.0, day=_D1, db_path=db)
    st3 = tb.budget_status(day=_D1, db_path=db)
    assert abs(st3["spend_usd"] - 0.08) < 1e-9, st3              # unchanged
    assert st3["call_count"] == 3, st3                           # but still counted
    print("  record_spend increments today's row (spend + call_count, neg floored): PASS")


def test_can_afford_hard_gate_at_boundary():
    # Pin the ceiling to $1.00 via the env override + use binary-exact quarters so
    # the boundary is precise (0.75 + 0.25 == 1.0 exactly in float).
    db = _fresh_db()
    prev = os.environ.get(tb.TRAINER_DAILY_BUDGET_USD_ENV)
    os.environ[tb.TRAINER_DAILY_BUDGET_USD_ENV] = "1.0"
    try:
        assert tb.daily_budget() == 1.0
        assert tb.can_afford(0.25, day=_D1, db_path=db) is True   # fresh, well within
        tb.record_spend(0.75, day=_D1, db_path=db)                # remaining exactly 0.25
        assert abs(tb.budget_remaining(day=_D1, db_path=db) - 0.25) < 1e-9
        # AT the boundary: spend + estimate == ceiling -> affordable (<= is within).
        assert tb.can_afford(0.25, day=_D1, db_path=db) is True
        # A hair OVER the boundary -> gate closes.
        assert tb.can_afford(0.2600, day=_D1, db_path=db) is False
        assert tb.can_afford(1.0, day=_D1, db_path=db) is False   # obviously over
        # A negative estimate is floored to 0 -> affordable at the boundary.
        assert tb.can_afford(-5.0, day=_D1, db_path=db) is True
    finally:
        if prev is None:
            os.environ.pop(tb.TRAINER_DAILY_BUDGET_USD_ENV, None)
        else:
            os.environ[tb.TRAINER_DAILY_BUDGET_USD_ENV] = prev
    print("  can_afford is the HARD gate at the exact ceiling boundary: PASS")


def test_budget_exhaustion_closes_gate():
    # Spend the full default ceiling -> remaining 0, gate closed, exhausted flagged.
    db = _fresh_db()
    budget = tb.daily_budget()                                    # default $0.25 (env unset)
    tb.record_spend(budget, day=_D1, db_path=db)
    assert tb.budget_remaining(day=_D1, db_path=db) == 0.0
    assert tb.can_afford(0.0001, day=_D1, db_path=db) is False    # broke -> no LLM spend
    st = tb.budget_status(day=_D1, db_path=db)
    assert st["exhausted"] is True, st
    assert abs(st["remaining_usd"]) < 1e-9, st
    # Overspend guard: even if a prior call pushed past the ceiling, remaining floors
    # at 0 (never negative) and the gate stays shut.
    tb.record_spend(budget, day=_D1, db_path=db)                  # now 2x over
    assert tb.budget_remaining(day=_D1, db_path=db) == 0.0
    assert tb.can_afford(0.0001, day=_D1, db_path=db) is False
    print("  budget exhaustion closes the gate (remaining floors at 0, exhausted): PASS")


def test_daily_reset_new_date_starts_fresh():
    # Exhaust day 1, then day 2 must start fresh at the full budget (the daily reset
    # IS the roll to a new date PK row — no reset() call, no wipe).
    db = _fresh_db()
    budget = tb.daily_budget()
    tb.record_spend(budget, day=_D1, db_path=db)
    assert tb.can_afford(0.0001, day=_D1, db_path=db) is False    # day 1 broke
    # Day 2: independent row, fresh budget.
    assert tb.today_spend(day=_D2, db_path=db) == 0.0
    assert tb.budget_remaining(day=_D2, db_path=db) == budget
    assert tb.can_afford(budget, day=_D2, db_path=db) is True
    st2 = tb.budget_status(day=_D2, db_path=db)
    assert st2["exhausted"] is False and st2["call_count"] == 0, st2
    # Day 1's row is untouched by day 2 activity (additive, not a wipe).
    st1 = tb.budget_status(day=_D1, db_path=db)
    assert abs(st1["spend_usd"] - budget) < 1e-9, st1
    print("  daily reset: a new date row starts fresh, prior day untouched: PASS")


def test_daily_budget_env_override_resolved_at_call_time():
    prev = os.environ.get(tb.TRAINER_DAILY_BUDGET_USD_ENV)
    try:
        os.environ[tb.TRAINER_DAILY_BUDGET_USD_ENV] = "3.00"
        assert tb.daily_budget() == 3.00                          # override wins, live
        for bad in ("", "   ", "abc", "-1.0"):                    # broken -> default
            os.environ[tb.TRAINER_DAILY_BUDGET_USD_ENV] = bad
            assert tb.daily_budget() == tb._DEFAULT_DAILY_BUDGET_USD, bad
        os.environ.pop(tb.TRAINER_DAILY_BUDGET_USD_ENV, None)
        assert tb.daily_budget() == tb._DEFAULT_DAILY_BUDGET_USD   # unset -> default
    finally:
        if prev is None:
            os.environ.pop(tb.TRAINER_DAILY_BUDGET_USD_ENV, None)
        else:
            os.environ[tb.TRAINER_DAILY_BUDGET_USD_ENV] = prev
    print("  daily_budget() env override resolved at call time (bad -> default): PASS")


def test_can_afford_fails_closed_on_unreadable_ledger():
    # get_connection HARD-REFUSES the 0444 replica path (raises ValueError). An
    # accessor surfaces that honestly (raises); the gate swallows it and returns
    # False -> an unverifiable budget never authorizes spend.
    replica = "/home/ghost/trevor-replica/trevor.db"
    raised = False
    try:
        tb.today_spend(db_path=replica)                           # honest accessor: raises
    except Exception:
        raised = True
    assert raised, "today_spend should surface the replica-refusal, not swallow it"
    assert tb.can_afford(0.0001, db_path=replica) is False        # gate fails CLOSED
    print("  can_afford fails CLOSED on an unreadable ledger (accessor stays honest): PASS")


_TESTS = [
    test_record_spend_increments_todays_row,
    test_can_afford_hard_gate_at_boundary,
    test_budget_exhaustion_closes_gate,
    test_daily_reset_new_date_starts_fresh,
    test_daily_budget_env_override_resolved_at_call_time,
    test_can_afford_fails_closed_on_unreadable_ledger,
]


if __name__ == "__main__":
    print("=== trainer_budget tests (R9-B4 Phase 1) ===")
    for t in _TESTS:
        t()
    print(f"=== {len(_TESTS)}/{len(_TESTS)} PASS ===")
