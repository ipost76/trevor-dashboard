#!/usr/bin/env python3
"""RP-C2 — the trainer ORCHESTRATION wiring proof (trainer_loop.main → REWARD_K).

RD-B8 rescaled ``REWARD_K`` to 1/550 and proved the constant correct. This file exists
because NOTHING RAN IT. The defect was two links, both measured at the RP-C2 gate:

  A. no process invoker — ``deploy/systemd/wsl/trevor-trainer.service`` was authored
     in-repo but never installed; no cron, no timer. (Closed by installing the unit
     DISABLED; not testable from here, verified with systemctl.)
  B. 🚨 no ``backtest_fn`` delivery path — ``main()`` called ``run_trainer_loop(level=level)``
     and never passed one. ``_run_one_iteration``'s ``if backtest_fn is not None`` is the
     ONLY route to ``trainer_bandit.compass_reward`` and hence to ``REWARD_K``, so the
     constant was unreachable from the entrypoint EVEN IF the daemon were armed.

What these tests prove, and what they do NOT:
  ✅ the chain main() → run_trainer_loop → _run_one_iteration → _reward_from →
     compass_reward → REWARD_K executes end to end, through the REAL code path.
  ✅ with no provider configured the behaviour is byte-identical to pre-RP-C2.
  ✅ the below-L1 refusal still refuses (this change must not weaken it).
  🚫 NOT that the trainer runs in production. It does not: `MAX(level)` is 0, the unit is
     disabled, the flags are off, and a REAL `backtest_fn` does not exist (RP-C3 / D-5).
     Production reachability of REWARD_K remains PENDING RP-C3.

Nothing here arms anything: the level is a FIXTURE (never minted, never read from the VM),
flags are set in-process and popped in a `finally`, the executor and heartbeat are fakes,
and no unit is enabled or started.

Dependency-free: ``python3 tests/test_trainer_orchestration.py``. pytest-compatible too.
(pytest is NOT installed in this venv — the ``__main__`` self-runner is the WSL test path.)
Uses a throwaway TRAINER_DB_PATH — never touches data/trainer.db, never hits the VM.
"""
import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # so `fixtures.*` resolves

_TMPDIR = tempfile.mkdtemp(prefix="trainer_c2_test_")
os.environ["TRAINER_DB_PATH"] = os.path.join(_TMPDIR, "trainer_test.db")
_FLAGS = ("TRAINER_LOOP_ENABLED", "SHADOW_LOOP_EXECUTOR_ENABLED", "TRAINER_BANDIT_ENABLED",
          "TRAINER_VALIDATION_ENABLED", "TRAINER_NARRATION_ENABLED", "TRAINER_COMPASS_ENABLED",
          "TRAINER_BACKTEST_PROVIDER")
for _f in _FLAGS:
    os.environ.pop(_f, None)

import trainer_bandit as tb  # noqa: E402
import trainer_loop as tl  # noqa: E402
from lib.trainer_db import get_connection  # noqa: E402

PROVIDER = "fixtures.trainer_backtest_stub:backtest_fn"
_SEQ = 0


def _fresh_db():
    global _SEQ
    _SEQ += 1
    os.environ["TRAINER_DB_PATH"] = os.path.join(_TMPDIR, f"trainer_c2_{_SEQ}.db")
    get_connection().close()  # materialize schema


class _FakeExecutor:
    """A canned R8 executor — records every op, replies per-op. Nothing crosses to the VM."""

    def __init__(self):
        self.calls = []
        self.replies = {
            "shadow.route_proposal": lambda a: {
                "ok": True, "result": {"queue": "config",
                                       "result": {"shadow_id": a["shadow_id"]}}},
            "shadow.grade": lambda a: {"ok": True, "result": {"gate_passed": 1}},
            "shadow.surface_promotion_candidate": lambda a: {
                "ok": True, "result": {"shadow_id": a["shadow_id"], "stats": {"net_usd": 4.2}}},
        }

    def post(self, op, args):
        self.calls.append((op, args))
        r = self.replies.get(op)
        return r(args) if callable(r) else r


