#!/usr/bin/env python3
"""Tests for [B6] query_loop_heartbeat.py — the Hub's live background-loop health read.

Dependency-free (``python3 tests/test_loop_heartbeat_surface.py``, pytest-compatible).

🚨 WHAT THESE ARE FOR. `[B1]` built a three-state contract in the database and left the
render open; a surface that collapses it back to two throws that fix away. So the load
test here is not "does it run" — it is **does each state produce a DIFFERENT verdict**.
Every state is DRIVEN through the real classifier with a fixture row, and the positive
control asserts healthy and degraded do not render the same.

🚨 NOTHING HERE TOUCHES A LIVE STORE. Every case is a dict built in-process, or a JSON
fixture read through the documented ``LOOP_HB_SOURCE_JSON`` seam. Zero ssh, zero sqlite,
zero writes — the module under test is a consumer and these tests keep it one.
"""
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import query_loop_heartbeat as qlh  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _row(**kw):
    """A healthy 60s-cadence row; override any field to drive a state."""
    base = {
        "loop_name": "sample_loop",
        "cadence_seconds": 60,
        "last_iteration_at": "2026-08-05T18:00:00+00:00",
        "iteration_count": 100,
        "error_count": 0,
        "last_error": None,
        "last_error_at": None,
        "is_dormant": 0,
        "degraded_reason": None,
        "age_sec": 30,
        "error_age_sec": None,
    }
    base.update(kw)
    return base


def _assert(cond, msg):
    if not cond:
        raise AssertionError(msg)


# ── the six states, each DRIVEN ──────────────────────────────────────────────────────────
def test_ok_state():
    r = qlh.classify(_row(), True)
    _assert(r["state"] == "ok", r)
    _assert("normally" in r["detail"], r)
    print("  ok: fresh + no reason + reason-field maintained: PASS")


def test_degraded_state():
    r = qlh.classify(_row(degraded_reason="no_simulator: observing without a backtest_fn"), True)
    _assert(r["state"] == "degraded", r)
    _assert(r["degraded_reason"] == "no_simulator: observing without a backtest_fn", r)
    print("  degraded: degraded_reason set -> impaired, reason carried: PASS")


def test_stale_state():
    # 60s cadence -> threshold max(3600, 120) = 3600. 4000s is past it.
    r = qlh.classify(_row(age_sec=4000), True)
    _assert(r["state"] == "stale", r)
    _assert(r["stale_threshold_sec"] == 3600, r)
    print("  stale: age past max(3600, cadence*2) -> stopped: PASS")


def test_unpopulated_state_is_the_live_one():
    """🚨 THE LOAD-BEARING CASE. The real trainer row on 2026-08-05: degraded_reason NULL,
    last_error set, last_error_at frozen ~28h behind last_iteration_at while the loop keeps
    running. That is [B1]'s code not being loaded, and it must NEVER read as healthy."""
    r = qlh.classify(_row(
        loop_name="trainer_search_loop", cadence_seconds=3600, age_sec=2735,
        iteration_count=35, error_count=3,
        last_error="no_simulator: observing without a backtest_fn",
        last_error_at="2026-08-04T14:00:16+00:00", error_age_sec=103676,
    ), True)
    _assert(r["state"] == "unpopulated", r)
    _assert(r["state"] != "ok", "the pre-[B1] trainer row must never classify as ok")
    _assert("restart is pending" in r["detail"], r)
    print("  unpopulated: NULL reason + frozen last_error_at -> not-yet-populated: PASS")


def test_unpopulated_when_column_absent():
    r = qlh.classify(_row(), False)
    _assert(r["state"] == "unpopulated", r)
    _assert("no degraded_reason column" in r["detail"], r)
    print("  unpopulated: degraded_reason column absent -> not confirmed healthy: PASS")


def test_unknown_states():
    unparsed = qlh.classify(_row(age_sec=None, last_iteration_at="not-a-timestamp"), True)
    _assert(unparsed["state"] == "unknown", unparsed)
    _assert("could not be read" in unparsed["detail"], unparsed)

    skew = qlh.classify(_row(age_sec=-500), True)
    _assert(skew["state"] == "unknown", skew)
    _assert("FUTURE" in skew["detail"], skew)

    no_ts = qlh.classify(_row(age_sec=None, last_iteration_at=None), True)
    _assert(no_ts["state"] == "unknown", no_ts)
    print("  unknown: unparseable ts / negative age / no ts -> unknown, never stale: PASS")


