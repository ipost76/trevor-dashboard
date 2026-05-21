import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// In-memory cache (60s TTL)
let _statusCache: { data: unknown; ts: number } | null = null;
const STATUS_CACHE_TTL = 60_000;

export async function GET() {
  const start = Date.now();

  if (_statusCache && (Date.now() - _statusCache.ts) < STATUS_CACHE_TTL) {
    return NextResponse.json({
      ...(_statusCache.data as Record<string, unknown>),
      cached: true,
      latencyMs: Date.now() - start,
    });
  }
  const trevorService = process.env.TREVOR_SERVICE_NAME || "trevor.service";
  const dbPath = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";

  let trevorPid = 0;
  let trevorRunning = false;
  let signalStats = { total: 0, wins: 0, losses: 0, pending: 0 };
  let recentSignals: Array<{ ticker: string; direction: string; confidence: number; timestamp: string }> = [];

  try {
    const { execSync } = await import("child_process");

    // Get TREVOR PID
    try {
      const pidResult = execSync(
        `systemctl show ${trevorService} --property=MainPID --value 2>/dev/null || echo "0"`,
        { encoding: "utf-8", timeout: 3000 }
      ).trim();
      trevorPid = parseInt(pidResult) || 0;
      trevorRunning = trevorPid > 0;
    } catch { /* graceful */ }

    // Query DB via Python (sqlite3 CLI not installed)
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
      const pyResult = execSync(
        `/home/trevor/trevor/venv/bin/python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
        { encoding: "utf-8", timeout: 8000, cwd: "/home/trevor/trevor" }
      ).trim();
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
      latencyMs: Date.now() - start,
    };
    _statusCache = { data: responseData, ts: Date.now() };
    return NextResponse.json(responseData);
  } catch (err) {
    return NextResponse.json({
      ok: false,
      trevor: { running: false, pid: 0 },
      signals: signalStats,
      recentSignals,
      error: String(err),
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
    });
  }
}