def _validate_fn(**kw):
    return {"enabled": True, "ok": True, "leakage_reject": False,
            "verdict": {"verdict": "PROMOTE", "confidence": 0.9},
            "throttle": {"discovery": True}, "n_trials": 12}


def _drive_main(*, level=7, provider=None, backtest_fn=None):
    """Drive the REAL ``tl.main()`` at a FIXTURE level, with the REAL ``run_trainer_loop``
    bounded to one iteration.

    Only the loop BOUND, the sleep, the executor and the heartbeat are fixtures — the
    sample → compass → pushback → submit → verdict → validate → reward-fold path is the
    real production code. ``run_trainer_loop`` is wrapped (not replaced) so we can also
    capture WHAT ``main()`` passed it, which is the wiring under test.
    """
    _fresh_db()
    os.environ["TRAINER_LOOP_ENABLED"] = "true"
    os.environ["TRAINER_BANDIT_ENABLED"] = "true"
    os.environ["SHADOW_LOOP_EXECUTOR_ENABLED"] = "true"
    if provider:
        os.environ["TRAINER_BACKTEST_PROVIDER"] = provider
    else:
        os.environ.pop("TRAINER_BACKTEST_PROVIDER", None)

    ex = _FakeExecutor()
    client = tl.R8HandoffClient(token="tok", trevor_db=tl._VM_TREVOR_DB_ABS)
    client._post = ex.post
    hb = tl.TrainerHeartbeat(emit_fn=lambda p, a: {"ok": True})

    captured, traces, reward_calls = {}, [], []
    real_loop = tl.run_trainer_loop
    real_reward = tb.compass_reward

    def bounded_loop(**kw):
        captured.update(kw)
        return real_loop(max_iterations=1, sleep_fn=lambda s: None, client=client,
                         heartbeat=hb, validate_fn=_validate_fn,
                         on_iteration=traces.append, **kw)

    def reward_spy(verdict, **kw):
        r = real_reward(verdict, **kw)
        reward_calls.append((verdict, r))
        return r

    tl.run_trainer_loop = bounded_loop
    tb.compass_reward = reward_spy
    # 🚨 `backtest_fn` is passed ONLY when explicitly given, so the default drive calls
    # main() with a signature the PRE-RP-C2 code also accepts. That is what lets this exact
    # test run against the unwired build and fail on the REWARD discriminator rather than
    # on a TypeError — the difference between proving the wiring and proving a signature.
    kw = {"backtest_fn": backtest_fn} if backtest_fn is not None else {}
    try:
        rc = tl.main(reader=lambda: (level, "fixture"), **kw)
    finally:
        tl.run_trainer_loop = real_loop
        tb.compass_reward = real_reward
        for f in _FLAGS:
            os.environ.pop(f, None)
    return {"rc": rc, "captured": captured, "traces": traces, "reward_calls": reward_calls,
            "ops": [op for (op, a) in ex.calls]}


