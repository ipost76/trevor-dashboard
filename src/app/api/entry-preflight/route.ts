import { NextRequest, NextResponse } from "next/server";
import { PYTHON_PATH, TREVOR_DIR } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker") || "";
  const direction = (request.nextUrl.searchParams.get("direction") || "LONG").toUpperCase();

  try {
    const { execSync } = await import("child_process");
    const code = `
import sqlite3, json, sys
db_path = "/home/trevor/trevor/trevor.db"
conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
cur = conn.cursor()

ticker = "${ticker.replace(/"/g, "")}"
direction = "${direction.replace(/"/g, "")}"

# Capital + exposure
capital = 50.0
try:
    row = cur.execute("SELECT value FROM trevor_config WHERE key='trading_capital'").fetchone()
    if row: capital = float(row[0])
except: pass
current_margin = cur.execute("SELECT COALESCE(SUM(margin_usd), 0) FROM active_trades WHERE status='open'").fetchone()[0]

# Track record
rec = cur.execute("SELECT COUNT(*) as total, SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) as wins, SUM(CASE WHEN pnl_pct <= 0 THEN 1 ELSE 0 END) as losses FROM trade_outcomes WHERE ticker=? AND direction=?", (ticker, direction)).fetchone()

# Block status
blocked = False
block_reason = None
try:
    blk = cur.execute("SELECT reason FROM signal_filter_rules WHERE rule_type='BLOCK_DIRECTION' AND enabled=1 AND ticker=? AND direction=?", (ticker, direction)).fetchone()
    if blk:
        blocked = True
        block_reason = blk[0]
except: pass

conn.close()
wr = round(rec[1] / rec[0] * 100, 1) if rec[0] and rec[0] > 0 else 0
print(json.dumps({
    "capital": capital,
    "currentMargin": current_margin,
    "percentUsed": round(current_margin / capital * 100, 1) if capital > 0 else 0,
    "record": {"total": rec[0] or 0, "wins": rec[1] or 0, "losses": rec[2] or 0, "wr": wr},
    "blocked": blocked,
    "blockReason": block_reason,
}))
`;
    const raw = execSync(`${PYTHON_PATH} -`, {
      input: code,
      encoding: "utf-8",
      timeout: 5000,
      cwd: TREVOR_DIR,
      env: { ...process.env, HOME: "/home/trevor" },
    }).trim();
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ capital: 50, currentMargin: 0, percentUsed: 0, record: { total: 0, wins: 0, losses: 0, wr: 0 }, blocked: false, blockReason: null });
  }
}
