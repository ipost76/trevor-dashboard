import { NextResponse } from "next/server";
import { runPythonInline, runCommand } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export const dynamic = "force-dynamic";

// In-memory cache (60s TTL).
// PERF-02 (2026-06-02): single-flight + SWR so a concurrent poller burst on this
// high-traffic route collapses to ONE compute (systemctl + Python child) per
// window. The per-request `cached` flag + `latencyMs` are preserved; the catch
// keeps the prior cold-failure error shape (ok:false). A warm failure now serves
// stale instead of the error shape (strictly better).
const cache = createSwrCache<Record<string, unknown>>({ defaultTtl: 60_000, concurrency: 2 });

export async function GET() {
  const start = Date.now();
  const servedFromCache = cache.peek("status") !== undefined;

  try {
    const { value } = await cache.swr("status", computeStatus);
    const resp: Record<string, unknown> = { ...value, latencyMs: Date.now() - start };
    if (servedFromCache) resp.cached = true;
    return NextResponse.json(resp);
  } catch (err) {
    return NextResponse.json({
      ok: false,
      trevor: { running: false, pid: 0 },
      signals: { total: 0, wins: 0, losses: 0, pending: 0 },
      recentSignals: [],
      error: String(err),
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
    });
  }
}

async function computeStatus(): Promise<Record<string, unknown>> {
  const trevorService = process.env.TREVOR_SERVICE_NAME || "trevor.service";
  const dbPath = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";

  let trevorPid = 0;
  let trevorRunning = false;
  let signalStats = { total: 0, wins: 0, losses: 0, pending: 0 };
  let recentSignals: Array<{ ticker: string; direction: string; confidence: number; timestamp: string }> = [];

  // Get TREVOR PID — argv, no shell (was `systemctl ... || echo 0`). allowFailure
  // returns empty stdout on a missing unit → parseInt → 0, same as the old fallback.
  try {
      const pidResult = (
        await runCommand(
          "systemctl",
          ["show", trevorService, "--property=MainPID", "--value"],
          { timeout: 3000, allowFailure: true },
        )
      ).trim();
      trevorPid = parseInt(pidResult) || 0;
      trevorRunning = trevorPid > 0;
    } catch { /* graceful */ }

    // Query DB via Python — the Hub has no Node SQLite binding, so every DB read
    // goes through the Python bridge (QUAL-06 2026-06-03: corrected a stale comment
    // that claimed the sqlite3 CLI wasn't installed — it is; that was never the reason).
    try {
      const pyScript = `
import sqlite3, json
conn = sqlite3.connect("file:${dbPath}?mode=ro", uri=True)
result = {}

# Trade insights as signal proxy
try:
    rows = conn.execute("SELECT COUNT(*) FROM trade_insights").fetchone()
    result["total"] = rows[0] if rows else 0
except: result["total"] = 0

# Recent trade insights
try:
    rows = conn.execute("SELECT ticker, signal_type, confidence, created_at FROM trade_insights ORDER BY created_at DESC LIMIT 5").fetchall()
    result["recent"] = [{"ticker": r[0], "direction": r[1] or "?", "confidence": int(r[2]*100) if r[2] and r[2] <= 1 else int(r[2] or 0), "timestamp": r[3] or ""} for r in rows]
except: result["recent"] = []

conn.close()
print(json.dumps(result))
`;
      const pyResult = await runPythonInline(pyScript, { timeout: 8000 });
      const dbData = JSON.parse(pyResult);
      signalStats.total = dbData.total || 0;
      recentSignals = dbData.recent || [];
    } catch { /* DB query failed — graceful */ }

  const responseData = {
    ok: true,
    trevor: { running: trevorRunning, pid: trevorPid },
    signals: signalStats,
    recentSignals,
    timestamp: new Date().toISOString(),
    latencyMs: 0,
  };
  return responseData;
}
