#!/usr/bin/env python3
"""Tests for the R9-B2 bandit search allocator (trainer_bandit.py).

Proves the load-bearing properties: arm_hash stability + collision-freedom,
NO-HEREDITY (a depth-2 subset selectable from a cold start), Thompson favouring
the higher-mean arm over many SEEDED draws (statistical, not one draw), posterior
persistence to trainer.db, the FRACTIONAL reward mapping calling B1's
evaluate_compass, and the exploration policy (one-axis-then-broaden + the balance
rule). Stochastic tests use a seeded ``random.Random`` + population assertions so
they are deterministic, never flaky.

Dependency-free: ``python3 tests/test_trainer_bandit.py``. pytest-compatible too.
Uses a throwaway TRAINER_DB_PATH — never touches data/trainer.db.
"""
import os
import random
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Isolate every DB op onto a throwaway trainer.db (resolved at call time).
_TMPDIR = tempfile.mkdtemp(prefix="trainer_b2_test_")
os.environ["TRAINER_DB_PATH"] = os.path.join(_TMPDIR, "trainer_test.db")

import trainer_bandit as tb  # noqa: E402
from lib.trainer_db import get_connection  # noqa: E402

_DB_SEQ = 0


def _fresh_db():
    """Point TRAINER_DB_PATH at a brand-new empty trainer.db and return a conn."""
    global _DB_SEQ
    _DB_SEQ += 1
    os.environ["TRAINER_DB_PATH"] = os.path.join(_TMPDIR, f"trainer_test_{_DB_SEQ}.db")
    return get_connection()


# A survivor backtest candidate (clears the two-gate wall; scores positive).
def _survivor_scored():
    return {
        "equity_curve": [100, 102, 99, 103, 101, 105],          # shallow dd -> gate (a) pass
        "net_pnl_series": [0.02] * 19 + [-0.10],                 # cvar_95 -> gate (b) pass
        "daily_returns": [0.01, -0.02, 0.03, -0.01, 0.02, -0.015, 0.025],  # >=3 obs -> sortino
        "trades": [
            {"pnl_usd": 10.0, "original_notional_usd": 1000.0, "ticker": "BTC"},
            {"pnl_usd": 8.0, "original_notional_usd": 1000.0, "ticker": "ETH"},
        ],
    }


# Injected level-0-style weights so the integration test never needs a seeded DB.
_W = {"w_consistency": 0.7, "w_magnitude": 0.3, "dd_ceiling": 0.35, "cvar_floor": -0.15}


# ══════════════════════════════════════════════════════════════════════════
# arm_hash: stability (reorder-invariant) + collision-free
# ══════════════════════════════════════════════════════════════════════════
def test_arm_hash_stable_across_key_reorder():
    a = {"direction.mode": "SHORT", "tickers.universe_subset": ["BTC", "ETH"],
         "leverage.lmax_fraction": 0.5}
    b = {"leverage.lmax_fraction": 0.5, "tickers.universe_subset": ["BTC", "ETH"],
         "direction.mode": "SHORT"}  # same arm, keys reordered
    assert tb.arm_hash(a) == tb.arm_hash(b), (tb.arm_hash(a), tb.arm_hash(b))
    print("  arm_hash stable across top-level key reorder: PASS")


def test_arm_hash_subset_order_invariant():
    # Same ticker subset expressed as set / sorted list / reversed list -> same hash.
    a = {"tickers.universe_subset": {"ETH", "BTC", "SOL"}}
    b = {"tickers.universe_subset": ["BTC", "ETH", "SOL"]}
    c = {"tickers.universe_subset": ["SOL", "ETH", "BTC"]}
    hs = {tb.arm_hash(a), tb.arm_hash(b), tb.arm_hash(c)}
    assert len(hs) == 1, hs
    print("  arm_hash order-invariant for subset values (set/list/reversed): PASS")


def test_arm_hash_float_precision_collapses_noise():
    a = {"size.risk_fraction": 0.30000000000000004}   # repr noise
    b = {"size.risk_fraction": 0.3}
    assert tb.arm_hash(a) == tb.arm_hash(b)
    c = {"size.risk_fraction": 0.31}                  # genuinely different -> distinct
    assert tb.arm_hash(a) != tb.arm_hash(c)
    print("  arm_hash collapses <1e-6 float noise, keeps genuine differences: PASS")


