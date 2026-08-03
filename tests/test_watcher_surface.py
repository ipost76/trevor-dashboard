#!/usr/bin/env python3
"""Tests for R10-B3 watcher_surface.py — the subscribe layer + malfunction router.

Dependency-free (``python3 tests/test_watcher_surface.py``, pytest-compatible). Each check
is exercised against a SYNTHETIC in-memory trevor.db (loop_heartbeat / shadow_lifecycle /
hmm_inference_log / observability_alerts) and a fresh temp watcher.db, with the ssh transport
injected as a fake — so every proof is deterministic and touches neither the live replica nor
the VM.

Phase 1 gate coverage:
  * check_loop_freshness FIRES on a genuinely stale loop; does NOT fire for is_dormant=1 or
    REMOVED_LOOPS loops.
  * absent ≠ dead: a loop absent from loop_heartbeat (trainer_search_loop) can never fire.
  * check_alerting_canary (HMM-divergence) fires on a stale HMM with no hmm_stale alert, and
    stays quiet on a fresh HMM AND when the alerter is working.
  * check_critical_units reflects live states and is edge-triggered (2nd run ≠ duplicate).
  * de-dup: two cycles over the same condition → ONE row, first_seen preserved, last_seen advanced.
  * every check handles a missing table / unreadable source as expected-empty or UNKNOWN — never a crash.
Phase 2 gate coverage (built here alongside the funnel):
  * a losing-trade / non-infra source NEVER routes (the structural W8 exclusion).
  * resolved flips ONLY when the underlying condition clears (observational), never by an action.
  * a partial (ssh-down) read declines to resolve — an outage can't clear a real malfunction.
"""
import json
import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 🚨 CONTAINMENT BELT (B7) — MODULE LEVEL, BEFORE the production imports below.
# Every store handle here is a temp file today, but nothing STRUCTURALLY stops a
# future check from reaching a zero-arg ``get_connection()`` and opening the LIVE
# <repo>/data/watcher.db. B11's ``_under_test()`` guard covers that only while the
# entry point is named ``test_*``; this redirect holds regardless of argv[0].
# Module level on purpose: a test added ABOVE a harness would otherwise run first.
import _containment  # noqa: E402

_containment.activate()

import watcher_surface as ws  # noqa: E402
from lib.watcher_db import get_connection  # noqa: E402

NOW = datetime(2026, 7, 22, 2, 0, 0)  # naive UTC
NOW_EPOCH = int(NOW.replace(tzinfo=timezone.utc).timestamp())
STALE_TS = "2026-07-18T19:32:49.179452+00:00"   # ~79h before NOW (offset-aware, like loop_heartbeat)
FRESH_TS = "2026-07-22T01:55:00+00:00"          # 5 min before NOW

_TMPFILES = []


# ── fixtures ────────────────────────────────────────────────────────────────
def _watcher():
    tmp = tempfile.NamedTemporaryFile(suffix=".watcher.db", delete=False)
    tmp.close()
    _TMPFILES.append(tmp.name)
    return get_connection(db_path=tmp.name)


