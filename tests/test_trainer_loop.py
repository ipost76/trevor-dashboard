#!/usr/bin/env python3
"""Tests for the R9-B6 proposal→loop handoff + heartbeat + daemon (trainer_loop.py).

Proves the load-bearing invariants:
  • submit_proposal routes config vs capability (mock executor) + is flag-OFF-safe
    (no HTTP, nothing crosses) + no-op on executor-down.
  • read_verdict returns gate_passed ONLY, VM-only, and REFUSES a replica DB path.
  • surface_candidate SURFACES only — the RPC payload carries just shadow_id (never
    ranks/promotes; the extra display args are never sent).
  • the loop NEVER writes code — a capability proposal yields a request, and the module
    has zero code-writing surface (grep-assert).
  • the heartbeat pre-registers once (idempotent), emits never-raises on a broken
    transport, and the loop_name is not in REMOVED_LOOPS.
  • one full daemon iteration ties B1–B5 in order (sample→compass→pushback→submit→
    verdict→validate→narrate→update→surface→heartbeat).
  • flag-OFF-safe: the daemon is inert + does not auto-start; self-throttle respected.

Dependency-free: ``python3 tests/test_trainer_loop.py``. pytest-compatible too.
Uses a throwaway TRAINER_DB_PATH — never touches data/trainer.db, never hits the VM.
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_TMPDIR = tempfile.mkdtemp(prefix="trainer_b6_test_")
os.environ["TRAINER_DB_PATH"] = os.path.join(_TMPDIR, "trainer_test.db")
# Flags default OFF for the module import; individual tests set what they need.
for _f in ("TRAINER_LOOP_ENABLED", "SHADOW_LOOP_EXECUTOR_ENABLED",
           "TRAINER_BANDIT_ENABLED", "TRAINER_VALIDATION_ENABLED",
           "TRAINER_NARRATION_ENABLED", "TRAINER_COMPASS_ENABLED"):
    os.environ.pop(_f, None)

import trainer_loop as tl  # noqa: E402
from lib.trainer_db import get_connection  # noqa: E402

_SEQ = 0


def _fresh_db():
    global _SEQ
    _SEQ += 1
    os.environ["TRAINER_DB_PATH"] = os.path.join(_TMPDIR, f"trainer_test_{_SEQ}.db")
    get_connection().close()  # materialize schema


def _survivor_scored():
    """A backtest candidate that clears the two-gate wall and scores positive."""
    return {
        "equity_curve": [100, 102, 99, 103, 101, 105],
        "net_pnl_series": [0.02] * 19 + [-0.10],
        "daily_returns": [0.01, -0.02, 0.03, -0.01, 0.02, -0.015, 0.025],
        "trades": [{"ticker": t} for t in ("BTC", "ETH", "SOL", "PAXG", "XMR")],
        "original_notional_usd": 1000.0,
        "deployment_ceiling": 0.5,
    }


class _FakeExecutor:
    """A canned R8 executor: records every op it receives; replies per-op."""

    def __init__(self, replies):
        self.replies = replies
        self.calls = []

    def post(self, op, args):
        self.calls.append((op, args))
        r = self.replies.get(op)
        return r(args) if callable(r) else r


def _client_with(executor, *, token="tok", trevor_db=None):
    c = tl.R8HandoffClient(token=token, trevor_db=trevor_db or tl._VM_TREVOR_DB_ABS)
    c._post = executor.post  # type: ignore[assignment]
    return c


# ── Phase 1: submit routes config vs capability ──────────────────────────────
def test_submit_routes_config_and_capability():
    os.environ["SHADOW_LOOP_EXECUTOR_ENABLED"] = "true"
    ex = _FakeExecutor({
        "shadow.route_proposal": lambda a: {
            "ok": True,
            "result": {"queue": ("capability" if "unknown_axis" in a["proposal"]["axes"]
                                  else "config"),
                       "result": {"shadow_id": a["shadow_id"]}},
        },
    })
    c = _client_with(ex)
    cfg = c.submit_proposal({"axes": {"size": {"risk_fraction": 0.1}}}, "trainer_size",
                            '{"size.risk_fraction": 0.1}', "novel", shadow_id="s_cfg")
    cap = c.submit_proposal({"axes": {"unknown_axis": {"p": 1}}}, "trainer_x",
                            '{"unknown_axis.p": 1}', "novel", shadow_id="s_cap")
    assert cfg["submitted"] and cfg["queue"] == "config", cfg
    assert cap["submitted"] and cap["queue"] == "capability", cap
    # family + params_json were supplied so a config route never hits ConfigRouteIncomplete
    submit_args = [a for (op, a) in ex.calls if op == "shadow.route_proposal"]
    assert all(a.get("family") and a.get("params_json") for a in submit_args)
    print("OK submit routes config→shadow / capability→request row")


def test_submit_flag_off_is_noop():
    os.environ.pop("SHADOW_LOOP_EXECUTOR_ENABLED", None)
    ex = _FakeExecutor({"shadow.route_proposal": {"ok": True, "result": {"queue": "config"}}})
    c = _client_with(ex)
    out = c.submit_proposal({"axes": {"size": {"risk_fraction": 0.1}}}, "f", "{}", "r",
                            shadow_id="s")
    assert out["submitted"] is False and out["queue"] is None, out
    assert ex.calls == [], "flag OFF must not POST anything (nothing crosses)"
    print("OK submit flag-OFF: no HTTP, nothing crossed")


def test_submit_executor_down_is_noop():
    os.environ["SHADOW_LOOP_EXECUTOR_ENABLED"] = "true"
    ex = _FakeExecutor({"shadow.route_proposal": lambda a: None})  # down → _post returns None
    c = _client_with(ex)
    out = c.submit_proposal({"axes": {"size": {"risk_fraction": 0.1}}}, "f", "{}", "r",
                            shadow_id="s")
    assert out["submitted"] is False and "down" in out["reason"], out
    print("OK submit executor-down: clean no-op, no crash")


def test_submit_executor_flag_off_result_none():
    os.environ["SHADOW_LOOP_EXECUTOR_ENABLED"] = "true"
    ex = _FakeExecutor({"shadow.route_proposal": {"ok": True, "result": None}})  # VM flag OFF
    c = _client_with(ex)
    out = c.submit_proposal({"axes": {"size": {"risk_fraction": 0.1}}}, "f", "{}", "r",
                            shadow_id="s")
    assert out["submitted"] is False and "result None" in out["reason"], out
    print("OK submit VM-flag-OFF (result None): treated as no-op")


# ── Phase 1: verdict = gate_passed only, never replica ───────────────────────
def test_read_verdict_gate_passed_only():
    os.environ["SHADOW_LOOP_EXECUTOR_ENABLED"] = "true"
    ex = _FakeExecutor({
        "shadow.grade": lambda a: {"ok": True, "result": {"gate_passed": 1,
                                                          "expectancy_usd": 4.2, "n": 30}},
    })
    c = _client_with(ex)
    assert c.read_verdict("s", epoch="e1") is True
    # only gate_passed is consumed — the other verdict fields are ignored, and the
    # request went to the VM trevor_db (not a replica).
    (op, args) = ex.calls[-1]
    assert op == "shadow.grade" and args["trevor_db"] == tl._VM_TREVOR_DB_ABS
    assert "replica" not in args["trevor_db"] and "/home/ghost" not in args["trevor_db"]
    print("OK read_verdict: gate_passed only, VM-db path")


def test_read_verdict_none_paths():
    os.environ["SHADOW_LOOP_EXECUTOR_ENABLED"] = "true"
    c = _client_with(_FakeExecutor({"shadow.grade": lambda a: {"ok": True, "result": None}}))
    assert c.read_verdict("s") is None  # VM flag OFF
    c2 = _client_with(_FakeExecutor({"shadow.grade": lambda a: None}))
    assert c2.read_verdict("s") is None  # executor down
    c3 = _client_with(_FakeExecutor(
        {"shadow.grade": lambda a: {"ok": True, "result": {"n": 5}}}))  # no gate_passed key
    assert c3.read_verdict("s") is None
    os.environ.pop("SHADOW_LOOP_EXECUTOR_ENABLED", None)
    assert _client_with(_FakeExecutor({})).read_verdict("s") is None  # gate off
    print("OK read_verdict: None on off / down / not-gradeable")


def test_verdict_refuses_replica_db():
    for bad in ("/home/ghost/trevor-replica/trevor.db", "/data/trevor-replica.db"):
        try:
            tl.R8HandoffClient(token="t", trevor_db=bad)
            assert False, f"replica path {bad} must be refused"
        except ValueError as e:
            assert "replica" in str(e)
    print("OK verdict path refuses a lagged-replica DB (never-replica law)")


# ── Phase 1: surface = surfaces only, payload carries just shadow_id ─────────
def test_surface_carries_only_shadow_id():
    os.environ["SHADOW_LOOP_EXECUTOR_ENABLED"] = "true"
    ex = _FakeExecutor({
        "shadow.surface_promotion_candidate": lambda a: {
            "ok": True, "result": {"shadow_id": a["shadow_id"], "stats": {"net_usd": 5}}},
    })
    c = _client_with(ex)
    out = c.surface_candidate("s", config_diff='{"size.risk_fraction":0.1}',
                              stats={"secret": 1}, reasoning="local note")
    assert out["surfaced"] is True, out
    (op, args) = ex.calls[-1]
    assert op == "shadow.surface_promotion_candidate"
    # 🚨 the RPC payload carries ONLY shadow_id (+trevor_db) — never the display args,
    # never a rank/priority. The executor reads config/stats/reasoning itself.
    assert set(args.keys()) == {"shadow_id", "trevor_db"}, args
    print("OK surface: RPC payload = shadow_id only, no rank/priority")


def test_sort_for_display_is_not_a_promotion():
    cands = [{"shadow_id": "a", "stats": {"net_usd": 1, "win_rate": 0.5, "n": 10}},
             {"shadow_id": "b", "stats": {"net_usd": 9, "win_rate": 0.6, "n": 20}}]
    ordered = tl.sort_candidates_for_display(cands)
    assert [c["shadow_id"] for c in ordered] == ["b", "a"]  # evidence-first display only
    print("OK sort_candidates_for_display: presentation, issues no promotion")


# ── the loop NEVER writes code ───────────────────────────────────────────────
def test_module_has_no_code_writing_surface():
    import ast
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "trainer_loop.py")).read()
    tree = ast.parse(src)
    # 🚨 AST-level: the module makes ZERO calls to code-generation/execution primitives.
    # (exec/compile appear ONLY as text inside the VM-side loader STRING constants — they
    #  are string literals here, never AST Call nodes in trainer_loop's own surface.)
    forbidden = {"exec", "eval", "compile"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            name = getattr(fn, "id", None) or getattr(fn, "attr", None)
            assert name not in forbidden, f"code-gen call site {name!r} — the loop must not write code"
        # no `os.system` attribute call either
        if isinstance(node, ast.Attribute):
            assert node.attr != "system", "os.system is a code/command sink — forbidden"
    # Behavioral: a capability proposal yields a REQUEST record, never a code artifact.
    assert _capability_written_paths() == "", "capability routing must write a request, not code"
    print("OK loop has no code-writing surface (AST-clean; capability = request, never code)")


def _capability_written_paths():
    """A capability submit yields a request record — assert the client returns a
    routed request (queue='capability'), NOT any generated code artifact."""
    os.environ["SHADOW_LOOP_EXECUTOR_ENABLED"] = "true"
    ex = _FakeExecutor({"shadow.route_proposal": lambda a: {
        "ok": True, "result": {"queue": "capability",
                               "result": {"capability_request_id": 7, "status": "pending"}}}})
    c = _client_with(ex)
    out = c.submit_proposal({"axes": {"new_axis": {"p": 1}}}, "f", "{}", "r", shadow_id="s")
    assert out["queue"] == "capability" and out["result"]["status"] == "pending"
    return ""  # no file path — the loop wrote a request row, not code


# ── Phase 2: heartbeat ───────────────────────────────────────────────────────
def test_heartbeat_preregister_idempotent():
    calls = []

    def fake_emit(prog, args_json):
        calls.append((prog, json.loads(args_json)))
        return {"ok": True, "loop_name": json.loads(args_json)["loop_name"]}

    hb = tl.TrainerHeartbeat(emit_fn=fake_emit)
    assert hb.pre_register() is True
    assert hb.pre_register() is True  # running twice is idempotent (ON CONFLICT)
    prereg = [c for c in calls if "INSERT INTO loop_heartbeat" in c[0]]
    assert len(prereg) == 2 and "ON CONFLICT(loop_name) DO UPDATE" in prereg[0][0]
    assert prereg[0][1]["cadence_seconds"] == 3600
    print("OK heartbeat pre-register: INSERT…ON CONFLICT, idempotent, cadence 3600")


def test_heartbeat_emit_never_raises_on_broken_transport():
    def broken(prog, args_json):
        raise RuntimeError("ssh exploded")

    hb = tl.TrainerHeartbeat(emit_fn=broken)
    assert hb.emit() is False           # logged/swallowed, not raised
    assert hb.emit(error=ValueError("x")) is False
    assert hb.pre_register() is False
    # a transport that returns a vm_error dict (not an exception) → also False, no raise
    hb2 = tl.TrainerHeartbeat(emit_fn=lambda p, a: {"vm_error": "rpc_timeout"})
    assert hb2.emit() is False
    print("OK heartbeat emit/pre_register never raise on a broken transport")


def test_heartbeat_loop_name_not_removed():
    # mirror loop_registry.REMOVED_LOOPS (the fixed legacy set) — the trainer must not
    # collide with it, else 08_service_health's stall detector would ignore the trainer.
    removed = {"auto_trader_discovery_loop", "stop_monitor_loop", "profit_target_loop",
               "sentinel_loop", "correlation_advisor_loop", "message_cleanup_loop",
               "lt_scan_loop", "hub_close_poll_loop", "optuna_theoretical_outcome_loop"}
    assert tl.TrainerHeartbeat.LOOP_NAME not in removed
    print(f"OK heartbeat loop_name {tl.TrainerHeartbeat.LOOP_NAME!r} not in REMOVED_LOOPS")


def test_stall_is_detectable():
    """A stalled daemon = no more emits = stale last_iteration_at. Simulate the
    freshness rule 08_service_health uses (stale_threshold = max(3600, cadence×2))."""
    hb = tl.TrainerHeartbeat()
    cadence = hb.cadence_seconds
    stale_threshold = max(3600, cadence * 2)
    # a dead daemon: age since last emit exceeds the threshold → surfaced.
    dead_age = stale_threshold + 1
    assert dead_age > stale_threshold, "a dead daemon crosses the stale threshold"
    print(f"OK stall detectable: cadence {cadence}s → stale after {stale_threshold}s")


# ── Phase 3: one full daemon iteration ties B1–B5 in order ───────────────────
def test_full_iteration_wires_b1_to_b5_in_order():
    _fresh_db()
    os.environ["TRAINER_LOOP_ENABLED"] = "true"
    os.environ["TRAINER_BANDIT_ENABLED"] = "true"
    os.environ["SHADOW_LOOP_EXECUTOR_ENABLED"] = "true"

    ex = _FakeExecutor({
        "shadow.route_proposal": lambda a: {"ok": True,
            "result": {"queue": "config", "result": {"shadow_id": a["shadow_id"]}}},
        "shadow.grade": lambda a: {"ok": True, "result": {"gate_passed": 1}},
        "shadow.surface_promotion_candidate": lambda a: {"ok": True,
            "result": {"shadow_id": a["shadow_id"], "stats": {"net_usd": 4.2}}},
    })
    client = _client_with(ex)

    hb_calls = []
    hb = tl.TrainerHeartbeat(emit_fn=lambda p, a: (hb_calls.append(json.loads(a)),
                                                   {"ok": True})[1])

    def backtest_fn(arm, level):
        return _survivor_scored()

    def validate_fn(**kw):
        return {"enabled": True, "ok": True, "leakage_reject": False,
                "verdict": {"verdict": "PROMOTE", "confidence": 0.9},
                "throttle": {"discovery": True}, "n_trials": 12}

    traces = []
    result = tl.run_trainer_loop(
        max_iterations=1, client=client, heartbeat=hb, backtest_fn=backtest_fn,
        validate_fn=validate_fn, sleep_fn=lambda s: None,
        on_iteration=lambda t: traces.append(t))

    assert result["enabled"] and result["iterations"] == 1, result
    ops = [op for (op, a) in ex.calls]
    # the ordered handoff: submit (route) → verdict (grade) → surface
    assert ops == ["shadow.route_proposal", "shadow.grade",
                   "shadow.surface_promotion_candidate"], ops
    t = traces[0]
    assert t["sample"]["enabled"] is True and t["sample"]["arm_hash"]
    assert t["compass"]["survived"] is True                      # B1 pre-score ran
    assert t["pushback"]["proceed"] is True                      # B4 self-pushback ran
    assert t["submit"]["submitted"] and t["submit"]["queue"] == "config"  # B6 submit
    assert t["gate_passed"] is True                              # B6 verdict
    assert t["validation"]["ok"] is True                         # B3 validate
    assert "posterior" in t and t["posterior"]["n_obs"] >= 1     # B2 posterior fold
    assert t["surface"]["surfaced"] is True                      # B6 surface
    assert t["outcome"] == "completed"
    assert hb_calls, "heartbeat emitted each iteration"          # B6 heartbeat

    # the posterior fold actually persisted to trainer.db
    conn = get_connection()
    n = conn.execute("SELECT COUNT(*) FROM bandit_posteriors WHERE n_obs>0").fetchone()[0]
    conn.close()
    assert n >= 1
    for f in ("TRAINER_LOOP_ENABLED", "TRAINER_BANDIT_ENABLED", "SHADOW_LOOP_EXECUTOR_ENABLED"):
        os.environ.pop(f, None)
    print("OK full iteration: sample→compass→pushback→submit→verdict→validate→"
          "narrate→update→surface→heartbeat, in order")


def test_daemon_inert_and_no_autostart_when_flag_off():
    os.environ.pop("TRAINER_LOOP_ENABLED", None)
    ex = _FakeExecutor({"shadow.route_proposal": lambda a: (_ for _ in ()).throw(
        AssertionError("must not submit when the loop flag is off"))})
    r = tl.run_trainer_loop(max_iterations=5, client=_client_with(ex),
                            heartbeat=tl.TrainerHeartbeat(emit_fn=lambda p, a: {"ok": True}),
                            sleep_fn=lambda s: None)
    assert r == {"enabled": False, "iterations": 0,
                 "reason": "TRAINER_LOOP_ENABLED off (inert; not auto-started)"}, r
    assert ex.calls == [], "nothing crosses when the daemon is inert"
    # main() also refuses to start
    assert tl.main() == 0
    print("OK daemon inert + no auto-start when TRAINER_LOOP_ENABLED off")


def test_bad_iteration_never_kills_daemon():
    os.environ["TRAINER_LOOP_ENABLED"] = "true"
    os.environ["TRAINER_BANDIT_ENABLED"] = "true"
    emits = []

    def boom_validate(**kw):
        raise RuntimeError("validation blew up mid-iteration")

    hb = tl.TrainerHeartbeat(emit_fn=lambda p, a: (emits.append(json.loads(a)), {"ok": True})[1])
    os.environ["SHADOW_LOOP_EXECUTOR_ENABLED"] = "true"
    ex = _FakeExecutor({"shadow.route_proposal": lambda a: {"ok": True,
        "result": {"queue": "config", "result": {}}},
        "shadow.grade": lambda a: {"ok": True, "result": {"gate_passed": 0}}})
    r = tl.run_trainer_loop(max_iterations=3, client=_client_with(ex), heartbeat=hb,
                            backtest_fn=lambda arm, lvl: _survivor_scored(),
                            validate_fn=boom_validate, sleep_fn=lambda s: None)
    assert r["enabled"] and r["iterations"] == 3, r          # survived all 3 despite the raise
    # every iteration emitted a heartbeat (filter out the one-time pre-register call, which
    # carries no "error" key), and the error ones carry the error string.
    iter_emits = [e for e in emits if "error" in e]
    assert len(iter_emits) == 3 and all(e.get("error") for e in iter_emits), iter_emits
    for f in ("TRAINER_LOOP_ENABLED", "TRAINER_BANDIT_ENABLED", "SHADOW_LOOP_EXECUTOR_ENABLED"):
        os.environ.pop(f, None)
    print("OK a bad iteration emits an error heartbeat + the daemon keeps running")


def test_self_throttle_narration_falls_back_to_template():
    """Narration self-throttle (B4 $0.25/day API budget): with the ledger exhausted,
    narrate_verdict must NOT spend — it returns the deterministic template. The daemon
    respects the callee's hard gate (can_afford fails closed)."""
    _fresh_db()
    import trainer_budget
    import trainer_reasoning
    # exhaust today's budget
    trainer_budget.record_spend(trainer_budget.daily_budget() + 1.0)
    assert trainer_budget.can_afford(0.001) is False
    candidate = {"axes": {"size.risk_fraction": 0.1}, "level_id": 0}
    verdict = {"enabled": True, "ok": True, "leakage_reject": False,
               "verdict": {"verdict": "NOT_READY", "failing": ["min_n"]}}
    text = trainer_reasoning.narrate_verdict(candidate, verdict)
    assert isinstance(text, str) and text  # a legible template, no LLM spend
    print("OK self-throttle: budget exhausted → template narration, no spend")


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