def test_arm_hash_collision_free_on_distinct_arms():
    rng = random.Random(11)
    schema = tb.default_axis_schema()
    arms, canons, hashes = [], set(), set()
    for _ in range(400):
        arm = tb.propose_arm(schema, rng.randint(1, 6), rng)
        if not arm:
            continue
        canon = tb.canonicalize_arm(arm)
        arms.append(arm)
        canons.add(canon)
        hashes.add(tb.arm_hash(arm))
    # Every DISTINCT canonical arm maps to a DISTINCT hash (no collision).
    assert len(hashes) == len(canons), (len(hashes), len(canons))
    assert len(canons) > 50, len(canons)  # the sample really is diverse
    print(f"  arm_hash collision-free over {len(canons)} distinct arms: PASS")


# ══════════════════════════════════════════════════════════════════════════
# NO HEREDITY: a depth-2 subset is directly sampled + selectable from a cold DB
# ══════════════════════════════════════════════════════════════════════════
def test_no_heredity_depth2_from_cold_start():
    conn = _fresh_db()
    schema = tb.default_axis_schema()
    rng = random.Random(3)
    # 1) A depth-2 arm is produced DIRECTLY (2 distinct axes), no prior grounding.
    depth2 = None
    for _ in range(20):
        arm = tb.propose_arm(schema, 2, rng)
        if len(tb._axes_of_arm(arm)) == 2:
            depth2 = arm
            break
    assert depth2 is not None and len(tb._axes_of_arm(depth2)) == 2, depth2
    # 2) It has the untouched (1,1) prior on a COLD db — no "ground axisA first" gate.
    a, b, n = tb.get_posterior(tb.arm_hash(depth2), 0, conn=conn)
    assert (a, b, n) == (1.0, 1.0, 0), (a, b, n)
    # 3) sample_arm can SELECT the joint arm from a cold start (single-candidate pool).
    chosen = tb.sample_arm([depth2], 0, conn=conn, rng=random.Random(1))
    assert chosen["arm_hash"] == tb.arm_hash(depth2)
    conn.close()
    print("  no-heredity: depth-2 joint arm sampled+selectable from cold start: PASS")


# ══════════════════════════════════════════════════════════════════════════
# Thompson: favours the higher-mean arm over MANY seeded draws (statistical)
# ══════════════════════════════════════════════════════════════════════════
def test_thompson_favours_higher_mean_over_many_draws():
    conn = _fresh_db()
    arm_hi = {"direction.mode": "LONG"}
    arm_lo = {"direction.mode": "SHORT"}
    for _ in range(20):
        tb.update_posterior(tb.arm_hash(arm_hi), 0, 1.0, conn=conn, axes_json=tb.canonicalize_arm(arm_hi))
        tb.update_posterior(tb.arm_hash(arm_lo), 0, 0.0, conn=conn, axes_json=tb.canonicalize_arm(arm_lo))
    a_hi, b_hi, _ = tb.get_posterior(tb.arm_hash(arm_hi), 0, conn=conn)
    a_lo, b_lo, _ = tb.get_posterior(tb.arm_hash(arm_lo), 0, conn=conn)
    assert (a_hi, b_hi) == (21.0, 1.0) and (a_lo, b_lo) == (1.0, 21.0), (a_hi, b_hi, a_lo, b_lo)
    rng = random.Random(42)
    wins = 0
    draws = 500
    for _ in range(draws):
        best = tb.sample_arm([arm_hi, arm_lo], 0, conn=conn, rng=rng, explore=False)
        if best["arm_hash"] == tb.arm_hash(arm_hi):
            wins += 1
    conn.close()
    # Beta(21,1) mean ~0.95 vs Beta(1,21) mean ~0.045 -> near-total separation.
    assert wins >= int(0.96 * draws), f"{wins}/{draws} (expected the higher-mean arm to dominate)"
    print(f"  Thompson favours higher-mean arm {wins}/{draws} draws (seeded, statistical): PASS")


# ══════════════════════════════════════════════════════════════════════════
# update_posterior: moves alpha/beta correctly + PERSISTS across connections
# ══════════════════════════════════════════════════════════════════════════
def test_update_posterior_moves_and_persists():
    conn = _fresh_db()
    arm = {"hedge.enabled": True}
    ah, aj = tb.arm_hash(arm), tb.canonicalize_arm(arm)
    tb.update_posterior(ah, 0, 0.75, conn=conn, axes_json=aj)   # alpha 1+.75, beta 1+.25, n 1
    tb.update_posterior(ah, 0, 0.25, conn=conn, axes_json=aj)   # alpha +.25, beta +.75, n 2
    a, b, n = tb.get_posterior(ah, 0, conn=conn)
    assert abs(a - 2.0) < 1e-9 and abs(b - 2.0) < 1e-9 and n == 2, (a, b, n)
    conn.close()
    # Re-open a FRESH connection to the same db file -> proves it hit disk.
    conn2 = get_connection()
    a2, b2, n2 = tb.get_posterior(ah, 0, conn=conn2)
    conn2.close()
    assert abs(a2 - 2.0) < 1e-9 and abs(b2 - 2.0) < 1e-9 and n2 == 2, (a2, b2, n2)
    print("  update_posterior moves alpha/beta + persists to trainer.db: PASS")


