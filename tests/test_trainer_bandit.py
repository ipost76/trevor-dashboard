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
import math
import os
import random
import sqlite3
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
        cold = tb.run_search_step(schema, level=0, conn=conn, rng=random.Random(5))
        assert cold["enabled"] is True and cold["arm"] is not None
        assert cold["depth_cap"] == 1, cold                # cold start narrows to one axis
        # Accumulate grounding so total axis-obs crosses BROADEN_STEP.
        rng = random.Random(9)
        for _ in range(30):
            arm = tb.propose_arm(schema, 2, rng)
            if arm:
                tb.update_posterior(tb.arm_hash(arm), 0, 0.5, conn=conn,
                                    axes_json=tb.canonicalize_arm(arm))
        warm = tb.run_search_step(schema, level=0, conn=conn, rng=random.Random(5))
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
    res = tb.run_search_step(tb.default_axis_schema(), level=0)
    assert res == {"enabled": False, "arm": None, "arm_hash": None,
                   "reason": f"{tb.FLAG_ENV} off"}, res
    print("  run_search_step dormant (byte-identical inert) when flag off: PASS")


# ═══════════════════════════════════════════════════════════════════════════
# RD-B8 — REWARD SCALE / DISCRIMINATION REGRESSION
#
# 🚨 THE PROPERTY THIS FILE EXISTS TO PROTECT: the bandit must be able to RANK
# ITS OWN SURVIVORS at the REAL blend scale. With REWARD_K = 0.5 it could not —
# the reward spread over blend [30,550] was 7.48e-14, every scored survivor
# collapsed onto ~1.0, and the BEST arm was the most-pulled arm in only 3/20
# seeds against a CHANCE rate of 4/20 (worse than chance) while "concentration"
# read 48.3% and looked exactly like convergence.
#
# 🚨 THIS TEST IS SELF-PROVING. It asserts the property HOLDS at the module's
# REWARD_K *and* that it FAILS at the old k=0.5 — driven through the same helper
# via compass_reward's `k=` kwarg, so no code is mutated and no isolated copy is
# needed. A test that would not have caught the original defect is decoration;
# this one demonstrates it catches it, permanently, and cannot rot.
# ═══════════════════════════════════════════════════════════════════════════
_REAL_SCALE_ARMS = [19.57, 80.0, 250.0, 600.0, 1295.20]   # A8's modelled range
_BEST_ARM = 4          # index of the highest-blend arm
_SCALE_SEEDS = 20
_SCALE_STEPS = 120


def _run_reward_scale_bandit(k, seed):
    """One bandit run over the 5 real-scale arms -> per-arm pull counts.

    Uses the REAL ``_thompson_theta`` and the REAL ``compass_reward`` (via its
    ``k=`` kwarg) — this is the production sampler, not a re-implementation."""
    rng = random.Random(seed)
    alpha = [1.0] * len(_REAL_SCALE_ARMS)
    beta = [1.0] * len(_REAL_SCALE_ARMS)
    pulls = [0] * len(_REAL_SCALE_ARMS)
    for _ in range(_SCALE_STEPS):
        best_i, best_score = 0, None
        for i in range(len(_REAL_SCALE_ARMS)):
            theta = tb._thompson_theta(alpha[i], beta[i], rng)
            if best_score is None or theta > best_score:
                best_i, best_score = i, theta
        r = tb.compass_reward(
            {"verdict": "scored", "blend_score": _REAL_SCALE_ARMS[best_i]}, k=k)
        alpha[best_i] += r
        beta[best_i] += 1.0 - r
        pulls[best_i] += 1
    return pulls


def _best_arm_wins(k):
    """How many of the 20 seeds end with the BEST arm as the most-pulled arm."""
    wins = 0
    for seed in range(_SCALE_SEEDS):
        pulls = _run_reward_scale_bandit(k, seed)
        if max(range(len(pulls)), key=lambda i: pulls[i]) == _BEST_ARM:
            wins += 1
    return wins


def test_reward_scale_best_arm_wins_at_module_k():
    """THE ACCEPTANCE TEST: best of 5 real-scale arms wins >= 18/20 seeds."""
    wins = _best_arm_wins(tb.REWARD_K)
    assert wins >= 18, (
        f"bandit cannot rank real-scale survivors: best arm won {wins}/20 seeds "
        f"at REWARD_K={tb.REWARD_K!r} (need >=18/20). If REWARD_K was retuned, "
        f"re-derive it as 1/observed_operative_max — see the derivation block."
    )
    print(f"  RD-B8 discrimination: best arm wins {wins}/{_SCALE_SEEDS} "
          f"at REWARD_K=1/{1.0/tb.REWARD_K:.6g}: PASS")


def test_reward_scale_test_would_have_caught_the_old_constant():
    """SELF-PROVING: the SAME property FAILS at the old k=0.5.

    This is what makes the test above non-decorative — it demonstrates, on every
    run, that the acceptance bar actually discriminates the defect it exists for."""
    old_wins = _best_arm_wins(0.5)
    assert old_wins < 18, (
        f"the old constant k=0.5 scored {old_wins}/20 — this test can no longer "
        f"detect the saturation defect it exists to catch"
    )
    chance = _SCALE_SEEDS // len(_REAL_SCALE_ARMS)
    assert old_wins <= chance, (
        f"expected the saturated bandit to be at-or-worse-than chance "
        f"({chance}/20); got {old_wins}/20"
    )
    print(f"  RD-B8 self-proof: old k=0.5 scores {old_wins}/{_SCALE_SEEDS} "
          f"(<= chance {chance}/{_SCALE_SEEDS}) — the bar catches the defect: PASS")


