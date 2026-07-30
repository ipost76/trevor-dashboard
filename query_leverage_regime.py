#!/usr/bin/env python3
"""
Consolidated LEVERAGE + REGIME read for /api/auto/leverage-regime (S2-P05).

READ-ONLY display feed for the Hub "Leverage + Regime" panel (Auto → Dashboard
tab, below the S1-P06 Profit-Taking + Risk panel). Surfaces Stage-2 state that
already lands in the bot DB but was never visible:

  1. Per open LIVE trade — the dynamic-leverage posture:
       chosen leverage (S2-P01 `leverage_at_entry`), the real maintenance-margin
       liquidation distance (`liq_distance_at_entry`), the conf/regime/vol
       multiplier breakdown (S2-P02 `lev_weight_breakdown_json`), and the
       ≥ k×stop liquidation-safety spot-check (k = LEVERAGE_LIQ_BUFFER_K).
  2. Current HMM regime per ticker — the latest `hmm_inference_log` row per
       ticker (predicted_state + probability + the full state-prob vector).
  3. Margin utilization — reconstructed from the litestream replica
       (B2-MARGIN-REPLICA, 2026-07-15): margin_used = Σ `auto_trades.notional_usd`
       (the POSTED MARGIN — NOT ÷ leverage) over open live trades, ÷ the latest
       `equity_snapshots.equity`. The Observatory heartbeat that formerly fed this
       was decommissioned in RM-DECOM (~2026-07-08).
  4. Regime-exit shadow comparison — `exit_engine_shadow` rows (would-be vs
       actual exit action, per S2-P04's parallel regime-aware-exit shadow). This
       is the semantically-correct "old vs new exit action + regime + divergent"
       table that exists today; it survives whatever S2-P04 finally names.

NO ARGS. NO MUTATIONS. NO BOT COMMANDS. NO network I/O. This script only reads,
via a read-only sqlite URI (`file:...?mode=ro`):
  - `auto_trades`, `equity_snapshots`, `hmm_inference_log`, `exit_engine_shadow`,
    `auto_config`.

HONESTY NOTE (S2-P05): the three Stage-2 *leverage* columns
(`leverage_at_entry`, `liq_distance_at_entry`, `lev_weight_breakdown_json`)
populate ONLY on a live entry under S2-P01/P02 sizing. S2-P01/P02/P03 are
deployed flag-ON but INERT until `AUTO_TRADER_ENABLED=true`. So with the
AutoTrader paused there are 0 open trades and the leverage section renders
empty BY DESIGN — the regime section + margin utilization are live now, and the
leverage section lights up automatically on the next live entry (no Hub change).

JSON output:
  {
    "data_available": bool,        # false only on a hard auto_trades failure
    "ts": <epoch_seconds>,
    "open_count": <N>,
    "leverage_dynamic_enabled": bool,   # auto_config LEVERAGE_DYNAMIC_ENABLED
    "leverage_weighting_enabled": bool, # auto_config LEVERAGE_WEIGHTING_ENABLED
    "autotrader_enabled": bool,         # auto_config AUTO_TRADER_ENABLED
    "liq_buffer_k": <float>,            # auto_config LEVERAGE_LIQ_BUFFER_K (2.5)
    "open_trades": [
      { id, ticker, direction, leverage, leverage_at_entry,
        liq_distance_at_entry, entry_price, stop_price, notional_usd,
        regime_at_entry, opened_at,
        stop_fraction: float|null,      # |entry-stop|/entry
        required_liq_distance: float|null,  # k * stop_fraction (the guarantee)
        liq_safe: bool|null,            # liq_distance_at_entry >= required
        breakdown: {liq_safe_cap, conf_mult, regime_mult, vol_mult,
                    weighted_target, final, confidence, regime, atr_pct}|null }
    ],
    "regimes": [
      { ticker, state, prob, all_probs:{...}, ts, age_seconds }
    ],
    "margin": {                          # reconstructed from the replica (B2)
      "available": bool, "account_value": float, "margin_used": float,
      "utilization_pct": float, "total_ntl_pos": float,
      "open_positions": int, "age_seconds": int?, "error": str? },
    "regime_exit_shadow": {
      "available": bool, "total": int, "divergent": int,
      "recent": [ {id, trade_id, ticker, direction, regime, check_time,
                   old_exit_action, new_exit_action, old_stop_price,
                   new_stop_price, current_price, pnl_pct, divergent} ],
      "error": str? }
  }
"""
from __future__ import annotations

