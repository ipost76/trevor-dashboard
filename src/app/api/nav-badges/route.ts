import { NextResponse } from "next/server";
import { PYTHON_PATH, TREVOR_DIR } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

let cache: { data: Record<string, unknown>; ts: number } | null = null;
const CACHE_TTL = 30_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const { execSync } = await import("child_process");
    const code = `
import sqlite3, json, os
db = os.environ.get("TREVOR_DB_PATH", "/home/trevor/trevor/trevor.db")
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
cur = conn.cursor()
active = cur.execute("SELECT COUNT(*) FROM active_trades WHERE status='open'").fetchone()[0]
signals = cur.execute("SELECT COUNT(*) FROM trade_insights WHERE created_at > datetime('now', '-30 minutes')").fetchone()[0]
try:
    overdue = cur.execute("SELECT COUNT(*) FROM reminders WHERE status != 'completed' AND due_at < datetime('now')").fetchone()[0]
except:
    overdue = 0
filters = []
try:
    rows = cur.execute("SELECT id, rule_type, ticker, direction, value, reason FROM signal_filter_rules WHERE enabled = 1").fetchall()
    for r in rows:
        filters.append({"id": r[0], "rule_type": r[1], "ticker": r[2], "direction": r[3], "value": r[4], "reason": r[5]})
except:
    pass
conn.close()
print(json.dumps({"activeTrades": active, "recentSignals": signals, "overdueReminders": overdue, "filters": filters, "filterCount": len(filters)}))
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
    return NextResponse.json({ activeTrades: 0, recentSignals: 0, overdueReminders: 0, filters: [], filterCount: 0 });
  }
}
