#!/usr/bin/env python3
"""trainer_bandit.py — TREVOR v5 Trainer (R9) bandit search allocator [R9-B2].

The arm-SELECTION half of the two-layer Thompson search (A1 / RECON-TRAINER-001,
decision-3 correction). The trainer searches the 12-axis config surface toward a
survival-first compass; THIS module decides *which config to try next*.

    from trainer_bandit import run_search_step, sample_arm, score_and_update

═══════════════════════════════════════════════════════════════════════════════
 THE TWO-LAYER SPLIT (A1's single biggest architecture catch — build to THIS)
═══════════════════════════════════════════════════════════════════════════════
The locked design said "the alpha-budget posterior directly feeds arm selection —
Thompson IS posterior sampling, so they COMPOSE." A1 confirmed live that
``alpha_budget.LordState`` (alpha_budget.py:170) is a single GLOBAL wealth scalar
+ LORD discovery-schedule state — it carries NO per-arm posteriors. Thompson
needs per-arm ``Beta(α,β)`` distributions to sample from. So they compose as a
TWO-LAYER SPLIT, not one object:

  * LAYER 1 — arm SELECTION (this module): the trainer keeps its OWN per-arm
    ``Beta(α,β)`` posteriors (one per sampled axis-subset "arm") in
    ``bandit_posteriors`` (trainer.db). Thompson = sample θ~Beta per arm, argmax.
  * LAYER 2 — discovery THROTTLE (``trainer_budget_adapter.throttle_test``):
    ``alpha_budget.test()`` is the DOWNSTREAM FDR/promotion gate that decides
    whether an evaluated arm's edge counts as a discovery (spending/replenishing
    the global wealth scalar). It is NOT the arm posterior.

  Do NOT sample arms from the LordState scalar — that is the exact bug A1 flagged.

═══════════════════════════════════════════════════════════════════════════════
 NO HEREDITY (§V — load-bearing, confirmed structural at config_surface.py:648)
═══════════════════════════════════════════════════════════════════════════════
The surface is a flat ``Tuple[Axis, ...]`` — no tree, no parent/child, no
unlock-intermediate-nodes. This module samples ARBITRARY-DEPTH axis subsets
DIRECTLY: a joint ``{direction=SHORT, tickers={BTC,ETH}}`` arm is sampled with NO
requirement to first "ground" direction or tickers alone. Pure interactions ("no
trade trades solo") are reachable from a cold start. There is deliberately NO
heredity / parent-child / unlock logic anywhere below. ``propose_depth`` is a
SOFT exploration schedule (§D.12.4 one-axis-then-broaden), never a hard barrier.

═══════════════════════════════════════════════════════════════════════════════
 DISCIPLINE
═══════════════════════════════════════════════════════════════════════════════
  * Python 3, stdlib only (``random.betavariate`` for Beta sampling — numpy is
    absent on this WSL box; stdlib is sufficient and keeps the trainer dep-free).
    Seed via ``random.Random(seed)`` for reproducible tests.
  * Persistence via B0's ``lib.trainer_db.get_connection`` (own connection per
    call, WAL, call-time path resolution). Reads B1's ``compass_metrics`` for the
    reward. NO import of the bot package (``auto_trader.*``) — that trips the
    ``__init__`` barrier on WSL; the axis surface is consumed as a schema passed
    IN (``default_axis_schema`` is a WSL-local snapshot for standalone use).
  * reset() deny (A1 rec #2): this module has ZERO import path to
    ``alpha_budget.reset``. The Layer-2 throttle is reached ONLY through
    ``trainer_budget_adapter`` (which exposes ``test()`` and nothing else).
  * Additive-DB law: seeds ``bandit_posteriors`` rows (1,1) + fractional updates.
    No DROP/DELETE/TRUNCATE.
  * Feature flag ``TRAINER_BANDIT_ENABLED`` (default OFF): ``run_search_step`` is
    dormant (returns ``{enabled: False}``, mutates nothing) until enabled. The
    lower-level primitives stay callable (the daemon/orchestration is B4/B5).

money_path=no. The bandit searches + proposes; nothing trades.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import random
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from lib.trainer_db import get_connection, utc_now

import compass_metrics


# ═══════════════════════════════════════════════════════════════════════════
# Tunable constants (design decisions — see the R9-B2 Preference Changes block)
# ═══════════════════════════════════════════════════════════════════════════
FLAG_ENV = "TRAINER_BANDIT_ENABLED"

_HASH_LEN = 32               # sha256 hex prefix length for arm_hash
FLOAT_PRECISION = 6          # canonical float rounding (dp) — collapses repr noise
_EPS = 1e-9                  # exclude-min / degenerate-posterior floor

# Reward mapping (compass verdict -> Beta success mass r∈[0,1]; α+=r, β+=1-r).
# FRACTIONAL is the default (Ghost-locked): it handles the survival wall's many
# "survived but not scored" outcomes honestly instead of forcing a binary.
#
# ── REWARD_K: DERIVATION (RD-B8, 2026-07-25) ────────────────────────────────
# K = 1 / OPERATIVE_BLEND_MAX, where the operative max is 550 — the top of the
# [30, 550] band A8 scored the reward over. The tanh argument is `K·blend`, so K
# is fixed by the largest blend we expect to rank ROUTINELY: at blend = 1/K the
# argument is 1.0 and tanh is 0.7616, i.e. the operative top lands at ~76% of
# tanh's rise, well short of the flat tail. That is the whole rule.
#
# ⚠️ STATED PLAINLY: 550 is NOT the top of the modelled range (1295.20), so this
# is `1/operative_max`, NOT `1/modelled_max`. The modelled EXTREME 1295.20 maps
# to reward 0.992859 under K=1/550 — still strictly monotone, still inside the
# safe band, NOT saturated — so the choice holds; but the re-derivation rule
# below names WHICH max it keys on, because "1/max_blend" alone is ambiguous
# and an ambiguous rule is how an unrecorded assumption gets here in the first
# place. (For reference K=1/1295.20 would also work — spread 0.2986 vs 0.2828 —
# it simply shifts the safe band up; 1/550 is the A8-verified, 20/20 choice.)
#
# 🚨 WAS 0.5 — tuned for O(1) blends and catastrophic at the real O(100) scale.
# At K=0.5 the total reward spread over blend [30, 550] measured 7.482903e-14:
# EVERY scored survivor collapsed onto ~1.0 and the Beta posterior could not rank
# them. Discrimination (a +10% better blend still moving reward >= 1e-3) died at
# blend 5.8681 — 6.31x earlier than the "saturates at 37.02" framing suggests.
# Measured consequence: over 20 seeds x 5 real-scale arms the BEST arm was the
# most-pulled arm in 3/20 seeds against a chance rate of 4/20 — WORSE THAN CHANCE
# — while "concentration" read 48.3% and looked exactly like convergence.
#
# ⚠️ THE RANGE IS MODELLED, NOT MEASURED. `bandit_posteriors` had ZERO rows when
# this was derived — nothing had ever scored. [19.57, 1295.20] comes from A8's
# modelling, so this constant inherits that uncertainty. The SAFE BAND below and
# the unconditional observed-range log in `compass_reward` exist precisely so the
# assumption validates (or contradicts) itself the moment anything real scores.
#
# SAFE BAND (measured, same >=1e-3-per-+10% criterion): blend ~[13.76, 1614].
#   * BELOW ~13.76 the reward saturates at the BOTTOM — the mirror of the old
#     failure. If real blends land an order of magnitude SMALLER than modelled
#     ([1.96, 129.52]) the bottom half of the range falls out of the band.
#   * ABOVE ~1614 it saturates at the top again.
#   * The modelled range sits inside the band, but with only ~1.4x headroom at
#     the bottom and ~1.25x at the top. It is NOT comfortably centred.
#
# 🚨 RE-DERIVATION RULE: if the OBSERVED blend range (see the `[BANDIT-SCALE]`
# log in `compass_reward`) differs materially from [19.57, 1295.20], REWARD_K
# MUST be re-derived as `1 / observed_operative_max` — the ROUTINE upper blend,
# i.e. the top of the bulk of scored survivors, NOT a lone outlier. Do not
# hand-tune it. Two hard triggers, either one forces the re-derivation:
#   * the observed max exceeds SAFE_BAND_HI (top saturation is live), or
#   * the observed min falls below SAFE_BAND_LO (bottom saturation is live).
MODELLED_BLEND_MIN = 19.57   # A8's modelled real blend range — MODELLED, NOT measured
MODELLED_BLEND_MAX = 1295.20 # ^ the modelled extreme (K keys on 550, see above)
OPERATIVE_BLEND_MAX = 550.0  # the routine upper blend REWARD_K is derived from
SAFE_BAND_LO = 13.76         # below this, reward saturates at the BOTTOM
SAFE_BAND_HI = 1614.0        # above this, reward saturates at the TOP
REWARD_K = 1.0 / OPERATIVE_BLEND_MAX   # = 1/550; tanh steepness for blend>0

# Exploration policy (§D.12.4 one-axis-then-broaden + the balance rule).
#
# 🚨🚨 OPEN FINDING — LAMBDA_STALE / LAMBDA_SAT HAVE NO RECORDED DERIVATION, AND
# THEY ARE PRECISELY THE CONSTANTS THAT OUT-VOTE THE REWARD (RD-B8, 2026-07-25).
# `sample_arm` picks argmax(theta + bonus), so these two lambdas set the bonus
# swing (+/-0.05, total 0.10) that competes DIRECTLY with the reward signal.
# Measured: once arms saturate at r=1.0 the theta spread across near-equal arms
# crosses BELOW the 0.10 bonus swing at n~10 (0.1801 @ n=5 -> 0.1101 @ n=10 ->
# 0.0643 @ n=20 -> 0.0340 @ n=40). At the OLD K=0.5 a static +0.05 on the WORST
# arm took 76.6% of pulls and became the most-pulled arm in 19/20 seeds.
#
# 🚨 THEREFORE, STATED PRECISELY: rescaling REWARD_K is NECESSARY BUT MAY NOT BE
# SUFFICIENT. It is NOT the same claim as "the bandit is fixed." The rescale
# restores the reward's ability to rank (post-fix the same static +0.05 takes
# only 1.4% of pulls and wins 0/20 — so at the MODELLED scale the bonus is now
# proportionate at 17.7% of the 0.2828 spread). But if the observed blend range
# turns out narrower than modelled, the reward spread shrinks and these two
# underived constants can out-vote it again — the failure mode simply returns by
# a different door. That is a live risk, not a closed item.
#
# ⚠️ DELIBERATELY NOT CHANGED HERE (Ghost, RD-B8 gate): a constant with no
# recorded derivation needs its DERIVATION before its VALUE. Deriving these two
# is its own item; guessing a new number here would just re-create the exact
# defect this prompt exists to fix, one level down.
#
# ── λ: THE RE-DERIVATION RULE (RP-C2, 2026-07-28) ───────────────────────────
# RP-C2 did NOT change either value (see the paragraph above — that bar is
# unchanged). What it adds is the missing RULE + a measured ceiling, so the next
# reader inherits a derivation procedure instead of a bare "no derivation" note.
#
# THE RULE:  λ_stale = λ_sat = λ ≤ f · observed_reward_spread
#   observed_reward_spread = compass_reward(observed_operative_max)
#                          − compass_reward(observed_operative_min)
#   f is fixed by an ACCEPTANCE CRITERION, not taste: under the adversarial bonus
#   the best observed arm must remain the most-pulled arm in ≥18/20 seeds — the
#   SAME bar `test_reward_scale_best_arm_wins_at_module_k` already applies to
#   REWARD_K. Re-run that harness with the bonus applied; do not hand-tune λ.
#
# MEASURED at the modelled range [19.57, 1295.20] with the REAL `_thompson_theta`
# + `compass_reward` (5 arms, 20 seeds, 120 steps), reward spread = 0.378632:
#   one-sided (+λ on the WORST arm only — the form RD-B8 measured):
#     λ=0.05 → best arm wins 20/20, worst arm wins 0/20.  ✅ RD-B8 CONFIRMED.
#   two-sided (+λ worst AND −λ best — the adversarial extreme of the ±λ swing):
#     λ=0.03 → 19/20 (passes) · λ=0.04 → 17/20 (fails) · λ=0.05 → 12/20 (fails)
#   ⇒ ceiling f ≈ 0.08 of spread ⇒ λ ≈ 0.030 at the modelled spread, vs 0.05 live.
#
# 🚨 WHAT THAT DOES AND DOES NOT SAY. It does NOT say a bad arm can win: the WORST
# arm wins 0/20 in EVERY configuration tested. The 8/20 losses at λ=0.05 all go to
# arm idx 3 (blend 600, reward 0.9189) — the best arm's NEAREST neighbour (blend
# 1295.20, reward 0.9929). So λ=0.05 can cost the bandit the distinction between
# the top TWO near-equal arms under a maximal saturation penalty; it does not make
# it choose garbage. ⚠️ And the two-sided case is an UPPER BOUND, not the operating
# point: a −λ penalty needs mean(saturation)=1.0, which requires the arm to hold
# ALL observations across its axes — with 5 arms live the best arm's share runs
# ~0.6–0.8, so the real penalty is ~−0.03..−0.04. Truth sits between 20/20 and 12/20.
#
# 🚨 THE VALUE STAYS **UNKNOWN**, AND THIS IS WHY: every number above rests on the
# MODELLED range. `bandit_posteriors` = 0 rows — nothing has ever scored — so the
# reward spread, which is the DENOMINATOR of the rule, is itself modelled. The
# sensitivity is not academic (same K, same λ=0.05, spread recomputed):
#     blend [19.57, 1295.20] (A8 modelled)  spread 0.378632  λ =  13.2% of spread
#     blend [30.00,  550.00] (operative)    spread 0.282841  λ =  17.7% of spread
#     blend [ 1.96,  129.52] (10× smaller)  spread 0.091067  λ =  54.9% of spread
#     blend [ 1.00,   10.00] (weak-edge)    spread 0.006545  λ = 764.0% of spread
# In the last row the bonus outweighs the entire reward signal by ~7.6×. So λ is
# not derivable until a real observed range exists.
#
# 🚨 THE EXACT MISSING INPUT: the OBSERVED blend range over real scored survivors
# — the same `[BANDIT-SCALE]` observed-range log `compass_reward` already emits.
# It needs n ≥ ~10–20 scored survivors, which requires the trainer to actually run
# (L1 minted + a real `backtest_fn`). Until then: λ = UNKNOWN, values unchanged.
BROADEN_STEP = 8             # every +8 total observations, allow +1 axis in a proposal
LAMBDA_STALE = 0.05          # staleness bonus weight  — ⚠️ VALUE UNDERIVED; rule above (RP-C2)
LAMBDA_SAT = 0.05            # saturation penalty weight — ⚠️ VALUE UNDERIVED; rule above (RP-C2)

# Value-sampler caps for unbounded (hi=None) numeric domains (documented).
_INT_UNBOUNDED_SPAN = 200
_FLOAT_UNBOUNDED_SPAN = 1.0

# Callable-axis enumerated named-policy family (A1 rec #8). The `portfolio`
# callables have no finite candidate set, so the bandit ranks NAMED policies
# (strings) as arm values — it installs NOTHING live (money_path=no); actual
# policy-fn instantiation is downstream. Minimal + extensible: only the null is
# live upstream (uniform / pro_rata); the rest are a named family the bandit ranks.
POLICY_FAMILY: Dict[str, Tuple[str, ...]] = {
    "portfolio.sleeve_priority": ("uniform", "inverse_vol", "by_recent_edge", "by_win_rate"),
    "portfolio.allocate": ("pro_rata", "equal_weight", "priority_weighted", "largest_first"),
}

# Axes that are never tuned (A1): `cost` is the 8.098 bps invariant; `signal` is
# R4/R5-owned passive escalation. Skipped at normalization.
_SKIP_AXES = frozenset({"cost", "signal"})

# A WSL-local snapshot of R1's playable universe (RECON-UNIVERSE-001 Level-1).
# In production the caller passes surface_as_dict()'s real ``subset_of``; this is
# only the standalone/test default (the bot's config_surface can't import on WSL).
_DEFAULT_UNIVERSE = ("BTC", "ETH", "SOL", "HYPE", "ZEC", "PAXG", "XMR")

# Module logger. STDLIB logging, mirroring compass_metrics.py:536 — NOT loguru.
# 🚨 Every log call in this module uses an F-STRING, never `%s` positional args
# and never `{}`: `%s` is correct under stdlib logging but is emitted LITERALLY by
# loguru (which formats via str.format()), and `{}` is the exact inverse. An
# f-string is pre-interpolated by Python and is therefore the ONLY form that
# renders correctly under BOTH loggers — so this cannot become another blind site
# if the module's logger is ever swapped.
_log = logging.getLogger("trainer_bandit")

# Running observed blend range (process-local, reset on import). The bandit has
# NEVER scored a real candidate, so REWARD_K rests on a MODELLED range; these two
# are what turn that assumption into a measurement the moment anything real
# scores. Updated unconditionally in `compass_reward`.
_observed_blend_min: Optional[float] = None
_observed_blend_max: Optional[float] = None


def observed_blend_range() -> Tuple[Optional[float], Optional[float]]:
    """The (min, max) positive blend this process has actually scored.

    ``(None, None)`` until the first scored survivor with blend > 0 — which, as of
    RD-B8, has never happened in production (`bandit_posteriors` = 0 rows)."""
    return _observed_blend_min, _observed_blend_max


def enabled() -> bool:
    """The bandit's own search flag (default OFF). Mirrors ``alpha_budget.enabled``.

    Gates ONLY the ``run_search_step`` orchestration entry — the module is
    import-safe and its primitives stay callable regardless (for B4/B5 + tests).
    """
    return os.environ.get(FLAG_ENV, "").strip().lower() in ("1", "true", "yes", "on")


# ═══════════════════════════════════════════════════════════════════════════
# The axis schema (consumed IN; a snapshot default keeps this standalone on WSL)
# ═══════════════════════════════════════════════════════════════════════════
def default_axis_schema() -> Dict[str, Any]:
    """The 12-axis surface as ``surface_as_dict()`` would emit it — a WSL-local
    SNAPSHOT (RECON-TRAINER-001 pipe read of config_surface.py). Pass the live
    ``surface_as_dict()`` output in production; this keeps the bandit importable
    + testable without the bot package (which trips the auto_trader barrier).

    `cost` (invariant 8.098) and `signal` (R4/R5 passive) are described but never
    sampled; `exit` schedules and the `entry` dict band are opaque (not sampled in
    this minimal build) — only their scalar knobs are tunable.
    """
    return {
        "axes": [
            {"key": "tickers", "title": "Ticker universe subset", "parameters": [
                {"name": "universe_subset", "type": "tuple[str]",
                 "domain": {"subset_of": list(_DEFAULT_UNIVERSE)}}]},
            {"key": "size", "title": "Position size", "parameters": [
                {"name": "risk_fraction", "type": "float",
                 "domain": {"range": (0.0, 1.0), "exclude_min": True}}]},
            {"key": "leverage", "title": "Leverage (× cascade Lmax clamp)", "parameters": [
                {"name": "lmax_fraction", "type": "float",
                 "domain": {"per_ticker": {"lmax_fraction_range": (0.0, 1.0)}}}]},
            {"key": "timeframe", "title": "Holding timeframe", "parameters": [
                {"name": "bars", "type": "int", "domain": {"range": (1, None)}}]},
            {"key": "direction", "title": "Trade direction", "parameters": [
                {"name": "mode", "type": "enum", "domain": {"enum": ["BOTH", "LONG", "SHORT"]}}]},
            {"key": "hedge", "title": "Hedge on/off", "parameters": [
                {"name": "enabled", "type": "bool", "domain": {"enum": [True, False]}}]},
            {"key": "exit", "title": "Exit profile", "parameters": [
                {"name": "tail_cap_lmax_fraction", "type": "float",
                 "domain": {"range": (0.0, 1.0), "exclude_min": True}},
                {"name": "ratchet_schedule", "type": "schedule",
                 "domain": {"schedule": "[(trigger_peak_r, lock), ...]"}}]},  # opaque
            {"key": "portfolio", "title": "Portfolio-level coordination", "parameters": [
                {"name": "sleeve_priority", "type": "callable",
                 "domain": {"returns": "{sleeve.name: weight}", "default": "uniform"}},
                {"name": "allocate", "type": "callable",
                 "domain": {"policy": "Sequence[MarginRequest], available -> List[Allocation]",
                            "default": "pro_rata"}},
                {"name": "deployment_ceiling", "type": "float",
                 "domain": {"range": (0.0, 1.0), "exclude_min": True}}]},
            {"key": "timing_context", "title": "Regime as posture", "parameters": [
                {"name": "regime_as_posture", "type": "float",
                 "domain": {"applies_to": "deployment_ceiling", "range": (0.0, 1.0),
                            "exclude_min": True}}]},
            {"key": "cost", "title": "Cost bar (invariant)", "parameters": [
                {"name": "cost_bar_bps_rt", "type": "float",
                 "domain": {"invariant": 8.098, "unit": "bps round-trip"}}]},  # never tuned
            {"key": "signal", "title": "Swarm v5 escalation (R4/R5)", "parameters": [
                {"name": "swarm_v5_escalation_bands", "type": "signal",
                 "domain": {"owner": "R5 swarm_judgment_v5"}}]},  # never tuned
            {"key": "entry", "title": "Entry-quality band (per-sleeve)", "parameters": [
                {"name": "entry_quality.min_group_scores", "type": "dict",
                 "domain": {"keys": ["momentum", "trend", "structure"],
                            "value_range": (0.0, None)}}]},  # opaque
        ]
    }


# ── schema normalization → flat list of tunable knobs ──────────────────────
def _iter_params(schema: Dict[str, Any]):
    for ax in schema.get("axes", []) or []:
        akey = ax.get("key")
        for p in ax.get("parameters", []) or []:
            yield akey, p


def _knob_key_from(axis: str, param_name: Any) -> str:
    return f"{axis}.{param_name}"


def _knob_key(knob: Dict[str, Any]) -> str:
    return _knob_key_from(knob["axis"], knob["param"])


def _is_sampleable(axis: str, p: Dict[str, Any]) -> bool:
    if axis in _SKIP_AXES:
        return False
    dom = p.get("domain") or {}
    ptype = p.get("type")
    if "invariant" in dom or ptype == "signal":
        return False
    if ptype == "callable":
        return _knob_key_from(axis, p.get("name")) in POLICY_FAMILY
    return any(k in dom for k in ("enum", "subset_of", "range", "per_ticker"))


def sampleable_knobs(schema: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The flat list of tunable knobs (skips cost/signal/opaque). Each knob is
    ``{axis, param, type, domain}``; ``_knob_key`` is ``axis.param``."""
    out: List[Dict[str, Any]] = []
    for akey, p in _iter_params(schema):
        if _is_sampleable(akey, p):
            out.append({"axis": akey, "param": p.get("name"),
                        "type": p.get("type"), "domain": p.get("domain") or {}})
    return out


