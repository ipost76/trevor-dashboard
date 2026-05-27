#!/usr/bin/env python3
"""query_control_full.py — D2 (Control Center) backend.

GET /api/auto/control-full reads ALL auto_config rows whose value IS a
boolean (true/false), categorizes per A1 Section 3, and tags each with a
sensitivity tier (1/2/3) per A1 Section 9.

Output:
    {
      "controls": [
        {"key", "value": "true"|"false", "updated_at",
         "category", "sensitivity_tier", "immutable", "immutable_reason"},
        ...
      ],
      "total": N,
      "by_category": {"Execution": N, ...},
      "by_tier":     {"1": N, "2": N, "3": N},
      "live_edit_enabled": bool
    }
"""
from __future__ import annotations

import json
import sqlite3
import sys
from typing import Optional, Tuple

DB = "/home/trevor/trevor/trevor.db"

# A1 Section 3 categories: Execution · Signal Gates · Critic Stack
#                        · Calibration · Risk · Experimental · Misc
CATEGORIES = (
    "Execution", "Signal Gates", "Critic Stack",
    "Calibration", "Risk", "Experimental", "Misc",
)

# A1 Section 9 sensitivity tiers.
# Tier 1 — destructive (Hub UI must require 2-tap confirm + reason).
TIER_1: set[str] = {
    "AUTO_TRADER_ENABLED",
    "AUTO_LIVE_ENABLED",
    "EMERGENCY_KILLSWITCH",
    "LIVE_PARTIALS_ENABLED",
    "MEME_ONCHAIN_SCORING_ENABLED",
    "WHALE_HYPERLIQUID_PRIMARY",
    # B1c: flipping LIVE_EDIT_ENABLED on opens the write surface itself —
    # by definition the most consequential toggle on the page.
    "LIVE_EDIT_ENABLED",
}

# Tier 2 — sensitive (1-tap + status warning).
TIER_2: set[str] = {
    "ALO_ENTRY_ENABLED",
    "CALIBRATION_V2_ENABLED",
    "CALIBRATION_V2_SHADOW",
    "CALIBRATOR_LIVE",
    "CALIBRATOR_SHADOW_ENABLED",
    "REGIME_GATE_V2",
    "REGIME_GATE_V2_SHADOW",
    "LEVERAGE_V2_PROMOTED",
    "SIZING_V2_PROMOTED",
    "RECALIBRATED_THRESHOLDS_V2",
    "MTF_ASYMMETRY_V2",
    "PER_TICKER_THRESHOLDS_ENABLED",
    "CONFIRM_CYCLES_PROMOTED",
    "TIME_GATE_PROMOTED",
    "TREND_FLOOR_V2_ENABLED",
    "GROUP_WEIGHTS_V2",
    "TRAIL_V3_PROMOTED",
    "HARD_STOP_V2",
    "WIDE_STOPS_V2",
    "CRYPTO_STOP_FLOORS_AT_ENABLED",
    "PARTIAL_FEE_GUARD_V2_ENABLED",
    "FUNDING_CONSUMER_ENABLED",
    "GAP_WATCHDOG_ENABLED",
    "TICKER_DISCOVERY",
    "AI_SWARM_JUDGMENT_ENABLED",
    "PERSISTENCE_GATE_RELAXED",
}

# Tier 3 — free toggle (single-tap, no modal). Default for anything not in
# Tier 1/2.

# Immutable: paired audit-metadata booleans (if any) — none today, but
# keep the structure parallel to query_config_full.py for symmetry.
IMMUTABLE_KEYS: dict[str, str] = {
    # No immutable booleans today. Add here if Ghost ever ships an
    # autonomous-only bool that should NOT have a UI toggle.
}