def _trevor(loops=None, shadow=None, hmm_ts=None, hmm_alerts=None,
            omit_shadow=False, omit_hmm=False, omit_alerts=False, omit_loops=False):
    """A synthetic trevor.db. Pass omit_* to drop a table entirely (missing-table proofs)."""
    c = sqlite3.connect(":memory:")
    if not omit_loops:
        c.execute("CREATE TABLE loop_heartbeat (loop_name TEXT PRIMARY KEY, cadence_seconds INT, "
                  "last_iteration_at TEXT, iteration_count INT DEFAULT 0, error_count INT DEFAULT 0, "
                  "last_error TEXT, last_error_at TEXT, is_dormant INT DEFAULT 0, is_time_based INT DEFAULT 0)")
        for name, cad, ts, dorm, err in (loops or []):
            c.execute("INSERT INTO loop_heartbeat (loop_name, cadence_seconds, last_iteration_at, "
                      "is_dormant, error_count) VALUES (?,?,?,?,?)", (name, cad, ts, dorm, err))
    if not omit_shadow:
        c.execute("CREATE TABLE shadow_lifecycle (shadow_id TEXT PRIMARY KEY, state TEXT, "
                  "level_tested_at INT, queue TEXT, proposed_at TEXT, deployed_at TEXT, "
                  "state_changed_at TEXT, prior_null_count INT DEFAULT 0, proposal_json TEXT, reason TEXT)")
        for sid, state, changed in (shadow or []):
            c.execute("INSERT INTO shadow_lifecycle (shadow_id, state, state_changed_at) VALUES (?,?,?)",
                      (sid, state, changed))
    if not omit_hmm:
        c.execute("CREATE TABLE hmm_inference_log (id INTEGER PRIMARY KEY, ts INTEGER, ticker TEXT, "
                  "predicted_state TEXT)")
        if hmm_ts is not None:
            c.execute("INSERT INTO hmm_inference_log (ts, ticker) VALUES (?, 'BTC')", (hmm_ts,))
    if not omit_alerts:
        c.execute("CREATE TABLE observability_alerts (id INTEGER PRIMARY KEY, created_at TEXT, "
                  "alert_type TEXT, severity TEXT, ticker TEXT, details TEXT, discord_posted INT DEFAULT 0, "
                  "resolved_at TEXT)")
        for created, atype in (hmm_alerts or []):
            c.execute("INSERT INTO observability_alerts (created_at, alert_type, severity, details) "
                      "VALUES (?,?, 'warning', '{}')", (created, atype))
    c.commit()
    return c


def _errs(w, source=None, unresolved_only=False):
    q = "SELECT source, json_extract(detail_json,'$.key'), resolved, first_seen_ts, last_seen_ts FROM watcher_errors"
    conds = []
    if source:
        conds.append(f"source='{source}'")
    if unresolved_only:
        conds.append("resolved=0")
    if conds:
        q += " WHERE " + " AND ".join(conds)
    return w.execute(q).fetchall()


def _assert(cond, msg):
    if not cond:
        raise AssertionError(msg)


def _canned(resp):
    """A transport double: accepts any call shape (run(cmd) / run(prog, timeout=...)),
    ignores it, and returns a fixed {ok,rc,out,err} dict."""
    def _fn(*args, **kwargs):
        _ = (args, kwargs)  # a transport is called with a cmd/argv (+ optional timeout)
        return resp
    return _fn


# ── (b) loop freshness ───────────────────────────────────────────────────────
def test_loop_freshness_fires_on_stale():
    w = _watcher()
    t = _trevor(loops=[
        ("auto_trader_monitor_loop", 30, STALE_TS, 0, 0),  # stale + active → FIRE (the A1 case)
        ("scheduler_loop", 60, FRESH_TS, 0, 0),            # fresh → no fire
    ])
    r = ws.check_loop_freshness(w, t, now=NOW)
    _assert(r["status"] == "ok" and r["fired"] == ["auto_trader_monitor_loop"], f"unexpected {r}")
    rows = _errs(w)
    _assert(rows == [("loop_stall", "auto_trader_monitor_loop", 0, rows[0][3], rows[0][4])], rows)
    print("  (b) loop_freshness fires on the genuinely-stale active loop: PASS")


def test_loop_freshness_ignores_dormant_and_removed():
    w = _watcher()
    t = _trevor(loops=[
        ("daily_email_triage", 86400, STALE_TS, 1, 0),          # is_dormant=1 → skip
        ("auto_trader_discovery_loop", 21600, STALE_TS, 0, 0),  # in REMOVED_LOOPS + active → skip
    ])
    r = ws.check_loop_freshness(w, t, now=NOW)
    _assert(r["fired"] == [], f"should fire on neither: {r}")
    _assert(_errs(w) == [], "dormant/removed stale loop must not create a row")
    print("  (b) loop_freshness ignores is_dormant=1 AND REMOVED_LOOPS (both stale): PASS")


