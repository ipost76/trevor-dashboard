#!/usr/bin/env python3
"""
Consolidated AUTO config view for /api/auto/config.

RM-07 P00 (2026-05-28): capital_cap_usd kept at 0.0 (vestigial — cap removed).
New margin_mode field returns "isolated" (sourced from auto_trader.config).

READ-ONLY. Returns the config knobs D1's ConfigCard renders + the per-ticker
thresholds (live mirror of /home/trevor/trevor/ticker_thresholds.py via runtime
import — no hardcoded drift).

JSON output:
  {
    "capital_cap_usd": 0.0,
    "margin_mode": "isolated",
    "live_per_trade_usd": 10.0,
    "confidence_floor": 35,
    "max_leverage": 5,
    "per_ticker_thresholds_enabled": true,
    "per_ticker_thresholds": [...],
    "data_available": true
  }
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
    # RM-07 P02 (2026-05-28): sacred 5 -> 10. Tiers mirror the bot's own
    # classification (auto_trader/config.py leverage comment + altcoin/
    # memecoin tier lists): XRP/NEAR/SUI = MID_CAP, DOGE/kPEPE = MEME.
    # (CL/XAU were deferred in P01 — not on Hyperliquid — so no COMMODITY tier.)
    "XRP": "MID_CAP",
    "DOGE": "MEME",
    "NEAR": "MID_CAP",
    "SUI": "MID_CAP",
    "kPEPE": "MEME",
}


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)


def _empty_payload(error: str | None = None) -> dict:
    out = {
        "capital_cap_usd": 0.0,           # RM-07 P00 — vestigial; cap removed
        "margin_mode": "isolated",        # RM-07 P00 — mandatory; one bad trade can't drain account
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


def _margin_mode() -> str:
    """Runtime import of auto_trader.config.MARGIN_MODE — default 'isolated'."""
    try:
        sys.path.insert(0, "/home/trevor/trevor")
        from auto_trader import config as _atcfg  # type: ignore[import-not-found]
        return str(getattr(_atcfg, "MARGIN_MODE", "isolated")).lower()
    except Exception:
        return "isolated"


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

        # RM-07 P00 (2026-05-28): capital_cap_usd reported as 0.0 — cap removed.
        # The auto_config row is preserved per Rule 15 but is no longer read by
        # the bot. Hub display now shows margin_mode + live HL balance instead.

        out = {
            "capital_cap_usd": 0.0,
            "margin_mode": _margin_mode(),
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
    # OUTER-WRAP: 2026-05-27 (silent-crash visibility)
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())

    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        _sys_wrap.exit(1)