# ── 1. THE WIRING PROOF ──────────────────────────────────────────────────────
def test_main_delivers_backtest_fn_and_reaches_reward_k():
    """🚨 THE test. main() at a simulated level >= 1 drives the real chain into
    compass_reward, and the folded posterior reward is REWARD_K's value — not a fallback.

    Fails on the unwired code: main() passed no backtest_fn, so the compass branch was
    skipped, compass_reward was never called, and _reward_from returned the gate-passed
    fallback 1.0."""
    out = _drive_main(provider=PROVIDER)

    assert out["rc"] == 0, out["rc"]
    # (a) main() actually DELIVERED a simulator — the link that did not exist.
    assert out["captured"].get("backtest_fn") is not None, \
        f"main() passed no backtest_fn — the RP-C2 link is missing: {out['captured']!r}"
    assert out["captured"].get("level") == 7, out["captured"]

    # (b) the compass pre-score branch ran (it is the ONLY door to REWARD_K).
    t = out["traces"][0]
    assert isinstance(t.get("compass"), dict) and t["compass"]["survived"] is True, t.get("compass")

    # (c) compass_reward was genuinely called — not inferred from a matching number.
    assert out["reward_calls"], "compass_reward was never called — REWARD_K unreached"
    verdict, r = out["reward_calls"][-1]
    blend = verdict["blend_score"]

    # (d) the value is REWARD_K's, recomputed independently from the live constant.
    #     ⚠️ isclose, never exact equality: reward(30) = 0.9999999999999252, not 1.0.
    expected = 0.6 + math.tanh(tb.REWARD_K * blend) * 0.4
    assert math.isclose(r, expected, rel_tol=1e-12), (r, expected, tb.REWARD_K)

    # (e) THE DISCRIMINATOR — it is not any _reward_from fallback. gate_passed is True
    #     here, so unwired code would have folded exactly 1.0.
    folded = t["posterior"]["reward"]
    for fallback in (1.0, 0.4, 0.0):
        assert not math.isclose(folded, fallback, abs_tol=1e-3), \
            f"folded reward {folded} is the {fallback} fallback — compass path did NOT run"
    assert math.isclose(folded, round(r, 4), abs_tol=1e-9), (folded, r)

    # (f) the fixture sits inside the measured safe band, so this raises no false alarm.
    assert tb.SAFE_BAND_LO < blend < tb.SAFE_BAND_HI, (blend, tb.SAFE_BAND_LO, tb.SAFE_BAND_HI)
    print(f"OK main() → run_trainer_loop → _run_one_iteration → _reward_from → "
          f"compass_reward → REWARD_K=1/{1.0 / tb.REWARD_K:.6g}: blend={blend:.4f} "
          f"reward={r:.6f} (fallback would be 1.0)")


# ── 2. THE NEGATIVE CONTROL — proves test 1 is sharp ─────────────────────────
def test_without_provider_reward_k_is_never_reached():
    """The pre-RP-C2 behaviour, pinned. No provider → no backtest_fn → compass_reward is
    NEVER called and the fold takes the gate-passed 1.0 fallback.

    🚨 This is what test 1 looked like before the fix. Keeping it makes test 1 a real
    discriminator rather than a number that happens to match."""
    out = _drive_main(provider=None)

    assert out["rc"] == 0, out["rc"]
    assert out["captured"].get("backtest_fn") is None, out["captured"]
    assert out["reward_calls"] == [], "compass_reward ran with no simulator configured"
    t = out["traces"][0]
    assert t["compass"] == "skipped (no backtest_fn — VM verdict authoritative)", t["compass"]
    assert math.isclose(t["posterior"]["reward"], 1.0, abs_tol=1e-9), t["posterior"]
    print("OK negative control: no provider → compass_reward never called, fold = 1.0 fallback")


# ── 3. BYTE-IDENTICAL WHEN UNCONFIGURED ──────────────────────────────────────
def test_resolver_absent_is_none_and_blank_is_none():
    """Unset (and blank/whitespace) → None → run_trainer_loop(backtest_fn=None), the exact
    pre-RP-C2 call shape. The default install can never reach the refusal path."""
    os.environ.pop("TRAINER_BACKTEST_PROVIDER", None)
    assert tl._resolve_backtest_fn() is None
    for blank in ("", "   ", "\t"):
        os.environ["TRAINER_BACKTEST_PROVIDER"] = blank
        assert tl._resolve_backtest_fn() is None, repr(blank)
    os.environ.pop("TRAINER_BACKTEST_PROVIDER", None)
    print("OK resolver: absent/blank → None (byte-identical to pre-RP-C2)")


