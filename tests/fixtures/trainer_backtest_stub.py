#!/usr/bin/env python3
"""A TEST-ONLY ``backtest_fn`` stub for the RP-C2 orchestration wiring proof.

🚨 THIS IS NOT `backtest_fn`. The real simulator is D-5 / RF-BACKTEST and is owned by
RP-C3; its contract lives in docs/design/BACKTEST_FN_SPEC.md. This file returns ONE
canned candidate so a test can drive `trainer_loop.main()` through the compass pre-score
branch and prove `REWARD_K` is consulted. It simulates NOTHING, reads no market data,
and must never be named by `TRAINER_BACKTEST_PROVIDER` outside a test.

The canned candidate is tuned to land INSIDE the measured REWARD_K safe band
(`trainer_bandit.SAFE_BAND_LO=13.76` .. `SAFE_BAND_HI=1614.0`) at blend ~536.5, which is
close to `OPERATIVE_BLEND_MAX=550` — the blend REWARD_K is derived from. Two reasons:
  * inside the band it raises no `[BANDIT-SCALE]` saturation warning, so the test does not
    manufacture a false alarm; and
  * at that blend `compass_reward` returns ~0.9004, which is far from EVERY `_reward_from`
    fallback (1.0 gate-passed / 0.4 clean-not-ready / 0.0 reject). That separation is the
    test's discriminator: reward ~0.9004 means the compass path ran and REWARD_K was
    consulted; reward exactly 1.0 means it did not.
⚠️ Deliberately NOT near the bottom of the band: `reward(30) = 0.9999999999999252`, so a
low-blend fixture would be indistinguishable from the 1.0 fallback at float tolerance.
"""
from typing import Any, Dict

# Sortino is driven by the single small negative return; -0.0028 is what puts the blend at
# ~536.5. Tuned empirically against compass_metrics.evaluate_compass (v1 path).
_DAILY_RETURNS = [0.05, 0.04, 0.06, -0.0028, 0.05, 0.045, 0.055]


def backtest_fn(arm: Dict[str, Any], level: int) -> Dict[str, Any]:
    """The `(arm, level) -> dict` shape BACKTEST_FN_SPEC.md §1 specifies. Ignores both
    inputs by design — this proves WIRING, not simulation fidelity."""
    return {
        "equity_curve": [100, 102, 99, 103, 101, 105],
        "net_pnl_series": [0.02] * 19 + [-0.10],
        "daily_returns": list(_DAILY_RETURNS),
        "trades": [{"ticker": t} for t in ("BTC", "ETH", "SOL", "PAXG", "XMR")],
        "original_notional_usd": 1000.0,
        "deployment_ceiling": 0.5,
    }
