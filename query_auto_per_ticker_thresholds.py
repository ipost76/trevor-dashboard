#!/usr/bin/env python3
"""
Hub helper for /api/auto-trader/per-ticker-thresholds.

READ-ONLY. Imports ticker_thresholds.py from the trevor bot repo at runtime
so the values always reflect the live config (no hardcoded drift).

Output shape:
    {
        "enabled": bool,
        "thresholds": [
            {"ticker": "BTC", "tier": "BLUE_CHIP", "quiet": 34.0, "normal": 37.0, "active": 40.0},
            ...
        ]
    }
"""
from __future__ import annotations

import json
import sys


# Hub-side cosmetic tier mapping for the watchlist UI pill colors.
# Source of truth for the actual confidence numbers is ticker_thresholds.py.
TIER_MAP = {
    "BTC": "BLUE_CHIP",
    "ETH": "BLUE_CHIP",
    "SOL": "MID_CAP",
    "HYPE": "MID_CAP",
    "FARTCOIN": "MEME",
}


def _empty_payload(error: str | None = None) -> dict:
    payload = {"enabled": False, "thresholds": []}
    if error:
        payload["error"] = error
    return payload


def main() -> int:
    try:
        sys.path.insert(0, "/home/trevor/trevor")
        import ticker_thresholds as tt  # type: ignore[import-not-found]
    except Exception as exc:
        sys.stdout.write(json.dumps(_empty_payload(f"import_failed: {exc}")))
        return 1

    try:
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
        sys.stdout.write(json.dumps({"enabled": enabled, "thresholds": out}))
        return 0
    except Exception as exc:
        sys.stdout.write(json.dumps(_empty_payload(f"read_failed: {exc}")))
        return 1


if __name__ == "__main__":
    sys.exit(main())
