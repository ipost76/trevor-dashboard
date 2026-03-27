import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const code = `
import sqlite3, json, os
db = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
rows = conn.execute("""
  SELECT date(closed_at) as date,
         COUNT(*) as trades,
         ROUND(SUM(pnl_pct), 2) as daily_pnl,
         SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) as wins
  FROM active_trades
  WHERE status='closed' AND closed_at IS NOT NULL
  GROUP BY date(closed_at)
  ORDER BY date(closed_at) ASC
""").fetchall()
conn.close()
result = [{"date": r["date"], "trades": r["trades"], "pnl": r["daily_pnl"], "wins": r["wins"]} for r in rows]
# Also compute cumulative
cum = 0
for r in result:
    cum += r["pnl"] or 0
    r["cumulative"] = round(cum, 2)
print(json.dumps(result))
`;
    const { execSync } = require("child_process");
    const raw = execSync(
      `${process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor"}/venv/bin/python3 -`,
      { input: code, encoding: "utf-8", timeout: 10000, env: { ...process.env, HOME: "/home/trevor" } }
    ).trim();
    return NextResponse.json(safeJsonParse(raw, []));
  } catch (err) {
    return NextResponse.json([], { status: 500 });
  }
}
