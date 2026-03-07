import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RANK_THRESHOLDS: [number, string][] = [
  [0, "Intern Quant"], [500, "Junior Analyst"], [1500, "Desk Analyst"],
  [3500, "Senior Analyst"], [7000, "Lead Strategist"], [12000, "Risk Officer"],
  [20000, "Portfolio Manager"], [32000, "Head of Alpha"], [50000, "Quant Director"],
  [75000, "Chief Analyst"], [110000, "Managing Director"], [160000, "Partner"],
  [220000, "CIO"], [300000, "Co-Founder"], [400000, "CEO"],
];

function rankForXP(xp: number): string {
  let rank = "Intern Quant";
  for (const [threshold, name] of RANK_THRESHOLDS) {
    if (xp >= threshold) rank = name;
    else break;
  }
  return rank;
}

export async function GET() {
  const start = Date.now();
  const trevorService = process.env.TREVOR_SERVICE_NAME || "trevor.service";
  const dbPath = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";

  let trevorPid = 0;
  let trevorRunning = false;
  let xp = 0;
  let rank = "Intern Quant";
  const signalStats = { total: 0, wins: 0, losses: 0, pending: 0 };

  try {
    const { execSync } = await import("child_process");

    try {
      const pidResult = execSync(
        `systemctl show ${trevorService} --property=MainPID --value 2>/dev/null || echo "0"`,
        { encoding: "utf-8", timeout: 3000 }
      ).trim();
      trevorPid = parseInt(pidResult) || 0;
      trevorRunning = trevorPid > 0;
    } catch { /* graceful */ }

    try {
      const pyScript = `
import sqlite3, json
conn = sqlite3.connect("file:${dbPath}?mode=ro", uri=True)
result = {}
try:
    result["xp"] = int(conn.execute("SELECT COALESCE(SUM(amount),0) FROM xp_ledger").fetchone()[0] or 0)
except: result["xp"] = 0
try:
    result["total"] = conn.execute("SELECT COUNT(*) FROM trade_insights").fetchone()[0]
except: result["total"] = 0
try:
    r = conn.execute("SELECT SUM(CASE WHEN exit_reason='WIN' THEN 1 ELSE 0 END), SUM(CASE WHEN exit_reason='LOSS' THEN 1 ELSE 0 END) FROM trade_outcomes").fetchone()
    result["wins"] = int(r[0] or 0)
    result["losses"] = int(r[1] or 0)
except:
    result["wins"] = 0
    result["losses"] = 0
try:
    result["costToday"] = round(float(conn.execute("SELECT COALESCE(SUM(cost_usd),0) FROM cost_tracking WHERE date=date('now')").fetchone()[0] or 0), 4)
except: result["costToday"] = 0
conn.close()
print(json.dumps(result))
`;
      const pyResult = execSync(
        `/home/trevor/trevor/venv/bin/python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
        { encoding: "utf-8", timeout: 8000, cwd: "/home/trevor/trevor" }
      ).trim();
      const dbData = JSON.parse(pyResult);
      xp = dbData.xp || 0;
      signalStats.total = dbData.total || 0;
      signalStats.wins = dbData.wins || 0;
      signalStats.losses = dbData.losses || 0;
    } catch { /* DB query failed */ }

    rank = rankForXP(xp);

    return NextResponse.json({
      ok: true,
      trevor: { running: trevorRunning, pid: trevorPid },
      signals: signalStats,
      xp,
      rank,
      costToday: 0,
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      trevor: { running: false, pid: 0 },
      signals: signalStats,
      xp: 0,
      rank: "Intern Quant",
      error: String(err),
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
    });
  }
}
