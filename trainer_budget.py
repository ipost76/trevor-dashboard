#!/usr/bin/env python3
"""trainer_budget.py — the R9 trainer's DAILY API-SPEND self-gate [R9-B4].

The money analog of B2's anti-farming throttle. B4's cheap-LLM rejection narration
(trainer_reasoning.narrate_verdict) spends Anthropic API budget; if that spend is
unbounded the trainer can blow past the shared daily budget the way A1 rec #5 warns
it can — so this module gives the trainer its OWN daily-spend accounting plus a HARD
ceiling it can never cross.

═══════════════════════════════════════════════════════════════════════════════
 WHY THIS EXISTS (A1 / RECON-TRAINER-001, rec #5 — the missing $3/day ceiling)
═══════════════════════════════════════════════════════════════════════════════
The VM's four cost lines (config.py / memory.py) are INDEPENDENT and un-gated in
aggregate: swarm $1.00 + ai_engine $0.25 + servant $0.60 + botbrain $1.50 already
sum to $3.35 with NO hard ceiling stopping them collectively (rec #5). This module
does NOT try to fix the VM's aggregate hole — it adds the thing every one of those
four lines lacks: a ``can_afford`` HARD gate. The trainer's line is the FIRST with a
self-enforced ceiling; the trainer never blows its OWN slice.

Accounting mirrors the VM ``cost_tracking`` daily-sum pattern (memory.get_swarm_daily_cost:
per-day SUM), but the trainer keeps its OWN ledger in ``trainer_api_budget`` (B0) in
the WSL-local ``trainer.db`` — it NEVER writes the VM ``cost_tracking``. Spend depletes
across a UTC day and resets automatically at the next day (a new ``date`` PK row).

═══════════════════════════════════════════════════════════════════════════════
 THE PUBLIC SURFACE (what B4 Phase 2 calls before/after every LLM call)
═══════════════════════════════════════════════════════════════════════════════
  can_afford(estimated_cost) -> bool   the HARD gate — call BEFORE every LLM call.
                                       False -> narration degrades to a template
                                       (no LLM call), NEVER silently skips logging.
  record_spend(cost_usd)     -> float  add an actual spend to today's row (atomic
                                       upsert); call AFTER a real LLM call.
  today_spend()              -> float  today's total spend.
  budget_remaining()         -> float  max(0, daily_budget - today_spend).
  daily_budget()             -> float  the ceiling (env TRAINER_DAILY_BUDGET_USD,
                                       else the $0.25 default). Read at CALL TIME so
                                       Ghost can tune it without a restart.
  budget_status()            -> dict   a glance snapshot (for narration/templates/Hub).

DISCIPLINE (A1 standing warnings, matched to B0):
  * Call-time resolution: the budget ceiling AND the db path are resolved on every
    call — never bound at import (the DB-path trap / a stale-config trap).
  * Own connection: get_connection() per call (WAL + busy_timeout); the atomic
    ON CONFLICT upsert + the 5s busy_timeout are the serialized-writer discipline for
    concurrent increments.
  * Additive-DB law: INSERT ... ON CONFLICT DO UPDATE only — no DROP/DELETE/TRUNCATE,
    no reset(). The "reset" is the natural daily roll to a new date row.
  * Nothing runs on import; the ledger is inert until a consumer calls.

money_path=no. MAX(level) stays 0. Python 3, stdlib sqlite3 only (via B0's get_connection).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from lib.trainer_db import get_connection, utc_now

# ── The trainer's daily API-spend ceiling ──────────────────────────────────────
# A config constant Ghost can tune. Default $0.25 = ai_engine's conservative line
# (A1). The env var wins and is resolved at CALL TIME (see daily_budget()), so the
# ceiling can be raised/lowered without a code edit or restart.
TRAINER_DAILY_BUDGET_USD_ENV = "TRAINER_DAILY_BUDGET_USD"
_DEFAULT_DAILY_BUDGET_USD = 0.25
# Kept for visibility (docs / Hub display). NOT the authoritative gate value — the
# gate reads daily_budget() at call time so an env override takes effect live.
TRAINER_DAILY_BUDGET_USD = _DEFAULT_DAILY_BUDGET_USD


def daily_budget() -> float:
    """The daily ceiling in USD, resolved AT CALL TIME.

    ``TRAINER_DAILY_BUDGET_USD`` env override wins; else the $0.25 default. A
    missing/blank/unparseable/negative env value falls back to the default (a
    broken override must never silently open the gate wide or invert it).
    """
    raw = os.environ.get(TRAINER_DAILY_BUDGET_USD_ENV)
    if raw is None or not raw.strip():
        return _DEFAULT_DAILY_BUDGET_USD
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return _DEFAULT_DAILY_BUDGET_USD
    return val if val >= 0.0 else _DEFAULT_DAILY_BUDGET_USD


def _today() -> str:
    """Today's date (UTC) as YYYY-MM-DD — the trainer_api_budget PK for the day.

    UTC (not local) to match the trainer's utc_now() stamp convention and stay
    box-timezone-independent. The daily reset IS the roll to a new date row.
    """
    return datetime.now(timezone.utc).date().isoformat()


def record_spend(
    cost_usd: float, *, day: Optional[str] = None, db_path: Optional[str] = None
) -> float:
    """Add ``cost_usd`` to today's ``trainer_api_budget`` row; return the new day total.

    Atomic single-statement upsert (INSERT ... ON CONFLICT(date) DO UPDATE): the row
    is created on the first spend of the day and incremented thereafter, and
    ``call_count`` ticks +1 per call. Negative costs are floored to 0 (a spend is
    never a credit). The WAL + 5s busy_timeout from get_connection() serialize
    concurrent increments (a competing writer waits, it never loses the add).

    ``day`` / ``db_path`` are call-time overrides (a throwaway ledger / a simulated
    date for tests); production passes neither.
    """
    cost = max(0.0, float(cost_usd))
    d = day or _today()
    ts = utc_now()
    conn = get_connection(db_path)
    try:
        with conn:  # commit on success, rollback on error
            conn.execute(
                "INSERT INTO trainer_api_budget (date, spend_usd, call_count, updated_at) "
                "VALUES (?, ?, 1, ?) "
                "ON CONFLICT(date) DO UPDATE SET "
                "  spend_usd = spend_usd + excluded.spend_usd, "
                "  call_count = call_count + 1, "
                "  updated_at = excluded.updated_at",
                (d, cost, ts),
            )
    finally:
        conn.close()
    return today_spend(day=d, db_path=db_path)


def today_spend(*, day: Optional[str] = None, db_path: Optional[str] = None) -> float:
    """Total spend recorded for today (0.0 when no row exists yet)."""
    d = day or _today()
    conn = get_connection(db_path)
    try:
        row = conn.execute(
            "SELECT spend_usd FROM trainer_api_budget WHERE date=?", (d,)
        ).fetchone()
    finally:
        conn.close()
    return float(row[0]) if row and row[0] is not None else 0.0


def budget_remaining(*, day: Optional[str] = None, db_path: Optional[str] = None) -> float:
    """Dollars left in today's budget: max(0, daily_budget() - today_spend())."""
    return max(0.0, daily_budget() - today_spend(day=day, db_path=db_path))


