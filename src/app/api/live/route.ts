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

    try {
      const pyScript = `
import sqlite3, json
conn = sqlite3.connect("file:${dbPath}?mode=ro", uri=True)
result = {}

# XP
try:
    result["xp"] = int(conn.execute("SELECT COALESCE(SUM(amount),0) FROM xp_ledger").fetchone()[0] or 0)
except: result["xp"] = 0

# Trade insights count
try:
    result["total"] = conn.execute("SELECT COUNT(*) FROM trade_insights").fetchone()[0]
except: result["total"] = 0

# Trade outcomes
try:
    rows = conn.execute("SELECT COUNT(*), SUM(CASE WHEN exit_reason='WIN' THEN 1 ELSE 0 END), SUM(CASE WHEN exit_reason='LOSS' THEN 1 ELSE 0 END) FROM trade_outcomes").fetchone()
    result["outcomes"] = {"decided": rows[0] or 0, "wins": int(rows[1] or 0), "losses": int(rows[2] or 0)}
except: result["outcomes"] = {"decided": 0, "wins": 0, "losses": 0}

# Recent trade insights
try:
    rows = conn.execute("SELECT id, ticker, signal_type, confidence, entry_price, target_price, stop_price, outcome, created_at FROM trade_insights ORDER BY created_at DESC LIMIT 10").fetchall()
    result["recent"] = [{"id": r[0], "ticker": r[1], "signal_type": r[2] or "", "direction": "LONG", "confidence": round(float(r[3] or 0) * 100) if r[3] and float(r[3]) <= 1 else int(r[3] or 0), "entry_price": r[4], "target_price": r[5], "stop_price": r[6], "outcome": r[7], "timestamp": r[8] or ""} for r in rows]
except: result["recent"] = []

# Watchlist
try:
    rows = conn.execute("SELECT ticker, mode, asset_type, notes, priority FROM watchlist ORDER BY ticker").fetchall()
    result["watchlist"] = [{"ticker": r[0], "mode": r[1] or "lt", "asset_type": r[2] or "stock", "notes": r[3] or "", "priority": r[4] or 2} for r in rows]
except: result["watchlist"] = []

# Training stats
try:
    tt = conn.execute("SELECT COUNT(*) FROM training_trades").fetchone()[0]
    to2 = conn.execute("SELECT COUNT(*) FROM training_observations").fetchone()[0]
    ts = conn.execute("SELECT COUNT(*) FROM training_sentiment").fetchone()[0]
    result["training"] = {"trades": tt, "observations": to2, "sentiment": ts}
except: result["training"] = {"trades": 0, "observations": 0, "sentiment": 0}

# Cost tracking (today)
try:
    cost = conn.execute("SELECT COALESCE(SUM(cost_usd),0) FROM cost_tracking WHERE date=date('now')").fetchone()[0]
    result["cost_today"] = round(float(cost or 0), 4)
except: result["cost_today"] = 0

# Security events (last 20)
try:
    rows = conn.execute("SELECT id, event_type, severity, description, file_path, created_at FROM security_events ORDER BY created_at DESC LIMIT 20").fetchall()
    result["security"] = [{"id": r[0], "event_type": r[1], "severity": r[2], "description": r[3], "file_path": r[4], "created_at": r[5]} for r in rows]
except: result["security"] = []

# DB size
try:
    import os
    result["db_size_mb"] = round(os.path.getsize("${dbPath}") / 1048576, 1)
except: result["db_size_mb"] = 0

conn.close()
print(json.dumps(result))
`;
      const pyResult = execSync(
        `/home/trevor/trevor/venv/bin/python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
        { encoding: "utf-8", timeout: 10000, cwd: "/home/trevor/trevor" }
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
      const logs = execSync(`tail -15 "${logPath}" 2>/dev/null || echo ""`, { encoding: "utf-8", timeout: 2000 }).trim();
      data.logs = logs ? logs.split("\n").filter(Boolean) : [];
    } catch { /* graceful */ }

  } catch { /* graceful */ }

  data.latencyMs = Date.now() - start;
  return NextResponse.json(data);
}
