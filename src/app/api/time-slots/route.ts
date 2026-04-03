import { NextResponse } from "next/server";
import { PYTHON_PATH, TREVOR_DIR } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

let cache: { data: Record<string, unknown>; ts: number } | null = null;
const CACHE_TTL = 60_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const { execSync } = await import("child_process");
    const code = `
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
    const raw = execSync(`${PYTHON_PATH} -`, {
      input: code,
      encoding: "utf-8",
      timeout: 5000,
      cwd: TREVOR_DIR,
      env: { ...process.env, HOME: "/home/trevor" },
    }).trim();
    const data = JSON.parse(raw);
    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ slots: {} });
  }
}