# Explicit category overrides for keys whose category isn't obvious from
# prefix matching alone.
EXPLICIT_CATEGORY: dict[str, str] = {
    # Execution
    "AUTO_TRADER_ENABLED":               "Execution",
    "AUTO_LIVE_ENABLED":                 "Execution",
    "EMERGENCY_KILLSWITCH":              "Execution",
    "ALO_ENTRY_ENABLED":                 "Execution",
    "TICKER_DISCOVERY":                  "Execution",
    "HUB_BRAIN_EDIT_ENABLED":            "Execution",
    "HUB_AGGRESSIVE_TOGGLE_ENABLED":     "Execution",
    "HUB_AUTOTRADER_TOGGLE_ENABLED":     "Execution",
    "HUB_CONFIRM_CYCLES_TOGGLE_ENABLED": "Execution",
    "HUB_LIVE_PARTIALS_TOGGLE_ENABLED":  "Execution",
    "LIVE_EDIT_ENABLED":                 "Execution",
    # Signal Gates
    "LIVE_PARTIALS_ENABLED":             "Signal Gates",
    "PARTIAL_FEE_GUARD_V2_ENABLED":      "Signal Gates",
    "MOMENTUM_EXIT_ENABLED":             "Signal Gates",
    "ATR_TRAIL_ENABLED":                 "Signal Gates",
    "CHANDELIER_ENABLED":                "Signal Gates",
    "FEE_AWARE_EXIT":                    "Signal Gates",
    "STALE_V2":                          "Signal Gates",
    "TIMEOUT_V2":                        "Signal Gates",
    "TRAIL_V2":                          "Signal Gates",
    "TRAIL_V3_PROMOTED":                 "Signal Gates",
    "WIDE_STOPS_V2":                     "Signal Gates",
    "HARD_STOP_V2":                      "Signal Gates",
    "PARTIAL_V2":                        "Signal Gates",
    "BREAKEVEN_V2":                      "Signal Gates",
    "TREND_FLOOR_V2_ENABLED":            "Signal Gates",
    "PER_TICKER_EXIT_PROFILES":          "Signal Gates",
    "CONFIRM_CYCLES_PROMOTED":           "Signal Gates",
    "TIME_GATE_PROMOTED":                "Signal Gates",
    "TIME_GATE_SHADOW_ENABLED":          "Signal Gates",
    "SCOUT_V3_FEED":                     "Signal Gates",
    "GAP_WATCHDOG_ENABLED":              "Signal Gates",
    "CRYPTO_STOP_FLOORS_AT_ENABLED":     "Signal Gates",
    "MOMENTUM_FACTOR_LOGGING":           "Signal Gates",
    # Critic Stack
    "AI_SWARM_JUDGMENT_ENABLED":         "Critic Stack",
    "SHADOW_SCORER_V2_ENABLED":          "Critic Stack",
    "GROUP_WEIGHTS_V2":                  "Critic Stack",
    "GROUP_WEIGHTS_V2_SHADOW":           "Critic Stack",
    "DOUBLE_FILTER_SHADOW_ENABLED":      "Critic Stack",
    "FUNDING_CONSUMER_ENABLED":          "Critic Stack",
    # Calibration
    "CALIBRATION_V2_ENABLED":            "Calibration",
    "CALIBRATION_V2_SHADOW":             "Calibration",
    "CALIBRATOR_SHADOW_ENABLED":         "Calibration",
    "CALIBRATOR_LIVE":                   "Calibration",
    "FEE_MODEL_V2_ENABLED":              "Calibration",
    "PER_TICKER_THRESHOLDS_ENABLED":     "Calibration",
    # Risk
    "REGIME_GATE_V2":                    "Risk",
    "REGIME_GATE_V2_SHADOW":             "Risk",
    "LEVERAGE_V2_PROMOTED":              "Risk",
    "SIZING_V2_PROMOTED":                "Risk",
    "MEME_ONCHAIN_SCORING_ENABLED":      "Risk",
    "WHALE_HYPERLIQUID_PRIMARY":         "Risk",
    "MTF_ASYMMETRY_V2":                  "Risk",
    "RECALIBRATED_THRESHOLDS_V2":        "Risk",
    "CB_SESSION_ENABLED":                "Risk",
    "CB_PORTFOLIO_ENABLED":              "Risk",
    "REGIME_HOLD_ADJUST_ENABLED":        "Risk",
    "PERSISTENCE_GATE_RELAXED":          "Risk",
    "DERIV_AGENT_ENABLED":               "Risk",
    "MICRO_DATA_LAYER_ENABLED":          "Risk",
    "MICRO_AGENT_ENABLED":               "Risk",
    "SESSION_AUTO_EXPIRY_ENABLED":       "Risk",
    # Experimental
    "DEVIL_ADVOCATE_ENABLED":            "Experimental",
    "COMPACT_HAIKU_IDENTITY":            "Experimental",
    "SHADOW_LOG_NEUTRAL":                "Experimental",
    "COINGLASS_ENABLED":                 "Experimental",
    "LUNARCRUSH_ENABLED":                "Experimental",
    "FRED_ENABLED":                      "Experimental",
    # Misc
    "JOURNAL_AUTO_GENERATE_ENABLED":     "Misc",
    "EMAIL_TRIAGE_ENABLED":              "Misc",
    "BUDGET_OVERRIDE":                   "Misc",
    "COMPRESS_BRAIN_WEEKLY_ENABLED":     "Misc",
}

