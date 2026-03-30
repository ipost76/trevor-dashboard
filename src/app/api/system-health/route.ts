import { NextResponse } from "next/server";
import { existsSync, readFileSync, statSync } from "fs";

export const dynamic = "force-dynamic";

const KILL_SWITCH_PATH = "/home/trevor/trevor/.kill_switch";
const AT_PAUSED_PATH = "/home/trevor/trevor/.autotrader_paused";

export async function GET() {
  const start = Date.now();

  try {
    const { execSync } = await import("child_process");

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

# Kill switch
result["kill_switch"] = {"active": os.path.exists('/home/trevor/trevor/.kill_switch')}
if result["kill_switch"]["active"]:
    try:
        result["kill_switch"]["reason"] = open('/home/trevor/trevor/.kill_switch').read().strip()
    except:
        pass

# AutoTrader pause
result["autotrader_paused"] = {"active": os.path.exists('/home/trevor/trevor/.autotrader_paused')}
if result["autotrader_paused"]["active"]:
    try:
        result["autotrader_paused"]["reason"] = open('/home/trevor/trevor/.autotrader_paused').read().strip()
    except:
        pass

print(json.dumps(result, default=str))
`;

    const pyResult = execSync(
      `/home/trevor/trevor/venv/bin/python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
      { encoding: "utf-8", timeout: 10000, cwd: "/home/trevor/trevor" }
    ).trim();
    const data = JSON.parse(pyResult);

    // Add autotrader paused status from file system
    let atPaused = { active: false, reason: "" };
    if (existsSync(AT_PAUSED_PATH)) {
      atPaused = {
        active: true,
        reason: readFileSync(AT_PAUSED_PATH, "utf-8").trim(),
      };
    }

    return NextResponse.json({
      ...data,
      autotrader_paused: atPaused,
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e), timestamp: new Date().toISOString(), latencyMs: Date.now() - start },
      { status: 500 }
    );
  }
}
