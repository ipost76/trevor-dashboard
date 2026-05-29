import { NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

let cache: { data: Record<string, unknown>; ts: number } | null = null;
const CACHE_TTL = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const code = `
import sqlite3, json, os
db = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = conn.cursor()
stats = {}
for r in cur.execute("SELECT ticker, direction, COUNT(*) as trades, SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) as wins, SUM(CASE WHEN pnl_pct <= 0 THEN 1 ELSE 0 END) as losses FROM trade_outcomes GROUP BY ticker, direction").fetchall():
    key = f"{r[0]}_{r[1]}"
    wr = round(r[3] / r[2] * 100, 1) if r[2] > 0 else 0
    stats[key] = {"wins": r[3], "losses": r[4], "trades": r[2], "wr": wr}
blocked = []
try:
    for r in cur.execute("SELECT ticker, direction FROM signal_filter_rules WHERE rule_type='BLOCK_DIRECTION' AND enabled=1").fetchall():
        blocked.append(f"{r[0]}_{r[1]}")
except:
    pass
conn.close()
print(json.dumps({"stats": stats, "blocked": blocked}))
`;
    const raw = await runPythonInline(code, { timeout: 5000 });
    const data = JSON.parse(raw);
    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ stats: {}, blocked: [] });
  }
}
