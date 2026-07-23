#!/usr/bin/env python3
"""trainer_capital.py — the R9 trainer's CAPITAL-TUNING + REGIME-POSTURE proposals
[R9-B5, gaps T8 (§D.9) + T9].

Two WSL-side, pure-proposal surfaces the trainer uses to tune WHOLE-BOOK risk
posture. Both are SURVIVAL-BOUND to B1's compass and produce proposals B6 hands
off — they mutate NOTHING (no VM write, no auto_config, no money path). They are
INERT until wired into the search (flag ``TRAINER_CAPITAL_ENABLED``, default OFF).

═══════════════════════════════════════════════════════════════════════════════
 T8 — CAPITAL TUNING (deployment_ceiling), a SURVIVAL LEVER, never a chaser
═══════════════════════════════════════════════════════════════════════════════
``deployment_ceiling`` = the fraction of equity that may be deployed at a moment
(auto_trader.portfolio.config_surface :537; auto_trader.portfolio.capital.
deployment_ceiling(), null = DEPLOYMENT_CEILING_NULL = 0.45 — Ghost's conservative
floor). The trainer tunes it ONLY within what B1's two compass gates allow: a
proposed ceiling is validated by running its simulated candidate through
``evaluate_compass`` — if the candidate breaches the DD ceiling OR the CVaR floor
(the two-gate survival WALL), the proposed ceiling is REJECTED and the default
0.45 holds. Capital is a survival lever bounded by the compass, NEVER a magnitude-
chaser. It sits ABOVE the hard -25% daily-loss breaker (risk_breakers.py, a SOFTER
tunable posture, not the breaker — the trainer optimizes UNDER the breaker and
NEVER touches risk_breakers.py).

═══════════════════════════════════════════════════════════════════════════════
 T9 — REGIME AS RISK-POSTURE (the one legitimate regime re-entry), AVAILABLE-NOT-
      FORCED, NEVER A SIGNAL
═══════════════════════════════════════════════════════════════════════════════
``regime_as_posture`` (config_surface :553, timing_context) modifies ONLY
``deployment_ceiling`` — trade SMALLER in chaos, MORE in calm. It is a POSTURE the
compass respects, NEVER a signal (it does not enter the signal path; grep-asserted).
AVAILABLE not forced: the trainer adopts a regime posture ONLY when
``evaluate_compass`` improves WITH it vs without — if it does not help, the posture
is NOT adopted. Regime re-entry is legitimate ONLY when the compass says it helps.

money_path=no. MAX(level) stays 0. v4 PAUSED. The trainer PROPOSES; nothing trades.
Python 3, stdlib only (reads B1's compass + B0's trainer.db; opens no pipe, no VM).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

_log = logging.getLogger("trainer.capital")

# Mirror of auto_trader.portfolio.capital.DEPLOYMENT_CEILING_NULL — Ghost's
# conservative floor. The default HOLDS here until a survival-safe adjustment is
# learned (the trainer can't import capital.py on WSL; the constant is mirrored,
# not imported — keep in sync if the bot ever changes DEPLOYMENT_CEILING_NULL).
DEPLOYMENT_CEILING_NULL: float = 0.45

# The deployment_ceiling / regime_as_posture axis domain (config_surface): (0.0, 1.0].
_CEILING_MAX: float = 1.0

# ── flag (default OFF → inert; the proposal surfaces produce the conservative
#    default without running the compass until B6 wires + enables them) ──
TRAINER_CAPITAL_ENABLED_ENV = "TRAINER_CAPITAL_ENABLED"


def enabled() -> bool:
    """True iff TRAINER_CAPITAL_ENABLED is truthy. Off → proposals return the
    conservative default (0.45 ceiling / no posture) without touching the compass."""
    return os.environ.get(TRAINER_CAPITAL_ENABLED_ENV, "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def _get_evaluate_compass():
    """Lazy import of B1's compass. Returns the callable, or None if the compass is
    unavailable (→ callers fall back to the conservative default)."""
    try:
        from compass_metrics import evaluate_compass  # B1 — pure stdlib, WSL-local
        return evaluate_compass
    except Exception as exc:  # pragma: no cover - defensive
        _log.warning("[TRAINER-CAPITAL] compass unavailable: %r", exc)
        return None


def _valid_ceiling(x: Any) -> bool:
    """A proposed ceiling is in the axis domain (0.0, 1.0] — exclude_min (>0), ≤1."""
    return isinstance(x, (int, float)) and not isinstance(x, bool) \
        and 0.0 < float(x) <= _CEILING_MAX


def _clamp_ceiling(x: float) -> float:
    """Clamp a survival-safe proposal into the axis domain (paranoia; a survived
    candidate's ceiling is already valid)."""
    return min(max(float(x), 1e-9), _CEILING_MAX)


def propose_deployment_ceiling(candidate: Dict[str, Any], level: int, *,
                               weights: Optional[Dict[str, float]] = None,
                               conn: Any = None) -> float:
    """Propose a survival-safe ``deployment_ceiling`` for ``candidate`` at ``level``.

    ``candidate`` is a compass-candidate (equity_curve / net_pnl_series /
    daily_returns / trades — the simulated result of deploying at the proposed
    ceiling) carrying its proposed ceiling under ``candidate["deployment_ceiling"]``.

    SURVIVAL-BOUND: the proposal is accepted ONLY if the candidate SURVIVES B1's
    two-gate wall (``evaluate_compass(...).survived``). A ceiling that breaches the
    DD ceiling OR the CVaR floor is REJECTED and the conservative floor 0.45 holds.
    Also returns 0.45 when: the flag is off (inert), no valid ceiling is proposed,
    or the compass is unavailable/errors (conservative default). NEVER raises."""
    if not enabled():
        return DEPLOYMENT_CEILING_NULL  # inert — no compass call, byte-identical

    proposed_raw = candidate.get("deployment_ceiling") if isinstance(candidate, dict) else None
    if not _valid_ceiling(proposed_raw):
        _log.debug("[TRAINER-CAPITAL] no valid proposed ceiling — holding %.3f",
                   DEPLOYMENT_CEILING_NULL)
        return DEPLOYMENT_CEILING_NULL
    assert isinstance(proposed_raw, (int, float))  # _valid_ceiling proved it (static type-narrow)
    proposed = float(proposed_raw)

    evaluate_compass = _get_evaluate_compass()
    if evaluate_compass is None:
        return DEPLOYMENT_CEILING_NULL  # compass unavailable → conservative default

    try:
        verdict = evaluate_compass(candidate, int(level), conn=conn, weights=weights)
    except Exception as exc:  # compass runtime error → conservative default
        _log.warning("[TRAINER-CAPITAL] compass evaluate failed (holding %.3f): %r",
                     DEPLOYMENT_CEILING_NULL, exc)
        return DEPLOYMENT_CEILING_NULL

    if not verdict.get("survived"):
        _log.info("[TRAINER-CAPITAL] ceiling %.3f REJECTED (breaches %s) — holding %.3f",
                  proposed, verdict.get("failing_gates"), DEPLOYMENT_CEILING_NULL)
        return DEPLOYMENT_CEILING_NULL

    safe = _clamp_ceiling(proposed)
    _log.info("[TRAINER-CAPITAL] ceiling %.3f ACCEPTED (survival-safe, blend=%s)",
              safe, verdict.get("blend_score"))
    return safe


def _lite(verdict: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """A compact, JSON-safe slice of a compass verdict for the proposal record."""
    v = verdict or {}
    return {"survived": v.get("survived"), "blend_score": v.get("blend_score"),
            "verdict": v.get("verdict"), "failing_gates": v.get("failing_gates")}


def _compass_improves(v_with: Dict[str, Any], v_without: Dict[str, Any]) -> bool:
    """True iff the WITH-posture verdict is STRICTLY better than WITHOUT (available-
    not-forced — a posture is adopted only on proven improvement):
      * posture clears the wall the baseline breached                       → adopt
      * posture breaks survival / neither survives                          → decline
      * both survive → adopt ONLY iff blend_score strictly rises (both numeric)."""
    sw, so = bool(v_with.get("survived")), bool(v_without.get("survived"))
    if sw and not so:
        return True
    if not sw:
        return False           # posture broke survival OR neither cleared the wall
    # both survived — require a strictly higher, numeric blend_score.
    bw, bo = v_with.get("blend_score"), v_without.get("blend_score")
    if isinstance(bw, (int, float)) and isinstance(bo, (int, float)):
        return float(bw) > float(bo)
    return False               # unscorable (sortino < 3 obs) → can't prove improvement


def propose_regime_posture(candidate: Dict[str, Any], level: int, *,
                           weights: Optional[Dict[str, float]] = None,
                           conn: Any = None) -> Dict[str, Any]:
    """Propose a ``regime_as_posture`` (trade smaller in chaos, more in calm) as a
    modifier ON ``deployment_ceiling`` — AVAILABLE-NOT-FORCED, NEVER a signal.

    ``candidate`` carries:
      * ``candidate["baseline"]``     — compass-candidate simulated WITHOUT the posture
      * ``candidate["with_posture"]`` — compass-candidate simulated WITH the posture
      * ``candidate["posture"]``      — the regime→ceiling-multiplier map proposed

    Adopts the posture ONLY if ``evaluate_compass(with_posture)`` STRICTLY improves
    over ``evaluate_compass(baseline)``; otherwise declines. The posture modifies
    ONLY deployment_ceiling (``applies_to``), never a signal field. Off (flag) /
    degenerate regime data / compass unavailable → declines (conservative default).
    NEVER raises. Returns a proposal dict (mutates nothing)."""
    declined = {"adopt": False, "posture": None, "applies_to": "deployment_ceiling",
                "never_a_signal": True}

    if not enabled():
        return {**declined, "reason": f"{TRAINER_CAPITAL_ENABLED_ENV} off"}

    if not isinstance(candidate, dict):
        return {**declined, "reason": "degenerate regime data — no posture adopted"}
    baseline = candidate.get("baseline")
    with_posture = candidate.get("with_posture")
    posture = candidate.get("posture")
    if not isinstance(baseline, dict) or not isinstance(with_posture, dict) \
            or not isinstance(posture, dict) or not posture:
        return {**declined, "reason": "degenerate regime data — no posture adopted"}

    evaluate_compass = _get_evaluate_compass()
    if evaluate_compass is None:
        return {**declined, "reason": "compass unavailable — no posture adopted"}

    try:
        v_without = evaluate_compass(baseline, int(level), conn=conn, weights=weights)
        v_with = evaluate_compass(with_posture, int(level), conn=conn, weights=weights)
    except Exception as exc:  # compass runtime error → decline (conservative default)
        _log.warning("[TRAINER-CAPITAL] regime compass evaluate failed (declining): %r", exc)
        return {**declined, "reason": f"compass evaluate error: {exc}"}

    adopt = _compass_improves(v_with, v_without)
    record = {
        "adopt": adopt,
        "posture": posture if adopt else None,     # regime→ceiling-multiplier map
        "applies_to": "deployment_ceiling",         # the ONLY thing it modifies
        "never_a_signal": True,
        "reason": ("compass improves WITH posture — adopted" if adopt
                   else "compass does not improve — posture NOT adopted (available-not-forced)"),
        "compass_with": _lite(v_with),
        "compass_without": _lite(v_without),
    }
    _log.info("[TRAINER-CAPITAL] regime posture %s (with=%s / without=%s)",
              "ADOPTED" if adopt else "declined",
              record["compass_with"]["blend_score"], record["compass_without"]["blend_score"])
    return record


__all__ = ["propose_deployment_ceiling", "propose_regime_posture", "enabled",
           "DEPLOYMENT_CEILING_NULL", "TRAINER_CAPITAL_ENABLED_ENV"]


if __name__ == "__main__":
    # Guarded smoke — NEVER runs on import. Reports the flag; runs a proposal only
    # when enabled (inert otherwise). Injected weights → no DB touch.
    import json
    logging.basicConfig(level=logging.INFO)
    print(f"{TRAINER_CAPITAL_ENABLED_ENV} enabled(): {enabled()}")
    if enabled():
        _W = {"w_consistency": 0.7, "w_magnitude": 0.3, "dd_ceiling": 0.35, "cvar_floor": -0.15}
        _survivor = {
            "deployment_ceiling": 0.55,
            "equity_curve": [100, 102, 99, 103, 101, 105],
            "net_pnl_series": [0.02] * 19 + [-0.10],
            "daily_returns": [0.01, -0.02, 0.03, -0.01, 0.02, -0.015, 0.025],
            "trades": [{"pnl_usd": 10.0, "original_notional_usd": 1000.0, "ticker": "BTC"}],
        }
        print(json.dumps({
            "ceiling": propose_deployment_ceiling(_survivor, 0, weights=_W),
        }, indent=2, default=str))
