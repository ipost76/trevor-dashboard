import { NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export const dynamic = "force-dynamic";

// In-memory cache (5 min TTL) — avoids 500ms Hyperliquid API ping on every call.
// PERF-02 (2026-06-02): single-flight + SWR so a concurrent burst collapses to
// ONE compute (subprocess-spawning Python child + HL ping) per window — this is
// the route whose synchronous subprocess fan-out triggered the original wedge.
// The per-request `cached` flag + `latencyMs` are preserved; the catch keeps the
// prior cold-failure 500. A warm failure now serves stale (strictly better).
const cache = createSwrCache<Record<string, unknown>>({ defaultTtl: 300_000, concurrency: 2 });

export async function GET() {
  const start = Date.now();
  const servedFromCache = cache.peek("system-health") !== undefined;

  try {
    const { value } = await cache.swr("system-health", computeHealth);
    const resp: Record<string, unknown> = { ...value, latencyMs: Date.now() - start };
    if (servedFromCache) resp.cached = true;
    return NextResponse.json(resp);
  } catch (e) {
    return NextResponse.json(
      { error: String(e), timestamp: new Date().toISOString(), latencyMs: Date.now() - start },
      { status: 500 }
    );
  }
}

async function computeHealth(): Promise<Record<string, unknown>> {
  const pyScript = `
import sqlite3, json, time, os

DB_PATH = '/home/trevor/trevor/trevor.db'
result = {}

conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)

# Scanner status — last signal time
try:
    row = conn.execute("SELECT created_at FROM trade_insights ORDER BY id DESC LIMIT 1").fetchone()
    last_signal = row[0] if row else None
    result["scanner"] = {
        "last_signal_at": last_signal,
        "status": "running" if last_signal else "unknown",
    }
except:
    result["scanner"] = {"status": "unknown", "last_signal_at": None}

# Signal volume
try:
    today = conn.execute("SELECT COUNT(*) FROM trade_insights WHERE DATE(created_at) = DATE('now')").fetchone()[0]
    avg_row = conn.execute("""
        SELECT AVG(daily_count) FROM (
            SELECT COUNT(*) as daily_count FROM trade_insights
            WHERE created_at > datetime('now', '-7 days') AND DATE(created_at) < DATE('now')
            GROUP BY DATE(created_at)
        )
    """).fetchone()
    seven_day_avg = round(float(avg_row[0] or 0), 1)
    change_pct = round(((today - seven_day_avg) / seven_day_avg) * 100, 1) if seven_day_avg > 0 else 0
    result["signals"] = {"today": today, "seven_day_avg": seven_day_avg, "change_pct": change_pct}
except:
    result["signals"] = {"today": 0, "seven_day_avg": 0, "change_pct": 0}

conn.close()

# Hyperliquid API health
try:
    import requests
    t0 = time.time()
    resp = requests.post('https://api.hyperliquid.xyz/info', json={"type": "allMids"}, timeout=5)
    latency_ms = int((time.time() - t0) * 1000)
    result["api"] = {"hyperliquid": {"healthy": resp.status_code == 200, "latency_ms": latency_ms}}
except Exception as e:
    result["api"] = {"hyperliquid": {"healthy": False, "latency_ms": 0, "error": str(e)}}

# Circuit breakers
try:
    import sys
    sys.path.insert(0, '/home/trevor/trevor')
    from confidence_calibrator import get_circuit_breaker_status
    result["circuit_breakers"] = get_circuit_breaker_status()
except:
    result["circuit_breakers"] = []

# Kill switch — auto_config.EMERGENCY_KILLSWITCH is the canonical state
# (Discord !killswitch and Hub POST /api/killswitch both write here).
# Fail-open: any DB error reports inactive so a flaky read never falsely
# signals an emergency stop to the UI.
try:
    ks_conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5)
    ks_rows = ks_conn.execute(
        "SELECT key, value FROM auto_config WHERE key LIKE 'EMERGENCY_KILLSWITCH%'"
    ).fetchall()
    ks_conn.close()
    ks_d = dict(ks_rows)
    ks_active = str(ks_d.get("EMERGENCY_KILLSWITCH", "false")).lower() == "true"
    result["kill_switch"] = {"active": ks_active}
    if ks_active:
        ks_reason = ks_d.get("EMERGENCY_KILLSWITCH_LAST_REASON", "")
        if ks_reason:
            result["kill_switch"]["reason"] = ks_reason
except Exception:
    result["kill_switch"] = {"active": False}

print(json.dumps(result, default=str))
`;

  const pyResult = await runPythonInline(pyScript, { timeout: 10000 });
  const data = JSON.parse(pyResult);

  return {
    ...data,
    timestamp: new Date().toISOString(),
    latencyMs: 0,
  };
}
