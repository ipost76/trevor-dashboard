#!/usr/bin/env python3
"""Tests for T1's OBSERVE-ONLY (paper-window) mode — §D.9 step 3.

The mode exists because §D.9 step 3 ("NO leveling · NO promotions") and ``main()``'s
below-L1 refusal are each correct and jointly a DEADLOCK: the refusal has no mode, so the
only way to run the loop was to mint a level the design forbids minting. These tests pin
the properties that make the mode safe to arm:

  • it RUNS at level 0 without minting and without ``TRAINER_LOOP_ENABLED``;
  • it PROVABLY cannot propose or promote — driven, not asserted: the same arm is pushed
    through the normal path (which DOES call submit/surface) and the observe path (which
    calls neither), and the ``ObserveOnlyClient`` raises on every handoff so a future
    missed branch fails LOUDLY instead of crossing to the VM;
  • ``main()``'s L1 refusal is UNTOUCHED — still rc=1 at level 0 and on hard-UNKNOWN;
  • [B0]'s required ``level=`` is intact in BOTH modes;
  • the two flags are INDEPENDENT — arming observation must not arm proposing;
  • 🚨 with no ``backtest_fn`` the mode is DEGRADED and says so: ``rewards_folded == 0``,
    while a ``bandit_posteriors`` ROW is still written by SAMPLING carrying an UNTOUCHED
    Beta(1,1)/n_obs=0 prior. A row count is NOT discovery — that misreading is pinned
    here as wrong, because it is the one an operator watching the paper window would make.

Dependency-free: ``python3 tests/test_trainer_observe_mode.py``. Never touches
``data/*.db`` (containment below) and never reaches the VM (every seam is injected).
"""
import os
import random
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import _containment  # noqa: E402

_containment.activate()

for _f in ("TRAINER_LOOP_ENABLED", "TRAINER_OBSERVE_ONLY_ENABLED",
           "SHADOW_LOOP_EXECUTOR_ENABLED", "TRAINER_VALIDATION_ENABLED",
           "TRAINER_NARRATION_ENABLED", "TRAINER_TEACH_ENABLED",
           "TRAINER_LEVEL_DETECTOR_ENABLED", "TRAINER_PAUSE_POLL_ENABLED",
           "MEMORY_REASONING_ENABLED", "MEMORY_QUERY_ENABLED",
           "TRAINER_BACKTEST_PROVIDER", "SHADOW_EXECUTOR_TOKEN"):
    os.environ.pop(_f, None)
os.environ["TRAINER_BANDIT_ENABLED"] = "true"
os.environ["TRAINER_COMPASS_ENABLED"] = "true"
# Layer 3 (unreachable destinations) — belt to the injected seams' braces.
os.environ["TRAINER_VM_HOST"] = "t1-invalid-host.invalid"
os.environ["TRAINER_EXECUTOR_URL"] = "http://127.0.0.1:1"

import trainer_loop as tl  # noqa: E402

_FAILED = []


def _assert(cond, msg):
    if not cond:
        raise AssertionError(msg)


def _survivor():
    """A backtest candidate that clears the two-gate wall and scores positive."""
    return {"equity_curve": [100, 102, 99, 103, 101, 105],
            "net_pnl_series": [0.02] * 19 + [-0.10],
            "daily_returns": [0.01, -0.02, 0.03, -0.01, 0.02, -0.015, 0.025],
            "trades": [{"ticker": t} for t in ("BTC", "ETH", "SOL", "PAXG", "XMR")],
            "original_notional_usd": 1000.0, "deployment_ceiling": 0.5}


class _RecordingClient:
    """Records which handoffs a path reaches. Crosses nothing."""

    def __init__(self):
        self.calls = []

    def submit_proposal(self, *a, **k):
        self.calls.append("submit_proposal")
        return {"submitted": True, "queue": "config", "reason": "stub"}

    def read_verdict(self, *a, **k):
        self.calls.append("read_verdict")
        return True

    def surface_candidate(self, *a, **k):
        self.calls.append("surface_candidate")
        return {"surfaced": True, "reason": "stub"}

    def sweep_stale_on_flip(self, *a, **k):
        self.calls.append("sweep_stale_on_flip")
        return {"ok": True, "reason": "stub"}