# ══════════════════════════════════════════════════════════════════════════
# Reward mapping: FRACTIONAL (default) + binary fallback
# ══════════════════════════════════════════════════════════════════════════
def test_reward_mapping_fractional():
    assert tb.compass_reward({"verdict": "rejected"}) == 0.0
    assert tb.compass_reward({"verdict": "survived_unscorable"}) == 0.25
    assert tb.compass_reward({"verdict": "scored", "blend_score": -0.5}) == 0.40
    assert tb.compass_reward({"verdict": "scored", "blend_score": 0.0}) == 0.40
    r_small = tb.compass_reward({"verdict": "scored", "blend_score": 0.1})
    r_big = tb.compass_reward({"verdict": "scored", "blend_score": 5.0})
    assert 0.6 <= r_small <= 1.0 and 0.6 <= r_big <= 1.0
    assert r_big > r_small, (r_small, r_big)               # magnitude-monotone
    assert tb.compass_reward({"verdict": "scored", "blend_score": None}) == 0.40
    assert tb.compass_reward({"verdict": "??"}) == 0.0     # unknown -> conservative fail
    assert tb.compass_reward("not a dict") == 0.0
    print("  reward mapping FRACTIONAL (rejected/unscorable/scored graded): PASS")


def test_reward_mapping_binary_fallback():
    assert tb.compass_reward({"verdict": "scored", "blend_score": 2.0}, mode="binary") == 1.0
    assert tb.compass_reward({"verdict": "scored", "blend_score": -0.1}, mode="binary") == 0.0
    assert tb.compass_reward({"verdict": "survived_unscorable"}, mode="binary") == 0.0
    print("  reward mapping BINARY fallback available: PASS")


def test_score_and_update_calls_evaluate_compass():
    conn = _fresh_db()
    arm = {"direction.mode": "LONG", "size.risk_fraction": 0.2}
    res = tb.score_and_update(arm, 0, _survivor_scored(), conn=conn, weights=_W)
    # The verdict came from B1's evaluate_compass (import + call proven on WSL).
    assert res["verdict"]["verdict"] == "scored", res["verdict"]
    assert res["verdict"]["survived"] is True
    assert res["reward"] > 0.6, res["reward"]              # scored + positive blend
    a, b, n = tb.get_posterior(tb.arm_hash(arm), 0, conn=conn)
    assert n == 1 and abs(a - (1.0 + res["reward"])) < 1e-9, (a, b, n, res["reward"])
    conn.close()
    print(f"  score_and_update calls evaluate_compass -> scored, reward={res['reward']:.3f}: PASS")


# ══════════════════════════════════════════════════════════════════════════
# Exploration policy: one-axis-then-broaden + the balance rule
# ══════════════════════════════════════════════════════════════════════════
def test_propose_depth_one_axis_then_broaden():
    assert tb.propose_depth(0, 9) == 1                     # cold start -> one axis
    assert tb.propose_depth(tb.BROADEN_STEP, 9) == 2       # +1 axis per BROADEN_STEP
    assert tb.propose_depth(tb.BROADEN_STEP * 4, 9) == 5
    assert tb.propose_depth(10_000, 9) == 9                # capped at n_axes
    # monotone non-decreasing in grounding
    seq = [tb.propose_depth(o, 9) for o in range(0, 100)]
    assert all(seq[i] <= seq[i + 1] for i in range(len(seq) - 1)), seq
    assert tb.propose_depth(10_000, 9, max_depth=3) == 3   # override respected
    print("  propose_depth: cold=1, broadens with grounding, capped, monotone: PASS")


