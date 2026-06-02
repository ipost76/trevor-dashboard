#!/usr/bin/env python3
"""Hub API helper — returns circuit breaker status as JSON.

REL-04 (2026-06-02): an outer try/except guarantees a single JSON object on
stdout + exit 0 even if the bot-side import or get_status() throws. The route
then gets a fail-safe `{overall_status:"UNKNOWN", error}` (mirrors
circuit-breaker/route.ts's own catch fallback) instead of a non-zero exit → 500.
Loud fail-open: the error is surfaced, never swallowed.
"""
import json
import sys

sys.path.insert(0, "/home/trevor/trevor")

try:
    from circuit_breaker import CircuitBreakerSystem

    cb = CircuitBreakerSystem()
    print(json.dumps(cb.get_status(), default=str))
except Exception as e:  # noqa: BLE001 — never crash the route; surface the error
    print(json.dumps({"overall_status": "UNKNOWN", "error": str(e)}))
    sys.exit(0)