def test_dormant_is_not_green_and_never_votes():
    r = qlh.classify(_row(is_dormant=1, age_sec=999999), True)
    _assert(r["state"] == "dormant", r)
    _assert(r["state"] != "ok", "a parked loop is not a clean bill of health")
    roll = qlh.rollup([r])
    _assert(roll["active"] == 0, roll)
    _assert(roll["worst"] == "unknown", "an all-dormant set has no verdict, not a green one")
    print("  dormant: parked -> own state, excluded from the roll-up: PASS")


# ── the positive control ─────────────────────────────────────────────────────────────────
def test_positive_control_all_six_states_differ():
    """🚨 WITHOUT THIS, 'no degradation shown' and 'the card is broken' look identical."""
    cases = {
        "ok": qlh.classify(_row(), True),
        "degraded": qlh.classify(_row(degraded_reason="impaired"), True),
        "stale": qlh.classify(_row(age_sec=4000), True),
        "unpopulated": qlh.classify(_row(last_error="x", error_age_sec=99999), True),
        "unknown": qlh.classify(_row(age_sec=None), True),
        "dormant": qlh.classify(_row(is_dormant=1), True),
    }
    for want, got in cases.items():
        _assert(got["state"] == want, f"expected {want}, got {got['state']}: {got}")
    details = {c["detail"] for c in cases.values()}
    _assert(len(details) == 6, f"six states must produce six distinct details, got {details}")
    _assert(len({c["state"] for c in cases.values()}) == 6, cases)
    print("  positive control: 6 states -> 6 distinct states AND 6 distinct details: PASS")


def test_healthy_and_degraded_are_not_the_same_row():
    healthy = qlh.classify(_row(loop_name="L"), True)
    degraded = qlh.classify(_row(loop_name="L", degraded_reason="the provider is missing"), True)
    _assert(healthy["state"] != degraded["state"], (healthy, degraded))
    _assert(healthy["detail"] != degraded["detail"], (healthy, degraded))
    _assert(degraded["degraded_reason"] and not healthy["degraded_reason"], (healthy, degraded))
    print("  positive control: one loop, two health inputs -> two different renderings: PASS")


# ── the roll-up ──────────────────────────────────────────────────────────────────────────
def test_rollup_unknown_outranks_ok():
    """A partial read must never summarise as a clean bill of health — the same rule
    external_liveness_check._worst applies, kept identical so they cannot disagree."""
    loops = [qlh.classify(_row(loop_name="a"), True),
             qlh.classify(_row(loop_name="b", age_sec=None), True)]
    _assert(qlh.rollup(loops)["worst"] == "unknown", qlh.rollup(loops))
    print("  rollup: unknown outranks ok: PASS")


def test_rollup_stale_outranks_degraded_but_reason_survives():
    stale_and_degraded = qlh.classify(_row(age_sec=4000, degraded_reason="still impaired"), True)
    _assert(stale_and_degraded["state"] == "stale", stale_and_degraded)
    _assert(stale_and_degraded["degraded_reason"] == "still impaired",
            "the reason must survive a more urgent verdict winning the pill")
    _assert("still impaired" in stale_and_degraded["detail"], stale_and_degraded)
    print("  rollup: stopped outranks impaired, reason still carried: PASS")


def test_threshold_matches_the_other_two_instruments():
    _assert(qlh.stale_threshold(3600) == 7200, "trainer: 2x cadence")
    _assert(qlh.stale_threshold(60) == 3600, "fast loops: the 3600 floor")
    _assert(qlh.stale_threshold(None) == 3600, "missing cadence: the floor")
    _assert(qlh.stale_threshold(0) == 3600, "zero cadence: the floor")
    print("  threshold: max(3600, cadence*2), identical to watcher_surface + B3: PASS")


# ── end-to-end through the real entry point, via the documented seam ─────────────────────
def _run_with_fixture(payload):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False,
                                     dir=os.environ.get("TMPDIR", "/home/ghost/tmp")) as fh:
        json.dump(payload, fh)
        path = fh.name
    try:
        env = {**os.environ, "LOOP_HB_SOURCE_JSON": path}
        p = subprocess.run([sys.executable, os.path.join(REPO, "query_loop_heartbeat.py")],
                           capture_output=True, text=True, timeout=30, env=env, cwd=REPO)
        return p, json.loads(p.stdout.strip())
    finally:
        os.unlink(path)


