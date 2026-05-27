#!/usr/bin/env python3
"""query_config_full.py — D1 (Config editor) backend.

GET /api/auto/config-full reads ALL auto_config rows whose value is NOT a
boolean (true/false), categorizes each by key prefix per A1 Section 2, and
flags read-only ones (LIVE_HARD_CAPITAL_CAP_USD + system counters). Bool
rows are surfaced by query_control_full.py instead.

Output:
    {
      "configs": [
        {"key", "value", "updated_at", "category", "type",
         "immutable": bool, "immutable_reason": str | None},
        ...
      ],
      "total": N,
      "by_category": {"Capital": N, ...},
      "live_edit_enabled": bool
    }
"""
from __future__ import annotations

import json
import sqlite3
import sys
from typing import Optional, Tuple

DB = "/home/trevor/trevor/trevor.db"

# A1 Section 2 categories: Capital · Signal · Exit · Risk · Per-Ticker
#                         · Calibration · Execution · Misc
CATEGORIES = (
    "Capital", "Signal", "Exit", "Risk", "Per-Ticker", "Calibration",
    "Execution", "Misc",
)

# Immutable: read-only from the Hub even when LIVE_EDIT_ENABLED=true.
# Ghost's escalation path for these is a CC prompt, not the UI.
IMMUTABLE_KEYS = {
    "LIVE_HARD_CAPITAL_CAP_USD":        "Ghost ruling 4 — inviolable $50 cap",
    "EMERGENCY_KILLSWITCH_LAST_TOGGLE": "system counter — written by killswitch helper",
    "EMERGENCY_KILLSWITCH_LAST_AUTHOR": "system counter — written by killswitch helper",
    "EMERGENCY_KILLSWITCH_LAST_REASON": "system counter — written by killswitch helper",
    "ANTHROPIC_API_DAILY_RESET_DATE":   "system counter — auto-rotated by budget tracker",
    "ANTHROPIC_API_DAILY_TOKENS_USED":  "system counter — incremented per API call",
    "DISCOVERED_TICKERS":               "autonomous output — written by ticker discovery loop",
}

# Explicit category overrides for keys whose category isn't obvious from prefix.
EXPLICIT_CATEGORY: dict[str, str] = {
    # Capital
    "STARTING_CAPITAL":                "Capital",
    "BRIDGE_AMOUNT_USD":               "Capital",
    "MAX_POSITION_SIZE_PCT":           "Capital",
    "MAX_DAILY_COST_USD":              "Capital",
    # Signal
    "AGGRESSIVE_THRESHOLD":            "Signal",
    "MIN_JUDGMENT_CONFIDENCE":         "Signal",
    "CONFIDENCE_FLOOR":                "Signal",
    "CONFIDENCE_CEILING":              "Signal",
    "MIN_HMM_PROB":                    "Signal",
    "MAX_SINGLE_BELIEF":               "Signal",
    "OPPOSING_FACTOR":                 "Signal",
    "CONFLICT_FLOOR":                  "Signal",
    "PENALTY_ASYMMETRY":               "Signal",
    "MAX_ADJ":                         "Signal",
    "RULES_CACHE_TTL":                 "Signal",
    "SOFT_THRESHOLD_TOKENS":           "Signal",
    "HISTORY_CAPACITY":                "Signal",
    # Exit
    "EXIT_THRESHOLD":                  "Exit",
    "CHANDELIER_MULTIPLIER":           "Exit",
    "_FLUSH_EVERY_N_CYCLES":           "Exit",
    "ESCALATION_MIN_RISE":             "Exit",
    # Risk
    "DEFAULT_REGIME_MULT":             "Risk",
    "MIN_LEVERAGE":                    "Risk",
    "MAX_LEVERAGE":                    "Risk",
    "DEFAULT_BASE":                    "Risk",
    "ESCALATION_DELAY_SECONDS":        "Risk",
    "MEM_CRITICAL_PSS_MB":             "Risk",
    "MEM_TREND_THRESHOLD":             "Risk",
    "SESSION_RECOVERY_HOURS":          "Risk",
    "SESSION_IDLE_TIMEOUT":            "Risk",
    "_SIZE_MISMATCH_TOLERANCE":        "Risk",
    # Per-Ticker
    "DIRECTION_PENALTIES":             "Per-Ticker",
    "ATR_QUIET_THRESHOLD":             "Per-Ticker",
    "ATR_ACTIVE_THRESHOLD":            "Per-Ticker",
    "ACTIVE_REGIMES":                  "Per-Ticker",
    "MEME_TICKERS":                    "Per-Ticker",
    "HYPERLIQUID_PERPS":               "Per-Ticker",
    "CRYPTO_STOP_FLOORS":              "Per-Ticker",
    "KNOWN_TICKERS":                   "Per-Ticker",
    "CRYPTO_TICKERS":                  "Per-Ticker",
    "SLIPPAGE_BPS":                    "Per-Ticker",
    "DISCOVERED_TICKERS":              "Per-Ticker",
    # Calibration
    "DEFAULT_TARGET":                  "Calibration",
    "LOOKBACK_LIMIT":                  "Calibration",
    "CAL_MIN":                         "Calibration",
    "CAL_MAX":                         "Calibration",
    "INSUFFICIENT_POWER_N":            "Calibration",
    # Execution / system metadata
    "EMERGENCY_KILLSWITCH_LAST_TOGGLE": "Execution",
    "EMERGENCY_KILLSWITCH_LAST_AUTHOR": "Execution",
    "EMERGENCY_KILLSWITCH_LAST_REASON": "Execution",
    "ANTHROPIC_API_DAILY_RESET_DATE":   "Execution",
    "ANTHROPIC_API_DAILY_TOKENS_USED":  "Execution",
    "ANTHROPIC_API_DAILY_BUDGET_TOKENS":"Capital",
    "ALO_ENTRY_TIMEOUT_SEC":            "Execution",
}