import json
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, "/home/trevor/trevor")

DB = "/home/trevor/trevor/trevor.db"

# Sacred-ticker display order (mirrors the bot's TICKER_THRESHOLDS / Hub watchlist);
# any extra tickers present in the HMM log fall in after these, alpha-sorted.
TICKER_ORDER = ["BTC", "ETH", "SOL", "HYPE", "FARTCOIN",
                "XRP", "DOGE", "NEAR", "SUI", "KPEPE"]


def _connect_ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)


def _rows_to_dicts(cursor) -> list[dict]:
    cols = [c[0] for c in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _config(conn, keys: list[str]) -> dict:
    """Read a set of auto_config keys → {key: value} (missing keys absent)."""
    out: dict[str, str] = {}
    try:
        qmarks = ",".join("?" for _ in keys)
        cur = conn.execute(
            f"SELECT key, value FROM auto_config WHERE key IN ({qmarks})", keys
        )
        for k, v in cur.fetchall():
            out[k] = v
    except Exception:
        pass
    return out


def _as_bool(v, default: bool = False) -> bool:
    if v is None:
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def _as_float(v, default: float | None = None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def fetch_open_trades(conn, liq_buffer_k: float) -> list[dict]:
    """Open positions (ALL modes) with the Stage-2 dynamic-leverage columns.

    W4a (2026-07-30): was live-only. Under PAPER_WINDOW_ENABLED every open row
    is trade_mode='paper', so this returned nothing and the panel showed no
    leverage or liq-safety reading for the position actually on the book.
    """
    cur = conn.execute(
        """
        SELECT id, ticker, direction, entry_price, stop_price, notional_usd,
               leverage, leverage_at_entry, liq_distance_at_entry,
               lev_weight_breakdown_json, regime_at_entry, opened_at
        FROM auto_trades
        WHERE status='open'
        ORDER BY opened_at DESC
        """
    )
    raw = _rows_to_dicts(cur)

    out: list[dict] = []
    for r in raw:
        entry = _as_float(r["entry_price"])
        stop = _as_float(r["stop_price"])
        liq_dist = _as_float(r["liq_distance_at_entry"])

        # Stop fraction = how far the stop sits from entry (a fraction of price).
        stop_fraction = None
        if entry and stop is not None and entry != 0:
            stop_fraction = abs(entry - stop) / abs(entry)

        # The S2-P01 guarantee: real maintenance-margin liq distance >= k*stop.
        required = None
        liq_safe = None
        if stop_fraction is not None:
            required = liq_buffer_k * stop_fraction
            if liq_dist is not None:
                liq_safe = liq_dist >= required

        # S2-P02 multiplier breakdown — single JSON column; NULL on legacy/fallback.
        breakdown = None
        bj = r.get("lev_weight_breakdown_json")
        if bj:
            try:
                breakdown = json.loads(bj)
            except (TypeError, ValueError, json.JSONDecodeError):
                breakdown = None

        out.append({
            "id": r["id"],
            "ticker": r["ticker"],
            "direction": r["direction"],
            "leverage": _as_float(r["leverage"]),
            "leverage_at_entry": _as_float(r["leverage_at_entry"]),
            "liq_distance_at_entry": liq_dist,
            "entry_price": entry,
            "stop_price": stop,
            "notional_usd": _as_float(r["notional_usd"]),
            "regime_at_entry": r["regime_at_entry"],
            "opened_at": r["opened_at"],
            "stop_fraction": stop_fraction,
            "required_liq_distance": required,
            "liq_safe": liq_safe,
            "breakdown": breakdown,
        })
    return out


def fetch_regimes(conn) -> list[dict]:
    """Latest HMM inference per ticker (predicted_state + prob + full vector)."""
    now = int(time.time())
    cur = conn.execute(
        """
        SELECT ticker, predicted_state, state_prob, all_state_probs, ts
        FROM hmm_inference_log
        WHERE id IN (SELECT MAX(id) FROM hmm_inference_log GROUP BY ticker)
        """
    )
    rows = _rows_to_dicts(cur)

    out: list[dict] = []
    for r in rows:
        all_probs = {}
        ap = r.get("all_state_probs")
        if ap:
            try:
                all_probs = json.loads(ap)
            except (TypeError, ValueError, json.JSONDecodeError):
                all_probs = {}
        ts = r.get("ts")
        try:
            ts_int = int(ts) if ts is not None else None
        except (TypeError, ValueError):
            ts_int = None
        out.append({
            "ticker": r["ticker"],
            "state": r["predicted_state"],
            "prob": _as_float(r["state_prob"]),
            "all_probs": all_probs,
            "ts": ts_int,
            "age_seconds": (now - ts_int) if ts_int is not None else None,
        })

    # Sacred order first, then any extras alpha-sorted.
    def _key(d):
        t = (d.get("ticker") or "").upper()
        return (TICKER_ORDER.index(t) if t in TICKER_ORDER else len(TICKER_ORDER), t)

    out.sort(key=_key)
    return out


def fetch_regime_exit_shadow(conn) -> dict:
    """Regime-aware exit shadow comparison (would-be vs actual) — exit_engine_shadow."""
    try:
        # Dedup by trade_id (B3-SHADOW-DEDUP): the bot appends one
        # exit_engine_shadow row per ~30s monitor cycle for an open divergent
        # trade, so a raw COUNT(*) counts one trade as N evaluations (the
        # phantom-bleeder). Count DISTINCT trades, not per-cycle log rows.
        total = conn.execute(
            "SELECT COUNT(DISTINCT trade_id) FROM exit_engine_shadow"
        ).fetchone()[0]
        divergent = conn.execute(
            "SELECT COUNT(DISTINCT trade_id) FROM exit_engine_shadow WHERE divergent=1"
        ).fetchone()[0]
        cur = conn.execute(
            """
            SELECT id, trade_id, ticker, direction, regime, check_time,
                   old_exit_action, new_exit_action, old_stop_price,
                   new_stop_price, current_price, pnl_pct, divergent, created_at
            FROM exit_engine_shadow
            -- One representative row per trade (latest cycle by id), so the
            -- list shows distinct trades, not 8x per-cycle snapshots of one.
            WHERE id IN (SELECT MAX(id) FROM exit_engine_shadow GROUP BY trade_id)
            ORDER BY id DESC
            LIMIT 20
            """
        )
        recent = _rows_to_dicts(cur)
        for r in recent:
            r["divergent"] = bool(r.get("divergent"))
        return {
            "available": True,
            "total": int(total),
            "divergent": int(divergent),
            "recent": recent,
        }
    except Exception as exc:
        return {
            "available": False,
            "total": 0,
            "divergent": 0,
            "recent": [],
            "error": f"{type(exc).__name__}: {exc}",
        }


def fetch_margin(conn) -> dict:
    """Margin utilization, reconstructed from the litestream replica.

    RE-SOURCE (B2-MARGIN-REPLICA, 2026-07-15): the Observatory heartbeat
    (:8443 / :3335) that formerly supplied this — via the Node route's
    resolveHeartbeatMargin() — was DECOMMISSIONED in RM-DECOM (~2026-07-08) and
    is gone BY DESIGN. Margin is now rebuilt from the SAME read-only replica this
    script already reads, badged with its age. (Prior state: a no-op sentinel the
    route overrode with the now-dead heartbeat.)

    ┌────────────────────────────────────────────────────────────────────────────┐
    │ 🚨🚨 LANDMINE — auto_trades.notional_usd IS THE POSTED MARGIN. 🚨🚨          │
    │ Bot ground truth (auto_trader/models.py INSERT, M10 comment 2026-06-26):     │
    │   "notional_usd holds MARGIN (= notional / leverage) ... Full notional =     │
    │    margin × leverage."                                                        │
    │   margin_used  = Σ notional_usd            → sum DIRECTLY.  *** NEVER ÷ lev ***│
    │   position_ntl = Σ (notional_usd × lev)    → the × below; DISPLAY exposure    │
    │                                              only, NOT the margin.            │
    │ Dividing notional_usd by leverage would ~7× the figure and ship a FALSE risk │
    │ number onto a leveraged-futures panel. Verified live 2026-07-15 (FARTCOIN,   │
    │ notional_usd=4.68, lev=7, equity=33.68):                                      │
    │   Σ notional_usd / equity        = 13.9%  ✅ (≈ A1's measured ~14%)          │
    │   Σ (notional_usd/lev) / equity  =  2.0%  ❌ (the trap)                       │
    └────────────────────────────────────────────────────────────────────────────┘

    Fails CLOSED — no positive equity denominator ⇒ an honest {available:false}
    degraded block, NEVER a silent 0% (a margin panel showing 0% when it actually
    cannot read is a lie that hides risk).
    """
    # margin_used = Σ posted margin over open trades, deduped by DISTINCT id
    # (phantom-bleeder law — defensive no-op since `id` is the PK, but a duplicated
    # row must never inflate the margin figure / understate risk).
    # W4a (2026-07-30): mode-blind. Live-only made utilization read a flat 0%
    # while a paper position held real margin on the book — a risk figure that
    # understates by omission is worse than one that is merely stale.
    try:
        cur = conn.execute(
            "SELECT id, notional_usd, leverage FROM auto_trades "
            "WHERE status='open'"
        )
        seen = set()
        margin_used = 0.0
        position_ntl = 0.0
        open_positions = 0
        for tid, ntl, lev in cur.fetchall():
            if tid in seen:
                continue
            seen.add(tid)
            m = _as_float(ntl)
            if m is None:
                continue
            open_positions += 1
            # ┌── notional_usd IS THE POSTED MARGIN → SUM DIRECTLY. DO NOT ÷ lev. ──┐
            margin_used += m
            # └─────────────────────────────────────────────────────────────────────┘
            lv = _as_float(lev)
            # position notional = margin × leverage (DISPLAY exposure ONLY; this ×
            # is NOT the margin — do not confuse it with the += m line above).
            position_ntl += m * lv if (lv and lv > 0) else m
    except Exception as exc:
        return {
            "available": False, "account_value": 0.0, "margin_used": 0.0,
            "utilization_pct": 0.0, "total_ntl_pos": 0.0,
            "error": f"open-trade read failed: {type(exc).__name__}: {exc}",
        }

    # account_value = latest equity snapshot. equity_snapshots.ts is a naive UTC
    # string (PROVEN: an Eastern reading would sit in the FUTURE vs the trade's UTC
    # created_at). NEVER compare it against the Eastern opened_at/closed_at columns.
    try:
        row = conn.execute(
            "SELECT equity, ts FROM equity_snapshots ORDER BY id DESC LIMIT 1"
        ).fetchone()
    except Exception as exc:
        return {
            "available": False, "account_value": 0.0, "margin_used": margin_used,
            "utilization_pct": 0.0, "total_ntl_pos": position_ntl,
            "error": f"equity read failed: {type(exc).__name__}: {exc}",
        }

    account_value = _as_float(row[0]) if row else None
    if account_value is None or account_value <= 0:
        # Fail CLOSED — no positive equity denominator ⇒ honest degraded, not 0%.
        return {
            "available": False,
            "account_value": account_value or 0.0,
            "margin_used": margin_used,
            "utilization_pct": 0.0,
            "total_ntl_pos": position_ntl,
            "error": "equity snapshot unavailable",
        }

    utilization = (margin_used / account_value) * 100.0

    # age_seconds = now(UTC) − snapshot ts(UTC): how stale this margin reading is.
    # Dominated by the ~hourly equity-snapshot cadence, which subsumes the
    # file-level replica lag (now − ts captures BOTH). Same UTC clock on both ends
    # — the equity ts is UTC, so there is NO 4-hour Eastern trap here.
    age_seconds = None
    ts_raw = row[1]
    if ts_raw:
        try:
            snap = datetime.strptime(
                str(ts_raw), "%Y-%m-%d %H:%M:%S"
            ).replace(tzinfo=timezone.utc)
            age_seconds = max(
                0, int(datetime.now(timezone.utc).timestamp() - snap.timestamp())
            )
        except (TypeError, ValueError):
            age_seconds = None

    out = {
        "available": True,
        "account_value": account_value,
        "margin_used": margin_used,
        "utilization_pct": utilization,
        "total_ntl_pos": position_ntl,
        "open_positions": open_positions,
    }
    if age_seconds is not None:
        out["age_seconds"] = age_seconds
    return out


def main() -> int:
    if not Path(DB).exists():
        sys.stdout.write(json.dumps({
            "data_available": False,
            "ts": int(time.time()),
            "open_count": 0,
            "leverage_dynamic_enabled": False,
            "leverage_weighting_enabled": False,
            "autotrader_enabled": False,
            "liq_buffer_k": 2.5,
            "open_trades": [],
            "regimes": [],
            "margin": {"available": False, "account_value": 0.0, "margin_used": 0.0,
                       "utilization_pct": 0.0, "total_ntl_pos": 0.0,
                       "error": f"DB not found: {DB}"},
            "regime_exit_shadow": {"available": False, "total": 0, "divergent": 0,
                                   "recent": [], "error": f"DB not found: {DB}"},
            "error": f"DB not found: {DB}",
        }))
        return 0

    try:
        conn = _connect_ro()
    except Exception as exc:
        sys.stdout.write(json.dumps({
            "data_available": False, "ts": int(time.time()), "open_count": 0,
            "leverage_dynamic_enabled": False, "leverage_weighting_enabled": False,
            "autotrader_enabled": False, "liq_buffer_k": 2.5,
            "open_trades": [], "regimes": [],
            "margin": {"available": False, "account_value": 0.0, "margin_used": 0.0,
                       "utilization_pct": 0.0, "total_ntl_pos": 0.0},
            "regime_exit_shadow": {"available": False, "total": 0, "divergent": 0,
                                   "recent": []},
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return 0

    with conn:
        cfg = _config(conn, [
            "LEVERAGE_DYNAMIC_ENABLED", "LEVERAGE_WEIGHTING_ENABLED",
            "AUTO_TRADER_ENABLED", "LEVERAGE_LIQ_BUFFER_K",
        ])
        liq_buffer_k = _as_float(cfg.get("LEVERAGE_LIQ_BUFFER_K"), 2.5) or 2.5

        try:
            open_trades = fetch_open_trades(conn, liq_buffer_k)
            trades_err = None
        except Exception as exc:
            open_trades = []
            trades_err = f"{type(exc).__name__}: {exc}"

        try:
            regimes = fetch_regimes(conn)
        except Exception:
            regimes = []

        regime_exit_shadow = fetch_regime_exit_shadow(conn)

        # B2-MARGIN-REPLICA: margin is reconstructed from the SAME replica conn
        # (the Observatory heartbeat that formerly fed it is decommissioned), so
        # it must run INSIDE the `with conn:` block — it needs the connection.
        margin = fetch_margin(conn)

    out = {
        "data_available": trades_err is None,
        "ts": int(time.time()),
        "open_count": len(open_trades),
        "leverage_dynamic_enabled": _as_bool(cfg.get("LEVERAGE_DYNAMIC_ENABLED")),
        "leverage_weighting_enabled": _as_bool(cfg.get("LEVERAGE_WEIGHTING_ENABLED")),
        "autotrader_enabled": _as_bool(cfg.get("AUTO_TRADER_ENABLED")),
        "liq_buffer_k": liq_buffer_k,
        "open_trades": open_trades,
        "regimes": regimes,
        "margin": margin,
        "regime_exit_shadow": regime_exit_shadow,
    }
    if trades_err:
        out["error"] = trades_err
    sys.stdout.write(json.dumps(out, default=str))
    return 0


if __name__ == "__main__":
    # OUTER-WRAP: silent-crash visibility (matches sibling query_*.py helpers).
    import traceback as _tb_wrap, sys as _sys_wrap
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        _tb_wrap.print_exc(file=_sys_wrap.stderr)
        # Still emit a clean fail-safe shape so the route never 500s on parse.
        _sys_wrap.stdout.write(json.dumps({
            "data_available": False, "ts": int(time.time()), "open_count": 0,
            "leverage_dynamic_enabled": False, "leverage_weighting_enabled": False,
            "autotrader_enabled": False, "liq_buffer_k": 2.5,
            "open_trades": [], "regimes": [],
            "margin": {"available": False, "account_value": 0.0, "margin_used": 0.0,
                       "utilization_pct": 0.0, "total_ntl_pos": 0.0},
            "regime_exit_shadow": {"available": False, "total": 0, "divergent": 0,
                                   "recent": []},
        }))
        _sys_wrap.exit(0)
