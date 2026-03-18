import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  const dbPath = "/home/trevor/trevor/autotrader/autotrader.db";

  const data: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    latencyMs: 0,
    engine: { running: false, paused: false, universe: 0 },
    account: { equity: 0, cash: 0, daytradeCount: 0 },
    dailyPnl: 0,
    positions: [] as Array<Record<string, unknown>>,
    recentTrades: [] as Array<Record<string, unknown>>,
    recentSignals: [] as Array<Record<string, unknown>>,
    stats: { total: 0, wins: 0, losses: 0, winRate: 0, profitFactor: 0, totalPnl: 0 },
    budget: { spent: 0, remaining: 0.15, calls: 0, exceeded: false },
    calibration: null,
  };

  try {
    const { execSync } = await import("child_process");

    const pyScript = `
import sqlite3, json, os

db = "${dbPath}"
if not os.path.exists(db):
    print(json.dumps({"error": "no_db"}))
    exit()

conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
result = {}

# Open positions
try:
    rows = conn.execute("SELECT ticker, side, entry_price, qty, stop_price, target_price, entry_time, signal_score FROM positions WHERE status = 'open'").fetchall()
    result["positions"] = [dict(r) for r in rows]
except: result["positions"] = []

# Recent trades (last 20)
try:
    rows = conn.execute("SELECT ticker, side, entry_price, exit_price, qty, pnl, pnl_pct, exit_reason, entry_time, exit_time, signal_score FROM trades ORDER BY id DESC LIMIT 20").fetchall()
    result["trades"] = [dict(r) for r in rows]
except: result["trades"] = []

# Recent signals (last 15)
try:
    rows = conn.execute("SELECT ticker, direction, tier3_score, action, created_at FROM signals ORDER BY id DESC LIMIT 15").fetchall()
    result["signals"] = [dict(r) for r in rows]
except: result["signals"] = []

# Trade stats
try:
    all_trades = conn.execute("SELECT pnl, pnl_pct FROM trades WHERE exit_price IS NOT NULL").fetchall()
    total = len(all_trades)
    wins = sum(1 for t in all_trades if t[0] and t[0] > 0)
    losses = sum(1 for t in all_trades if t[0] and t[0] < 0)
    total_won = sum(t[0] for t in all_trades if t[0] and t[0] > 0)
    total_lost = abs(sum(t[0] for t in all_trades if t[0] and t[0] < 0))
    pf = total_won / total_lost if total_lost > 0 else (999.99 if total_won > 0 else 0)
    result["stats"] = {
        "total": total, "wins": wins, "losses": losses,
        "winRate": round(wins / total * 100, 1) if total else 0,
        "profitFactor": round(pf, 2),
        "totalPnl": round(sum(t[0] or 0 for t in all_trades), 2),
        "avgPnlPct": round(sum(t[1] or 0 for t in all_trades) / total, 2) if total else 0,
    }
except: result["stats"] = {}

# Daily PnL
try:
    row = conn.execute("SELECT COALESCE(SUM(pnl), 0) FROM trades WHERE exit_time LIKE date('now') || '%'").fetchone()
    result["dailyPnl"] = round(float(row[0]), 2)
except: result["dailyPnl"] = 0

# Budget
try:
    row = conn.execute("SELECT COALESCE(SUM(cost_usd), 0), COALESCE(SUM(calls), 0), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0) FROM budget WHERE date = date('now')").fetchone()
    spent = float(row[0])
    result["budget"] = {"spent": round(spent, 4), "remaining": round(0.15 - spent, 4), "calls": int(row[1]), "exceeded": spent >= 0.15}
except: result["budget"] = {"spent": 0, "remaining": 0.15, "calls": 0, "exceeded": False}

# Latest calibration
try:
    row = conn.execute("SELECT threshold, win_rate, sample_size, adjustment, computed_at FROM calibration ORDER BY id DESC LIMIT 1").fetchone()
    if row: result["calibration"] = dict(row)
except: pass

# Last scan
try:
    row = conn.execute("SELECT scan_time, tickers_scanned, tier1_passed, signals_generated, trades_opened, duration_ms, mode FROM scans ORDER BY id DESC LIMIT 1").fetchone()
    if row: result["lastScan"] = dict(row)
except: pass

conn.close()
print(json.dumps(result, default=str))
`;

    try {
      const pyResult = execSync(
        `python3 -c '${pyScript.replace(/'/g, "'\"'\"'")}'`,
        { encoding: "utf-8", timeout: 10000, cwd: "/home/trevor/trevor" }
      ).trim();
      const db = JSON.parse(pyResult);

      if (db.error === "no_db") {
        data.engine = { running: false, paused: false, universe: 0, status: "not_initialized" };
      } else {
        data.positions = db.positions || [];
        data.recentTrades = db.trades || [];
        data.recentSignals = db.signals || [];
        data.stats = db.stats || data.stats;
        data.dailyPnl = db.dailyPnl || 0;
        data.budget = db.budget || data.budget;
        data.calibration = db.calibration || null;
        data.lastScan = db.lastScan || null;
      }
    } catch { /* DB query failed */ }

  } catch { /* graceful */ }

  data.latencyMs = Date.now() - start;
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "pause" || action === "resume") {
      // Write action to a file that the engine monitors
      const { execSync } = await import("child_process");
      execSync(`echo '${action}' > /home/trevor/trevor/autotrader/.engine_command`, {
        timeout: 2000,
      });
      return NextResponse.json({ ok: true, action });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
