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
REWARD_K = 0.5               # tanh steepness for a positive blend_score -> reward

# Exploration policy (§D.12.4 one-axis-then-broaden + the balance rule).
BROADEN_STEP = 8             # every +8 total observations, allow +1 axis in a proposal
LAMBDA_STALE = 0.05          # staleness bonus weight (untested-axis opportunity)
LAMBDA_SAT = 0.05            # saturation penalty weight (over-focus damping)

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


def get_posterior(ahash: str, level: int, *, conn=None) -> Tuple[float, float, int]:
    """Return ``(alpha, beta, n_obs)`` for an arm; unseeded -> the (1,1) prior."""
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
    return (float(row[0]), float(row[1]), int(row[2]))


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
        return min(1.0, max(0.6, 0.6 + math.tanh(k * blend_num) * 0.4))
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
    """
    rows = conn.execute(
        "SELECT axes_json, n_obs, last_sampled_at FROM bandit_posteriors WHERE level_id=?",
        (int(level),),
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
    first), parsed back from ``axes_json``."""
    rows = conn.execute(
        "SELECT axes_json FROM bandit_posteriors WHERE level_id=? "
        "ORDER BY n_obs DESC, updated_at DESC LIMIT ?",
        (int(level), int(max(0, limit))),
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
def run_search_step(schema: Optional[Dict[str, Any]] = None, level: int = 0, *,
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
    print(f"run_search_step (flag off): {run_search_step(_schema)}")
