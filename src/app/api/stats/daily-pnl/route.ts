import { NextResponse } from "next/server";
import { runPythonInline, safeJsonParse } from "@/lib/api-helpers";

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
  FROM auto_trades
  WHERE status='closed' AND closed_at IS NOT NULL
  GROUP BY date(closed_at)
  ORDER BY date(closed_at) ASC
  LIMIT 90
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
    const raw = await runPythonInline(code, { timeout: 10000 });
    return NextResponse.json(safeJsonParse(raw, []), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    return NextResponse.json([], { status: 500 });
  }
}