def test_reward_scale_monotone_and_unsaturated_over_real_range():
    """Reward must stay strictly increasing AND strictly below 1.0 across the
    modelled range — no float-equality assertions anywhere (reward(30) is
    0.9999999999999252, NOT 1.0, so an equality test would assert an untruth)."""
    lo, hi = tb.MODELLED_BLEND_MIN, tb.MODELLED_BLEND_MAX
    xs = [lo + i * (hi - lo) / 500.0 for i in range(501)]
    ys = [tb.compass_reward({"verdict": "scored", "blend_score": x}) for x in xs]
    assert all(ys[i + 1] > ys[i] for i in range(len(ys) - 1)), "reward not monotone"
    assert all(y < 1.0 for y in ys), "reward saturated to 1.0 inside the real range"
    assert all(y > 0.6 for y in ys), "positive blend must reward above the 0.6 floor"
    spread = ys[-1] - ys[0]
    assert spread > 0.2, f"reward spread {spread!r} too small to rank survivors"
    print(f"  RD-B8 monotone + unsaturated over [{lo}, {hi}], "
          f"spread {spread:.6f}: PASS")


def test_reward_scale_observed_range_is_recorded():
    """The observed-blend-range instrumentation must actually record, so the
    MODELLED range can validate (or contradict) itself the moment anything real
    scores. Uses inequalities only."""
    tb._observed_blend_min = None
    tb._observed_blend_max = None
    for b in (42.0, 900.0, 7.5):
        tb.compass_reward({"verdict": "scored", "blend_score": b})
    lo, hi = tb.observed_blend_range()
    assert lo is not None and hi is not None, "observed range never recorded"
    assert lo < 8.0 and hi > 899.0, (lo, hi)
    # a non-scored verdict must NOT pollute the range
    before = tb.observed_blend_range()
    tb.compass_reward({"verdict": "rejected"})
    tb.compass_reward({"verdict": "scored", "blend_score": -5.0})
    assert tb.observed_blend_range() == before, "non-positive blend polluted the range"
    tb._observed_blend_min = None
    tb._observed_blend_max = None
    print(f"  RD-B8 observed range recorded [{lo:.6g}, {hi:.6g}], "
          f"non-scored verdicts excluded: PASS")


def test_posterior_params_finiteness_guarded():
    """RD-B8: a corrupt stored alpha/beta must fall back to the (1,1) prior with
    a log, never reach ``betavariate``.

    ⚠️ MEASURED, and it narrows the surface: ``bandit_posteriors.alpha``/``beta``
    are **NOT NULL** in the B0 schema, and SQLite cannot store NaN at all (it
    coerces to NULL, which the constraint then rejects). So NULL and NaN are
    SCHEMA-BLOCKED — the reachable corruptions are +-inf, zero/negative, and a
    type-affinity string. The guard covers those; the constraint covers the rest.
    """
    conn = _fresh_db()
    arm = {"direction.mode": "LONG"}
    ahash = tb.arm_hash(arm)
    tb.update_posterior(ahash, 0, 0.9, conn=conn, axes_json="{}")

    # NULL is schema-blocked — assert that, rather than pretending to guard it.
    try:
        conn.execute("UPDATE bandit_posteriors SET alpha=NULL WHERE arm_hash=? AND level_id=0",
                     (ahash,))
        conn.commit()
        raise AssertionError("expected NOT NULL constraint on bandit_posteriors.alpha")
    except sqlite3.IntegrityError:
        conn.rollback()

    for bad in (float("inf"), float("-inf"), 0.0, -3.0, "abc"):
        conn.execute("UPDATE bandit_posteriors SET alpha=? WHERE arm_hash=? AND level_id=0",
                     (bad, ahash))
        conn.commit()
        a, b, _n = tb.get_posterior(ahash, 0, conn=conn)
        assert isinstance(a, float) and math.isfinite(a) and a > 0.0, (bad, a)
        # and it must be samplable without raising
        tb._thompson_theta(a, b, random.Random(1))
    conn.close()
    print("  RD-B8 posterior alpha/beta finiteness-guarded "
          "(inf/-inf/0/negative/str; NULL+NaN schema-blocked): PASS")


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
    # RD-B8 reward-scale / discrimination regression
    test_reward_scale_best_arm_wins_at_module_k,
    test_reward_scale_test_would_have_caught_the_old_constant,
    test_reward_scale_monotone_and_unsaturated_over_real_range,
    test_reward_scale_observed_range_is_recorded,
    test_posterior_params_finiteness_guarded,
]


if __name__ == "__main__":
    print("=== trainer_bandit tests (R9-B2) ===")
    for t in _TESTS:
        t()
    print(f"=== {len(_TESTS)}/{len(_TESTS)} PASS ===")
