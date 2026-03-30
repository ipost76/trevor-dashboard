import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  const dbPath = process.env.TREVOR_DB_PATH || "/home/trevor/trevor/trevor.db";
  const logPath = process.env.TREVOR_LOG_PATH || "/home/trevor/trevor/logs/trevor.log";

  const data = {
    timestamp: new Date().toISOString(),
    latencyMs: 0,
    signals: { total: 0, wins: 0, losses: 0, pending: 0, winRate: 0 },
    xp: 0,
    rank: "Apprentice",
    recentSignals: [] as Array<{ id?: number; ticker: string; signal_type?: string; direction: string; confidence: number; outcome: string | null; entry_price?: number | null; target_price?: number | null; stop_price?: number | null; timeframe?: string; timestamp: string }>,
    activeScalps: [] as Array<{ ticker: string; direction: string; confidence: number; timestamp: string; entry_price?: number | null; leverage?: number; stop_price?: number | null; target_price?: number | null }>,
    watchlist: [] as Array<{ ticker: string; track: string; type: string }>,
    trainingStats: { trades: 0, observations: 0, sentiment: 0, vectors: 0 },
    logs: [] as string[],
  };

  try {
    const { execSync } = await import("child_process");

    // Query all dashboard data in one Python call
    try {
      const pyScript = `
import sqlite3, json
conn = sqlite3.connect("file:${dbPath}?mode=ro", uri=True)
result = {}

# XP
try:
    result["xp"] = int(conn.execute("SELECT COALESCE(SUM(amount),0) FROM xp_ledger").fetchone()[0])
except: result["xp"] = 0

# Trade insights (signals proxy)
try:
    total = conn.execute("SELECT COUNT(*) FROM trade_insights").fetchone()[0]
    result["total"] = total
except: result["total"] = 0

# Trade outcomes
try:
    rows = conn.execute("SELECT COUNT(*), SUM(CASE WHEN leveraged_pnl_pct > 0.1 THEN 1 ELSE 0 END), SUM(CASE WHEN leveraged_pnl_pct < -0.1 THEN 1 ELSE 0 END) FROM trade_outcomes WHERE leveraged_pnl_pct IS NOT NULL").fetchone()
    result["outcomes"] = {"decided": rows[0] or 0, "wins": int(rows[1] or 0), "losses": int(rows[2] or 0)}
except: result["outcomes"] = {"decided": 0, "wins": 0, "losses": 0}

# Recent trade insights (last 1 hour, non-NEUTRAL, oldest first)
try:
    rows = conn.execute("SELECT id, ticker, signal_type, confidence, entry_price, target_price, stop_price, timeframe, created_at FROM trade_insights WHERE created_at > datetime('now', '-1 hour') AND signal_type IN ('LONG', 'SHORT') ORDER BY created_at ASC").fetchall()
    result["recent"] = [{"id": r[0], "ticker": r[1], "signal_type": r[2] or "?", "direction": r[2] or "?", "confidence": round(float(r[3] or 0) * 100) if r[3] and float(r[3]) <= 1 else int(r[3] or 0), "entry_price": r[4], "target_price": r[5], "stop_price": r[6], "timeframe": r[7] or "", "timestamp": r[8] or ""} for r in rows]
except: result["recent"] = []

# Watchlist
try:
    rows = conn.execute("SELECT ticker, notes FROM watchlist ORDER BY ticker").fetchall()
    wl = []
    for r in rows:
        notes = r[1] or ""
        track = "lt"
        atype = "stock"
        for part in notes.split(","):
            if part.startswith("track="): track = part.split("=")[1]
            if part.startswith("type="): atype = part.split("=")[1]
        wl.append({"ticker": r[0], "track": track, "type": atype})
    result["watchlist"] = wl
except: result["watchlist"] = []

# Training stats
try:
    tt = conn.execute("SELECT COUNT(*) FROM training_trades").fetchone()[0]
    to = conn.execute("SELECT COUNT(*) FROM training_observations").fetchone()[0]
    ts = conn.execute("SELECT COUNT(*) FROM training_sentiment").fetchone()[0]
    result["training"] = {"trades": tt, "observations": to, "sentiment": ts}
except: result["training"] = {"trades": 0, "observations": 0, "sentiment": 0}

# Active trades (DB-persisted on TAKE/BUILDING)
try:
    rows = conn.execute("SELECT ticker, direction, confidence, opened_at, entry_price, leverage, stop_price, target_price FROM active_trades WHERE status='open' ORDER BY opened_at DESC").fetchall()
    result["active"] = [{"ticker": r[0], "direction": r[1] or "?", "confidence": int(r[2] or 0), "timestamp": r[3] or "", "entry_price": r[4], "leverage": r[5] or 1, "stop_price": r[6], "target_price": r[7]} for r in rows]
except: result["active"] = []

# Cost tracking (today)
try:
    cost = conn.execute("SELECT COALESCE(SUM(cost_usd),0) FROM cost_tracking WHERE date(created_at) = date('now')").fetchone()[0]
    result["cost_today"] = round(float(cost), 4)
except: result["cost_today"] = 0

conn.close()
print(json.dumps(result))
`;
      const pyResult = execSync(
        `/home/trevor/trevor/venv/bin/python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
        { encoding: "utf-8", timeout: 10000, cwd: "/home/trevor/trevor" }
      ).trim();
      const db = JSON.parse(pyResult);

      data.xp = db.xp || 0;
      data.signals.total = db.total || 0;
      data.signals.wins = db.outcomes?.wins || 0;
      data.signals.losses = db.outcomes?.losses || 0;
      const decided = data.signals.wins + data.signals.losses;
      data.signals.winRate = decided > 0 ? Math.round((data.signals.wins / decided) * 100) : 0;
      data.recentSignals = (db.recent || []).map((s: Record<string, unknown>) => ({ ...s, outcome: null }));
      data.activeScalps = db.active || [];
      data.watchlist = db.watchlist || [];
      data.trainingStats = { trades: db.training?.trades || 0, observations: db.training?.observations || 0, sentiment: db.training?.sentiment || 0, vectors: 0 };

      // Derive rank (matches memory.py RANK_THRESHOLDS)
      if (data.xp >= 5000) data.rank = "Head of Alpha";
      else if (data.xp >= 3000) data.rank = "Portfolio Mgr";
      else if (data.xp >= 1500) data.rank = "Risk Officer";
      else if (data.xp >= 800) data.rank = "Lead Strategist";
      else if (data.xp >= 400) data.rank = "Senior Analyst";
      else if (data.xp >= 150) data.rank = "Desk Analyst";
      else if (data.xp >= 50) data.rank = "Junior Analyst";
    } catch { /* DB failed — graceful */ }

    // Log tail
    try {
      const logs = execSync(`tail -8 "${logPath}" 2>/dev/null || echo ""`, { encoding: "utf-8", timeout: 2000 }).trim();
      data.logs = logs ? logs.split("\n").filter(Boolean) : [];
    } catch { /* graceful */ }

  } catch { /* graceful */ }

  data.latencyMs = Date.now() - start;
  return NextResponse.json(data);
}