# Prefix rules for not-explicitly-mapped keys.
PREFIX_RULES: list[Tuple[str, str]] = [
    ("MOMENTUM_",                "Signal Gates"),
    ("MAX_TRADES_PER_TICKER_",   "Critic Stack"),
    ("HUB_REDESIGN_",            "Misc"),
    ("HUB_",                     "Execution"),
    ("CB_",                      "Risk"),
]


def _categorize(key: str) -> str:
    if key in EXPLICIT_CATEGORY:
        return EXPLICIT_CATEGORY[key]
    for prefix, cat in PREFIX_RULES:
        if key.startswith(prefix):
            return cat
    return "Misc"


def _tier(key: str) -> int:
    if key in TIER_1:
        return 1
    if key in TIER_2:
        return 2
    return 3


def _is_bool(value: Optional[str]) -> bool:
    return value is not None and value.strip().lower() in ("true", "false")


def main() -> int:
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5.0)
        rows = conn.execute(
            "SELECT key, value, updated_at FROM auto_config ORDER BY key"
        ).fetchall()
        live_edit_row = conn.execute(
            "SELECT value FROM auto_config WHERE key='LIVE_EDIT_ENABLED'"
        ).fetchone()
        conn.close()
    except Exception as exc:
        print(json.dumps({
            "controls": [], "total": 0, "by_category": {}, "by_tier": {},
            "live_edit_enabled": False,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0

    live_edit_enabled = bool(live_edit_row) and (
        (live_edit_row[0] or "").strip().lower() == "true"
    )

    controls: list[dict] = []
    by_category: dict[str, int] = {c: 0 for c in CATEGORIES}
    by_tier: dict[str, int] = {"1": 0, "2": 0, "3": 0}

    for key, value, updated_at in rows:
        if not _is_bool(value):
            continue
        cat = _categorize(key)
        tier = _tier(key)
        controls.append({
            "key": key,
            "value": value.strip().lower(),
            "updated_at": updated_at,
            "category": cat,
            "sensitivity_tier": tier,
            "immutable": key in IMMUTABLE_KEYS,
            "immutable_reason": IMMUTABLE_KEYS.get(key),
        })
        by_category[cat] = by_category.get(cat, 0) + 1
        by_tier[str(tier)] += 1

    print(json.dumps({
        "controls": controls,
        "total": len(controls),
        "by_category": by_category,
        "by_tier": by_tier,
        "live_edit_enabled": live_edit_enabled,
    }, default=str))
    return 0


if __name__ == "__main__":
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
