#!/usr/bin/env python3
"""
Consolidated AUTO config view for /api/auto/config (D3, 2026-04-30).

READ-ONLY. Returns the four config knobs D1's ConfigCard renders +
the per-ticker thresholds (live mirror of /home/trevor/trevor/ticker_thresholds.py
via runtime import — no hardcoded drift).

JSON output:
  {
    "capital_cap_usd": 50.0,
    "live_per_trade_usd": 10.0,
    "confidence_floor": 35,
    "max_leverage": 5,
    "per_ticker_thresholds_enabled": true,
    "per_ticker_thresholds": [
      { "ticker": "BTC", "tier": "BLUE_CHIP", "quiet": 34, "normal": 37, "active": 40 },
      ...
    ],
    "data_available": true
  }

Replaces: GET /api/auto-trader/per-ticker-thresholds + GET side of
/api/auto-trader/config (PUT side intentionally dropped — config writes
are CC-prompt + auto_trader/config.py only, never via Hub UI).
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

DB = "/home/trevor/trevor/trevor.db"

# Hub-side cosmetic tier mapping for the watchlist UI pill colors.
# Source of truth for the actual confidence numbers is ticker_thresholds.py.
TIER_MAP = {
    "BTC": "BLUE_CHIP",
    "ETH": "BLUE_CHIP",
    "SOL": "MID_CAP",
    "HYPE": "MID_CAP",
    "FARTCOIN": "MEME",
}


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=4.0)


def _empty_payload(error: str | None = None) -> dict:
    out = {
        "capital_cap_usd": 50.0,
        "live_per_trade_usd": 10.0,
        "confidence_floor": 35,
        "max_leverage": 5,
        "per_ticker_thresholds_enabled": False,
        "per_ticker_thresholds": [],
        "data_available": False,
    }
    if error:
        out["error"] = error
    return out


def _per_ticker_payload() -> tuple[bool, list[dict]]:
    """Runtime import from /home/trevor/trevor/ticker_thresholds.py.

    Mirrors query_auto_per_ticker_thresholds.py exactly — single source of
    truth for the actual confidence numbers.
    """
    try:
        sys.path.insert(0, "/home/trevor/trevor")
        import ticker_thresholds as tt  # type: ignore[import-not-found]
    except Exception:
        return False, []

    enabled = bool(getattr(tt, "PER_TICKER_THRESHOLDS_ENABLED", False))
    raw = getattr(tt, "TICKER_THRESHOLDS", {}) or {}
    out: list[dict] = []
    for ticker, levels in raw.items():
        if not isinstance(levels, dict):
            continue
        out.append(
            {
                "ticker": ticker,
                "tier": TIER_MAP.get(ticker, "MEME"),
                "quiet": float(levels.get("quiet", 0)),
                "normal": float(levels.get("normal", 0)),
                "active": float(levels.get("active", 0)),
            }
        )
    return enabled, out


def main() -> int:
    if not Path(DB).exists():
        sys.stdout.write(json.dumps(_empty_payload(f"DB not found: {DB}")))
        return 1

    try:
        with _connect_ro() as conn:
            conn.row_factory = sqlite3.Row
            cfg_rows = conn.execute(
                """
                SELECT key, value FROM auto_config
                WHERE key IN (
                    'LIVE_HARD_CAPITAL_CAP_USD',
                    'CAPITAL_USD',
                    'LIVE_PER_TRADE_USD',
                    'AGGRESSIVE_THRESHOLD',
                    'LIVE_LEVERAGE_DEFAULT'
                )
                """
            ).fetchall()
        cfg = {r["key"]: r["value"] for r in cfg_rows}

        enabled, thresholds = _per_ticker_payload()

        def _f(key: str, default: float) -> float:
            try:
                v = cfg.get(key)
                return float(v) if v is not None else default
            except (TypeError, ValueError):
                return default

        def _i(key: str, default: int) -> int:
            try:
                v = cfg.get(key)
                return int(float(v)) if v is not None else default
            except (TypeError, ValueError):
                return default

        # Capital cap: prefer LIVE_HARD_CAPITAL_CAP_USD (the immutable code-enforced
        # ceiling); fall back to CAPITAL_USD for configurations that pre-date it.
        cap = _f("LIVE_HARD_CAPITAL_CAP_USD", _f("CAPITAL_USD", 50.0))

        out = {
            "capital_cap_usd": cap,
            "live_per_trade_usd": _f("LIVE_PER_TRADE_USD", 10.0),
            "confidence_floor": _i("AGGRESSIVE_THRESHOLD", 35),
            "max_leverage": _i("LIVE_LEVERAGE_DEFAULT", 5),
            "per_ticker_thresholds_enabled": enabled,
            "per_ticker_thresholds": thresholds,
            "data_available": True,
        }
        sys.stdout.write(json.dumps(out))
        return 0
    except Exception as exc:
        sys.stdout.write(json.dumps(_empty_payload(f"{type(exc).__name__}: {exc}")))
        return 1


if __name__ == "__main__":
    sys.exit(main())
