import { NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export const dynamic = "force-dynamic";

// RM-DASH 2026-05-29: single-flight + SWR (60s) so a cold-cache burst spawns ONE
// Python child per window, not N. The route's existing try/catch around swr()
// preserves the exact cold-failure contract (the {stats:[],blocked:[]} fallback).
const cache = createSwrCache<Record<string, unknown>>({ defaultTtl: 60_000, concurrency: 2 });

const PY = `
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

export async function GET() {
  try {
    const { value } = await cache.swr("trade-stats", async () => {
      const raw = await runPythonInline(PY, { timeout: 5000 });
      return JSON.parse(raw);
    });
    return NextResponse.json(value);
  } catch {
    return NextResponse.json({ stats: {}, blocked: [] });
  }
}
