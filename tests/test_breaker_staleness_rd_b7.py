"""RD-B7 — breaker-evaluation staleness gating in query_profit_risk.build_breakers().

The defect: build_breakers() read only RISK_BREAKERS_STATE_JSON + RISK_BREAKERS_ENABLED,
never RISK_BREAKERS_LAST_EVAL — so a frozen breaker was pixel-identical to a healthy one.
The card said OK against an evaluation of ANY age.

The fix must be honest in BOTH directions, so these tests pin both:
  * a STALE evaluation degrades the all-clear to UNKNOWN, and
  * a FRESH evaluation is UNMOVED — still OK.

And it must not become the same defect with the opposite colour: UNKNOWN is not a fault.
A stale readout never invents a halt (entries_allowed / active pass through untouched),
never outranks an already-latched RED, and never overrides an explicit OFF.

Every case runs against a SCRATCH sqlite file. The live store is never written.

Run: python3 tests/test_breaker_staleness_rd_b7.py
(pytest is not installed in the WSL venv — the __main__ self-runner is the live test path.)
"""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import query_profit_risk as qpr  # noqa: E402

UTC = timezone.utc

# A minimal but realistic state mirror: one armed breaker, nothing tripped.
STATE_OK = (
    '{"entries_allowed": true, "active_breakers": [], "detail": {"daily_loss": '
    '{"breaker": "daily_loss", "loss_pct": 0.0, "limit_pct": -25.0, "active": false}}}'
)
STATE_HALTED = (
    '{"entries_allowed": false, "active_breakers": ["daily_loss"], "detail": {"daily_loss": '
    '{"breaker": "daily_loss", "loss_pct": -30.0, "limit_pct": -25.0, "active": true}}}'
)


def _scratch_db(*, last_eval, state_json=STATE_OK, enabled="true", updated_at=None):
    """Build a throwaway auto_config DB and point query_profit_risk at it.

    Returns the temp path; the caller restores qpr.DB. NEVER touches the real store.
    """
    fd, path = tempfile.mkstemp(suffix=".db", prefix="rdb7_scratch_")
    os.close(fd)
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE auto_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)"
    )
    stamp = updated_at or datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
    rows = [
        ("RISK_BREAKERS_STATE_JSON", state_json, stamp),
        ("RISK_BREAKERS_ENABLED", enabled, "2026-05-29 23:02:25"),
    ]
    if last_eval is not None:
        rows.append(("RISK_BREAKERS_LAST_EVAL", last_eval, stamp))
    conn.executemany("INSERT INTO auto_config VALUES (?,?,?)", rows)
    conn.commit()
    conn.close()
    return path


def _iso_ago(seconds: int) -> str:
    """A LAST_EVAL value `seconds` old, in risk_breakers._persist_state's exact format."""
    return (datetime.now(UTC) - timedelta(seconds=seconds)).replace(tzinfo=None).isoformat() + "Z"


def _build(**kw) -> dict:
    path = _scratch_db(**kw)
    original = qpr.DB
    try:
        qpr.DB = path
        return qpr.build_breakers()
    finally:
        qpr.DB = original
        os.unlink(path)


# ── the two headline cases ──────────────────────────────────────────────────

def test_stale_eval_degrades_all_clear_to_unknown():
    """A 7h-old evaluation must NOT render OK. This is the green lie."""
    out = _build(last_eval=_iso_ago(7 * 3600))
    assert out["last_eval_stale"] is True, out
    assert out["overall_status"] == "UNKNOWN", out
    assert out["last_eval_age_s"] >= 7 * 3600 - 5, out
    print("OK stale 7h -> UNKNOWN (age", out["last_eval_age_s"], "s)")


def test_fresh_eval_still_renders_ok():
    """The correct case must be UNMOVED — the fix must not move OK."""
    out = _build(last_eval=_iso_ago(120))
    assert out["last_eval_stale"] is False, out
    assert out["overall_status"] == "OK", out
    assert 100 <= out["last_eval_age_s"] <= 200, out
    print("OK fresh 2m -> OK (age", out["last_eval_age_s"], "s)")


# ── UNKNOWN is not a fault ──────────────────────────────────────────────────

def test_stale_never_invents_a_halt():
    """STALE means UNKNOWN, not FAILED. It must not fabricate a halt."""
    out = _build(last_eval=_iso_ago(7 * 3600))
    assert out["overall_status"] == "UNKNOWN", out
    # The last known reading passes through untouched — no invented RED.
    assert out["entries_allowed"] is True, out
    assert out["active"] == [], out
    assert out["override_active"] is False, out
    print("OK stale does not fabricate a halt (entries_allowed still True)")


