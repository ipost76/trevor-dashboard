#!/usr/bin/env python3
"""
Consolidated AUTO config view for /api/auto/config.

RM-07 P00 (2026-05-28): capital_cap_usd kept at 0.0 (vestigial — cap removed).
New margin_mode field returns "isolated" (sourced from auto_trader.config).

READ-ONLY. Returns the config knobs D1's ConfigCard renders + the per-ticker
thresholds (live mirror of the VM-only /home/trevor/trevor/ticker_thresholds.py
+ auto_trader.config.MARGIN_MODE, re-sourced over the read-only `ssh vm` pipe —
those modules do not exist on the Hub box, so a local import silently returned
empty/default; B2-WATCHLIST-RESOURCE, mirroring the RM-MEM-A3 helpers).

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
import os
import sqlite3
import subprocess
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


# --- VM re-source (RM-MEM-A3 pattern) ------------------------------------------
# ticker_thresholds.py + auto_trader.config live ONLY on the VM. This Hub box has
# just the trevor.db symlink, so a local `import` throws and silently degrades to
# empty thresholds / default margin. Re-source both in ONE read-only `ssh vm`
# round-trip (mirrors query_memory_daily.py). ssh must run as the DB-owner `trevor`
# via `sudo -n` so the bot venv + VM-only modules resolve.
SSH_BASE = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "vm"]
_REMOTE_CMD = ["sudo", "-n", "-u", "trevor", "/home/trevor/trevor/venv/bin/python3", "-"]

# Fixed, pure-stdlib program executed ON THE VM. No user input reaches it (it is a
# constant piped via python's stdin `-`), so nothing touches the remote shell.
_REMOTE_PROGRAM = r'''
import sys, json
sys.path.insert(0, "/home/trevor/trevor")
out = {"enabled": False, "thresholds": {}, "margin_mode": "isolated"}
try:
    import ticker_thresholds as _tt
    out["enabled"] = bool(getattr(_tt, "PER_TICKER_THRESHOLDS_ENABLED", False))
    raw = getattr(_tt, "TICKER_THRESHOLDS", {}) or {}
    out["thresholds"] = {k: v for k, v in raw.items() if isinstance(v, dict)}
except Exception as e:
    out["tt_error"] = f"{type(e).__name__}: {e}"
try:
    from auto_trader import config as _atcfg
    out["margin_mode"] = str(getattr(_atcfg, "MARGIN_MODE", "isolated")).lower()
except Exception as e:
    out["cfg_error"] = f"{type(e).__name__}: {e}"
print(json.dumps(out))
'''


def _fetch_vm_config() -> dict | None:
    """ONE read-only `ssh vm` round-trip re-sourcing the VM-only bot modules.

    Returns the parsed dict on success, or None on any ssh/parse failure — logged
    to stderr, never swallowed silently. 10s subprocess timeout sits below the
    route's 12s runPython budget so the helper self-bounds first. HOME is set to
    /home/ghost DEFENSIVELY ONLY: runPython does force HOME=/home/trevor, but ssh
    resolves ~/.ssh from the process UID (getpwuid), NOT $HOME, so this reset is a
    no-op for ssh. Kept (harmless, and other tools DO read $HOME). RF3T2-B8.
    """
    try:
        proc = subprocess.run(
            SSH_BASE + _REMOTE_CMD,
            input=_REMOTE_PROGRAM,
            capture_output=True,
            text=True,
            timeout=10,
            env={**os.environ, "HOME": "/home/ghost"},
        )
    except subprocess.TimeoutExpired:
        sys.stderr.write("query_auto_config: ssh vm timeout re-sourcing ticker_thresholds/margin_mode\n")
        return None
    except Exception as exc:  # pragma: no cover
        sys.stderr.write(f"query_auto_config: ssh vm error: {type(exc).__name__}: {exc}\n")
        return None
    if proc.returncode != 0 or not proc.stdout.strip():
        sys.stderr.write(
            f"query_auto_config: ssh vm failed (rc={proc.returncode}): "
            f"{(proc.stderr or 'ssh failed').strip()[:200]}\n"
        )
        return None
    try:
        return json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        sys.stderr.write("query_auto_config: ssh vm returned unparseable output\n")
        return None


def _margin_mode(vm: dict | None) -> str:
    """MARGIN_MODE re-sourced from the VM (auto_trader.config) — default 'isolated'."""
    if not vm:
        return "isolated"
    return str(vm.get("margin_mode") or "isolated").lower()


def _per_ticker_payload(vm: dict | None) -> tuple[bool, list[dict]]:
    """Per-ticker thresholds re-sourced from the VM (ticker_thresholds.py) via the
    single _fetch_vm_config() ssh call, with the Hub-side TIER_MAP overlay applied.

    On a missing/failed VM fetch returns (False, []) — the graceful empty state
    (the panel renders "Per-ticker thresholds unavailable", never crashes).
    """
    if not vm:
        return False, []

    enabled = bool(vm.get("enabled", False))
    raw = vm.get("thresholds", {}) or {}
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

        # ONE ssh vm round-trip feeds BOTH the thresholds + margin_mode (never
        # raises → won't trip the DB except; graceful defaults on failure). DB
        # knobs above are already captured, so they always populate regardless.
        vm = _fetch_vm_config()
        enabled, thresholds = _per_ticker_payload(vm)

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
            "margin_mode": _margin_mode(vm),
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