class _StubHeartbeat(tl.TrainerHeartbeat):
    """🚨 A REAL pre_register writes a `trainer_search_loop` row to the VM's trevor.db.
    That row is the evidence the daemon has never run; a test must never mint it."""

    def __init__(self):
        super().__init__(emit_fn=lambda p, a: {"ok": True})
        self.calls = []
        self.errors = []

    def pre_register(self):
        self.calls.append("pre_register")
        return True

    def emit(self, error=None):
        self.calls.append("emit")
        if error:
            self.errors.append(str(error))
        return True


def _validate_ok(**kw):
    return {"enabled": True, "ok": True, "leakage_reject": False,
            "verdict": {"verdict": "PROMOTE", "confidence": 0.9},
            "throttle": {"discovery": True}, "n_trials": 12}


def _fresh_store(tag):
    """A brand-new scratch store so two runs start from identical posteriors."""
    base = os.path.dirname(os.environ["TRAINER_DB_PATH"])
    p = os.path.join(base, f"observe_{tag}.db")
    if os.path.exists(p):
        os.remove(p)
    os.environ["TRAINER_DB_PATH"] = p
    return p


def _posteriors(db):
    if not os.path.exists(db):
        return []
    c = sqlite3.connect(db)
    try:
        return c.execute("SELECT alpha, beta, n_obs FROM bandit_posteriors").fetchall()
    finally:
        c.close()


# ── the tests ───────────────────────────────────────────────────────────────
def test_observe_runs_at_level_0_without_the_propose_flag():
    """The deadlock's resolution: level 0 runs, and LOOP_FLAG is not what arms it."""
    _fresh_store("runs")
    os.environ.pop("TRAINER_LOOP_ENABLED", None)
    os.environ["TRAINER_OBSERVE_ONLY_ENABLED"] = "true"
    res = tl.run_trainer_loop(
        level=0, max_iterations=1, observe_only=True, client=_RecordingClient(),
        heartbeat=_StubHeartbeat(), backtest_fn=lambda a, l: _survivor(),
        validate_fn=_validate_ok, rng=random.Random(1234), sleep_fn=lambda s: None,
        level_reader=lambda: (0, "ok"))
    _assert(tl.loop_enabled() is False, "LOOP_FLAG must be OFF for this test to mean anything")
    _assert(res["iterations"] == 1, f"expected 1 iteration, got {res}")
    _assert(res["mode"] == "observe_only", res)
    print("  observe runs at level 0 with TRAINER_LOOP_ENABLED off: PASS")


def test_same_arm_proposes_on_the_normal_path_and_not_on_observe():
    """🚨 DRIVEN, not asserted: one arm, two paths, opposite behaviour."""
    os.environ["TRAINER_LOOP_ENABLED"] = "true"
    os.environ.pop("TRAINER_OBSERVE_ONLY_ENABLED", None)
    _fresh_store("normal")
    normal = _RecordingClient()
    t_n = []
    tl.run_trainer_loop(level=0, max_iterations=1, client=normal, heartbeat=_StubHeartbeat(),
                        backtest_fn=lambda a, l: _survivor(), validate_fn=_validate_ok,
                        rng=random.Random(1234), sleep_fn=lambda s: None,
                        on_iteration=t_n.append)
    _assert("submit_proposal" in normal.calls, f"normal path did not propose: {normal.calls}")
    _assert("surface_candidate" in normal.calls, f"normal path did not surface: {normal.calls}")

    os.environ.pop("TRAINER_LOOP_ENABLED", None)
    os.environ["TRAINER_OBSERVE_ONLY_ENABLED"] = "true"
    _fresh_store("observe")
    obs = _RecordingClient()
    t_o = []
    res = tl.run_trainer_loop(level=0, max_iterations=1, observe_only=True, client=obs,
                              heartbeat=_StubHeartbeat(),
                              backtest_fn=lambda a, l: _survivor(), validate_fn=_validate_ok,
                              rng=random.Random(1234), sleep_fn=lambda s: None,
                              level_reader=lambda: (0, "ok"), on_iteration=t_o.append)
    _assert(t_n[0]["sample"]["arm_hash"] == t_o[0]["sample"]["arm_hash"],
            "the two paths must be driven with the SAME arm or the comparison is empty")
    _assert(obs.calls == [], f"observe path reached a handoff: {obs.calls}")
    _assert(res["proposed"] is False and res["promoted"] is False, res)
    _assert(res["observe_violations"] == [], res)
    _assert(len(t_o[0]["skipped_in_observe"]) == 5, t_o[0])
    print("  same arm: normal path proposes+surfaces, observe path does neither: PASS")


