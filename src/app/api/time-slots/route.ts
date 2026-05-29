import { NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export const dynamic = "force-dynamic";

// RM-DASH 2026-05-29: single-flight + SWR (60s) so a cold-cache burst spawns ONE
// Python child per window, not N. The route's existing try/catch around swr()
// preserves the exact cold-failure fallback contract ({slots:{}}).
const cache = createSwrCache<Record<string, unknown>>({ defaultTtl: 60_000, concurrency: 2 });

const PY = `
import sqlite3, json
db = "/home/trevor/trevor/trevor.db"
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = conn.cursor()
slots = {}
for r in cur.execute("""
    SELECT
      CASE
        WHEN CAST(strftime('%H', created_at) AS INT) BETWEEN 0 AND 3 THEN '00-03'
        WHEN CAST(strftime('%H', created_at) AS INT) BETWEEN 4 AND 7 THEN '04-07'
        WHEN CAST(strftime('%H', created_at) AS INT) BETWEEN 8 AND 11 THEN '08-11'
        WHEN CAST(strftime('%H', created_at) AS INT) BETWEEN 12 AND 15 THEN '12-15'
        WHEN CAST(strftime('%H', created_at) AS INT) BETWEEN 16 AND 19 THEN '16-19'
        ELSE '20-23'
      END as hb,
      strftime('%w', created_at) as dow,
      COUNT(*) as trades,
      SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) as wins
    FROM trade_outcomes
    GROUP BY hb, dow
""").fetchall():
    key = f"{r[0]}_{r[1]}"
    wr = round(r[3] / r[2] * 100, 1) if r[2] > 0 else 0
    slots[key] = {"trades": r[2], "wins": r[3], "wr": wr}
conn.close()
print(json.dumps({"slots": slots}))
`;

export async function GET() {
  try {
    const { value } = await cache.swr("time-slots", async () => {
      const raw = await runPythonInline(PY, { timeout: 5000 });
      return JSON.parse(raw);
    });
    return NextResponse.json(value);
  } catch {
    return NextResponse.json({ slots: {} });
  }
}