def test_absent_not_dead():
    w = _watcher()
    # trainer_search_loop is NOT registered in loop_heartbeat (pre-cutover) — it can't fire.
    t = _trevor(loops=[("scheduler_loop", 60, FRESH_TS, 0, 0)])
    r = ws.check_loop_freshness(w, t, now=NOW)
    keys = [row[1] for row in _errs(w)]
    _assert("trainer_search_loop" not in keys and r["fired"] == [], f"absent loop fired: {r}")
    print("  absent ≠ dead: trainer_search_loop absent from loop_heartbeat → no error: PASS")


# ── (c) alerting canary — HMM divergence ─────────────────────────────────────
def test_canary_fires_on_stale_hmm_no_alert():
    w = _watcher()
    hmm_old = int((NOW - timedelta(days=8)).replace(tzinfo=timezone.utc).timestamp())
    t = _trevor(hmm_ts=hmm_old, hmm_alerts=[])  # stale HMM, alerter produced nothing
    r = ws.check_alerting_canary(w, t, now=NOW, now_epoch=NOW_EPOCH)
    _assert(r["fired"] == ["hmm_stale_alerter"], f"canary should fire: {r}")
    _assert(len(_errs(w, "swallowed_canary")) == 1, "one swallowed_canary row")
    print("  (c) canary FIRES on stale HMM + no hmm_stale alert (swallowed-except signature): PASS")


def test_canary_quiet_on_fresh_hmm():
    w = _watcher()
    hmm_fresh = int((NOW - timedelta(minutes=10)).replace(tzinfo=timezone.utc).timestamp())
    t = _trevor(hmm_ts=hmm_fresh, hmm_alerts=[])
    r = ws.check_alerting_canary(w, t, now=NOW, now_epoch=NOW_EPOCH)
    _assert(r["fired"] == [] and _errs(w) == [], f"fresh HMM must be quiet: {r}")
    print("  (c) canary quiet on a FRESH HMM row: PASS")