def can_afford(
    estimated_cost: float, *, day: Optional[str] = None, db_path: Optional[str] = None
) -> bool:
    """The HARD gate. True iff today's spend + ``estimated_cost`` stays WITHIN budget.

    Exceeding the budget (spend + estimate strictly greater than daily_budget())
    returns False -> the caller MUST degrade to a deterministic template (no LLM
    call). Exactly-at-budget is affordable (<= is within). A negative estimate is
    floored to 0.

    Fails CLOSED: if the ledger can't be read (locked/corrupt db), returns False —
    an unverifiable budget must NEVER authorize spend (the trainer can't blow its
    own line even when the accounting is momentarily unreadable).
    """
    est = max(0.0, float(estimated_cost))
    try:
        spent = today_spend(day=day, db_path=db_path)
    except Exception:
        return False  # unreadable ledger -> fail closed, force the template path
    return (spent + est) <= daily_budget()


def budget_status(
    *, day: Optional[str] = None, db_path: Optional[str] = None
) -> Dict[str, Any]:
    """A glance snapshot for narration/templates/Hub display.

    ``{date, spend_usd, call_count, budget_usd, remaining_usd, exhausted}``.
    ``exhausted`` is True when nothing is left (remaining <= 0) — the signal the
    narrator uses to switch to the template path. Read-only; never raises for a
    missing row (a fresh day is spend 0 / count 0 / not exhausted).
    """
    d = day or _today()
    conn = get_connection(db_path)
    try:
        row = conn.execute(
            "SELECT spend_usd, call_count FROM trainer_api_budget WHERE date=?", (d,)
        ).fetchone()
    finally:
        conn.close()
    spend = float(row[0]) if row and row[0] is not None else 0.0
    calls = int(row[1]) if row and row[1] is not None else 0
    budget = daily_budget()
    remaining = max(0.0, budget - spend)
    return {
        "date": d,
        "spend_usd": spend,
        "call_count": calls,
        "budget_usd": budget,
        "remaining_usd": remaining,
        "exhausted": remaining <= 0.0,
    }


__all__ = [
    "daily_budget",
    "record_spend",
    "today_spend",
    "budget_remaining",
    "can_afford",
    "budget_status",
    "TRAINER_DAILY_BUDGET_USD",
    "TRAINER_DAILY_BUDGET_USD_ENV",
]


if __name__ == "__main__":
    # Guarded smoke only — NEVER runs on import. Uses a THROWAWAY ledger so the real
    # trainer.db is never touched. Prints the ceiling + a spend/gate walk-through.
    import json
    import tempfile

    _tmp = os.path.join(tempfile.mkdtemp(prefix="trainer_budget_smoke_"), "throwaway.db")
    print(f"daily_budget() = ${daily_budget():.4f}  (env {TRAINER_DAILY_BUDGET_USD_ENV} "
          f"{'set' if os.environ.get(TRAINER_DAILY_BUDGET_USD_ENV) else 'unset'})")
    print(f"can_afford($0.001) fresh: {can_afford(0.001, db_path=_tmp)}")
    print(f"record_spend($0.10): new total = ${record_spend(0.10, db_path=_tmp):.4f}")
    print(f"status: {json.dumps(budget_status(db_path=_tmp))}")
    # Spend right up to the ceiling, then prove the gate closes.
    record_spend(daily_budget(), db_path=_tmp)
    print(f"after spending the full ceiling: remaining = ${budget_remaining(db_path=_tmp):.4f}, "
          f"can_afford($0.001) = {can_afford(0.001, db_path=_tmp)}")