def test_stale_does_not_outrank_a_latched_red():
    """An already-tripped breaker stays RED — staleness only degrades the all-clear."""
    out = _build(last_eval=_iso_ago(9 * 3600), state_json=STATE_HALTED)
    assert out["last_eval_stale"] is True, out
    assert out["overall_status"] == "RED", out
    assert out["entries_allowed"] is False, out
    print("OK stale + latched halt -> RED (not downgraded to UNKNOWN)")


def test_stale_does_not_override_off():
    """Master flag OFF is an explicit operator state; staleness must not mask it."""
    out = _build(last_eval=_iso_ago(9 * 3600), enabled="false")
    assert out["last_eval_stale"] is True, out
    assert out["overall_status"] == "OFF", out
    assert out["override_active"] is True, out
    print("OK stale + master OFF -> OFF (override still visible)")


# ── fail-safe: undatable is stale, never a silent OK ────────────────────────

def test_missing_last_eval_falls_back_to_updated_at():
    """No LAST_EVAL row → date the reading from the STATE_JSON row's updated_at."""
    old = (datetime.now(UTC) - timedelta(seconds=8 * 3600)).strftime("%Y-%m-%d %H:%M:%S")
    out = _build(last_eval=None, updated_at=old)
    assert out["last_eval_stale"] is True, out
    assert out["overall_status"] == "UNKNOWN", out
    assert out["last_eval_at"] is not None, out
    print("OK missing LAST_EVAL -> dated from updated_at, stale")


def test_unparseable_timestamp_is_stale_not_ok():
    """A value we cannot parse or date is UNKNOWN — never a silent all-clear."""
    out = _build(last_eval="not-a-timestamp", updated_at="also-garbage")
    assert out["last_eval_stale"] is True, out
    assert out["last_eval_at"] is None, out
    assert out["last_eval_age_s"] is None, out
    assert out["overall_status"] == "UNKNOWN", out
    print("OK unparseable -> UNKNOWN, fail-safe")


def test_unreadable_db_is_stale_not_ok():
    """The DB-error path carries the freshness fields too — no missing-key crash."""
    original = qpr.DB
    try:
        qpr.DB = "/nonexistent/rd-b7/definitely-not-here.db"
        out = qpr.build_breakers()
    finally:
        qpr.DB = original
    assert out["last_eval_stale"] is True, out
    assert out["overall_status"] == "UNKNOWN", out
    assert "error" in out, out
    print("OK unreadable DB -> UNKNOWN + stale + error surfaced")


# ── the bound itself ────────────────────────────────────────────────────────

def test_boundary_is_strictly_greater_than():
    """At exactly the bound: fresh. One second past: stale. No off-by-one drift."""
    bound = qpr.BREAKER_EVAL_STALE_S
    at = _build(last_eval=_iso_ago(bound - 2))
    past = _build(last_eval=_iso_ago(bound + 30))
    assert at["last_eval_stale"] is False, at
    assert at["overall_status"] == "OK", at
    assert past["last_eval_stale"] is True, past
    assert past["overall_status"] == "UNKNOWN", past
    print(f"OK boundary at {bound}s: -2s fresh, +30s stale")


def test_bound_is_published_for_the_ui():
    """The UI has to be able to explain the threshold, so the payload carries it."""
    out = _build(last_eval=_iso_ago(60))
    assert out["last_eval_stale_after_s"] == qpr.BREAKER_EVAL_STALE_S, out
    assert out["last_eval_stale_after_s"] == 14400, out
    print("OK bound published:", out["last_eval_stale_after_s"], "s (4h)")


def test_absolute_timestamp_is_emitted_and_utc():
    """`last_eval_at` is the load-bearing field — it must survive a frozen SWR body."""
    out = _build(last_eval=_iso_ago(300))
    assert isinstance(out["last_eval_at"], str), out
    assert out["last_eval_at"].endswith("Z"), out
    parsed = datetime.fromisoformat(out["last_eval_at"].replace("Z", "+00:00"))
    assert parsed.tzinfo is not None, out
    drift = abs((datetime.now(UTC) - parsed).total_seconds() - 300)
    assert drift < 10, (out, drift)
    print("OK absolute last_eval_at emitted as UTC:", out["last_eval_at"])


ALL = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]

if __name__ == "__main__":
    failed = 0
    for t in ALL:
        try:
            t()
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(ALL) - failed}/{len(ALL)} passed")
    sys.exit(1 if failed else 0)
