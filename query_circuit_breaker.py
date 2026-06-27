#!/usr/bin/env python3
"""Hub API helper — returns circuit breaker status as JSON.

RR2 C-1 (2026-06-27): REPOINTED to the LIVE breaker source. This previously
imported the bot-side `circuit_breaker.CircuitBreakerSystem().get_status()` —
the legacy CB layer whose `overall_status` reflects only the DORMANT
Session/Portfolio breakers (CB_SESSION/PORTFOLIO_ENABLED=false), and which is
not even importable on the WSL Hub box (`No module named 'circuit_breaker'` →
the route always returned a dead `UNKNOWN`). The live entry gate is
`auto_trader/risk_breakers.py`, which mirrors its consolidated state into
`auto_config.RISK_BREAKERS_STATE_JSON`. We now read THAT (the source of truth)
via `query_profit_risk.build_breakers()` — a `mode=ro` read of the litestream
replica, no VM call, no gateway, display/read only. After BRK-W1 the live gate
has one breaker — daily_loss (-25%/day realized) — and build_breakers() renders
whatever `detail` keys the live state carries, so a re-armed breaker shows up
automatically.

REL-04 (2026-06-02): an outer try/except guarantees a single JSON object on
stdout + exit 0 even if the read throws. The route then gets a fail-safe
`{overall_status:"UNKNOWN", error}` (mirrors circuit-breaker/route.ts's own catch
fallback) instead of a non-zero exit → 500. Loud fail-open: the error is
surfaced, never swallowed.
"""
import json
import os
import sys

# build_breakers() lives in the sibling Hub helper; ensure this script's own
# directory is importable regardless of the runPython cwd.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from query_profit_risk import build_breakers

    print(json.dumps(build_breakers(), default=str))
except Exception as e:  # noqa: BLE001 — never crash the route; surface the error
    print(json.dumps({"overall_status": "UNKNOWN", "error": str(e)}))
    sys.exit(0)