def test_resolver_resolves_and_refuses_loudly():
    """A good spec resolves to the callable; a bad one RAISES rather than silently falling
    back to None — a named-but-missing simulator would make the survival gates blind."""
    os.environ["TRAINER_BACKTEST_PROVIDER"] = PROVIDER
    fn = tl._resolve_backtest_fn()
    assert callable(fn), fn
    bt = fn({"any": "arm"}, 7)
    assert set(bt) >= {"equity_curve", "net_pnl_series", "daily_returns", "trades"}, sorted(bt)

    for bad in ("no_colon", "nonexistent_module_xyz:fn", "fixtures.trainer_backtest_stub:missing",
                "fixtures.trainer_backtest_stub:_DAILY_RETURNS"):
        os.environ["TRAINER_BACKTEST_PROVIDER"] = bad
        try:
            tl._resolve_backtest_fn()
        except ValueError as exc:
            assert "TRAINER_BACKTEST_PROVIDER" in str(exc), str(exc)
        else:
            raise AssertionError(f"{bad!r} resolved silently — must refuse loudly")
    os.environ.pop("TRAINER_BACKTEST_PROVIDER", None)
    print("OK resolver: resolves a good spec; refuses loudly on malformed/missing/non-callable")


# ── 4. THE REFUSAL MUST STILL REFUSE ─────────────────────────────────────────
def test_below_l1_still_refuses_and_never_resolves_a_provider():
    """🚨 RP-C2 must not weaken RF1-B2. At the live level 0 (today's VM truth) main() still
    refuses rc=1 — and refuses BEFORE resolving any provider, so a broken provider can never
    convert a clean refusal into a crash."""
    os.environ["TRAINER_LOOP_ENABLED"] = "true"
    os.environ["TRAINER_BACKTEST_PROVIDER"] = "nonexistent_module_xyz:fn"  # would raise if read
    called = []
    real_loop = tl.run_trainer_loop
    tl.run_trainer_loop = lambda **kw: called.append(kw)
    try:
        for lvl, label in ((0, "empty/unminted chain"), (None, "hard-UNKNOWN")):
            rc = tl.main(reader=lambda: (lvl, "fixture"))
            assert rc == 1, f"level={lvl} ({label}) must refuse rc=1, got {rc}"
        assert called == [], "the loop was constructed despite a refusal"
    finally:
        tl.run_trainer_loop = real_loop
        for f in _FLAGS:
            os.environ.pop(f, None)
    print("OK below-L1 refusal intact (rc=1 at level 0 and on hard-UNKNOWN); provider never read")


def test_flag_off_is_inert_and_resolves_nothing():
    """Master flag off → rc=0, no loop, no provider resolution. Unchanged by RP-C2."""
    for f in _FLAGS:
        os.environ.pop(f, None)
    os.environ["TRAINER_BACKTEST_PROVIDER"] = "nonexistent_module_xyz:fn"  # would raise if read
    called = []
    real_loop = tl.run_trainer_loop
    tl.run_trainer_loop = lambda **kw: called.append(kw)
    try:
        assert tl.main() == 0
        assert called == [], "the loop ran with the master flag off"
    finally:
        tl.run_trainer_loop = real_loop
        os.environ.pop("TRAINER_BACKTEST_PROVIDER", None)
    print("OK flag-OFF inert: no loop, no provider resolution")


TESTS = [
    test_main_delivers_backtest_fn_and_reaches_reward_k,
    test_without_provider_reward_k_is_never_reached,
    test_resolver_absent_is_none_and_blank_is_none,
    test_resolver_resolves_and_refuses_loudly,
    test_below_l1_still_refuses_and_never_resolves_a_provider,
    test_flag_off_is_inert_and_resolves_nothing,
]

if __name__ == "__main__":
    print("=== trainer orchestration wiring tests (RP-C2) ===")
    failed = 0
    for t in TESTS:
        try:
            t()
        except Exception as exc:
            failed += 1
            print(f"FAIL {t.__name__}: {exc!r}")
    print(f"=== {len(TESTS) - failed}/{len(TESTS)} passed ===")
    raise SystemExit(1 if failed else 0)