# Prefix rules for keys not in EXPLICIT_CATEGORY. First-match wins.
PREFIX_RULES: list[Tuple[str, str]] = [
    ("CAPITAL_",                       "Capital"),
    ("PER_TRADE_",                     "Capital"),
    ("LIVE_CAPITAL_",                  "Capital"),
    ("LIVE_HARD_CAPITAL_",             "Capital"),
    ("LIVE_PER_TRADE_",                "Capital"),
    ("SIZE_MIN_",                      "Capital"),
    ("SIZE_MAX_",                      "Capital"),
    ("SIZING_V2_HIGH_CEILING_",        "Capital"),
    ("PARTIAL_DUST_GUARD_",            "Capital"),
    ("ANTHROPIC_API_DAILY_BUDGET",     "Capital"),
    ("CORR_",                          "Signal"),
    ("MIN_CORRELATION_",               "Signal"),
    ("MIN_TRAILING_",                  "Signal"),
    ("SOCIAL_Z_",                      "Signal"),
    ("MOMENTUM_EXIT_",                 "Exit"),
    ("MOMENTUM_MIN_HOLD_",             "Exit"),
    ("LIVE_DEAD_MAN_",                 "Exit"),
    ("LIVE_RETRY_",                    "Exit"),
    ("MAX_DAILY_",                     "Risk"),
    ("MAX_CONCURRENT_",                "Risk"),
    ("MAX_TRADES_PER_",                "Risk"),
    ("MAX_JUDGMENT_",                  "Risk"),
    ("LEVERAGE_DEFAULT",               "Risk"),
    ("LIVE_LEVERAGE_",                 "Risk"),
    ("DISCOVERY_TICKER_LEVERAGE",      "Risk"),
    ("ATR_DEQUE_",                     "Risk"),
    ("ATR_RETENTION_",                 "Risk"),
    ("LIVE_SLIPPAGE_",                 "Risk"),
    ("LIVE_EXIT_SLIPPAGE_",            "Risk"),
    ("CIRCUIT_BREAKER_",               "Risk"),
    ("GAP_WATCHDOG_INTERVAL_",         "Risk"),
    ("GAP_WATCHDOG_ALERT_",            "Risk"),
    ("FUNDING_POLL_",                  "Risk"),
    ("TICKER_THRESHOLDS",              "Per-Ticker"),
    ("RECALIBRATED_THRESHOLDS_",       "Per-Ticker"),
    ("TICKER_LEVERAGE",                "Per-Ticker"),
    ("MOMENTUM_FLOOR_BY_TICKER",       "Per-Ticker"),
    ("TICKER_TRAIL_",                  "Per-Ticker"),
    ("TICKER_BE_",                     "Per-Ticker"),
    ("TICKER_TARGETS",                 "Per-Ticker"),
    ("TICKER_HARD_STOP_",              "Per-Ticker"),
    ("ALO_DISABLED_TICKERS",           "Per-Ticker"),
    ("LEVERAGE_V2_INTERMEDIATE_",      "Per-Ticker"),
    ("MIN_TRADES_FOR_CAL",             "Calibration"),
    ("SWEEP_",                         "Calibration"),
    ("MIN_SAMPLE_PER_",                "Calibration"),
    ("MIN_SAMPLES_FOR_",               "Calibration"),
]


def _categorize(key: str) -> str:
    if key in EXPLICIT_CATEGORY:
        return EXPLICIT_CATEGORY[key]
    for prefix, cat in PREFIX_RULES:
        if key.startswith(prefix):
            return cat
    return "Misc"


def _infer_type(value: Optional[str]) -> str:
    if value is None or value == "":
        return "str"
    v = value.strip()
    if v.lower() in ("true", "false"):
        return "bool"
    # JSON shapes — must come before int/float so '[]' / '{}' don't trip
    # the numeric branch (they wouldn't, but a single bracket might).
    if v.startswith("{") and v.endswith("}"):
        return "json"
    if v.startswith("[") and v.endswith("]"):
        return "json"
    try:
        int(v)
        return "int"
    except ValueError:
        pass
    try:
        float(v)
        return "float"
    except ValueError:
        pass
    return "str"


def main() -> int:
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5.0)
        # auto_config has (key, value, updated_at) — older rows have NULL updated_at.
        rows = conn.execute(
            "SELECT key, value, updated_at FROM auto_config ORDER BY key"
        ).fetchall()
        live_edit_row = conn.execute(
            "SELECT value FROM auto_config WHERE key='LIVE_EDIT_ENABLED'"
        ).fetchone()
        conn.close()
    except Exception as exc:
        print(json.dumps({
            "configs": [], "total": 0, "by_category": {},
            "live_edit_enabled": False,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0

    live_edit_enabled = bool(live_edit_row) and (
        (live_edit_row[0] or "").strip().lower() == "true"
    )

    configs: list[dict] = []
    by_category: dict[str, int] = {c: 0 for c in CATEGORIES}

    for key, value, updated_at in rows:
        inferred = _infer_type(value)
        # Booleans belong to the controls endpoint, not configs.
        if inferred == "bool":
            continue
        cat = _categorize(key)
        configs.append({
            "key": key,
            "value": value,
            "updated_at": updated_at,
            "category": cat,
            "type": inferred,
            "immutable": key in IMMUTABLE_KEYS,
            "immutable_reason": IMMUTABLE_KEYS.get(key),
        })
        by_category[cat] = by_category.get(cat, 0) + 1

    print(json.dumps({
        "configs": configs,
        "total": len(configs),
        "by_category": by_category,
        "live_edit_enabled": live_edit_enabled,
    }, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