def test_end_to_end_mixed_payload():
    p, out = _run_with_fixture({"degraded_column": True, "error": None, "rows": [
        _row(loop_name="healthy_loop"),
        _row(loop_name="impaired_loop", degraded_reason="the provider is missing"),
        _row(loop_name="stopped_loop", age_sec=99999),
        _row(loop_name="trainer_search_loop", cadence_seconds=3600, age_sec=2735,
             last_error="no_simulator", error_age_sec=103676),
        _row(loop_name="unreadable_loop", age_sec=None),
        _row(loop_name="parked_loop", is_dormant=1),
    ]})
    _assert(p.returncode == 0, f"must always exit 0, got {p.returncode}: {p.stderr}")
    states = {lp["loop_name"]: lp["state"] for lp in out["loops"]}
    _assert(states == {
        "healthy_loop": "ok", "impaired_loop": "degraded", "stopped_loop": "stale",
        "trainer_search_loop": "unpopulated", "unreadable_loop": "unknown",
        "parked_loop": "dormant"}, states)
    _assert(out["rollup"]["worst"] == "stale", out["rollup"])
    _assert(out["rollup"]["active"] == 5, out["rollup"])
    # Worst-first ordering: the thing that needs looking at is at the top.
    _assert(out["loops"][0]["state"] == "stale", out["loops"][0])
    print("  e2e: all six states in one payload, worst-first, rc=0: PASS")


def test_end_to_end_read_failure_is_unknown_never_ok():
    """🚨 ssh down / DB unreachable / no rows -> UNKNOWN with a reason. NEVER an empty ok,
    and NEVER a replica fallback (Ghost's call at the B6 gate)."""
    for payload, why in (
        ({"error": "ssh to vm timed out after 20s"}, "ssh down"),
        ({"degraded_column": True, "error": None, "rows": []}, "no rows"),
    ):
        p, out = _run_with_fixture(payload)
        _assert(p.returncode == 0, f"{why}: must exit 0, got {p.returncode}")
        _assert(out["status"] == "unknown", f"{why}: {out}")
        _assert(out["rollup"]["worst"] == "unknown", f"{why}: {out}")
        _assert(out["loops"] == [], f"{why}: {out}")
        _assert(out["error"], f"{why}: a failed read must carry a reason")
        _assert("replica" not in json.dumps(out).lower() or out["source"] == "vm-live",
                f"{why}: must never fall back to the replica")
    print("  e2e: ssh failure + empty table -> unknown with a reason, never ok: PASS")


def test_unreadable_fixture_cannot_fabricate_health():
    env = {**os.environ, "LOOP_HB_SOURCE_JSON": "/home/ghost/tmp/does-not-exist-b6.json"}
    p = subprocess.run([sys.executable, os.path.join(REPO, "query_loop_heartbeat.py")],
                       capture_output=True, text=True, timeout=30, env=env, cwd=REPO)
    out = json.loads(p.stdout.strip())
    _assert(p.returncode == 0, p.stderr)
    _assert(out["status"] == "unknown", out)
    _assert("unreadable" in (out["error"] or ""), out)
    print("  e2e: a broken fixture reads UNKNOWN, it cannot mint a healthy payload: PASS")


TESTS = [
    test_ok_state,
    test_degraded_state,
    test_stale_state,
    test_unpopulated_state_is_the_live_one,
    test_unpopulated_when_column_absent,
    test_unknown_states,
    test_dormant_is_not_green_and_never_votes,
    test_positive_control_all_six_states_differ,
    test_healthy_and_degraded_are_not_the_same_row,
    test_rollup_unknown_outranks_ok,
    test_rollup_stale_outranks_degraded_but_reason_survives,
    test_threshold_matches_the_other_two_instruments,
    test_end_to_end_mixed_payload,
    test_end_to_end_read_failure_is_unknown_never_ok,
    test_unreadable_fixture_cannot_fabricate_health,
]

if __name__ == "__main__":
    print("=== loop heartbeat surface tests ([B6] RM-WATCH) ===")
    failed = 0
    for t in TESTS:
        try:
            t()
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  {t.__name__}: FAIL — {exc}")
    print(f"=== {len(TESTS) - failed}/{len(TESTS)} PASS ===")
    sys.exit(1 if failed else 0)