def sampleable_axes(schema: Dict[str, Any]) -> List[str]:
    return sorted({k["axis"] for k in sampleable_knobs(schema)})


def _axes_map(schema: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    m: Dict[str, List[Dict[str, Any]]] = {}
    for k in sampleable_knobs(schema):
        m.setdefault(k["axis"], []).append(k)
    return m


# ═══════════════════════════════════════════════════════════════════════════
# Value samplers (one per domain type; unknown/opaque -> None = skip)
# ═══════════════════════════════════════════════════════════════════════════
def _sample_value(rng: random.Random, knob: Dict[str, Any]) -> Any:
    ptype = knob.get("type")
    dom = knob.get("domain") or {}
    if "invariant" in dom or ptype == "signal":
        return None
    if ptype == "callable":
        fam = POLICY_FAMILY.get(_knob_key(knob))
        return rng.choice(list(fam)) if fam else None
    if "enum" in dom:
        opts = list(dom["enum"])
        return rng.choice(opts) if opts else None
    if "subset_of" in dom:
        universe = list(dom["subset_of"])
        if not universe:
            return None
        k = rng.randint(1, len(universe))          # non-empty subset
        return sorted(rng.sample(universe, k), key=lambda x: json.dumps(x, sort_keys=True))
    if "per_ticker" in dom:                          # leverage lmax_fraction ∈ (0,1]
        return round(rng.uniform(_EPS, 1.0), FLOAT_PRECISION)
    if "range" in dom:
        lo, hi = dom["range"]
        exclude_min = bool(dom.get("exclude_min"))
        is_int = ptype == "int"
        if hi is None:                               # unbounded -> documented cap
            hi = (lo + _INT_UNBOUNDED_SPAN) if is_int else (lo + _FLOAT_UNBOUNDED_SPAN)
        if is_int:
            lo_i = int(lo) + (1 if exclude_min else 0)
            hi_i = int(hi)
            if hi_i < lo_i:
                hi_i = lo_i
            return rng.randint(lo_i, hi_i)
        lo_f, hi_f = float(lo), float(hi)
        if hi_f < lo_f:
            hi_f = lo_f
        v = rng.uniform(lo_f, hi_f)
        if exclude_min and v <= lo_f:                # (lo, hi] semantics
            v = min(hi_f, lo_f + _EPS)
        return round(v, FLOAT_PRECISION)
    return None                                      # schedule / dict / keys -> opaque


# ═══════════════════════════════════════════════════════════════════════════
# Arm representation: canonical hash (stable across key/subset reorder; collision-safe)
# ═══════════════════════════════════════════════════════════════════════════
def _canon_value(v: Any) -> Any:
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        return round(v, FLOAT_PRECISION)
    if isinstance(v, (set, frozenset, list, tuple)):  # subsets: order-invariant
        return sorted((_canon_value(x) for x in v),
                      key=lambda x: json.dumps(x, sort_keys=True))
    if isinstance(v, dict):
        return {str(k): _canon_value(v[k]) for k in sorted(v, key=str)}
    return v


def canonicalize_arm(axes: Dict[str, Any]) -> str:
    """Stable canonical JSON of an axis-subset arm. Sorted keys + rounded floats +
    order-invariant subsets, so the SAME logical arm always serializes identically."""
    if not isinstance(axes, dict):
        raise TypeError(f"arm must be a dict of knob_key->value, got {type(axes).__name__}")
    canon = {str(k): _canon_value(axes[k]) for k in sorted(axes, key=str)}
    return json.dumps(canon, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def arm_hash(axes: Dict[str, Any]) -> str:
    """sha256 prefix of the canonical arm. Same subset -> same hash; distinct
    subsets -> distinct hash (collision-free in practice)."""
    return hashlib.sha256(canonicalize_arm(axes).encode("utf-8")).hexdigest()[:_HASH_LEN]


def _axes_of_arm(arm: Dict[str, Any]) -> set:
    return {str(k).split(".", 1)[0] for k in arm}


def _axes_of_json(axes_json: str) -> set:
    try:
        d = json.loads(axes_json)
    except Exception:
        return set()
    return {str(k).split(".", 1)[0] for k in d} if isinstance(d, dict) else set()


# ═══════════════════════════════════════════════════════════════════════════
# Per-arm Beta posteriors (Layer 1). Seeded (1,1); fractional updates.
# ═══════════════════════════════════════════════════════════════════════════
def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else (1.0 if x > 1.0 else x)


def _seed_arm(conn, ahash: str, level: int, axes_json: str) -> None:
    """INSERT OR IGNORE a fresh Beta(1,1) arm row (idempotent)."""
    conn.execute(
        "INSERT OR IGNORE INTO bandit_posteriors "
        "(arm_hash, level_id, axes_json, alpha, beta, n_obs, updated_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (ahash, int(level), axes_json, 1.0, 1.0, 0, utc_now()),
    )


def _finite_beta_param(raw: Any, field: str, ahash: str, level: int) -> float:
    """Coerce a stored Beta parameter to a FINITE positive float, or fall back to
    the (1,1) prior value with a loud log.

    🚨 RD-B8: a NULL / NaN / +-inf / non-numeric alpha or beta reaching
    ``_thompson_theta`` -> ``random.betavariate`` is the SAME cfg_float-class
    finiteness gap as ``compass_metrics._read_compass_weights`` — on the same
    flow, one call later. ``float(None)`` raises TypeError; a non-finite param
    makes the sampler meaningless or raises. Note SQLite cannot even store NaN
    (it coerces to NULL), so the realistic corruptions are NULL and +-inf.
    Fail SAFE to the uninformative prior — never a guessed posterior, never a
    silent crash inside the sampler.
    """
    try:
        val = float(raw)
    except (TypeError, ValueError):
        _log.warning(
            f"[BANDIT-POSTERIOR] non-numeric {field}={raw!r} for arm={ahash[:12]} "
            f"level={level} — falling back to the (1,1) prior value 1.0"
        )
        return 1.0
    if not math.isfinite(val) or val <= 0.0:
        _log.warning(
            f"[BANDIT-POSTERIOR] non-finite/non-positive {field}={val!r} for "
            f"arm={ahash[:12]} level={level} — falling back to the (1,1) prior value 1.0"
        )
        return 1.0
    return val


def get_posterior(ahash: str, level: int, *, conn=None) -> Tuple[float, float, int]:
    """Return ``(alpha, beta, n_obs)`` for an arm; unseeded -> the (1,1) prior.

    Alpha/beta are finiteness-guarded (RD-B8): a corrupt stored parameter falls
    back to the prior with a loud log rather than reaching ``betavariate``."""
    own = conn is None
    if own:
        conn = get_connection()
    try:
        row = conn.execute(
            "SELECT alpha, beta, n_obs FROM bandit_posteriors WHERE arm_hash=? AND level_id=?",
            (ahash, int(level)),
        ).fetchone()
    finally:
        if own:
            conn.close()
    if row is None:
        return (1.0, 1.0, 0)
    alpha = _finite_beta_param(row[0], "alpha", ahash, int(level))
    beta = _finite_beta_param(row[1], "beta", ahash, int(level))
    try:
        n_obs = int(row[2])
    except (TypeError, ValueError):
        _log.warning(
            f"[BANDIT-POSTERIOR] non-integer n_obs={row[2]!r} for arm={ahash[:12]} "
            f"level={int(level)} — falling back to 0"
        )
        n_obs = 0
    return (alpha, beta, n_obs)


def update_posterior(ahash: str, level: int, reward: float, *,
                     conn=None, axes_json: Optional[str] = None) -> Tuple[float, float, int]:
    """Fold one compass outcome into an arm's Beta posterior: ``α += reward``,
    ``β += (1 - reward)``, ``n_obs += 1`` (reward∈[0,1]). Seeds (1,1) if new.
    Persists to trainer.db. Returns the updated ``(alpha, beta, n_obs)``."""
    r = _clamp01(float(reward))
    own = conn is None
    if own:
        conn = get_connection()
    try:
        with conn:  # one transaction; commits on success, rolls back on error
            if axes_json is None:
                row = conn.execute(
                    "SELECT axes_json FROM bandit_posteriors WHERE arm_hash=? AND level_id=?",
                    (ahash, int(level)),
                ).fetchone()
                axes_json = row[0] if row else json.dumps({"_unresolved_arm": ahash})
            _seed_arm(conn, ahash, int(level), axes_json)
            conn.execute(
                "UPDATE bandit_posteriors SET alpha = alpha + ?, beta = beta + ?, "
                "n_obs = n_obs + 1, updated_at = ? WHERE arm_hash=? AND level_id=?",
                (r, 1.0 - r, utc_now(), ahash, int(level)),
            )
            out = conn.execute(
                "SELECT alpha, beta, n_obs FROM bandit_posteriors WHERE arm_hash=? AND level_id=?",
                (ahash, int(level)),
            ).fetchone()
    finally:
        if own:
            conn.close()
    return (float(out[0]), float(out[1]), int(out[2]))


# ═══════════════════════════════════════════════════════════════════════════
# Reward mapping: compass verdict -> Beta success mass (FRACTIONAL default)
# ═══════════════════════════════════════════════════════════════════════════
def _record_observed_blend(blend: float, reward: float, k: float) -> None:
    """Fold one scored blend into the running observed range and LOG IT.

    🚨 THE POINT: `REWARD_K` is derived from a MODELLED blend range that has never
    been measured (`bandit_posteriors` = 0 rows at RD-B8). This is the line that
    converts that assumption into a measurement — the moment anything real scores,
    the modelled range either validates or contradicts itself IN THE LOG, without
    anyone remembering to go looking. Without it, REWARD_K is a hardcoded constant
    resting on a model nobody revisits, which is exactly how REWARD_K = 0.5 got
    here in the first place.

    Unconditional (every scored survivor), and NOT a hot path: `compass_reward`
    fires ~1-2x per loop iteration at a 60s default cadence (~2/min worst case).
    The running min/max is self-bounding — it does not grow with call count.

    NEVER raises: a logging or bookkeeping failure must not be able to change a
    reward or break the search loop.
    """
    global _observed_blend_min, _observed_blend_max
    try:
        if not math.isfinite(blend):
            # A non-finite blend should never reach here (the compass guards it),
            # but if it ever does, say so LOUDLY rather than poisoning the range.
            _log.warning(
                f"[BANDIT-SCALE] non-finite blend_score={blend!r} reached compass_reward "
                f"— NOT folded into the observed range; upstream compass defect"
            )
            return
        if _observed_blend_min is None or blend < _observed_blend_min:
            _observed_blend_min = blend
        if _observed_blend_max is None or blend > _observed_blend_max:
            _observed_blend_max = blend

        lo, hi = _observed_blend_min, _observed_blend_max
        in_band = SAFE_BAND_LO <= blend <= SAFE_BAND_HI
        _log.info(
            f"[BANDIT-SCALE] blend={blend:.6g} reward={reward:.6f} k={k:.8g} "
            f"observed_range=[{lo:.6g}, {hi:.6g}] "
            f"modelled_range=[{MODELLED_BLEND_MIN:.6g}, {MODELLED_BLEND_MAX:.6g}] "
            f"safe_band=[{SAFE_BAND_LO:.6g}, {SAFE_BAND_HI:.6g}] in_band={in_band}"
        )
        # The two hard re-derivation triggers, surfaced the instant they fire.
        if hi > SAFE_BAND_HI:
            _log.warning(
                f"[BANDIT-SCALE] 🚨 observed max {hi:.6g} EXCEEDS safe band top "
                f"{SAFE_BAND_HI:.6g} — reward is saturating at the TOP. REWARD_K must be "
                f"re-derived as 1/observed_operative_max (currently 1/{OPERATIVE_BLEND_MAX:.6g})."
            )
        if lo < SAFE_BAND_LO:
            _log.warning(
                f"[BANDIT-SCALE] 🚨 observed min {lo:.6g} BELOW safe band floor "
                f"{SAFE_BAND_LO:.6g} — reward is saturating at the BOTTOM (the symmetric "
                f"failure). REWARD_K must be re-derived as 1/observed_operative_max "
                f"(currently 1/{OPERATIVE_BLEND_MAX:.6g})."
            )
    except Exception:  # pragma: no cover — observability must never break scoring
        pass


def compass_reward(verdict: Dict[str, Any], *, mode: str = "fractional",
                   k: float = REWARD_K) -> float:
    """Map B1's ``evaluate_compass`` verdict -> reward r∈[0,1].

    FRACTIONAL (default, Ghost-locked):
        rejected            -> 0.00   (failed the survival wall)
        survived_unscorable -> 0.25   (cleared the wall; no demonstrable edge yet)
        scored & blend<=0   -> 0.40   (survived + scorable, but not a positive edge)
        scored & blend>0    -> clip(0.6 + tanh(k·blend)·0.4, 0.6, 1.0)   (edge, scaled)
    BINARY (fallback): 1.0 iff scored & blend>0, else 0.0.
    """
    if not isinstance(verdict, dict):
        return 0.0
    v = verdict.get("verdict")
    blend = verdict.get("blend_score")
    blend_num: Optional[float] = (
        float(blend) if isinstance(blend, (int, float)) and not isinstance(blend, bool) else None
    )
    if mode == "binary":
        return 1.0 if (v == "scored" and blend_num is not None and blend_num > 0) else 0.0
    # fractional
    if v == "rejected":
        return 0.0
    if v == "survived_unscorable":
        return 0.25
    if v == "scored":
        if blend_num is None or blend_num <= 0:
            return 0.40
        r = min(1.0, max(0.6, 0.6 + math.tanh(k * blend_num) * 0.4))
        _record_observed_blend(blend_num, r, k)
        return r
    return 0.0  # unknown verdict -> conservative failure


def score_and_update(arm: Any, level: int, backtest_candidate: Dict[str, Any], *,
                     conn=None, weights: Optional[Dict[str, float]] = None,
                     mode: str = "fractional") -> Dict[str, Any]:
    """The compass scoring hook: score a sampled arm's backtest outcome via B1's
    ``evaluate_compass`` and fold the reward into the arm's Beta posterior.

    ``arm`` is the arm dict (or a pre-computed arm_hash). ``backtest_candidate`` is
    the backtest-outcome dict B1 scores (equity_curve / net_pnl_series / daily_returns
    / trades). Returns ``{arm_hash, reward, posterior, verdict}``.
    """
    if isinstance(arm, str):
        ahash, axes_json = arm, None
    else:
        ahash, axes_json = arm_hash(arm), canonicalize_arm(arm)
    own = conn is None
    if own:
        conn = get_connection()
    try:
        verdict = compass_metrics.evaluate_compass(
            backtest_candidate, int(level), conn=conn, weights=weights)
        reward = compass_reward(verdict, mode=mode)
        post = update_posterior(ahash, int(level), reward, conn=conn, axes_json=axes_json)
    finally:
        if own:
            conn.close()
    return {"arm_hash": ahash, "reward": reward, "posterior": post, "verdict": verdict}


# ═══════════════════════════════════════════════════════════════════════════
# Exploration policy (§D.12.4): one-axis-then-broaden + the balance rule
# ═══════════════════════════════════════════════════════════════════════════
def propose_depth(total_obs: int, n_axes: int, *, max_depth: Optional[int] = None) -> int:
    """Soft depth schedule — the observable 'one-axis-then-broaden'. Cold start
    (total_obs=0) -> 1 (search narrows to a single axis); every +BROADEN_STEP
    observations lifts the cap by 1, up to ``n_axes``. This is the prior-width
    broadening realized as a proposal-depth cap; it is NOT a heredity barrier."""
    cap = 1 + (max(0, int(total_obs)) // BROADEN_STEP)
    cap = min(cap, max(1, int(n_axes)))
    if max_depth is not None:
        cap = min(cap, max(1, int(max_depth)))
    return max(1, cap)


def exploration_bonus(arm_axes: Iterable[str], axis_stats: Dict[str, Dict[str, int]],
                      n_events: int, *, lambda_stale: float = LAMBDA_STALE,
                      lambda_sat: float = LAMBDA_SAT) -> float:
    """Additive balance term on the Thompson score (never a hard constraint):

        + λ_stale · mean(staleness)   — a long-untested axis gets an opportunity bonus
        - λ_sat  · mean(saturation)   — an over-focused axis gets a penalty

    ``axis_stats[axis] = {"n_obs": int, "last_step": int}`` (last_step = the sample
    event index at which the axis was last chosen; 0 = never). ``n_events`` = total
    sampling events at this level. Staleness = (steps since last touch)/n_events
    (never-touched -> 1.0, max); saturation = axis n_obs / total n_obs share.
    """
    axset = {str(a) for a in arm_axes}
    if not axset:
        return 0.0
    total_obs = sum(int(s.get("n_obs", 0)) for s in axis_stats.values())
    denom_obs = max(1, total_obs)
    events = max(1, int(n_events))
    stale_terms: List[float] = []
    sat_terms: List[float] = []
    for ax in axset:
        s = axis_stats.get(ax, {"n_obs": 0, "last_step": 0})
        last = int(s.get("last_step", 0))
        steps_since = events - last            # never touched (last=0) -> events (max)
        stale_terms.append(min(1.0, max(0.0, steps_since / events)))
        sat_terms.append(int(s.get("n_obs", 0)) / denom_obs)
    stale = sum(stale_terms) / len(stale_terms)
    sat = sum(sat_terms) / len(sat_terms)
    return lambda_stale * stale - lambda_sat * sat


def axis_stats_from_db(conn, level: int) -> Tuple[Dict[str, Dict[str, int]], int]:
    """Build ``(axis_stats, n_events)`` from ``bandit_posteriors``: per-axis n_obs
    is summed over arms containing the axis; per-axis last_step is the sample-event
    rank (by ``last_sampled_at`` ascending) of the most recent arm that touched it;
    n_events = number of arms ever sampled (last_sampled_at not null) at this level.

    🚨 Skips malformed-``arm_hash`` rows (RECON-TRAINER-003 / RM-TRAINER-B2): a hash
    that is not ``_HASH_LEN`` chars cannot have come from ``arm_hash()``, so the row is
    an unreachable hand-seeded fixture. Unfiltered its ``n_obs`` was summed into the
    per-axis totals, letting a trial that never happened STEER exploration.
    """
    rows = conn.execute(
        "SELECT axes_json, n_obs, last_sampled_at FROM bandit_posteriors "
        "WHERE level_id=? AND length(arm_hash)=?",
        (int(level), _HASH_LEN),
    ).fetchall()
    sampled = sorted(((r[2], r[0]) for r in rows if r[2]), key=lambda x: x[0])
    n_events = len(sampled)
    axis_last_step: Dict[str, int] = {}
    for step, (_ts, aj) in enumerate(sampled, start=1):
        for ax in _axes_of_json(aj):
            axis_last_step[ax] = step  # ascending order -> latest step wins
    axis_nobs: Dict[str, int] = {}
    for aj, nobs, _ts in rows:
        for ax in _axes_of_json(aj):
            axis_nobs[ax] = axis_nobs.get(ax, 0) + int(nobs or 0)
    stats: Dict[str, Dict[str, int]] = {}
    for ax in set(axis_last_step) | set(axis_nobs):
        stats[ax] = {"n_obs": axis_nobs.get(ax, 0), "last_step": axis_last_step.get(ax, 0)}
    return stats, n_events


# ═══════════════════════════════════════════════════════════════════════════
# Proposal + Thompson pick
# ═══════════════════════════════════════════════════════════════════════════
def propose_arm(schema: Dict[str, Any], depth: int, rng: random.Random) -> Dict[str, Any]:
    """Sample ONE arbitrary-depth axis-subset arm DIRECTLY (no heredity): choose
    ``depth`` distinct axes, then one sampleable knob + value per axis. A depth-2
    arm is produced with NO prior single-axis grounding — the load-bearing §V
    property. Returns ``{knob_key: value}`` (may be shorter than depth if a chosen
    knob's value samples to None/opaque)."""
    amap = _axes_map(schema)
    axes = list(amap.keys())
    if not axes:
        return {}
    d = max(1, min(int(depth), len(axes)))
    arm: Dict[str, Any] = {}
    for ax in rng.sample(axes, d):
        knob = rng.choice(amap[ax])
        val = _sample_value(rng, knob)
        if val is not None:
            arm[_knob_key(knob)] = val
    return arm


def load_existing_arms(conn, level: int, limit: int = 8) -> List[Dict[str, Any]]:
    """The exploit pool: previously-instantiated arms for this level (most-observed
    first), parsed back from ``axes_json``.

    🚨 Skips malformed-``arm_hash`` rows (RECON-TRAINER-003 / RM-TRAINER-B2). This is
    the sharpest edge of the fixture: ``ORDER BY n_obs DESC`` put an unreachable
    hand-seeded row — with fabricated evidence — at the TOP of the exploit pool.
    """
    rows = conn.execute(
        "SELECT axes_json FROM bandit_posteriors WHERE level_id=? "
        "AND length(arm_hash)=? "
        "ORDER BY n_obs DESC, updated_at DESC LIMIT ?",
        (int(level), _HASH_LEN, int(max(0, limit))),
    ).fetchall()
    out: List[Dict[str, Any]] = []
    for (aj,) in rows:
        try:
            d = json.loads(aj)
            if isinstance(d, dict):
                out.append(d)
        except Exception:
            continue
    return out


def _thompson_theta(alpha: float, beta: float, rng: random.Random) -> float:
    """One Thompson draw θ~Beta(α,β) (stdlib; numpy absent). Floors degenerate
    params so a fresh/degenerate arm never breaks the sampler."""
    return rng.betavariate(max(_EPS, float(alpha)), max(_EPS, float(beta)))


def sample_arm(candidate_arms: Sequence[Dict[str, Any]], level: int, *,
               conn=None, rng: Optional[random.Random] = None,
               axis_stats: Optional[Dict[str, Dict[str, int]]] = None,
               n_events: Optional[int] = None, explore: bool = True) -> Dict[str, Any]:
    """Thompson pick over a candidate arm pool: for each arm sample θ~Beta from its
    posterior, add the exploration balance term, pick argmax. Reads posteriors from
    trainer.db at call time. Returns the chosen arm dict
    ``{arm, arm_hash, theta, bonus, score, all}``. Raises on an empty pool."""
    if not candidate_arms:
        raise ValueError("sample_arm: empty candidate pool")
    rng = rng or random.Random()
    own = conn is None
    if own:
        conn = get_connection()
    try:
        if explore and axis_stats is None:
            axis_stats, n_events = axis_stats_from_db(conn, int(level))
        stats = axis_stats or {}
        events = int(n_events or 0)
        scored: List[Dict[str, Any]] = []
        best: Optional[Dict[str, Any]] = None
        for arm in candidate_arms:
            ahash = arm_hash(arm)
            a, b, _ = get_posterior(ahash, int(level), conn=conn)
            theta = _thompson_theta(a, b, rng)
            bonus = exploration_bonus(_axes_of_arm(arm), stats, events) if explore else 0.0
            entry = {"arm": arm, "arm_hash": ahash, "theta": theta,
                     "bonus": bonus, "score": theta + bonus}
            scored.append(entry)
            if best is None or entry["score"] > best["score"]:
                best = entry
    finally:
        if own:
            conn.close()
    assert best is not None
    result = dict(best)
    result["all"] = scored
    return result


# ═══════════════════════════════════════════════════════════════════════════
# Orchestration entry (flag-gated) — propose the next config to try
# ═══════════════════════════════════════════════════════════════════════════
def run_search_step(schema: Optional[Dict[str, Any]] = None, *, level: int,
                    conn=None, rng: Optional[random.Random] = None,
                    n_fresh: int = 8, n_exploit: int = 8,
                    max_depth: Optional[int] = None) -> Dict[str, Any]:
    """The bandit's search step: build a candidate pool (fresh no-heredity proposals
    at the current schedule depth + the exploit pool), Thompson-pick, seed + stamp
    the chosen arm. Returns the chosen arm + diagnostics.

    DORMANT when ``TRAINER_BANDIT_ENABLED`` is off: returns ``{enabled: False}`` and
    mutates NOTHING (byte-identical inert)."""
    if not enabled():
        return {"enabled": False, "arm": None, "arm_hash": None,
                "reason": f"{FLAG_ENV} off"}
    schema = schema or default_axis_schema()
    rng = rng or random.Random()
    own = conn is None
    if own:
        conn = get_connection()
    try:
        axis_stats, n_events = axis_stats_from_db(conn, int(level))
        total_obs = sum(int(s["n_obs"]) for s in axis_stats.values())
        n_ax = len(sampleable_axes(schema))
        depth_cap = propose_depth(total_obs, n_ax, max_depth=max_depth)
        fresh: List[Dict[str, Any]] = []
        for _ in range(max(0, int(n_fresh))):
            arm = propose_arm(schema, rng.randint(1, depth_cap), rng)
            if arm:
                fresh.append(arm)
        pool = fresh + load_existing_arms(conn, int(level), limit=n_exploit)
        if not pool:
            arm = propose_arm(schema, 1, rng)  # degenerate fallback
            if not arm:
                return {"enabled": True, "arm": None, "arm_hash": None,
                        "reason": "no sampleable knobs in schema"}
            pool = [arm]
        best = sample_arm(pool, int(level), conn=conn, rng=rng,
                          axis_stats=axis_stats, n_events=n_events)
        aj = canonicalize_arm(best["arm"])
        with conn:
            _seed_arm(conn, best["arm_hash"], int(level), aj)
            conn.execute(
                "UPDATE bandit_posteriors SET last_sampled_at=?, updated_at=? "
                "WHERE arm_hash=? AND level_id=?",
                (utc_now(), utc_now(), best["arm_hash"], int(level)),
            )
        return {"enabled": True, "arm": best["arm"], "arm_hash": best["arm_hash"],
                "axes_json": aj, "theta": best["theta"], "bonus": best["bonus"],
                "score": best["score"], "depth_cap": depth_cap, "pool_size": len(pool),
                "level": int(level)}
    finally:
        if own:
            conn.close()


if __name__ == "__main__":
    # Guarded smoke only — NEVER runs on import.
    _rng = random.Random(7)
    _schema = default_axis_schema()
    print(f"sampleable axes ({len(sampleable_axes(_schema))}): {sampleable_axes(_schema)}")
    _a = propose_arm(_schema, 3, _rng)
    print(f"depth-3 arm: {_a}")
    print(f"arm_hash: {arm_hash(_a)}")
    print(f"canonical: {canonicalize_arm(_a)}")
    print(f"flag enabled(): {enabled()}  (run_search_step dormant unless set)")
    print(f"run_search_step (flag off): {run_search_step(_schema, level=0)}")