def test_observe_client_refuses_every_handoff_loudly():
    """The structural backstop: a MISSED BRANCH must fail loudly, not cross."""
    c = tl.ObserveOnlyClient()
    for op in ("submit_proposal", "read_verdict", "surface_candidate", "sweep_stale_on_flip"):
        try:
            getattr(c, op)("x")
            raise AssertionError(f"{op} did not raise")
        except tl.ObserveOnlyViolation:
            pass
    _assert(len(c.violations) == 4, c.violations)
    print("  ObserveOnlyClient raises on all 4 handoffs and records them: PASS")


def test_main_l1_refusal_is_untouched():
    """🚨 The mode must not have weakened the control it routes around."""
    os.environ["TRAINER_LOOP_ENABLED"] = "true"
    _assert(tl.main(reader=lambda: (0, "ok")) == 1, "main() must refuse at level 0")
    _assert(tl.main(reader=lambda: (None, "unreachable")) == 1,
            "main() must refuse on hard-UNKNOWN")
    os.environ["TRAINER_OBSERVE_ONLY_ENABLED"] = "true"
    _assert(tl.observe_main(reader=lambda: (None, "unreachable")) == 1,
            "observe_main() must ALSO refuse on hard-UNKNOWN — a guessed level is B0's "
            "corruption by another road")
    os.environ.pop("TRAINER_LOOP_ENABLED", None)
    print("  main() rc=1 at level 0 and on UNKNOWN; observe_main rc=1 on UNKNOWN: PASS")


def test_b0_required_level_intact_in_both_modes():
    for kwargs in ({}, {"observe_only": True}):
        try:
            tl.run_trainer_loop(max_iterations=1, client=_RecordingClient(),
                                heartbeat=_StubHeartbeat(), **kwargs)
            raise AssertionError(f"omitting level= did not raise (kwargs={kwargs})")
        except TypeError as exc:
            _assert("level" in str(exc), str(exc))
    print("  [B0]: omitting level= still raises TypeError in both modes: PASS")


def test_flags_are_independent():
    os.environ.pop("TRAINER_OBSERVE_ONLY_ENABLED", None)
    off = tl.run_trainer_loop(level=0, max_iterations=1, observe_only=True,
                              client=_RecordingClient(), heartbeat=_StubHeartbeat(),
                              level_reader=lambda: (0, "ok"))
    _assert(off["enabled"] is False and off["iterations"] == 0, off)

    os.environ["TRAINER_OBSERVE_ONLY_ENABLED"] = "true"
    os.environ.pop("TRAINER_LOOP_ENABLED", None)
    propose = tl.run_trainer_loop(level=0, max_iterations=1, client=_RecordingClient(),
                                  heartbeat=_StubHeartbeat())
    _assert(propose["enabled"] is False,
            "🚨 arming OBSERVE must never arm the PROPOSE path — that would defeat the "
            "DO-NOT-ENABLE-PENDING-L1 control rather than satisfy it")
    print("  observe flag OFF ⇒ inert; observe flag ON does not arm proposing: PASS")


