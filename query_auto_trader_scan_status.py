#!/usr/bin/env python3
"""
Query helper for AutoTrader scanning empty state — per-ticker scan status.

Returns JSON with one entry per sacred ticker (BTC/ETH/SOL/HYPE/FARTCOIN):
  ticker, status (scanning | cooldown | recent_reject),
  on_cooldown (bool), cooldown_remaining_minutes (float | null),
  cooldown_direction (LONG/SHORT | null),
  last_confidence (float | null), last_reject_reason (str | null),
  last_scan_at (ISO str | null), recent_confidences (list)

READ-ONLY (file:...?mode=ro URI). Pure dashboard helper.
Sources: signal_cooldowns + active_signal_cards.
"""
from __future__ import annotations

import json
import sqlite3
import sys
import time
from datetime import datetime, timezone

DB_PATH = "/home/trevor/trevor/trevor.db"
SACRED_TICKERS = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN"]
COOLDOWN_SECONDS = 3600  # 60min per CLAUDE.md (signal_cooldown.py SQLite)
RECENT_REJECT_WINDOW_MIN = 60  # surface rejects from last hour
CONFIDENCE_TRAIL_LIMIT = 3


def _parse_iso_to_age_min(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        s = iso.replace("Z", "+00:00") if iso.endswith("Z") else iso
        dt = datetime.fromisoformat(s)
        return (datetime.now(timezone.utc) - dt).total_seconds() / 60.0
    except Exception:
        return None


def query_scan_status() -> list[dict]:
    now = time.time()
    out: list[dict] = []

    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        for ticker in SACRED_TICKERS:
            entry: dict = {
                "ticker": ticker,
                "status": "scanning",
                "on_cooldown": False,
                "cooldown_remaining_minutes": None,
                "cooldown_direction": None,
                "last_confidence": None,
                "last_reject_reason": None,
                "last_scan_at": None,
                "recent_confidences": [],
            }

            # 1. Active cooldowns — pick most recent still-active across LONG/SHORT
            cur = conn.execute(
                "SELECT base_ticker, direction, confidence, posted_at "
                "FROM signal_cooldowns WHERE base_ticker=? "
                "ORDER BY posted_at DESC LIMIT 4",
                (ticker,),
            )
            for row in cur.fetchall():
                try:
                    cd_end = float(row["posted_at"]) + COOLDOWN_SECONDS
                except (TypeError, ValueError):
                    continue
                if cd_end > now:
                    entry["on_cooldown"] = True
                    entry["cooldown_remaining_minutes"] = round(
                        (cd_end - now) / 60.0, 1
                    )
                    entry["cooldown_direction"] = row["direction"]
                    break

            # 2. Last 3 active_signal_cards rows — confidence trail
            cur = conn.execute(
                "SELECT direction, original_confidence, current_confidence, "
                "peak_confidence, removed_reason, posted_at "
                "FROM active_signal_cards WHERE ticker=? "
                "ORDER BY rowid DESC LIMIT ?",
                (ticker, CONFIDENCE_TRAIL_LIMIT),
            )
            recent = cur.fetchall()
            if recent:
                latest = recent[0]
                entry["last_confidence"] = (
                    float(latest["original_confidence"])
                    if latest["original_confidence"] is not None
                    else None
                )
                entry["last_scan_at"] = latest["posted_at"]
                entry["last_reject_reason"] = latest["removed_reason"]
                entry["recent_confidences"] = [
                    {
                        "ts": r["posted_at"],
                        "direction": r["direction"],
                        "original": (
                            float(r["original_confidence"])
                            if r["original_confidence"] is not None
                            else None
                        ),
                        "current": (
                            float(r["current_confidence"])
                            if r["current_confidence"] is not None
                            else None
                        ),
                        "peak": (
                            float(r["peak_confidence"])
                            if r["peak_confidence"] is not None
                            else None
                        ),
                        "removed": r["removed_reason"],
                    }
                    for r in recent
                ]

                # Status precedence: cooldown > recent_reject > scanning
                if entry["on_cooldown"]:
                    entry["status"] = "cooldown"
                elif latest["removed_reason"]:
                    age = _parse_iso_to_age_min(latest["posted_at"])
                    if age is not None and age < RECENT_REJECT_WINDOW_MIN:
                        entry["status"] = "recent_reject"
            elif entry["on_cooldown"]:
                entry["status"] = "cooldown"

            out.append(entry)
        return out
    finally:
        conn.close()


def main() -> int:
    try:
        result = {
            "tickers": query_scan_status(),
            "queried_at": int(time.time()),
        }
        print(json.dumps(result))
        return 0
    except Exception as e:
        print(json.dumps({"tickers": [], "queried_at": int(time.time()), "error": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
