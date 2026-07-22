#!/usr/bin/env python3
"""Tests for R10-B2 — the watcher's INTEGRITY sub-module (watcher_integrity.py).

HERMETIC by design: NOT one test touches the live VM / ssh pipe. The shim's
subprocess boundary is exercised with synthetic ``_exec`` results (real subprocess
where it's cheap and deterministic — ``sh -c``), and the shim WRAPPERS
(current_level / run_all_integrity / money_path_at_level / config_tested_at) are
monkeypatched, so these tests pass on any box regardless of ssh access. The
live-VM integration (real current_level, real integrity, real money-path-at 0,
real absent JSONL) was proven separately at build time.

What is proven here — B2's behavioral contract:

  * HARD UNKNOWN on EVERY shim failure mode (never a false pass) — the single
    most important behavior of the module.
  * VACUOUS ok != verified — a pass is ``integrity_verified`` ONLY on a positive
    current_level >= 1; otherwise ``checks_ran_nothing_to_check`` (domain-empty).
  * Reconciliation records ONLY mismatch rows, ranks the dangerous kind higher,
    is EXACTLY-ONCE (re-run records nothing; a crash before commit RE-READS).
  * Absent JSONL / pipe-down are EXPECTED-empty, never an alarm.
  * W9 apply oversight: a clean increment records clean; a wrong increment records
    a finding with the specific check + evidence; expected-empty config cross-check
    and R8-scaffolded config_tested_at are NOT faults; an unreadable level does not
    advance last_seen (retried, never skipped).
  * WATCHER_INTEGRITY_ENABLED off → fully inert (no ssh, no connection, no writes).

Dependency-free: ``python3 tests/test_watcher_integrity.py``. pytest-compatible.
The independence guarantee (denials 1 + 3) is proven by tests/test_watcher_independence.py.
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Point every write at a throwaway DB BEFORE importing the module (path is resolved
# at call time, so per-test _fresh_db() re-points cleanly).
os.environ["WATCHER_INTEGRITY_DB_PATH"] = tempfile.mkdtemp(prefix="wi_test_import_") + "/db.sqlite"
os.environ["WATCHER_INTEGRITY_ENABLED"] = ""  # default OFF

import watcher_integrity as wi  # noqa: E402
from lib.watcher_integrity_db import get_connection  # noqa: E402


# ── helpers ────────────────────────────────────────────────────────────────
def _fresh_db() -> str:
    p = tempfile.mkdtemp(prefix="wi_test_") + "/db.sqlite"
    os.environ["WATCHER_INTEGRITY_DB_PATH"] = p
    return p


def _findings():
    c = get_connection()
    try:
        return c.execute(
            "SELECT check_name, ok, findings_json, level_id FROM integrity_findings ORDER BY id"
        ).fetchall()
    finally:
        c.close()


def _exec_result(returncode=0, stdout="", stderr="", timed_out=False, spawn_error=None):
    return {"returncode": returncode, "stdout": stdout, "stderr": stderr,
            "timed_out": timed_out, "spawn_error": spawn_error}


def _make_tail(all_lines):
    return lambda start: {"status": "ok", "lines": all_lines[start - 1:]}


# ── shim: hard UNKNOWN on every failure mode ───────────────────────────────
def test_shim_hard_unknown_on_every_failure():
    # A real, parseable JSON body → a dict (the ONLY non-UNKNOWN outcome).
    ok = wi._classify("current", _exec_result(0, '{"current_level": 0}'))
    assert not wi.is_unknown(ok) and ok["current_level"] == 0

    # Every failure mode → the UNKNOWN sentinel, and NEVER a pass.
    cases = {
        "nonzero exit": _exec_result(returncode=3, stderr="boom"),
        "timeout": _exec_result(timed_out=True),
        "empty stdout": _exec_result(0, ""),
        "malformed json": _exec_result(0, "not json at all"),
        "non-object json": _exec_result(0, "[1, 2, 3]"),
        "spawn error": _exec_result(spawn_error="ssh: command not found"),
    }
    for name, res in cases.items():
        out = wi._classify("integrity", res)
        assert wi.is_unknown(out), "%s should be UNKNOWN" % name
        assert "ok" not in out and "current_level" not in out, "%s leaked a pass" % name

    # A REAL failing subprocess also classifies UNKNOWN (end-to-end _exec→_classify).
    real_nz = wi._classify("integrity", wi._exec(["sh", "-c", "exit 3"], 5))
    real_bad = wi._classify("current", wi._exec(["sh", "-c", "printf nope"], 5))
    assert wi.is_unknown(real_nz) and wi.is_unknown(real_bad)
    print("  shim hard-UNKNOWN on all failure modes (never a pass): PASS")


def test_shim_is_read_only_by_construction():
    # A non-read subcommand never builds an argv (→ UNKNOWN), so the shim can only
    # ever run the JSON readers — no VM write path exists.
    assert wi._build_argv("apply", []) is None
    assert wi._build_argv("rebuild_tracker", ["log"]) is None
    assert wi._level_query("apply").get("status") == "unknown"
    # Every allowlisted read subcommand DOES build a read-only ssh argv.
    for sub in wi._READ_SUBCOMMANDS:
        argv = wi._build_argv(sub, [])
        assert argv and argv[0] == "ssh"
        remote = argv[-1]
        assert "sudo -u trevor python3" in remote and "level_query.py" in remote
        # nothing mutating in the remote command
        for bad in ("rm ", "mv ", "log --", "--money-path", ">"):
            assert bad not in remote
    print("  shim read-only by construction (allowlist + no VM write path): PASS")


# ── vacuous-ok vs verified ─────────────────────────────────────────────────
def test_vacuous_ok_distinct_from_verified():
    _fresh_db()
    saved = (wi.run_all_integrity, wi.current_level)
    clean = {"ok": True, "checks": [{"check": "chain_consistency", "ok": True, "findings": []}]}
    try:
        # L0 / current_level 0 → vacuous, NOT rich.
        wi.run_all_integrity = lambda: clean
        wi.current_level = lambda: {"current_level": 0}
        r0 = wi.evaluate_integrity()
        assert r0["status"] == wi.STATUS_NOTHING_TO_CHECK and r0["ok"] is True

        # current_level UNKNOWN → still NOT rich (never over-claim).
        wi.current_level = lambda: wi._unknown("pipe down")
        r_u = wi.evaluate_integrity()
        assert r_u["status"] == wi.STATUS_NOTHING_TO_CHECK

        # POSITIVE current_level >= 1 → verified.
        wi.current_level = lambda: {"current_level": 3}
        r1 = wi.evaluate_integrity()
        assert r1["status"] == wi.STATUS_VERIFIED and r1["level"] == 3

        # A shim UNKNOWN on the integrity read → status unknown, ok=0 (could NOT confirm).
        wi.run_all_integrity = lambda: wi._unknown("boom")
        r_unk = wi.evaluate_integrity()
        assert r_unk["status"] == wi.STATUS_UNKNOWN and r_unk["ok"] is False
    finally:
        wi.run_all_integrity, wi.current_level = saved

    # The distinction is persisted + visible in findings_json.
    fs = _findings()
    statuses = [json.loads(f[2])["status"] for f in fs]
    assert wi.STATUS_NOTHING_TO_CHECK in statuses and wi.STATUS_VERIFIED in statuses
    vac = [json.loads(f[2]) for f in fs if json.loads(f[2])["status"] == wi.STATUS_NOTHING_TO_CHECK][0]
    assert vac["domain"] == "empty"
    print("  vacuous-ok distinct from verified (domain marker persisted): PASS")


# ── reconciliation: absent / only-mismatch / ranking / exactly-once ────────
def test_absent_and_pipedown_are_expected_empty():
    _fresh_db()
    absent = wi.poll_reconciliation(tail_fn=lambda s: {"status": "absent"})
    assert absent["status"] == "absent" and absent["recorded"] == 0
    down = wi.poll_reconciliation(tail_fn=lambda s: wi._unknown("pipe down"))
    assert down["status"] == "unknown" and down["recorded"] == 0
    assert not _findings()  # no alarm, no rows
    print("  absent JSONL + pipe-down are expected-empty (no alarm): PASS")


def test_reconciliation_records_only_mismatches_ranked():
    _fresh_db()
    lines = [
        json.dumps({"outcome": "agree-yes", "prompt_id": "A", "triggers": []}),
        json.dumps({"outcome": "agree-no", "prompt_id": "B", "triggers": []}),
        json.dumps({"outcome": "mismatch", "kind": "undeclared_trading_change",
                    "prompt_id": "R4-B3", "triggers": ["config.py"]}),
        json.dumps({"outcome": "mismatch", "kind": "declared_not_detected",
                    "prompt_id": "R5-C1", "triggers": []}),
        "{ not valid json",  # malformed → consume, record nothing (never stall)
    ]
    r = wi.poll_reconciliation(tail_fn=_make_tail(lines))
    assert r["recorded"] == 2 and r["consumed"] == 5
    surf = wi.surface_unresolved()
    assert [s["kind"] for s in surf] == ["undeclared_trading_change", "declared_not_detected"]
    assert surf[0]["severity"] == 2 and surf[1]["severity"] == 1
    assert wi.severity_for_kind("undeclared_trading_change") > wi.severity_for_kind("declared_not_detected")
    print("  reconciliation records only mismatches, dangerous kind ranked first: PASS")


def test_reconciliation_exactly_once_rerun():
    _fresh_db()
    lines = [json.dumps({"outcome": "mismatch", "kind": "declared_not_detected",
                         "prompt_id": "X", "triggers": []})]
    assert wi.poll_reconciliation(tail_fn=_make_tail(lines))["recorded"] == 1
    # re-run: cursor at EOF → nothing new, no duplicate.
    assert wi.poll_reconciliation(tail_fn=_make_tail(lines))["recorded"] == 0
    c = get_connection()
    try:
        assert c.execute("SELECT COUNT(*) FROM reconciliation_log").fetchone()[0] == 1
    finally:
        c.close()
    print("  reconciliation exactly-once (re-run records nothing new): PASS")


def test_reconciliation_crash_before_commit_rereads():
    _fresh_db()
    lines = [
        json.dumps({"outcome": "mismatch", "kind": "undeclared_trading_change", "prompt_id": "P1", "triggers": []}),
        json.dumps({"outcome": "mismatch", "kind": "declared_not_detected", "prompt_id": "P2", "triggers": []}),
    ]
    # utc_now is called INSERT-then-cursor per mismatch line; the 4th call is line-2's
    # cursor write. Raising there rolls back line 2's WHOLE transaction.
    real = wi.utc_now
    calls = {"n": 0}

    def boom():
        calls["n"] += 1
        if calls["n"] == 4:
            raise RuntimeError("simulated crash mid-write")
        return real()

    wi.utc_now = boom
    crash = wi.poll_reconciliation(tail_fn=_make_tail(lines))
    wi.utc_now = real  # "restart"
    assert crash["status"] == "partial" and crash["recorded"] == 1

    c = get_connection()
    try:
        assert [r[0] for r in c.execute("SELECT prompt_id FROM reconciliation_log ORDER BY id")] == ["P1"]
        assert c.execute("SELECT last_line FROM jsonl_cursor WHERE source='level_detection'").fetchone()[0] == 1
    finally:
        c.close()

    # re-read after restart: line 2 recorded exactly once — never skipped, never duplicated.
    assert wi.poll_reconciliation(tail_fn=_make_tail(lines))["recorded"] == 1
    c = get_connection()
    try:
        assert [r[0] for r in c.execute("SELECT prompt_id FROM reconciliation_log ORDER BY id")] == ["P1", "P2"]
    finally:
        c.close()
    print("  reconciliation crash-before-commit RE-READS (exactly-once, no skip): PASS")


def test_observational_resolution_never_acts():
    _fresh_db()
    # Seed two unresolved mismatches; only the one whose prompt_id is a formally-
    # applied money-path level gets marked resolved — observationally, own flag only.
    wi.poll_reconciliation(tail_fn=_make_tail([
        json.dumps({"outcome": "mismatch", "kind": "undeclared_trading_change", "prompt_id": "APPLIED", "triggers": []}),
        json.dumps({"outcome": "mismatch", "kind": "declared_not_detected", "prompt_id": "PENDING", "triggers": []}),
    ]))
    res = wi.reconcile_observed_resolutions(applied_prompt_ids={"APPLIED"})
    assert res["resolved"] == 1 and res["checked"] == 2
    remaining = wi.surface_unresolved()
    assert [s["prompt_id"] for s in remaining] == ["PENDING"]  # unresolved surfaces to Hub
    # chain unreadable → resolve NOTHING (never falsely resolve).
    _fresh_db()
    wi.poll_reconciliation(tail_fn=_make_tail([
        json.dumps({"outcome": "mismatch", "kind": "undeclared_trading_change", "prompt_id": "Z", "triggers": []}),
    ]))
    saved = wi._applied_prompt_ids
    wi._applied_prompt_ids = lambda: None  # chain UNKNOWN
    try:
        r = wi.reconcile_observed_resolutions()
    finally:
        wi._applied_prompt_ids = saved
    assert r["status"] == "unknown" and r["resolved"] == 0
    print("  observational resolution (own flag only; unknown-chain resolves nothing): PASS")


# ── W9 apply oversight ─────────────────────────────────────────────────────
def test_w9_no_new_level_is_silent():
    _fresh_db()
    saved = wi.current_level
    wi.current_level = lambda: {"current_level": 0}
    try:
        r = wi.poll_apply_oversight()
    finally:
        wi.current_level = saved
    assert r["status"] == "no_new_level"
    assert all(f[0] != "apply_oversight" for f in _findings())
    print("  W9 no-new-level is silent (pre-cutover): PASS")


def _patch_w9(current, row, integ, tested=None, cross=None):
    saved = (wi.current_level, wi.money_path_at_level, wi.run_all_integrity,
             wi.config_tested_at, wi._cross_check_config)
    wi.current_level = lambda: current
    wi.money_path_at_level = lambda n: row
    wi.run_all_integrity = lambda: integ
    wi.config_tested_at = lambda ref: (tested if tested is not None
                                       else {"populated": False, "r8_dependency": "awaiting R8"})
    if cross is not None:
        wi._cross_check_config = lambda ref: cross
    return saved


def _restore_w9(saved):
    (wi.current_level, wi.money_path_at_level, wi.run_all_integrity,
     wi.config_tested_at, wi._cross_check_config) = saved


def test_w9_correct_increment_records_clean():
    _fresh_db()
    saved = _patch_w9(
        current={"current_level": 1},
        row={"level": 1, "prompt_id": "R4-B3", "config_snapshot_ref": "cfg_x"},
        integ={"ok": True, "checks": [{"check": "increment_when_should", "ok": True, "findings": []}]},
        cross={"status": "expected_empty", "reason": "promotion_candidates absent"},
    )
    try:
        r = wi.poll_apply_oversight()
    finally:
        _restore_w9(saved)
    v = r["verified"][0]
    assert v["status"] == "apply_verified" and v["ok"] is True
    detail = json.loads([f for f in _findings() if f[0] == "apply_oversight"][0][2])
    assert detail["failures"] == []  # expected-empty config + tested are NOT faults
    assert detail["config_cross_check"]["status"] == "expected_empty"
    assert detail["config_tested_at"]["status"] == "expected_empty_awaiting_r8"
    c = get_connection()
    try:
        assert c.execute("SELECT value FROM watcher_state WHERE key='w9_last_seen_level'").fetchone()[0] == "1"
    finally:
        c.close()
    print("  W9 correct increment recorded clean (expected-empty config/tested not faults): PASS")


def test_w9_wrong_increment_records_finding_with_evidence():
    _fresh_db()
    saved = _patch_w9(
        current={"current_level": 1},
        row={"level": 1, "prompt_id": "R4-B3", "config_snapshot_ref": None},
        integ={"ok": False, "checks": [
            {"check": "increment_when_should", "ok": False,
             "findings": [{"level": 1, "level_before": 1, "level_after": 1, "why": "level_after <= level_before"}]},
        ]},
    )
    try:
        r = wi.poll_apply_oversight()
    finally:
        _restore_w9(saved)
    v = r["verified"][0]
    assert v["status"] == "apply_integrity_failed" and v["ok"] is False
    detail = json.loads([f for f in _findings() if f[0] == "apply_oversight"][0][2])
    fails = {f["check"]: f for f in detail["failures"]}
    assert "increment_when_should" in fails
    assert fails["increment_when_should"]["findings"][0]["why"] == "level_after <= level_before"
    print("  W9 wrong increment records finding w/ specific check + evidence: PASS")


def test_w9_null_prompt_id_is_a_fault():
    _fresh_db()
    saved = _patch_w9(
        current={"current_level": 1},
        row={"level": 1, "prompt_id": None, "config_snapshot_ref": None},
        integ={"ok": True, "checks": []},
    )
    try:
        r = wi.poll_apply_oversight()
    finally:
        _restore_w9(saved)
    detail = json.loads([f for f in _findings() if f[0] == "apply_oversight"][0][2])
    assert any(f["check"] == "prompt_id_present" for f in detail["failures"])
    assert r["verified"][0]["ok"] is False
    print("  W9 null prompt_id on applied row is a fault: PASS")


def test_w9_unreadable_level_does_not_advance():
    _fresh_db()
    saved = (wi.current_level, wi.money_path_at_level)
    wi.current_level = lambda: {"current_level": 2}
    wi.money_path_at_level = lambda n: wi._unknown("pipe down")
    try:
        r = wi.poll_apply_oversight()
    finally:
        wi.current_level, wi.money_path_at_level = saved
    assert r["verified"][0]["status"] == "unknown"
    # last_seen NOT advanced (retried next poll) — never a false pass, never skipped.
    c = get_connection()
    try:
        assert c.execute("SELECT value FROM watcher_state WHERE key='w9_last_seen_level'").fetchone() is None
    finally:
        c.close()
    assert all(f[0] != "apply_oversight" for f in _findings())  # no finding for a level it couldn't read
    print("  W9 unreadable level does NOT advance last_seen (retry, no skip): PASS")


def test_config_cross_check_null_is_expected_empty():
    # Hermetic: a null config_snapshot_ref never opens the replica → expected_empty.
    assert wi._cross_check_config(None)["status"] == "expected_empty"
    assert wi._cross_check_config("")["status"] == "expected_empty"
    print("  null config_snapshot_ref → expected_empty (no replica read): PASS")


# ── feature flag inertness ─────────────────────────────────────────────────
def test_flag_off_is_fully_inert():
    d = tempfile.mkdtemp(prefix="wi_off_")
    off_db = d + "/never_created.sqlite"
    os.environ["WATCHER_INTEGRITY_DB_PATH"] = off_db
    os.environ["WATCHER_INTEGRITY_ENABLED"] = ""  # OFF

    saved_run = wi.subprocess.run

    def _tripwire(*a, **k):
        raise AssertionError("subprocess.run called while flag OFF — NOT inert")

    wi.subprocess.run = _tripwire
    try:
        r = wi.run_integrity_cycle()
    finally:
        wi.subprocess.run = saved_run
    assert r["status"] == "disabled"
    # No connection opened → the DB file was never even created → no writes.
    assert not os.path.exists(off_db)
    print("  flag OFF is fully inert (no ssh, no connection, no writes): PASS")


def test_flag_on_runs_cycle_gate_only():
    # With the flag ON, the gate opens; the shim wrappers are patched so no real ssh
    # fires (hermetic). Pre-cutover-shaped stubs → all expected-empty, no alarm.
    _fresh_db()
    os.environ["WATCHER_INTEGRITY_ENABLED"] = "1"
    saved = (wi.current_level, wi.run_all_integrity, wi.money_path_at_level, wi._ssh_tail_jsonl)
    wi.current_level = lambda: {"current_level": 0}
    wi.run_all_integrity = lambda: {"ok": True, "checks": []}
    wi.money_path_at_level = lambda n: {"level": n, "prompt_id": "ENV-0", "config_snapshot_ref": None}
    wi._ssh_tail_jsonl = lambda start: {"status": "absent"}
    try:
        r = wi.run_integrity_cycle()
    finally:
        (wi.current_level, wi.run_all_integrity, wi.money_path_at_level, wi._ssh_tail_jsonl) = saved
        os.environ["WATCHER_INTEGRITY_ENABLED"] = ""
    assert r["status"] == "ran"
    assert r["reconciliation"]["status"] == "absent"
    assert r["apply_oversight"]["status"] == "no_new_level"
    assert r["integrity"]["status"] == wi.STATUS_NOTHING_TO_CHECK
    print("  flag ON runs one cycle (pre-cutover-shaped → all expected-empty): PASS")


_TESTS = [
    test_shim_hard_unknown_on_every_failure,
    test_shim_is_read_only_by_construction,
    test_vacuous_ok_distinct_from_verified,
    test_absent_and_pipedown_are_expected_empty,
    test_reconciliation_records_only_mismatches_ranked,
    test_reconciliation_exactly_once_rerun,
    test_reconciliation_crash_before_commit_rereads,
    test_observational_resolution_never_acts,
    test_w9_no_new_level_is_silent,
    test_w9_correct_increment_records_clean,
    test_w9_wrong_increment_records_finding_with_evidence,
    test_w9_null_prompt_id_is_a_fault,
    test_w9_unreadable_level_does_not_advance,
    test_config_cross_check_null_is_expected_empty,
    test_flag_off_is_fully_inert,
    test_flag_on_runs_cycle_gate_only,
]


if __name__ == "__main__":
    print("=== watcher integrity tests (R10-B2) ===")
    for t in _TESTS:
        t()
    print("=== %d/%d PASS ===" % (len(_TESTS), len(_TESTS)))
