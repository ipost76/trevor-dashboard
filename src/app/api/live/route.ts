import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RANK_THRESHOLDS = [
  [0, "Intern Quant"], [500, "Junior Analyst"], [1500, "Desk Analyst"],
  [3500, "Senior Analyst"], [7000, "Lead Strategist"], [12000, "Risk Officer"],
  [20000, "Portfolio Manager"], [32000, "Head of Alpha"], [50000, "Quant Director"],
  [75000, "Chief Analyst"], [110000, "Managing Director"], [160000, "Partner"],
  [220000, "CIO"], [300000, "Co-Founder"], [400000, "CEO"],
];

function rankForXP(xp: number): string {
  let rank = "Intern Quant";
  for (const [threshold, name] of RANK_THRESHOLDS) {
    if (xp >= (threshold as number)) rank = name as string;
    else break;
  }
  return rank;
}

export async function GET() {
  const start = Date.now();
  const dbPath = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";
  const logPath = process.env.TREVOR_LOG_PATH || "/home/trevor/trevor/logs/trevor.log";
  const trevorDir = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
  const pythonPath = trevorDir + "/venv/bin/python3";
  const dashboardDir = process.cwd();

  const data: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    latencyMs: 0,
    signals: { total: 0, wins: 0, losses: 0, pending: 0, winRate: 0 },
    xp: 0,
    rank: "Intern Quant",
    recentSignals: [],
    activeScalps: [],
    watchlist: [],
    trainingStats: { trades: 0, observations: 0, sentiment: 0, vectors: 0 },
    logs: [],
    securityEvents: [],
    costToday: 0,
  };

  try {
    const { execSync } = await import("child_process");

    // Use external Python script instead of inline to avoid shell escaping issues
    try {
      const scriptPath = dashboardDir + "/query_live.py";
      const pyResult = execSync(
        `${pythonPath} ${scriptPath} "${dbPath}"`,
        { encoding: "utf-8", timeout: 10000, cwd: trevorDir }
      ).trim();
      const db = JSON.parse(pyResult);

      data.xp = db.xp || 0;
      data.rank = rankForXP(db.xp || 0);
      data.signals = {
        total: db.total || 0,
        wins: db.outcomes?.wins || 0,
        losses: db.outcomes?.losses || 0,
        pending: 0,
        winRate: (db.outcomes?.wins || 0) + (db.outcomes?.losses || 0) > 0
          ? Math.round(((db.outcomes?.wins || 0) / ((db.outcomes?.wins || 0) + (db.outcomes?.losses || 0))) * 100)
          : 0,
      };
      data.recentSignals = db.recent || [];
      data.activeScalps = [];
      data.watchlist = db.watchlist || [];
      data.trainingStats = {
        trades: db.training?.trades || 0,
        observations: db.training?.observations || 0,
        sentiment: db.training?.sentiment || 0,
        vectors: 0,
      };
      data.securityEvents = db.security || [];
      data.costToday = db.cost_today || 0;
      data.dbSizeMB = db.db_size_mb || 0;
    } catch { /* DB failed */ }

    // Log tail
    try {
      const logs = execSync(`tail -20 "${logPath}" 2>/dev/null || echo ""`, { encoding: "utf-8", timeout: 2000 }).trim();
      data.logs = logs ? logs.split("\n").filter(Boolean) : [];
    } catch { /* graceful */ }

  } catch { /* graceful */ }

  data.latencyMs = Date.now() - start;
  return NextResponse.json(data);
}