def test_no_provider_is_degraded_and_a_row_count_is_not_discovery():
    """🚨 THE MISREADING THIS TEST EXISTS TO PREVENT.

    With no simulator the mode still writes a ``bandit_posteriors`` row — SAMPLING writes
    it, before any reward exists. An operator watching the paper window who reads
    ``SELECT COUNT(*)`` as progress will conclude the trainer is learning when its
    posterior is the untouched uniform prior. ``rewards_folded``/``n_obs`` is the signal."""
    os.environ["TRAINER_OBSERVE_ONLY_ENABLED"] = "true"
    os.environ.pop("TRAINER_LOOP_ENABLED", None)

    db_nosim = _fresh_store("nosim")
    hb = _StubHeartbeat()
    res_nosim = tl.run_trainer_loop(level=0, max_iterations=1, observe_only=True,
                                    client=_RecordingClient(), heartbeat=hb,
                                    backtest_fn=None, validate_fn=_validate_ok,
                                    rng=random.Random(1234), sleep_fn=lambda s: None,
                                    level_reader=lambda: (0, "ok"))
    _assert(res_nosim["simulating"] is False, res_nosim)
    _assert(res_nosim["rewards_folded"] == 0, res_nosim)
    _assert("degraded" in res_nosim, res_nosim)
    _assert(any("no_simulator" in e for e in hb.errors),
            f"the heartbeat must carry the degraded state VM-side: {hb.errors}")
    _assert(_posteriors(db_nosim) == [(1.0, 1.0, 0)],
            f"expected ONE untouched Beta(1,1)/n_obs=0 row, got {_posteriors(db_nosim)}")

    db_sim = _fresh_store("sim")
    res_sim = tl.run_trainer_loop(level=0, max_iterations=1, observe_only=True,
                                  client=_RecordingClient(), heartbeat=_StubHeartbeat(),
                                  backtest_fn=lambda a, l: _survivor(),
                                  validate_fn=_validate_ok, rng=random.Random(1234),
                                  sleep_fn=lambda s: None, level_reader=lambda: (0, "ok"))
    sim_rows = _posteriors(db_sim)
    _assert(res_sim["simulating"] is True and res_sim["rewards_folded"] == 1, res_sim)
    _assert(sim_rows and sim_rows[0][2] == 1 and sim_rows[0][0] != 1.0,
            f"with a provider the posterior must MOVE: {sim_rows}")
    _assert(len(_posteriors(db_nosim)) == len(sim_rows),
            "the row COUNT is identical in both cases — which is exactly why a count "
            "must never be read as discovery")
    print("  no-provider: rewards_folded=0, row IS written but is an untouched prior: PASS")


def test_level_move_stops_the_observe_loop():
    """[B0]'s corruption caught at RUNTIME: L1 minting mid-window must stop the loop."""
    _fresh_store("levelmove")
    os.environ["TRAINER_OBSERVE_ONLY_ENABLED"] = "true"
    seq = [(0, "ok"), (1, "ok")]
    res = tl.run_trainer_loop(level=0, max_iterations=5, observe_only=True,
                              client=_RecordingClient(), heartbeat=_StubHeartbeat(),
                              backtest_fn=lambda a, l: _survivor(), validate_fn=_validate_ok,
                              rng=random.Random(7), sleep_fn=lambda s: None,
                              level_reader=lambda: seq.pop(0) if seq else (1, "ok"))
    _assert(res["iterations"] < 5, f"the loop should have stopped early: {res}")
    _assert("level_moved 0->1" in str(res.get("stopped_reason")), res)
    print("  a level move under the observe loop STOPS it, loudly: PASS")


def test_unknown_level_midrun_does_not_stop_it():
    """Asymmetric on purpose: a transport blip must not halt a trainer with nothing at stake."""
    _fresh_store("unknown")
    os.environ["TRAINER_OBSERVE_ONLY_ENABLED"] = "true"
    res = tl.run_trainer_loop(level=0, max_iterations=2, observe_only=True,
                              client=_RecordingClient(), heartbeat=_StubHeartbeat(),
                              backtest_fn=lambda a, l: _survivor(), validate_fn=_validate_ok,
                              rng=random.Random(3), sleep_fn=lambda s: None,
                              level_reader=lambda: (None, "vm unreachable"))
    _assert(res["iterations"] == 2, f"an UNKNOWN re-read must not stop the loop: {res}")
    _assert("stopped_reason" not in res, res)
    print("  an UNKNOWN mid-run level read is surfaced but does NOT stop the loop: PASS")


TESTS = [test_observe_runs_at_level_0_without_the_propose_flag,
         test_same_arm_proposes_on_the_normal_path_and_not_on_observe,
         test_observe_client_refuses_every_handoff_loudly,
         test_main_l1_refusal_is_untouched,
         test_b0_required_level_intact_in_both_modes,
         test_flags_are_independent,
         test_no_provider_is_degraded_and_a_row_count_is_not_discovery,
         test_level_move_stops_the_observe_loop,
         test_unknown_level_midrun_does_not_stop_it]

if __name__ == "__main__":
    print("=== T1 observe-only mode tests (§D.9 step 3) ===")
    for t in TESTS:
        try:
            t()
        except Exception as exc:  # noqa: BLE001 — a harness must report, not crash
            _FAILED.append(t.__name__)
            print(f"  {t.__name__}: FAIL — {exc}")
    print(f"=== {len(TESTS) - len(_FAILED)}/{len(TESTS)} PASS ===")
    raise SystemExit(1 if _FAILED else 0)