def test_run_search_step_broadens_live():
    conn = _fresh_db()
    os.environ[tb.FLAG_ENV] = "1"                          # flag ON for the live path
    try:
        schema = tb.default_axis_schema()
        cold = tb.run_search_step(schema, 0, conn=conn, rng=random.Random(5))
        assert cold["enabled"] is True and cold["arm"] is not None
        assert cold["depth_cap"] == 1, cold                # cold start narrows to one axis
        # Accumulate grounding so total axis-obs crosses BROADEN_STEP.
        rng = random.Random(9)
        for _ in range(30):
            arm = tb.propose_arm(schema, 2, rng)
            if arm:
                tb.update_posterior(tb.arm_hash(arm), 0, 0.5, conn=conn,
                                    axes_json=tb.canonicalize_arm(arm))
        warm = tb.run_search_step(schema, 0, conn=conn, rng=random.Random(5))
        assert warm["depth_cap"] >= 2, warm                # broadened past one axis
    finally:
        os.environ.pop(tb.FLAG_ENV, None)
        conn.close()
    print(f"  run_search_step: cold depth_cap=1 -> warm depth_cap={warm['depth_cap']}: PASS")


def test_balance_rule_staleness_bonus():
    # Axis B never touched (last_step=0) beats axis A just touched (last_step=n_events).
    stats = {"A": {"n_obs": 5, "last_step": 10}, "B": {"n_obs": 5, "last_step": 0}}
    bonus_a = tb.exploration_bonus(["A"], stats, 10)
    bonus_b = tb.exploration_bonus(["B"], stats, 10)
    assert bonus_b > bonus_a, (bonus_a, bonus_b)
    # A long-untested axis's bonus grows as steps since last touch grows.
    grow = [tb.exploration_bonus(["A"], {"A": {"n_obs": 1, "last_step": 1}}, ev) for ev in (2, 5, 20)]
    assert grow[0] < grow[1] < grow[2], grow
    print("  balance rule: staleness bonus (untested axis favoured, grows w/ age): PASS")


def test_balance_rule_saturation_penalty():
    # Axis C over-focused (huge n_obs share) penalised vs axis D (tiny share).
    stats = {"C": {"n_obs": 100, "last_step": 5}, "D": {"n_obs": 1, "last_step": 5}}
    bonus_c = tb.exploration_bonus(["C"], stats, 10)
    bonus_d = tb.exploration_bonus(["D"], stats, 10)
    assert bonus_d > bonus_c, (bonus_c, bonus_d)
    print("  balance rule: saturation penalty (over-focused axis damped): PASS")


# ══════════════════════════════════════════════════════════════════════════
# Callable axes sample over the enumerated named-policy set (not a scalar)
# ══════════════════════════════════════════════════════════════════════════
def test_callable_axis_samples_enumerated_policies():
    rng = random.Random(2)
    sp_knob = {"axis": "portfolio", "param": "sleeve_priority", "type": "callable",
               "domain": {"default": "uniform"}}
    al_knob = {"axis": "portfolio", "param": "allocate", "type": "callable",
               "domain": {"default": "pro_rata"}}
    sp_fam = tb.POLICY_FAMILY["portfolio.sleeve_priority"]
    al_fam = tb.POLICY_FAMILY["portfolio.allocate"]
    for _ in range(60):
        sp = tb._sample_value(rng, sp_knob)
        al = tb._sample_value(rng, al_knob)
        assert isinstance(sp, str) and sp in sp_fam, sp      # a NAMED policy, never a scalar
        assert isinstance(al, str) and al in al_fam, al
    assert "uniform" in sp_fam and "pro_rata" in al_fam      # the live nulls are in the family
    print("  callable axes sample enumerated named policies (never a scalar): PASS")


def test_run_search_step_dormant_when_flag_off():
    os.environ.pop(tb.FLAG_ENV, None)
    res = tb.run_search_step(tb.default_axis_schema(), 0)
    assert res == {"enabled": False, "arm": None, "arm_hash": None,
                   "reason": f"{tb.FLAG_ENV} off"}, res
    print("  run_search_step dormant (byte-identical inert) when flag off: PASS")


_TESTS = [
    test_arm_hash_stable_across_key_reorder,
    test_arm_hash_subset_order_invariant,
    test_arm_hash_float_precision_collapses_noise,
    test_arm_hash_collision_free_on_distinct_arms,
    test_no_heredity_depth2_from_cold_start,
    test_thompson_favours_higher_mean_over_many_draws,
    test_update_posterior_moves_and_persists,
    test_reward_mapping_fractional,
    test_reward_mapping_binary_fallback,
    test_score_and_update_calls_evaluate_compass,
    test_propose_depth_one_axis_then_broaden,
    test_run_search_step_broadens_live,
    test_balance_rule_staleness_bonus,
    test_balance_rule_saturation_penalty,
    test_callable_axis_samples_enumerated_policies,
    test_run_search_step_dormant_when_flag_off,
]


if __name__ == "__main__":
    print("=== trainer_bandit tests (R9-B2) ===")
    for t in _TESTS:
        t()
    print(f"=== {len(_TESTS)}/{len(_TESTS)} PASS ===")