def test_canary_quiet_when_alerter_working():
    w = _watcher()
    hmm_old = int((NOW - timedelta(days=8)).replace(tzinfo=timezone.utc).timestamp())
    recent = (NOW - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
    t = _trevor(hmm_ts=hmm_old, hmm_alerts=[(recent, "hmm_stale")])  # alerter DID fire
    r = ws.check_alerting_canary(w, t, now=NOW, now_epoch=NOW_EPOCH)
    _assert(r["fired"] == [], f"working alerter must not trip the canary: {r}")
    print("  (c) canary quiet when the hmm_stale alerter is working (no divergence): PASS")


# ── (a) critical units ───────────────────────────────────────────────────────
def test_critical_units_reflects_state_and_edge_triggered():
    w = _watcher()

    # trevor active, monitor-center + observatory dead — mirrors the live box
    run_two_dead = _canned({"ok": False, "rc": 3, "out": "active\ninactive\ninactive", "err": ""})
    r1 = ws.check_critical_units(w, run=run_two_dead)
    _assert(set(r1["fired"]) == {"trevor-monitor-center.service", "trevor-observatory.service"}, r1)
    _assert(len(_errs(w, "systemctl_failed", unresolved_only=True)) == 2, "two dead daemons")
    # edge-triggered: a second identical run must NOT duplicate the rows
    ws.check_critical_units(w, run=run_two_dead)
    _assert(len(_errs(w, "systemctl_failed", unresolved_only=True)) == 2, "second run duplicated rows")
    print("  (a) critical_units reflects live states + is edge-triggered (2nd run no dup): PASS")


def test_critical_units_ssh_down_is_unknown_not_allclear():
    w = _watcher()

    down = _canned({"ok": False, "rc": -1, "out": "", "err": "ssh_timeout"})
    r = ws.check_critical_units(w, run=down)
    _assert(r["status"] == "unknown", f"ssh down must be UNKNOWN: {r}")
    _assert(_errs(w) == [], "UNKNOWN must not fire or resolve anything (no false all-clear)")
    hr = w.execute("SELECT status FROM watcher_health WHERE check_name='critical_units'").fetchone()
    _assert(hr and hr[0] == "unknown", "health mirror must record UNKNOWN")
    print("  (a) ssh-down → UNKNOWN health, zero fires, zero resolves (never a false all-clear): PASS")


# ── (d) cron liveness ────────────────────────────────────────────────────────
def test_cron_liveness_fires_then_resolves_on_recovery():
    w = _watcher()
    failed_line = "trevor-regime-transitions.service loaded failed failed TREVOR Regime Transition"
    vm_failed = _canned({"ok": True, "rc": 0, "out": failed_line, "err": ""})
    local_clean = _canned({"ok": True, "rc": 0, "out": "", "err": ""})

    r = ws.check_cron_liveness(w, run_vm=vm_failed, run_local=local_clean)
    _assert(r["fired"] == ["vm:trevor-regime-transitions.service"], f"live failed job: {r}")

    # job recovers → the row RESOLVES observationally (condition cleared, not an action)
    vm_clean = _canned({"ok": True, "rc": 0, "out": "", "err": ""})
    r2 = ws.check_cron_liveness(w, run_vm=vm_clean, run_local=local_clean)
    resolved = w.execute("SELECT resolved FROM watcher_errors WHERE source='cron_dead'").fetchone()[0]
    _assert(r2["fired"] == [] and resolved == 1, f"recovery must resolve: {r2} resolved={resolved}")
    print("  (d) cron_liveness fires on a failed trevor-* job, resolves on recovery: PASS")


def test_cron_liveness_partial_read_does_not_resolve():
    w = _watcher()
    failed_line = "trevor-regime-transitions.service loaded failed failed TREVOR Regime Transition"
    vm_failed = _canned({"ok": True, "rc": 0, "out": failed_line, "err": ""})
    local_clean = _canned({"ok": True, "rc": 0, "out": "", "err": ""})
    ws.check_cron_liveness(w, run_vm=vm_failed, run_local=local_clean)  # fire the row

    # ssh outage — cannot confirm the VM job cleared
    vm_down = _canned({"ok": False, "rc": -1, "out": "", "err": "ssh_timeout"})
    r = ws.check_cron_liveness(w, run_vm=vm_down, run_local=local_clean)
    resolved = w.execute("SELECT resolved FROM watcher_errors WHERE source='cron_dead'").fetchone()[0]
    _assert(r["status"] == "partial" and resolved == 0,
            f"a partial read must NOT resolve a real failure: {r} resolved={resolved}")
    print("  (d) partial (ssh-down) read declines to resolve — outage can't clear a real failure: PASS")


# ── stuck testing ────────────────────────────────────────────────────────────
def test_stuck_testing_fires_and_empty_is_expected():
    w = _watcher()
    old = (NOW - timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S")
    t = _trevor(shadow=[("sh1", "TESTING", old)])
    r = ws.check_stuck_testing(w, t, now=NOW)
    _assert(r["fired"] == ["sh1"], f"stuck TESTING row should fire: {r}")

    w2 = _watcher()
    t2 = _trevor(shadow=[])  # 0 rows = expected pre-cutover
    r2 = ws.check_stuck_testing(w2, t2, now=NOW)
    _assert(r2["status"] == "ok" and r2["fired"] == [], f"empty shadow_lifecycle must be quiet: {r2}")
    print("  stuck_testing fires on an aged TESTING row; empty table = expected (no fire): PASS")


# ── de-dup + edge-trigger across cycles ──────────────────────────────────────
def test_dedup_one_row_first_preserved_last_advanced():
    w = _watcher()
    t = _trevor(loops=[("auto_trader_monitor_loop", 30, STALE_TS, 0, 0)])
    orig = ws.utc_now
    stamps = {"i": 0, "vals": ["2026-07-22T02:00:00Z", "2026-07-22T02:05:00Z"]}
    ws.utc_now = lambda: stamps["vals"][min(stamps["i"], 1)]
    try:
        stamps["i"] = 0
        ws.check_loop_freshness(w, t, now=NOW)  # cycle 1 → INSERT
        stamps["i"] = 1
        ws.check_loop_freshness(w, t, now=NOW)  # cycle 2 → UPDATE (same condition)
    finally:
        ws.utc_now = orig
    rows = w.execute("SELECT first_seen_ts, last_seen_ts FROM watcher_errors WHERE source='loop_stall'").fetchall()
    _assert(len(rows) == 1, f"two cycles must yield ONE row, got {len(rows)}")
    fs, ls = rows[0]
    _assert(fs == "2026-07-22T02:00:00Z", f"first_seen must be preserved: {fs}")
    _assert(ls == "2026-07-22T02:05:00Z", f"last_seen must advance: {ls}")
    print("  de-dup: two cycles → ONE row, first_seen preserved, last_seen advanced: PASS")


# ── missing table / unreadable source → expected-empty or UNKNOWN, never crash ─
def test_missing_and_unreadable_never_crash():
    w = _watcher()
    # shadow_lifecycle absent → expected-empty (ok), no row
    t_no_shadow = _trevor(omit_shadow=True)
    r = ws.check_stuck_testing(w, t_no_shadow, now=NOW)
    _assert(r["status"] == "ok" and _errs(w, "stuck_testing") == [], f"absent shadow_lifecycle: {r}")
    # hmm_inference_log absent → expected-empty (ok), no canary fire
    r2 = ws.check_alerting_canary(w, t_no_shadow, now=NOW, now_epoch=NOW_EPOCH)
    _assert(r2["status"] == "ok" and _errs(w, "swallowed_canary") == [], f"absent hmm table: {r2}")
    # loop_heartbeat absent → UNKNOWN (not a crash, not a false all-clear)
    w3 = _watcher()
    t_no_loops = _trevor(omit_loops=True)
    r3 = ws.check_loop_freshness(w3, t_no_loops, now=NOW)
    _assert(r3["status"] == "unknown" and _errs(w3) == [], f"absent loop_heartbeat: {r3}")
    hr = w3.execute("SELECT status FROM watcher_health WHERE check_name='loop_freshness'").fetchone()
    _assert(hr and hr[0] == "unknown", "unreadable loop_heartbeat records UNKNOWN health")
    print("  missing table = expected-empty; unreadable = UNKNOWN; never a crash: PASS")


# ── W8 exclusion + observational resolution (Phase 2 gate, built with the funnel) ─
def test_losing_trade_never_routes():
    w = _watcher()
    routed = ws.route_malfunction(w, "losing_trade", "trade-101", {"pnl_usd": -50.0})
    routed2 = ws.route_malfunction(w, "drawdown", "acct", {"dd_pct": -12.0})
    _assert(routed is False and routed2 is False, "non-infra sources must be refused")
    _assert(_errs(w) == [], "a losing trade / drawdown must NEVER appear in watcher_errors")
    print("  W8: a losing-trade / drawdown source is refused — never routes (structural exclusion): PASS")


def test_resolution_is_observational_only():
    w = _watcher()
    # a real infra fire, then the condition clears → resolved=1 WITHOUT any action call
    ws.route_malfunction(w, "loop_stall", "some_loop", {"age_seconds": 9999}, severity="high")
    _assert(w.execute("SELECT resolved FROM watcher_errors").fetchone()[0] == 0, "fires unresolved")
    ws.resolve_cleared(w, "loop_stall", active_keys=set())  # condition no longer firing
    _assert(w.execute("SELECT resolved FROM watcher_errors").fetchone()[0] == 1,
            "resolved flips only because the condition cleared")
    print("  resolved flips ONLY when the condition clears (observational, never an action): PASS")


def test_recurrence_after_resolution_makes_fresh_row():
    w = _watcher()
    ws.route_malfunction(w, "loop_stall", "some_loop", {"age_seconds": 1}, severity="high")
    ws.resolve_cleared(w, "loop_stall", active_keys=set())            # resolve it
    ws.route_malfunction(w, "loop_stall", "some_loop", {"age_seconds": 2}, severity="high")  # recurs
    rows = w.execute("SELECT resolved FROM watcher_errors WHERE source='loop_stall' ORDER BY id").fetchall()
    _assert([r[0] for r in rows] == [1, 0], f"recurrence must be a FRESH unresolved row: {rows}")
    print("  recurrence after resolution → a fresh unresolved row (not a re-open): PASS")


def test_no_writable_trevor_db_and_no_halt_lever():
    src = open(ws.__file__, encoding="utf-8").read()
    _assert("mode=ro" in src, "the replica must be opened mode=ro")
    _assert("import auto_trader" not in src, "no auto_trader import (no auto-halt lever)")
    # live: a write against the replica connection MUST raise — read-only is structural,
    # so the watcher cannot touch trevor.db even by accident (the one sanctioned VM write
    # is W7's heartbeat row in watcher_health.py, not here).
    try:
        c = ws._replica_connect()
    except sqlite3.Error:
        c = None
    if c is not None:
        raised = False
        try:
            c.execute("CREATE TABLE _watcher_write_probe (x)")
        except sqlite3.OperationalError:
            raised = True
        finally:
            c.close()
        _assert(raised, "the replica connection must be read-only — a write must raise")
        print("  NO AUTO-HALT: trevor.db replica is mode=ro (a write RAISES); no halt-lever import: PASS")
    else:
        print("  NO AUTO-HALT: replica not present in this env — source proves mode=ro + no halt lever: PASS")


def test_severity_is_ranked_for_hub_ordering():
    w = _watcher()
    ws.route_malfunction(w, "systemctl_failed", "trevor.service", {"state": "dead"}, severity="critical")
    ws.route_malfunction(w, "stuck_testing", "sh9", {"state": "TESTING"}, severity="medium")
    sevs = [json.loads(d)["severity"]
            for (d,) in w.execute("SELECT detail_json FROM watcher_errors").fetchall()]
    ranked = sorted(sevs, key=lambda s: ws.SEVERITY_RANK.get(s, -1), reverse=True)
    _assert(ranked[0] == "critical" and "medium" in sevs, f"severity must rank for the Hub: {sevs}")
    print("  severity is stored + rank-ordered so the Hub can sort by what matters: PASS")


_TESTS = [
    test_loop_freshness_fires_on_stale,
    test_loop_freshness_ignores_dormant_and_removed,
    test_absent_not_dead,
    test_canary_fires_on_stale_hmm_no_alert,
    test_canary_quiet_on_fresh_hmm,
    test_canary_quiet_when_alerter_working,
    test_critical_units_reflects_state_and_edge_triggered,
    test_critical_units_ssh_down_is_unknown_not_allclear,
    test_cron_liveness_fires_then_resolves_on_recovery,
    test_cron_liveness_partial_read_does_not_resolve,
    test_stuck_testing_fires_and_empty_is_expected,
    test_dedup_one_row_first_preserved_last_advanced,
    test_missing_and_unreadable_never_crash,
    test_losing_trade_never_routes,
    test_resolution_is_observational_only,
    test_recurrence_after_resolution_makes_fresh_row,
    test_no_writable_trevor_db_and_no_halt_lever,
    test_severity_is_ranked_for_hub_ordering,
]


def _cleanup():
    for p in _TMPFILES:
        for suffix in ("", "-wal", "-shm"):
            try:
                os.unlink(p + suffix)
            except OSError:
                pass


if __name__ == "__main__":
    print("=== watcher_surface tests (R10-B3) ===")
    try:
        for t in _TESTS:
            t()
    finally:
        _cleanup()
    print(f"=== {len(_TESTS)}/{len(_TESTS)} PASS ===")
