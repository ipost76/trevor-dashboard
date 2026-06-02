import { NextResponse } from "next/server";
import { runPythonInline } from "@/lib/api-helpers";
import { createSwrCache } from "@/lib/single-flight";

export const dynamic = "force-dynamic";

// PERF-02 (2026-06-02): was uncached — added single-flight + SWR (5min, matching
// its analytics siblings) so a cold-cache burst spawns ONE Python child per
// window, not N. The try/catch around swr() preserves the cold-failure 500.
const cache = createSwrCache<unknown>({ defaultTtl: 300_000, concurrency: 2 });

export async function GET() {
  try {
    const pyScript = `
import sqlite3, json

DB = "/home/trevor/trevor/trevor.db"
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

rows = conn.execute("""
    SELECT regime_at_entry, COUNT(*) as trades,
           ROUND(AVG(CASE WHEN pnl_pct > 0 THEN 1.0 ELSE 0.0 END)*100, 1) as win_rate,
           ROUND(AVG(pnl_pct), 2) as avg_pnl
    FROM trade_outcomes
    WHERE regime_at_entry IS NOT NULL AND regime_at_entry != ''
    GROUP BY regime_at_entry
    ORDER BY trades DESC
""").fetchall()

total_with = sum(r["trades"] for r in rows)
total_without = conn.execute("SELECT COUNT(*) FROM trade_outcomes WHERE regime_at_entry IS NULL OR regime_at_entry = ''").fetchone()[0]
conn.close()

regimes = [{"regime": r["regime_at_entry"], "trades": r["trades"], "win_rate": r["win_rate"], "avg_pnl": r["avg_pnl"]} for r in rows]

if total_with == 0:
    print(json.dumps({"available": False, "reason": "No regime data available for closed trades.", "total_trades_with_regime": 0, "total_trades_without_regime": total_without, "regimes": [], "recommendation": None}))
else:
    best = max(regimes, key=lambda x: x["win_rate"]) if regimes else None
    rec = f"Best regime: {best['regime']} ({best['win_rate']}% WR across {best['trades']} trades)" if best else None
    print(json.dumps({"available": True, "total_trades_with_regime": total_with, "total_trades_without_regime": total_without, "regimes": regimes, "recommendation": rec}))
`;

    const { value } = await cache.swr("regime-performance", async () => {
      const pyResult = await runPythonInline(pyScript, { timeout: 10000 });
      return JSON.parse(pyResult);
    });
    return NextResponse.json(value);
  } catch (error) {
    console.error("[Analytics Regime] Error:", error);
    return NextResponse.json({ available: false, reason: "Query failed", regimes: [] }, { status: 500 });
  }
}
